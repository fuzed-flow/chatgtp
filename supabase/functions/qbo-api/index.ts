import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { accountingBase, adminDb, clientCredentials, companyAdmin, corsHeaders, respond } from '../_shared/qboSandbox.ts';
import type { QboEnvironment } from '../_shared/qboSandbox.ts';

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const { companyId, userId } = await companyAdmin(req);
    const { action, environment: requestedEnvironment } = await req.json();
    const environment: QboEnvironment = requestedEnvironment || 'sandbox';
    if (environment !== 'sandbox' && environment !== 'production') return respond({ error: 'Invalid QuickBooks environment.' }, 400);
    const db = adminDb();
    if (action === 'status') {
      const table = environment === 'production' ? 'qbo_production_connections' : 'qbo_connections';
      const { data, error } = await db.from(table).select('company_id').eq('company_id', companyId).maybeSingle();
      if (error) throw new Error('QuickBooks connection status is unavailable.');
      return respond({ connected: Boolean(data), environment });
    }
    if (action !== 'get_company_info') return respond({ error: 'Only the read-only connection test is available.' }, 400);
    const { data: credentials, error } = await db.rpc(environment === 'production' ? 'qbo_read_production_tokens' : 'qbo_read_tokens', { p_company: companyId });
    const saved = credentials?.[0];
    if (error || !saved?.access_token || !saved?.refresh_token || !saved?.realm_id) {
      return respond({ error: `QuickBooks ${environment} is not connected for this company.` }, 400);
    }
    let accessToken = saved.access_token;
    if (new Date(saved.access_expires_at).getTime() < Date.now() + 60_000) {
      const { id, secret } = clientCredentials(environment);
      const refresh = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token }),
      });
      const token = await refresh.json();
      if (!refresh.ok || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string'
        || !Number.isFinite(Number(token.expires_in))) throw new Error(`QuickBooks ${environment} needs to be reconnected.`);
      const stored = await db.rpc(environment === 'production' ? 'qbo_store_production_tokens' : 'qbo_store_tokens', { p_company: companyId, p_realm: saved.realm_id,
        p_actor: userId, p_access: token.access_token, p_refresh: token.refresh_token,
        p_expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() });
      if (stored.error) throw new Error('QuickBooks token refresh could not be saved.');
      accessToken = token.access_token;
    }
    const realm = encodeURIComponent(saved.realm_id);
    const response = await fetch(`${accountingBase(environment)}/${realm}/companyinfo/${realm}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`QuickBooks ${environment} connection test failed.`);
    const body = await response.json();
    return respond({ success: true, company_name: body.CompanyInfo?.CompanyName || null, realm_id: saved.realm_id });
  } catch (error) {
    console.error('QuickBooks sandbox connection check failed');
    return respond({ error: error instanceof Error ? error.message : 'QuickBooks sandbox connection check failed.' }, 400);
  }
});
