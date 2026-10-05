import { createClient } from 'npm:@supabase/supabase-js@2.107.0';
import { runProviderSetup, publicSetupError } from './setup.js';

const sameSecret = (actual: string, expected: string) => {
  const a = new TextEncoder().encode(actual), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
};
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Setup unavailable', { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error } = await db.rpc('notification_provider_setup_config');
  // Root removes the dedicated Vault setup secret once provider configuration is finished.
  if (error || !config?.setup_secret) return new Response('Setup unavailable', { status: 410 });
  if (!sameSecret(request.headers.get('X-Notification-Setup-Secret') || '', config.setup_secret)) return new Response('Unauthorized', { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 200) return Response.json({ error: 'Only a setup action is accepted.' }, { status: 400 });
    const input = JSON.parse(raw);
    if (!input || Object.keys(input).some(key => key !== 'action')) return Response.json({ error: 'Only a setup action is accepted.' }, { status: 400 });
    const result = await runProviderSetup(input.action, config, {
      resendKey: Deno.env.get('RESEND_API_KEY'), twilioSid: Deno.env.get('TWILIO_ACCOUNT_SID'),
      twilioToken: Deno.env.get('TWILIO_AUTH_TOKEN'), twilioFrom: Deno.env.get('TWILIO_FROM_NUMBER'),
    }, fetch, async (name: string, value: string) => {
      const { error } = await db.rpc('notification_store_provider_secret', { p_name: name, p_value: value });
      if (error) throw new Error('Secure provider storage unavailable');
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    const publicError = publicSetupError(error);
    return Response.json(publicError, { status: publicError.status >= 400 && publicError.status <= 599 ? publicError.status : 503 });
  }
});
