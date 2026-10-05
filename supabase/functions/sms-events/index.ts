import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyTwilioSignature } from "../_shared/providerSignatures.js";
import { deliveryCallback } from "../_shared/salesNotifications.js";

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const raw = await req.text();
    if (raw.length > 100000) return new Response('Invalid request', { status: 400 });
    const form = new URLSearchParams(raw);
    const canonical = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-events${new URL(req.url).search}`;
    if (!await verifyTwilioSignature(canonical, form, req.headers.get('X-Twilio-Signature'), Deno.env.get('TWILIO_AUTH_TOKEN')) || form.get('AccountSid') !== Deno.env.get('TWILIO_ACCOUNT_SID')) return new Response('Invalid signature', { status: 401 });
    const messageId = form.get('MessageSid');
    if (!/^SM[0-9a-f]{32}$/i.test(messageId || '')) return new Response('Invalid message', { status: 400 });
    const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const status = (form.get('MessageStatus') || form.get('SmsStatus') || '').toLowerCase();
    if (['delivered', 'failed', 'undelivered'].includes(status)) {
      try {
        if (!await deliveryCallback(db, 'twilio', messageId, `${messageId}:${status}`, status, form.get('DateUpdated') || form.get('DateSent'))) return new Response('Delivery record not ready', { status: 503 });
      } catch { return new Response('Delivery tracking unavailable', { status: 503 }); }
    } else if (form.has('Body') && ['received', 'receiving', ''].includes(status)) {
      const result = await db.rpc('record_inbound_sms', { p_event_id: messageId, p_sender: form.get('From'), p_recipient: form.get('To'), p_message: (form.get('Body') || '').slice(0, 5000) });
      if (result.error) return new Response('Reply could not be recorded', { status: 503 });
    }
    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  } catch { return new Response('Webhook processing failed', { status: 500 }); }
});
