import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { registerDelivery, recordSalesOutcome } from "../_shared/salesNotifications.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const documents: Record<string, { table: string; number: string }> = {
  quote_viewed: { table: "quotes", number: "quote_number" },
  quote_approved: { table: "quotes", number: "quote_number" },
  quote_change_requested: { table: "quotes", number: "quote_number" },
  co_viewed: { table: "change_orders", number: "change_order_number" },
  co_approved: { table: "change_orders", number: "change_order_number" },
  change_order_requested: { table: "change_orders", number: "change_order_number" },
  invoice_viewed: { table: "invoices", number: "invoice_number" },
  payment_received: { table: "invoices", number: "invoice_number" },
  partial_payment_received: { table: "invoices", number: "invoice_number" },
  payment_failed: { table: "invoices", number: "invoice_number" },
  po_viewed: { table: "purchase_orders", number: "po_number" },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const relaySecret = req.headers.get("X-Notification-Cron-Secret") || "";
    if ((!bearer || bearer === Deno.env.get("SUPABASE_ANON_KEY")) && !relaySecret) return respond({error:"Authentication required"},401);
    const db = createClient(url, key);
    let service = bearer === key;
    if (!service && relaySecret) {
      const {data:config,error} = await db.rpc('notification_delivery_server_config');
      if(error || !config?.notification_cron_secret) return respond({error:"Relay configuration unavailable"},503);
      const expected=String(config.notification_cron_secret);
      let difference=relaySecret.length ^ expected.length;
      for(let i=0;i<Math.max(relaySecret.length,expected.length);i++) difference|=(relaySecret.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
      service=difference===0;
      if(!service) return respond({error:"Authentication required"},401);
    }
    const input = await req.json();
    // Historical database webhooks lack event keys. Row triggers now create their in-app alerts.
    if (input.type === "UPDATE" && !input.event_key) return respond({ success: true, skipped: "database event handled by trigger" });
    const event = input.event_key === "quote_change_request" ? "quote_change_requested" : input.event_key;
    const config = documents[event];
    if (!config || !uuid.test(input.company_id || "")) return respond({ error: "Unsupported event" }, 400);
    let actor: { id: string; company_id: string; is_active: boolean; role: string } | null = null;
    if (bearer && !service) {
      const { data: auth } = await db.auth.getUser(bearer);
      if (auth.user) {
        const { data } = await db.from("profiles").select("id, company_id, is_active, role").eq("id", auth.user.id).maybeSingle();
        actor = data;
        if (!actor || actor.company_id !== input.company_id || actor.is_active === false) actor = null;
      }
    }
    if (!service && !actor) return respond({error:"Authentication required"},401);
    if (event.startsWith("payment_") || event === "partial_payment_received") {
      if (!service && (!actor || !["owner", "admin", "office"].includes(actor.role))) return respond({ error: "Finance access required" }, 403);
    }
    const reader = service ? db : createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{global:{headers:{Authorization:`Bearer ${bearer}`}}});
    let query = reader.from(config.table).select("*").eq("company_id", input.company_id);
    if (uuid.test(input.document_uuid || input.document_id || "")) query = query.eq("id", input.document_uuid || input.document_id);
    else {
      // Backwards-compatible relay for already-open portal pages.
      if (typeof input.document_id !== "string" || input.document_id.length > 100) return respond({ error: "Document required" }, 400);
      query = query.eq(config.number, input.document_id);
    }
    const { data: document, error } = await query.maybeSingle();
    if (error || !document) return respond({ error: "Document unavailable" }, 404);
    const status = String(document.status || "").toLowerCase();
    if (!actor && !service && ["draft", "cancelled", "canceled", "void"].includes(status)) return respond({ error: "Document unavailable" }, 403);
    if (event.endsWith("_approved") && !["approved", "accepted"].includes(status)) return respond({ error: "Approval is not recorded" }, 409);
    // An internal preview is not a client view.
    if (actor && event.endsWith("_viewed")) return respond({ success: true, skipped: "internal preview" });
    const customerMessage = String(input.message_body || "Document activity").slice(0, 2000);
    const portalEvent = ["quote_viewed", "co_viewed", "invoice_viewed", "quote_change_requested", "change_order_requested"].includes(event);
    const { data: claimed, error: claimError } = await db.rpc(portalEvent ? "process_portal_notification" : "claim_notification_delivery", {
      p_company: document.company_id, p_document: document.id, p_event: event, p_message: customerMessage,
    });
    if (claimError) throw claimError;
    if (!claimed) return respond({ success: true, duplicate: true });
    // Approvals, payment changes, and all internal events are generated from database state.
    const { data: company, error: companyError } = await db.from("companies")
      .select("settings, name, phone, notification_emails").eq("id", document.company_id).single();
    if (companyError) throw companyError;
    let prefs = company.settings?.notifications?.[event] || (event === "payment_received" ? company.settings?.notifications?.invoice_paid : null) || { email: false, mobile: false };
    if (typeof prefs === "boolean") prefs = { email: prefs, mobile: prefs };
    const emailValue = company.notification_emails?.length ? company.notification_emails : company.settings?.email;
    const emails = (Array.isArray(emailValue) ? emailValue : [emailValue]).filter(Boolean);
    const phone = company.phone || company.settings?.phone;
    const failures: string[] = [];
    const context = { companyId: document.company_id, related: "Company", id: document.company_id, kind: "company_notification", clientId: null, leadId: null, label: "Company alert" };
    const recorded = await db.from("notifications").select("body").eq("company_id", document.company_id).eq("related_id", document.id).eq("event_key", event).order("created_at", { ascending: false }).limit(1);
    const message = recorded.data?.[0]?.body || `${document[config.number] || "Document"}: activity recorded. Open Fuzed Flow to review.`;
    if (prefs.mobile && !phone) failures.push("SMS");
    if (prefs.mobile && phone) {
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), token = Deno.env.get("TWILIO_AUTH_TOKEN"), from = Deno.env.get("TWILIO_FROM_NUMBER");
      if (sid && token && from) {
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
          body: new URLSearchParams({ To: phone, From: from, Body: `FuzedFlow Alert: ${message}`, StatusCallback: `${url}/functions/v1/sms-events` }),
        });
        if (!response.ok) failures.push("SMS");
        else { const accepted = await response.json(); if (/^SM[0-9a-f]{32}$/i.test(accepted.sid || "")) { try { await registerDelivery(db, context, "twilio", accepted.sid, actor?.id, phone, from); } catch { console.warn("Company SMS delivery tracking requires review."); } } }
      } else failures.push("SMS");
    }
    const resend = Deno.env.get("RESEND_API_KEY");
    if (prefs.email && (!emails.length || !resend)) failures.push("Email");
    if (prefs.email && emails.length && resend) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "FuzedFlow Alerts <alerts@mail.fuzedflow.com>", to: emails,
          subject: `New Activity: ${document[config.number] || "Update"}`,
          html: `<p><strong>${escapeHtml(company.name || "Your Company")}</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
        }),
      });
      if (!response.ok) failures.push("Email");
      else { const accepted = await response.json(); if (uuid.test(accepted.id || "")) { try { await registerDelivery(db, context, "resend", accepted.id, actor?.id, emails, "alerts@mail.fuzedflow.com"); } catch { console.warn("Company email delivery tracking requires review."); } } }
    }
    if (failures.length) await recordSalesOutcome(db, context, "company_notification_failed", `${document.id}:${event}`, actor?.id, "A company alert could not be delivered. Review notification contact details and provider configuration.");
    return respond({ success: true, outbound_failures: failures });
  } catch (error) {
    console.error("Notification relay failed", error instanceof Error ? error.message : "Unknown error");
    return respond({ error: "Could not process this notification. Please retry." }, 500);
  }
});