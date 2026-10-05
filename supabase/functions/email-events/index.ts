import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { providerServerConfig, salesUuid, deliveryCallback } from "../_shared/salesNotifications.js";
import { verifyResendSignature, authenticatedEmail, receivedMessageText } from "../_shared/providerSignatures.js";

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  try {
    const config = await providerServerConfig(db);
    const raw = await req.text();
    if (raw.length > 200000 || !await verifyResendSignature(raw, req.headers, config.resend_webhook_secret)) return new Response('Invalid signature', { status: 401 });
    const event = JSON.parse(raw);
    const eventId = req.headers.get('svix-id') || req.headers.get('webhook-id');
    const emailId = event.data?.email_id;
    if (!salesUuid.test(emailId || '') || !eventId) return new Response('Invalid event', { status: 400 });
    const status = { 'email.delivered': 'delivered', 'email.failed': 'failed', 'email.bounced': 'bounced', 'email.complained': 'complained' }[event.type];
    if (status) {
      try {
        if (!await deliveryCallback(db, 'resend', emailId, eventId, status, event.created_at)) return new Response('Delivery record not ready', { status: 503 });
      } catch { return new Response('Delivery tracking unavailable', { status: 503 }); }
    } else if (event.type === 'email.received') {
      if (!config.resend_reply_domain) return new Response('Reply service unavailable', { status: 503 });
      const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}?html_format=cid`, { headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') || ''}` } });
      if (!response.ok) return new Response('Message retrieval unavailable', { status: 503 });
      const received = await response.json();
      // The signed receiving event authenticates Resend; require sender domain authentication too.
      if (!authenticatedEmail(received.authentication)) return Response.json({ received: true, ignored: true });
      const sender = String(received.from || '').match(/(?:^|<)([^\s<>]+@[^\s<>]+)>?$/)?.[1];
      const recipients = Array.isArray(received.to) ? received.to : [received.to];
      const routes = recipients.map(address => String(address || '').match(/^reply\+([0-9a-f-]{36})@([^\s<>]+)$/i)).filter(match => match && match[2].toLowerCase() === config.resend_reply_domain.toLowerCase());
      if (!sender || routes.length !== 1 || !salesUuid.test(routes[0][1])) return Response.json({ received: true, ignored: true });
      const result = await db.rpc('record_inbound_reply', { p_provider: 'resend', p_event_id: emailId, p_route: routes[0][1], p_sender: sender, p_subject: String(received.subject || '').slice(0, 250), p_message: receivedMessageText(received) });
      if (result.error) return new Response('Reply could not be recorded', { status: 503 });
    }
    return Response.json({ received: true });
  } catch { return new Response('Webhook processing failed', { status: 500 }); }
});
