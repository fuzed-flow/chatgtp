import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminDb, callbackUrl, clientCredentials, sandboxOnly, stateHash } from '../_shared/qboSandbox.ts';

const finish = (outcome: 'connected' | 'failed') => Response.redirect(`https://app.fuzedflow.com/AdminSettings?qbo=${outcome}`, 302);
const realmPattern = /^[0-9]{1,30}$/;

serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    sandboxOnly();
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const realm = url.searchParams.get('realmId');
    if (url.searchParams.has('error') || !code || !state || state.length > 128 || !realm || !realmPattern.test(realm)) return finish('failed');
    const db = adminDb();
    const { data: attempt, error } = await db.from('qbo_oauth_states').delete()
      .eq('state_hash', await stateHash(state)).gt('expires_at', new Date().toISOString())
      .select('company_id,initiated_by').single();
    if (error || !attempt) return finish('failed');
    const { data: admin } = await db.from('profiles').select('company_id,role,is_active')
      .eq('id', attempt.initiated_by).single();
    if (!admin || admin.company_id !== attempt.company_id || admin.is_active === false
      || !['owner', 'admin'].includes(admin.role)) return finish('failed');
    const { id, secret } = clientCredentials();
    const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl() }),
    });
    const token = await response.json();
    if (!response.ok || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string'
      || !Number.isFinite(Number(token.expires_in))) throw new Error('Token exchange failed.');
    const expires = new Date(Date.now() + Number(token.expires_in) * 1000).toISOString();
    const saved = await db.rpc('qbo_store_tokens', { p_company: attempt.company_id, p_realm: realm,
      p_actor: attempt.initiated_by, p_access: token.access_token, p_refresh: token.refresh_token,
      p_expires_at: expires });
    if (saved.error) throw new Error('Connection could not be saved.');
    return finish('connected');
  } catch {
    console.error('QuickBooks sandbox callback failed');
    return finish('failed');
  }
});
