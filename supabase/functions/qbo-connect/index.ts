import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminDb, callbackUrl, clientCredentials, companyAdmin, corsHeaders, respond, stateHash } from '../_shared/qboSandbox.ts';
import type { QboEnvironment } from '../_shared/qboSandbox.ts';

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const { companyId, userId } = await companyAdmin(req);
    const body = await req.json();
    const environment: QboEnvironment = body?.environment || 'sandbox';
    if (environment !== 'sandbox' && environment !== 'production') return respond({ error: 'Invalid QuickBooks environment.' }, 400);
    const { id } = clientCredentials(environment);
    const state = crypto.randomUUID();
    const { error } = await adminDb().from('qbo_oauth_states').insert({
      state_hash: await stateHash(state), company_id: companyId, initiated_by: userId, environment,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error('QuickBooks authorization could not be started.');
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.search = new URLSearchParams({ client_id: id, response_type: 'code', scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: callbackUrl(), state }).toString();
    return respond({ url: url.toString() });
  } catch (error) {
    console.error('QuickBooks authorization start failed');
    return respond({ error: error instanceof Error ? error.message : 'QuickBooks authorization could not be started.' }, 400);
  }
});
