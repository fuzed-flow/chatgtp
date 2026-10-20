import { stableRequestId } from "../_shared/salesNotifications.js";
import { authorizeReminderCron } from "../_shared/cronAuth.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const configuredAppUrl = Deno.env.get("APP_URL");
const APP_URL = configuredAppUrl && !/^https?:\/\/(?:app\.)?pro-trades\.(?:com|ca)(?:\/|$)/i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, "")
  : "https://app.fuzedflow.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const positiveDays = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};
const dateOnly = value => new Date(value).toISOString().slice(0, 10);
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

    const { data: quotes, error: fetchError } = await db.from("quotes").select(`
      id, quote_number, title, status, created_at, sent_at, next_follow_up_date,
      automation_stage, client_id, lead_id, company_id
    `).in("status", ["Sent", "Viewed"]);
    if (fetchError) throw fetchError;

    let emails = 0;
    let sms = 0;
    let failed = 0;
    let eligible = 0;

    for (const quote of quotes || []) {
      const [{ data: company }, { data: directClient }, { data: lead }] = await Promise.all([
        db.from("companies").select("id,name,settings").eq("id", quote.company_id).maybeSingle(),
        quote.client_id ? db.from("clients").select("name,email,phone").eq("id", quote.client_id).eq("company_id", quote.company_id).maybeSingle() : Promise.resolve({ data: null }),
        quote.lead_id ? db.from("leads").select("contact_name,contact_email,contact_phone").eq("id", quote.lead_id).eq("company_id", quote.company_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const recipient = directClient || (lead ? {
        name: lead.contact_name, email: lead.contact_email, phone: lead.contact_phone,
      } : null);
      const automations = company?.settings?.automations;
      if (!automations || automations.quote_enabled !== true || (!recipient?.email && !recipient?.phone)) continue;

      const { data: approval, error: approvalError } = await db.from("quote_approvals")
        .select("approval_token,sent_at")
        .eq("quote_id", quote.id)
        .eq("company_id", quote.company_id)
        .or("approval_status.is.null,approval_status.neq.Revoked")
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      const token = approval?.approval_token;
      if (approvalError || typeof token !== "string" || token.length < 32 || token.length > 256) continue;

      const stage = Number.isInteger(quote.automation_stage) ? quote.automation_stage : 0;
      const firstDays = positiveDays(automations.quote_followup_1, 3);
      const finalDays = Math.max(positiveDays(automations.quote_followup_2, 7), firstDays + 1);
      const sentAt = approval.sent_at || quote.sent_at || quote.created_at;
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(sentAt).getTime()) / DAY_MS));
      const today = dateOnly(new Date());
      const nextDue = quote.next_follow_up_date ? String(quote.next_follow_up_date) : null;

      let newStage = null;
      if (stage === 0 && (nextDue ? nextDue <= today : ageDays >= firstDays)) newStage = 1;
      if (stage === 1 && (nextDue ? nextDue <= today : ageDays >= finalDays)) newStage = 2;
      if (newStage === null) continue;
      eligible += 1;

      const title = quote.title ? ` for ${quote.title}` : "";
      const subject = newStage === 1
        ? `Checking in: Quote #${quote.quote_number}${title}`
        : `Following up: Quote #${quote.quote_number}${title}`;
      const greeting = escapeHtml(recipient.name || "there");
      const portalLink = new URL(`/PublicQuoteView/${encodeURIComponent(quote.id)}/${encodeURIComponent(token)}`, APP_URL).toString();
      const message = newStage === 1
        ? "We wanted to check whether you have any questions about your quote."
        : "We are following up one last time in case you would like to review or discuss your quote.";
      const html = `<p>Hi ${greeting},</p><p>${message}</p><p><a href="${escapeHtml(portalLink)}" style="background-color:#f59e0b;color:#111827;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Review Your Quote</a></p>`;
      const smsBody = `Hi ${recipient.name ? String(recipient.name).split(" ")[0] : "there"}. ${message} Review Quote #${quote.quote_number}: ${portalLink}`;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
      const deliveries = [];

      if (recipient.email) {
        deliveries.push(fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST", headers,
          body: JSON.stringify({
            to_email: recipient.email, to: recipient.email, subject, html_body: html, html,
            client_id: quote.client_id, lead_id: quote.lead_id, company_id: company.id,
            document_type: "quote", document_id: quote.id, notification_kind: "followup", track_replies: true,
            request_id: await stableRequestId(`quote:${quote.id}:followup:${newStage}:email`),
          }),
        }).then(async response => { if (await accepted(response)) emails += 1; else throw new Error("email rejected"); }));
      }
      if (recipient.phone) {
        deliveries.push(fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST", headers,
          body: JSON.stringify({
            phone_number: recipient.phone, message_body: smsBody,
            client_id: quote.client_id, lead_id: quote.lead_id, company_id: company.id,
            document_type: "quote", document_id: quote.id, notification_kind: "followup",
            request_id: await stableRequestId(`quote:${quote.id}:followup:${newStage}:sms`),
          }),
        }).then(async response => { if (await accepted(response)) sms += 1; else throw new Error("sms rejected"); }));
      }

      try {
        await Promise.all(deliveries);
        const patch: Record<string, unknown> = { automation_stage: newStage, next_follow_up_date: null };
        if (newStage === 1) {
          patch.next_follow_up_date = dateOnly(new Date(Date.now() + Math.max(finalDays - firstDays, 1) * DAY_MS));
        }
        let update = db.from("quotes").update(patch)
          .eq("id", quote.id).eq("company_id", quote.company_id).eq("status", quote.status);
        update = quote.automation_stage == null
          ? update.is("automation_stage", null)
          : update.eq("automation_stage", quote.automation_stage);
        const { data: updated, error: updateError } = await update.select("id").maybeSingle();
        if (updateError || !updated) throw updateError || new Error("Quote changed during reminder delivery");
      } catch {
        failed += 1;
      }
    }

    return Response.json({ success: failed === 0, scanned: quotes?.length || 0, eligible, emails, sms, failed }, { status: failed ? 207 : 200 });
  } catch {
    return Response.json({ error: "Quote reminders could not finish." }, { status: 500 });
  }
});
