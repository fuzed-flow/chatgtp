import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { salesUuid, savedDeliveryContext, normalizedPhone, registerDelivery, recordSalesOutcome, deliveryFailureEvent } from "../_shared/salesNotifications.js";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let context = null, db = null, actor = null, reference = null, attempted = false, rejected = false;
  try {
    const body = await req.json();
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    db = createClient(url, serviceKey);
    let companyId;
    if (token && token === serviceKey) companyId = body.company_id;
    else {
      const scoped = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', { global: { headers: { Authorization: `Bearer ${token}` } } });
      const auth = await scoped.auth.getUser(token);
      if (auth.error || !auth.data?.user) return json({ error: 'Authentication required' }, 401);
      const profile = await scoped.from('profiles').select('company_id,is_active').eq('id', auth.data.user.id).single();
      if (profile.error || !profile.data || profile.data.is_active === false) return json({ error: 'An active company profile is required' }, 403);
      companyId = profile.data.company_id; actor = auth.data.user.id;
    }
    if (!salesUuid.test(companyId || '')) return json({ error: 'A saved company is required' }, 400);
    context = await savedDeliveryContext(db, companyId, body);
    if (!context) throw new Error('A saved document, client or lead is required.');
    const phone = normalizedPhone(body.phone_number);
    const message = String(body.message_body || '').trim();
    if (!message || message.length > 5000) throw new Error('Enter an SMS message of at most 5,000 characters.');
    reference = body.request_id || crypto.randomUUID();
    if (!salesUuid.test(reference)) throw new Error('A valid send request is required.');
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), secret = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM_NUMBER');
    if (!sid || !secret || !from) throw new Error('SMS delivery is not configured.');
    const input = JSON.stringify([phone, message, context.related, context.id, context.kind, context.replyId]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    const claim = await db.rpc('claim_sms_intent', { p_company: companyId, p_request: reference, p_fingerprint: fingerprint });
    if (claim.error || !claim.data) throw new Error('The send request could not be prepared.');
    if (!claim.data.claimed) {
      if (claim.data.status === 'sent') return json({ success: true, message_sid: claim.data.provider_id, replayed: true });
      return json({ success: false, error: 'This SMS is still being confirmed. Check communication history before sending another copy.' }, 409);
    }
    const form = new URLSearchParams({ To: phone, From: from, Body: message, StatusCallback: `${url}/functions/v1/sms-events` });
    attempted = true;
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${sid}:${secret}`)}` }, body: form });
    const result = await response.json();
    if (!response.ok) { rejected = true; throw new Error('The SMS provider rejected the message. Review the recipient and try again.'); }
    if (!/^SM[0-9a-f]{32}$/i.test(result.sid || '')) throw new Error('SMS acceptance could not be confirmed.');
    try {
      const finished = await db.rpc('finish_sms_intent', { p_company: companyId, p_request: reference, p_status: 'sent', p_provider_id: result.sid });
      if (finished.error) console.warn('SMS acceptance tracking requires review.');
    } catch { console.warn('SMS acceptance tracking requires review.'); }
    try { await registerDelivery(db, context, 'twilio', result.sid, actor, phone, from); } catch { console.warn('SMS delivery tracking requires review.'); }
    try {
      const logged = await db.from('client_communications').upsert({ company_id: companyId, client_id: context.clientId, lead_id: context.leadId, type: 'SMS', direction: 'Outbound', subject: 'Text message sent', message, status: 'Sent', sent_by: actor, provider: 'twilio', provider_message_id: result.sid }, { onConflict: 'provider,provider_message_id', ignoreDuplicates: true });
      if (logged.error) console.warn('SMS history tracking requires review.');
    } catch { console.warn('SMS history tracking requires review.'); }
    return json({ success: true, message_sid: result.sid });
  } catch (error) {
    if (attempted && db && context && reference) {
      try { await db.rpc('finish_sms_intent', { p_company: context.companyId, p_request: reference, p_status: rejected ? 'failed' : 'unknown' }); } catch { console.warn('SMS failure tracking requires review.'); }
      await recordSalesOutcome(db, context, deliveryFailureEvent(context), reference, actor, rejected ? 'SMS delivery failed. Review the recipient and retry from the saved record.' : 'SMS acceptance could not be confirmed. Check communication history before sending again.');
    }
    return json({ success: false, error: attempted ? (rejected ? 'SMS delivery failed. Review the recipient and try again.' : 'SMS delivery could not be confirmed. Check communication history before sending again.') : error.message }, attempted ? 502 : 400);
  }
});
