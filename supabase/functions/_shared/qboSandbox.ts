import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
export type QboEnvironment = 'sandbox' | 'production';
export const accountingBase = (environment: QboEnvironment) => environment === 'production'
  ? 'https://quickbooks.api.intuit.com/v3/company'
  : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
export const projectUrl = () => {
  const value = Deno.env.get('SUPABASE_URL');
  if (!value) throw new Error('QuickBooks service unavailable.');
  return value;
};
export const adminDb = () => {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('QuickBooks service unavailable.');
  return createClient(projectUrl(), key);
};
export const callbackUrl = () => `${projectUrl()}/functions/v1/qbo-callback`;
export const clientCredentials = (environment: QboEnvironment) => {
  // QBO_CLIENT_* were replaced with live keys. Sandbox keys use separate secrets.
  const prefix = environment === 'production' ? 'QBO' : 'QBO_SANDBOX';
  const id = Deno.env.get(`${prefix}_CLIENT_ID`)?.trim();
  const secret = Deno.env.get(`${prefix}_CLIENT_SECRET`)?.trim();
  if (!id || !secret) throw new Error(`QuickBooks ${environment} credentials are missing.`);
  if (/\s/.test(id)) throw new Error(`QuickBooks ${environment} Client ID contains whitespace.`);
  return { id, secret };
};
export async function companyAdmin(req: Request) {
  const authorization = req.headers.get('Authorization');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization?.startsWith('Bearer ') || !anonKey) throw new Error('Authentication required.');
  const db = createClient(projectUrl(), anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await db.auth.getUser(authorization.slice(7).trim());
  if (authError || !auth?.user) throw new Error('Authentication required.');
  const { data: profile, error } = await db.from('profiles')
    .select('company_id,role,is_active').eq('id', auth.user.id).single();
  if (error || !profile?.company_id || profile.is_active === false || !['owner', 'admin'].includes(profile.role)) {
    throw new Error('Company administrator access required.');
  }
  return { companyId: profile.company_id as string, userId: auth.user.id as string };
}
export async function stateHash(state: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export const respond = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
