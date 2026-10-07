import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const company = '00000000-0000-4000-8000-000000000001';
const user = '00000000-0000-4000-8000-000000000002';

async function fixture({ role = 'admin', active = true, authenticated = true } = {}) {
  const queries = [];
  const network = [];
  const old = { Deno: globalThis.Deno, createClient: globalThis.__qboTestCreateClient,
    handler: globalThis.__qboTestHandler, fetch: globalThis.fetch };
  globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' })[key] } };
  globalThis.__qboTestCreateClient = (_url, key) => ({
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: user } : null }, error: null }) },
    from: table => {
      const filters = [];
      const query = { select: () => query, eq: (field, value) => { filters.push([field, value]); return query; },
        single: async () => {
          queries.push({ key, table, filters });
          if (table === 'profiles') return { data: { company_id: company, role, is_active: active }, error: null };
          return { data: { qbo_access_token: 'synthetic-token', qbo_realm_id: 'sandbox-realm' }, error: null };
        } };
      return query;
    },
  });
  globalThis.fetch = async (url, init) => {
    network.push({ url, init });
    return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Synthetic' } }), { status: 200 });
  };
  const source = await readFile(new URL('../../supabase/functions/qbo-api/index.ts', import.meta.url), 'utf8');
  const output = await build({ stdin: { contents: source, loader: 'ts' }, bundle: true, write: false,
    platform: 'node', format: 'esm', plugins: [{ name: 'synthetic-edge-imports', setup(builder) {
      builder.onResolve({ filter: /^https:\/\// }, args => ({ path: args.path, namespace: 'synthetic-edge' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic-edge' }, args => ({ loader: 'js',
        contents: args.path.includes('/http/server.ts')
          ? 'export const serve=handler=>{globalThis.__qboTestHandler=handler};'
          : 'export const createClient=(...args)=>globalThis.__qboTestCreateClient(...args);' }));
    } }] });
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}#${Math.random()}`);
  const invoke = async (body, authorization = 'Bearer synthetic-user') => {
    const response = await globalThis.__qboTestHandler(new Request('https://synthetic.supabase.co/functions/v1/qbo-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const close = () => { globalThis.Deno = old.Deno; globalThis.__qboTestCreateClient = old.createClient;
    globalThis.__qboTestHandler = old.handler; globalThis.fetch = old.fetch; };
  return { invoke, queries, network, close };
}

test('QuickBooks API rejects unauthenticated and non-admin requests before service access', async () => {
  for (const options of [{ authenticated: false }, { role: 'employee' }, { active: false }]) {
    const h = await fixture(options);
    try {
      assert.notEqual((await h.invoke({ action: 'get_company_info' })).body.success, true);
      assert.equal(h.queries.some(q => q.key === 'synthetic-service'), false);
      assert.equal(h.network.length, 0);
    } finally { h.close(); }
  }
  const h = await fixture();
  try {
    assert.notEqual((await h.invoke({ action: 'get_company_info' }, null)).body.success, true);
    assert.equal(h.queries.length, 0);
  } finally { h.close(); }
});

test('QuickBooks API scopes the service lookup to the authenticated company', async () => {
  const h = await fixture();
  try {
    const result = await h.invoke({ action: 'get_company_info', company_id: 'different-company' });
    assert.equal(result.body.success, true);
    const lookup = h.queries.find(q => q.key === 'synthetic-service' && q.table === 'companies');
    assert.deepEqual(lookup.filters, [['id', company]]);
    assert.equal(h.network.length, 1);
    assert.match(h.network[0].url, /sandbox-quickbooks\.api\.intuit\.com/);
  } finally { h.close(); }
});
