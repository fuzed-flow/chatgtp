import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const company = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const clientId = '00000000-0000-4000-8000-000000000003';

async function fixture({ tax = 5, existingInvoice = false, remoteTotal = 105 } = {}) {
  const previous = { Deno: globalThis.Deno, fetch: globalThis.fetch, create: globalThis.__qboCreate, handler: globalThis.__qboHandler };
  const requests = [], rows = new Map();
  let role = 'admin';
  globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] } };
  globalThis.__qboCreate = (_url, key) => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000004' } } }) },
    from: table => {
      const filters = [];
      const q = {
        select: () => q, eq: (name, value) => { filters.push([name, value]); return q; },
        update: payload => { q.updated = payload; return q; },
        upsert: async row => { rows.set(table, row); return { error: null }; },
        maybeSingle: async () => ({ data: rows.get(table) || null, error: null }),
        single: async () => {
          if (table === 'profiles') return { data: { company_id: company, role, is_active: true }, error: null };
          if (table === 'invoices') return { data: { id: invoiceId, company_id: company, client_id: clientId,
            status: 'Sent', invoice_number: 'INV-100', issue_date: '2026-10-01', due_date: '2026-11-01',
            subtotal: 100, tax, total: 100 + tax, amount_paid: 0 }, error: null };
          if (table === 'clients') return { data: { id: clientId, name: 'Client A', email: 'client@example.com' }, error: null };
          if (table === 'companies') return { data: { settings: { currency: 'CAD' } }, error: null };
          if (table === 'qbo_customer_links') return { data: rows.get(table), error: null };
          if (table === 'qbo_invoice_exports' && q.updated) {
            rows.set(table, { ...rows.get(table), ...q.updated });
            return { data: rows.get(table), error: null };
          }
          throw Error(`Unexpected single ${table}`);
        },
        then: done => Promise.resolve(table === 'invoice_line_items'
          ? { data: [{ name: 'Work', line_total: 100, taxable: true }], error: null }
          : { data: q.updated, error: null }).then(done),
      };
      return q;
    },
    rpc: async (name, args) => {
      if (name === 'qbo_read_production_tokens') return { data: [{ realm_id: '123456', access_token: 'token', refresh_token: 'refresh',
        access_expires_at: new Date(Date.now() + 3600000).toISOString() }], error: null };
      if (name === 'qbo_claim_invoice_export') {
        const claimed = !rows.has('qbo_invoice_exports');
        if (claimed) rows.set('qbo_invoice_exports', { status: 'processing', request_id: args.p_request });
        return { data: [{ claimed, export_status: rows.get('qbo_invoice_exports').status }], error: null };
      }
      throw Error(`Unexpected rpc ${name}`);
    },
  });
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    requests.push({ url: u, init });
    let body = {};
    if (u.pathname.endsWith('/preferences')) body = { Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'CAD' } } } };
    else if (u.pathname.includes('/companyinfo/')) body = { CompanyInfo: { Country: 'CA' } };
    else if (u.pathname.endsWith('/query')) {
      const sql = u.searchParams.get('query');
      if (sql.includes('FROM Item')) body = { QueryResponse: { Item: [{ Id: '10', Active: true, Type: 'Service' }] } };
      if (sql.includes('FROM TaxCode')) body = { QueryResponse: { TaxCode: [{ Id: '20', Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '30' } }] } }] } };
      if (sql.includes('FROM TaxRate')) body = { QueryResponse: { TaxRate: [{ Id: '30', RateValue: 5 }] } };
      if (sql.includes('FROM Invoice')) body = { QueryResponse: { Invoice: existingInvoice ? [{ Id: '99' }] : [] } };
      if (sql.includes('FROM Customer')) body = { QueryResponse: { Customer: [{ Id: '40', Active: true }] } };
    } else if (u.pathname.endsWith('/invoice')) body = { Invoice: { Id: '50', DocNumber: 'INV-100', TotalAmt: remoteTotal } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const bundled = await build({ entryPoints: [`${root}supabase/functions/qbo-api/index.ts`], bundle: true, write: false,
    platform: 'node', format: 'esm', plugins: [{ name: 'edge-stubs', setup(builder) {
      builder.onResolve({ filter: /^https:\/\// }, args => ({ path: args.path, namespace: 'edge-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'edge-stub' }, args => ({ loader: 'js', contents: args.path.includes('/http/server.ts')
        ? 'export const serve=fn=>{globalThis.__qboHandler=fn};'
        : 'export const createClient=(...args)=>globalThis.__qboCreate(...args);' }));
    } }] });
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}#${Math.random()}`);
  const invoke = async body => {
    const response = await globalThis.__qboHandler(new Request('https://synthetic.supabase.co/functions/v1/qbo-api', {
      method: 'POST', headers: { Authorization: 'Bearer signed-in', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const close = () => { globalThis.Deno = previous.Deno; globalThis.fetch = previous.fetch;
    globalThis.__qboCreate = previous.create; globalThis.__qboHandler = previous.handler; };
  return { invoke, requests, rows, close, setRole: value => { role = value; } };
}

const payload = { action: 'export_invoice', environment: 'production', invoiceId,
  customerChoice: 'existing', customerId: '40', itemId: '10', taxCodeId: '20' };

test('exports once with a linked customer, matching tax code, and isolated realm', async () => {
  const h = await fixture();
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const result = await h.invoke(payload);
    assert.equal(result.status, 200);
    assert.equal(result.body.qbo_invoice_id, '50');
    const writes = h.requests.filter(r => r.init.method === 'POST');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url.pathname, '/v3/company/123456/invoice');
    const sent = JSON.parse(writes[0].init.body);
    assert.equal(sent.CustomerRef.value, '40');
    assert.equal(sent.Line[0].SalesItemLineDetail.TaxCodeRef.value, '20');
    assert.equal(sent.Line[0].Amount, 100);
    assert.equal((await h.invoke(payload)).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 1);
  } finally { h.close(); }
});

test('rejects mismatched tax and an existing invoice number without writes', async () => {
  for (const options of [{ tax: 7 }, { existingInvoice: true }]) {
    const h = await fixture(options);
    try {
      assert.equal((await h.invoke(payload)).status, 400);
      assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 0);
      assert.equal(h.rows.has('qbo_invoice_exports'), false);
    } finally { h.close(); }
  }
});

test('non-admin cannot read or write QuickBooks accounting data', async () => {
  const h = await fixture();
  try {
    h.setRole('employee');
    assert.equal((await h.invoke(payload)).status, 400);
    assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});

test('a created invoice with a mismatched QuickBooks total requires review and cannot be repeated', async () => {
  const h = await fixture({ remoteTotal: 106 });
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const result = await h.invoke(payload);
    assert.equal(result.body.reviewRequired, true);
    assert.equal(h.rows.get('qbo_invoice_exports').status, 'review_required');
    assert.equal((await h.invoke(payload)).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 1);
  } finally { h.close(); }
});
