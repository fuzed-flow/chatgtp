import { stableRequestId } from "../_shared/salesNotifications.js";
import { authorizeReminderCron } from "../_shared/cronAuth.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const configuredAppUrl = Deno.env.get("APP_URL");
const APP_URL = configuredAppUrl && !/^https?:\/\/(?:app\.)?pro-trades\.(?:com|ca)(?:\/|$)/i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, "")
  : "https://app.fuzedflow.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const asOne = value => Array.isArray(value) ? value[0] : value;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const accepted = async response => {
  try {
    const result = await response.json();
    return response.ok && result?.success === true;
  } catch {
    return false;
  }
};

serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return new Response("Reminder service unavailable", { status: 503 });
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!await authorizeReminderCron(request, db)) return new Response("Authentication required", { status: 401 });

    const { data: orders, error: fetchError } = await db.from("change_orders").select(`
      id, change_order_number, title, status, created_at, sent_at, next_follow_up_date,
      automation_stage, client_id, project_id, company_id,
      companies ( id, name, settings ),
      clients ( name, email, phone ),
      projects ( client_id, clients ( name, email, phone ) )
    `).in("status", ["Sent", "Viewed"]);
    if (fetchError) throw fetchError;

    let emails = 0;
    let sms = 0;
    let failed = 0;
    let eligible = 0;

    for (const order of orders || []) {
      const company = asOne(order.companies);
      const project = asOne(order.projects);
      const client = asOne(project?.clients) || asOne(order.clients);
      const automations = company?.settings?.automations;
      if (!automations || automations.co_enabled !== true || (!client?.email && !client?.phone)) continue;

      const stage = Number.isInteger(order.automation_stage) ? order.automation_stage : 0;
      if (stage !== 0) continue;
      const followUpDays = Math.max(1, Number.parseInt(automations.co_followup_1, 10) || 2);
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(order.sent_at || order.created_at).getTime()) / DAY_MS));
      const today = new Date().toISOString().slice(0, 10);
      if (order.next_follow_up_date ? String(order.next_follow_up_date) > today : ageDays < followUpDays) continue;
      eligible += 1;

      const { data: token, error: tokenError } = await db.rpc("issue_change_order_reminder_share_token", {
        p_change_order: order.id,
      });
      if (tokenError || typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
        failed += 1;
        continue;
      }

      const portalUrl = new URL("/PublicChangeOrderView", APP_URL);
      portalUrl.searchParams.set("id", order.id);
      portalUrl.searchParams.set("token", token);
      const portalLink = portalUrl.toString();
      const firstName = client.name ? String(client.name).split(" ")[0] : "there";
      const companyName = company.name || "your contractor";
      const title = order.title ? ` for ${order.title}` : "";
      const subject = `Action required: Change Order #${order.change_order_number}${title}`;
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334155;line-height:1.6;font-size:16px;max-width:600px"><p>Hi ${escapeHtml(firstName)},</p><p>Change Order #${escapeHtml(order.change_order_number)}${escapeHtml(title)} is awaiting your review. Please review it so your project can continue on schedule.</p><p><a href="${escapeHtml(portalLink)}" style="background-color:#f59e0b;color:#111827;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:700;display:inline-block">Review &amp; Approve Change Order</a></p><p>If you have questions, please contact ${escapeHtml(companyName)}.</p></div>`;
      const smsBody = `Hi ${firstName}. ${companyName} is waiting for your review of Change Order #${order.change_order_number}. Review it securely here: ${portalLink}`;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
      const deliveries = [];

      if (client.email) {
        deliveries.push(fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST", headers,
          body: JSON.stringify({
            to_email: client.email, subject, html_body: html,
            client_id: order.client_id || project?.client_id || null,
            company_id: company.id, document_type: "change_order", document_id: order.id,
            notification_kind: "followup", track_replies: true,
            request_id: await stableRequestId(`co:${order.id}:followup:1:email`),
          }),
        }).then(async response => { if (await accepted(response)) emails += 1; else throw new Error("email rejected"); }));
      }
      if (client.phone) {
        deliveries.push(fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST", headers,
          body: JSON.stringify({
            phone_number: client.phone, message_body: smsBody,
            client_id: order.client_id || project?.client_id || null,
            company_id: company.id, document_type: "change_order", document_id: order.id,
            notification_kind: "followup",
            request_id: await stableRequestId(`co:${order.id}:followup:1:sms`),
          }),
        }).then(async response => { if (await accepted(response)) sms += 1; else throw new Error("sms rejected"); }));
      }

      try {
        await Promise.all(deliveries);
        let update = db.from("change_orders").update({
          automation_stage: 1, next_follow_up_date: null, last_reminder_sent_at: new Date().toISOString(),
        }).eq("id", order.id).eq("company_id", order.company_id).eq("status", order.status);
        update = order.automation_stage == null
          ? update.is("automation_stage", null)
          : update.eq("automation_stage", order.automation_stage);
        const { data: updated, error: updateError } = await update.select("id").maybeSingle();
        if (updateError || !updated) throw updateError || new Error("Change order changed during reminder delivery");
      } catch {
        failed += 1;
      }
    }

    return Response.json({ success: failed === 0, scanned: orders?.length || 0, eligible, emails, sms, failed }, { status: failed ? 207 : 200 });
  } catch {
    return Response.json({ error: "Change-order reminders could not finish." }, { status: 500 });
  }
});
