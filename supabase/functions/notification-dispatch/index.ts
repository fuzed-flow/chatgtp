import { createClient } from 'npm:@supabase/supabase-js@2.107.0';
import webpush from 'npm:web-push@3.6.7';
import { runDeliveryBatch } from './delivery.js';

const sameSecret = (actual: string, expected: string) => {
  const a = new TextEncoder().encode(actual), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
};
const providerError = (status: number) => Object.assign(new Error('Provider rejected notification'), { status });
const checkedJson = async (response: Response) => {
  if (!response.ok) throw providerError(response.status);
  const data = await response.json();
  if (!data?.id) throw new Error('Provider acceptance unconfirmed');
  return data;
};
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Delivery is not configured', { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: vault, error } = await db.rpc('notification_delivery_server_config');
  if (error) return new Response('Delivery is not configured', { status: 503 });
  const secret = Deno.env.get('NOTIFICATION_CRON_SECRET') || vault?.notification_cron_secret;
  if (!secret || !sameSecret(request.headers.get('X-Notification-Cron-Secret') || '', secret)) return new Response('Unauthorized', { status: 401 });
  const vapid = {
    publicKey: Deno.env.get('NOTIFICATION_VAPID_PUBLIC_KEY') || vault?.notification_vapid_public_key,
    privateKey: Deno.env.get('NOTIFICATION_VAPID_PRIVATE_KEY') || vault?.notification_vapid_private_key,
    subject: Deno.env.get('NOTIFICATION_VAPID_SUBJECT') || vault?.notification_vapid_subject || 'https://app.fuzedflow.com',
  };
  try {
    const result = await runDeliveryBatch(db, {
      email: async (payload: any, job: any) => {
        const apiKey = Deno.env.get('RESEND_API_KEY');
        if (!apiKey) throw new Error('Email delivery configuration unavailable');
        return checkedJson(await fetch('https://api.resend.com/emails', { method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `fuzedflow/notification/${job.id}` },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) }));
      },
      sms: async (payload: any) => {
        const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM_NUMBER');
        if (!sid || !token || !from) throw providerError(503);
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST',
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: payload.to, From: from, Body: payload.body, StatusCallback: 'https://ochqexofahdssmarnict.supabase.co/functions/v1/sms-events' }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw providerError(response.status);
        const data = await response.json();
        if (!data?.sid) throw new Error('SMS acceptance unconfirmed');
        return { id: data.sid };
      },
      push: async (payload: any, job: any) => {
        if (!vapid.publicKey || !vapid.privateKey) throw new Error('Push delivery configuration unavailable');
        const details = webpush.generateRequestDetails(job.subscription, JSON.stringify(payload), {
          vapidDetails: vapid, TTL: 24 * 60 * 60, urgency: job.payload.severity === 'Action Required' ? 'high' : 'normal',
          topic: job.id.replace(/-/g, '').slice(0, 32), contentEncoding: 'aes128gcm',
        });
        const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: new Uint8Array(details.body), signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw providerError(response.status);
        return { id: job.id };
      },
    });
    return Response.json({ success: true, ...result });
  } catch {
    // No customer content, addresses, subscription endpoints, or capability tokens in logs.
    return Response.json({ error: 'Notification processing could not finish. Pending jobs will retry.' }, { status: 500 });
  }
});
