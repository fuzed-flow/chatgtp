import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const company = '00000000-0000-4000-8000-000000000001';
const otherCompany = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000003';
const base = 'https://synthetic.supabase.co/functions/v1/';

async function fixture(options = {}) {
  const old = { Deno: globalThis.Deno, fetch: globalThis.fetch, create: globalThis.__qboCreate,
    handler: globalThis.__qboHandler };
  const states = new Map(), connections = new Map(), calls = [], requests = [];
  let role = options.role || 'admin', currentCompany = options.company || company;
  globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    QBO_CLIENT_ID: 'synthetic-client-id', QBO_CLIENT_SECRET: 'synthetic-client-secret',
    QBO_ENVIRONMENT: options.environment || 'sandbox' })[name] } };
  globalThis.__qboCreate = (_url, key) => ({
    auth: { getUser: async token => ({ data: { user: token === 'valid-user' ? { id: user } : null }, error: null }) },
    from: table => {
      const filters = [];
      const query = {
        select: () => query, eq: (field, value) => { filters.push([field, value]); return query; },
        gt: (field, value) => { filters.push([field, value]); return query; },
        delete: () => { query.mode = 'delete'; return query; },
        insert: async row => { calls.push({ table, row, key }); states.set(row.state_hash, row); return { error: null }; },
        single: async () => {
          calls.push({ table, filters, key, mode: query.mode });
          if (table === 'profiles') return { data: { company_id: currentCompany, role, is_active: true }, error: null };
          const hash = filters.find(([name]) => name === 'state_hash')?.[1];
          const state = states.get(hash);
          if (!state || new Date(state.expires_at).getTime() <= Date.now() || query.mode !== 'delete') return { data: null, error: { message: 'Missing' } };
          states.delete(hash);
          return { data: state, error: null };
        },
      };
      return query;
    },
    rpc: async (name, args) => {
      calls.push({ name, args, key });
      if (name === 'qbo_read_tokens') return { data: connections.has(args.p_company) ? [connections.get(args.p_company)] : [], error: null };
      if (name === 'qbo_store_tokens') {
        connections.set(args.p_company, { realm_id: args.p_realm, access_token: args.p_access,
          refresh_token: args.p_refresh, access_expires_at: args.p_expires_at });
        return { data: null, error: null };
      }
      throw Error('Unexpected RPC');
    },
  });
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/tokens/bearer')) return new Response(JSON.stringify({ access_token: 'sandbox-access',
      refresh_token: 'sandbox-refresh', expires_in: 3600 }), { status: 200 });
    if (String(url).includes('sandbox-quickbooks.api.intuit.com')) return new Response(JSON.stringify({
      CompanyInfo: { CompanyName: 'Test Construction' },
    }), { status: 200 });
    throw Error('Unexpected network destination');
  };
  const handlers = {};
  for (const name of ['qbo-connect', 'qbo-callback', 'qbo-api']) {
    const bundled = await build({ entryPoints: [`${root}supabase/functions/${name}/index.ts`],
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'edge-stubs', setup(builder) {
        builder.onResolve({ filter: /^https:\/\// }, args => ({ path: args.path, namespace: 'edge-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'edge-stub' }, args => ({ loader: 'js',
          contents: args.path.includes('/http/server.ts')
            ? 'export const serve=fn=>{globalThis.__qboHandler=fn};'
            : 'export const createClient=(...args)=>globalThis.__qboCreate(...args);' }));
      } }] });
    await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}#${Math.random()}`);
    handlers[name] = globalThis.__qboHandler;
  }
  const invoke = async (name, { token = 'valid-user', method, path, body = {} } = {}) => {
    const action = method || (name === 'qbo-callback' ? 'GET' : 'POST');
    const response = await handlers[name](new Request(base + name + (path || ''), {
      method: action, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(action === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(action === 'POST' ? { body: JSON.stringify(body) } : {}),
    }));
    return { status: response.status, location: response.headers.get('location'),
      body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
  };
  const close = () => { globalThis.Deno = old.Deno; globalThis.fetch = old.fetch;
    globalThis.__qboCreate = old.create; globalThis.__qboHandler = old.handler; };
  return { invoke, calls, requests, connections, states, close, setRole: value => { role = value; },
    setCompany: value => { currentCompany = value; } };
}

test('only an authenticated company admin can start sandbox OAuth', async () => {
  const h = await fixture();
  try {
    assert.equal((await h.invoke('qbo-connect', { token: null })).status, 400);
    h.setRole('employee');
    assert.equal((await h.invoke('qbo-connect')).status, 400);
    assert.equal(h.states.size, 0);
    h.setRole('admin');
    const result = await h.invoke('qbo-connect', { body: { company_id: otherCompany } });
    assert.equal(result.status, 200);
    const url = new URL(result.body.url);
    assert.equal(url.origin, 'https://appcenter.intuit.com');
    assert.equal(url.searchParams.get('redirect_uri'), base + 'qbo-callback');
    assert.equal([...h.states.values()][0].company_id, company);
    assert.notEqual([...h.states.keys()][0], url.searchParams.get('state'));
  } finally { h.close(); }
});

test('callback consumes state once and stores tokens only for its initiating company', async () => {
  const h = await fixture();
  try {
    const start = await h.invoke('qbo-connect');
    const state = new URL(start.body.url).searchParams.get('state');
    const path = `?code=synthetic-code&realmId=123456&state=${encodeURIComponent(state)}`;
    assert.match((await h.invoke('qbo-callback', { path })).location, /qbo=connected/);
    assert.equal(h.connections.has(company), true);
    assert.equal(h.connections.has(otherCompany), false);
    assert.match((await h.invoke('qbo-callback', { path })).location, /qbo=failed/);
    assert.equal(h.requests.filter(request => request.url.includes('/tokens/bearer')).length, 1);
    const store = h.calls.find(call => call.name === 'qbo_store_tokens');
    assert.equal(store.args.p_company, company);
    assert.equal(store.key, 'synthetic-service');
  } finally { h.close(); }
});

test('expired state and a moved administrator cannot exchange tokens', async () => {
  const h = await fixture();
  try {
    const expired = new URL((await h.invoke('qbo-connect')).body.url).searchParams.get('state');
    for (const row of h.states.values()) row.expires_at = new Date(Date.now() - 1000).toISOString();
    const expiredPath = `?code=code&realmId=123456&state=${expired}`;
    assert.match((await h.invoke('qbo-callback', { path: expiredPath })).location, /qbo=failed/);
    h.states.clear();
    const moved = new URL((await h.invoke('qbo-connect')).body.url).searchParams.get('state');
    h.setCompany(otherCompany);
    assert.match((await h.invoke('qbo-callback', { path: `?code=code&realmId=123456&state=${moved}` })).location, /qbo=failed/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.connections.size, 0);
  } finally { h.close(); }
});

test('sandbox company check uses only the signed-in company and never writes accounting data', async () => {
  const h = await fixture();
  try {
    h.connections.set(company, { realm_id: '123456', access_token: 'sandbox-access', refresh_token: 'sandbox-refresh',
      access_expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const result = await h.invoke('qbo-api', { body: { action: 'get_company_info', company_id: otherCompany } });
    assert.equal(result.body.company_name, 'Test Construction');
    assert.equal(h.calls.find(call => call.name === 'qbo_read_tokens').args.p_company, company);
    assert.equal((await h.invoke('qbo-api', { body: { action: 'create_customer' } })).status, 400);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('an expired sandbox token refreshes and stores the rotated token before the read', async () => {
  const h = await fixture();
  try {
    h.connections.set(company, { realm_id: '123456', access_token: 'old-access', refresh_token: 'old-refresh',
      access_expires_at: new Date(Date.now() - 1000).toISOString() });
    const result = await h.invoke('qbo-api', { body: { action: 'get_company_info' } });
    assert.equal(result.body.success, true);
    assert.equal(h.connections.get(company).refresh_token, 'sandbox-refresh');
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].init.headers.Authorization, 'Bearer sandbox-access');
  } finally { h.close(); }
});
