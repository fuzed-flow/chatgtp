import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const company = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const clientId = '00000000-0000-4000-8000-000000000003';
const money = value => Math.round(Number(value || 0) * 100) / 100;

async function fixture({ tax = 5, existingInvoice = false, remoteTotal = 105, invoiceStatus = 'Sent', payments = [], paymentFailureOn = 0, matchingPayment = false, initialRemoteBalance = 105, duplicateCustomerName = false } = {}) {
  const previous = { Deno: globalThis.Deno, fetch: globalThis.fetch, create: globalThis.__qboCreate, handler: globalThis.__qboHandler };
  const requests = [], rows = new Map(), paymentRows = new Map();
  let remoteBalance = initialRemoteBalance;
  let role = 'admin';
  globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] } };
  globalThis.__qboCreate = (_url, key) => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000004' } } }) },
    from: table => {
      const filters = [];
      const q = {
        select: () => q, eq: (name, value) => { filters.push([name, value]); return q; },
        order: () => q, limit: () => q, is: (name, value) => { filters.push([name, value]); return q; },
        update: payload => { q.updated = payload; return q; },
        upsert: async row => { rows.set(table, row); return { error: null }; },
        maybeSingle: async () => ({ data: rows.get(table) || null, error: null }),
        single: async () => {
          if (table === 'profiles') return { data: { company_id: company, role, is_active: true }, error: null };
          if (table === 'invoices') return { data: { id: invoiceId, company_id: company, client_id: clientId,
            status: invoiceStatus, invoice_number: 'INV-100', issue_date: '2026-10-01', due_date: '2026-11-01',
            subtotal: 100, tax, total: 100 + tax,
            amount_paid: payments.reduce((sum, p) => sum + p.amount, 0),
            balance_due: 100 + tax - payments.reduce((sum, p) => sum + p.amount, 0) }, error: null };
          if (table === 'clients') return { data: { id: clientId, name: 'Client A', email: 'client@example.com' }, error: null };
          if (table === 'companies') return { data: { settings: { currency: 'CAD' } }, error: null };
          if (table === 'qbo_customer_links') return { data: rows.get(table), error: null };
          if (table === 'qbo_invoice_exports' && q.updated) {
            const current = rows.get(table);
            if (filters.some(([name, value]) =>
              ['status', 'request_id', 'realm_id', 'error_message', 'qbo_invoice_id', 'qbo_customer_id'].includes(name)
              && (current?.[name] ?? null) !== (value ?? null))) return { data: null, error: { message: 'State changed' } };
            rows.set(table, { ...rows.get(table), ...q.updated });
            return { data: rows.get(table), error: null };
          }
          if (table === 'qbo_invoice_exports') return { data: rows.get(table) || null, error: null };
          if (table === 'qbo_payment_exports' && q.updated) {
            const id = filters.find(([name]) => name === 'payment_id')?.[1];
            paymentRows.set(id, { ...paymentRows.get(id), ...q.updated });
            return { data: paymentRows.get(id), error: null };
          }
          throw Error(`Unexpected single ${table}`);
        },
        then: done => {
          if (table === 'qbo_payment_exports' && q.updated) {
            const id = filters.find(([name]) => name === 'payment_id')?.[1];
            paymentRows.set(id, { ...paymentRows.get(id), ...q.updated });
          }
          if (table === 'qbo_invoice_exports' && q.updated) rows.set(table, { ...rows.get(table), ...q.updated });
          return Promise.resolve(table === 'payments'
          ? { data: payments, error: null } : table === 'qbo_payment_exports'
            ? { data: [...paymentRows.values()], error: null } : table === 'invoice_line_items'
          ? { data: [{ name: 'Work', line_total: 100, taxable: true }], error: null }
          : { data: q.updated, error: null }).then(done);
        },
      };
      return q;
    },
    rpc: async (name, args) => {
      if (name === 'qbo_read_production_tokens') return { data: [{ realm_id: '123456', access_token: 'token', refresh_token: 'refresh',
        access_expires_at: new Date(Date.now() + 3600000).toISOString() }], error: null };
      if (name === 'qbo_claim_invoice_export') {
        const claimed = !rows.has('qbo_invoice_exports');
        if (claimed) rows.set('qbo_invoice_exports', { status: 'processing', request_id: args.p_request,
          realm_id: args.p_realm, payment_sync_status: 'not_applicable' });
        return { data: [{ claimed, export_status: rows.get('qbo_invoice_exports').status }], error: null };
      }
      if (name === 'qbo_claim_payment_export') {
        const claimed = !paymentRows.has(args.p_payment);
        if (claimed) paymentRows.set(args.p_payment, { payment_id: args.p_payment, status: 'processing', request_id: args.p_request });
        return { data: [{ claimed, export_status: paymentRows.get(args.p_payment).status }], error: null };
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
      if (sql.includes('FROM Account')) body = { QueryResponse: { Account: [{ Id: '60', Active: true, AccountType: 'Bank' }] } };
      if (sql.includes('FROM PaymentMethod')) body = { QueryResponse: { PaymentMethod: [{ Id: '70', Name: 'Check', Active: true }] } };
      if (sql.includes('FROM Invoice')) body = { QueryResponse: { Invoice: existingInvoice ? [{ Id: '99' }] : [] } };
      if (/FROM Payment\s/.test(sql)) body = { QueryResponse: { Payment: matchingPayment ? [{ Id: '99', TotalAmt: payments[0]?.amount }] : [] } };
      if (sql.includes('FROM Customer')) body = { QueryResponse: { Customer: sql.includes('DisplayName') ? [] : [{ Id: '40', Active: true }] } };
    } else if (u.pathname.endsWith('/customer')) {
      const sent = JSON.parse(init.body);
      if (duplicateCustomerName && sent.DisplayName === 'Client A') {
        return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } }), { status: 400 });
      }
      body = { Customer: { Id: '40' } };
    } else if (u.pathname.endsWith('/invoice')) body = { Invoice: { Id: '50', DocNumber: 'INV-100', TotalAmt: remoteTotal } };
    else if (u.pathname.endsWith('/invoice/50')) body = { Invoice: { Id: '50', CustomerRef: { value: '40' }, TotalAmt: remoteTotal, Balance: remoteBalance } };
    else if (u.pathname.endsWith('/payment')) {
      if (paymentFailureOn && paymentRows.size === paymentFailureOn) {
        return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Synthetic payment failure' }] } }), { status: 500 });
      }
      const sent = JSON.parse(init.body);
      remoteBalance -= sent.TotalAmt;
      body = { Payment: { Id: String(80 + paymentRows.size), TotalAmt: sent.TotalAmt, UnappliedAmt: 0,
        Line: sent.Line } };
    }
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
    const amountPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const snapshot = [invoiceId, clientId, 'INV-100', '2026-10-01', '2026-11-01', invoiceStatus,
      100, money(tax), money(100 + tax), money(amountPaid), money(100 + tax - amountPaid),
      payments.map(p => [p.id, money(p.amount), p.payment_date, p.payment_method || 'Other'])];
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
    const signature = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await globalThis.__qboHandler(new Request('https://synthetic.supabase.co/functions/v1/qbo-api', {
      method: 'POST', headers: { Authorization: 'Bearer signed-in', 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewSignature: signature, ...body }),
    }));
    return { status: response.status, body: await response.json() };
  };
  const close = () => { globalThis.Deno = previous.Deno; globalThis.fetch = previous.fetch;
    globalThis.__qboCreate = previous.create; globalThis.__qboHandler = previous.handler; };
  return { invoke, requests, rows, paymentRows, close, setRole: value => { role = value; } };
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

test('a draft invoice cannot create a QuickBooks accounting record', async () => {
  const h = await fixture({ invoiceStatus: 'Draft' });
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const result = await h.invoke(payload);
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Send the invoice first/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.rows.has('qbo_invoice_exports'), false);
  } finally { h.close(); }
});

test('a paid invoice exports its two dated payments and does not repeat them', async () => {
  const payments = [
    { id: '00000000-0000-4000-8000-000000000011', amount: 40, payment_date: '2026-09-09', payment_method: 'Check' },
    { id: '00000000-0000-4000-8000-000000000012', amount: 65, payment_date: '2026-10-06', payment_method: 'Check' },
  ];
  const h = await fixture({ invoiceStatus: 'Paid', payments });
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const result = await h.invoke({ ...payload, depositAccountId: '60', paymentMethodIds: { Check: '70' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.payment_count, 2);
    assert.equal(h.rows.get('qbo_invoice_exports').payment_sync_status, 'complete');
    const writes = h.requests.filter(r => r.init.method === 'POST');
    assert.deepEqual(writes.map(r => r.url.pathname), ['/v3/company/123456/invoice', '/v3/company/123456/payment', '/v3/company/123456/payment']);
    assert.deepEqual(writes.slice(1).map(r => JSON.parse(r.init.body).TxnDate), ['2026-09-09', '2026-10-06']);
    assert.equal(JSON.parse(writes[1].init.body).DepositToAccountRef.value, '60');
    assert.equal(JSON.parse(writes[2].init.body).Line[0].LinkedTxn[0].TxnId, '50');
    assert.equal((await h.invoke({ ...payload, depositAccountId: '60', paymentMethodIds: { Check: '70' } })).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 3);
  } finally { h.close(); }
});

test('a changed invoice preview cannot create an invoice or payment', async () => {
  const h = await fixture({ invoiceStatus: 'Paid', payments: [
    { id: '00000000-0000-4000-8000-000000000011', amount: 105, payment_date: '2026-09-09', payment_method: 'Check' },
  ] });
  try {
    assert.equal((await h.invoke({ ...payload, previewSignature: 'stale', depositAccountId: '60', paymentMethodIds: { Check: '70' } })).status, 400);
    assert.equal(h.requests.length, 0);
    assert.equal(h.rows.has('qbo_invoice_exports'), false);
  } finally { h.close(); }
});

test('a matching QuickBooks payment stops payment posting for review', async () => {
  const h = await fixture({ invoiceStatus: 'Paid', matchingPayment: true, payments: [
    { id: '00000000-0000-4000-8000-000000000011', amount: 105, payment_date: '2026-09-09', payment_method: 'Check' },
  ] });
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const result = await h.invoke({ ...payload, depositAccountId: '60', paymentMethodIds: { Check: '70' } });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /QuickBooks payment/);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 0);
    assert.equal(h.rows.has('qbo_invoice_exports'), false);
  } finally { h.close(); }
});

test('an uncertain payment failure locks that payment against automatic retry', async () => {
  const payments = [
    { id: '00000000-0000-4000-8000-000000000011', amount: 40, payment_date: '2026-09-09', payment_method: 'Check' },
    { id: '00000000-0000-4000-8000-000000000012', amount: 65, payment_date: '2026-10-06', payment_method: 'Check' },
  ];
  const h = await fixture({ invoiceStatus: 'Paid', payments, paymentFailureOn: 2 });
  try {
    h.rows.set('qbo_customer_links', { realm_id: '123456', qbo_customer_id: '40' });
    const input = { ...payload, depositAccountId: '60', paymentMethodIds: { Check: '70' } };
    assert.equal((await h.invoke(input)).status, 400);
    assert.equal(h.rows.get('qbo_invoice_exports').payment_sync_status, 'review_required');
    assert.equal(h.paymentRows.get(payments[0].id).status, 'exported');
    assert.equal(h.paymentRows.get(payments[1].id).status, 'review_required');
    const writes = h.requests.filter(r => r.init.method === 'POST').length;
    assert.equal((await h.invoke({ action: 'sync_payments', environment: 'production', invoiceId,
      depositAccountId: '60', paymentMethodIds: { Check: '70' } })).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, writes);
  } finally { h.close(); }
});

test('a pending export resumes only the payment that has not been posted', async () => {
  const payments = [
    { id: '00000000-0000-4000-8000-000000000011', amount: 40, payment_date: '2026-09-09', payment_method: 'Check' },
    { id: '00000000-0000-4000-8000-000000000012', amount: 65, payment_date: '2026-10-06', payment_method: 'Check' },
  ];
  const h = await fixture({ invoiceStatus: 'Paid', payments, initialRemoteBalance: 65 });
  try {
    h.rows.set('qbo_invoice_exports', { status: 'exported', payment_sync_status: 'pending', realm_id: '123456',
      qbo_invoice_id: '50', qbo_customer_id: '40' });
    h.paymentRows.set(payments[0].id, { payment_id: payments[0].id, status: 'exported', qbo_payment_id: '81' });
    const result = await h.invoke({ action: 'sync_payments', environment: 'production', invoiceId,
      depositAccountId: '60', paymentMethodIds: { Check: '70' } });
    assert.equal(result.status, 200);
    assert.equal(h.rows.get('qbo_invoice_exports').payment_sync_status, 'complete');
    assert.deepEqual(h.requests.filter(r => r.init.method === 'POST').map(r => JSON.parse(r.init.body).TotalAmt), [65]);
  } finally { h.close(); }
});

test('duplicate customer name permits one guarded retry with a distinct QuickBooks display name', async () => {
  const payments = [
    { id: '00000000-0000-4000-8000-000000000011', amount: 40, payment_date: '2026-09-09', payment_method: 'Check' },
    { id: '00000000-0000-4000-8000-000000000012', amount: 65, payment_date: '2026-10-06', payment_method: 'Check' },
  ];
  const h = await fixture({ invoiceStatus: 'Paid', payments, duplicateCustomerName: true });
  try {
    const input = { ...payload, customerChoice: 'new', customerId: '', depositAccountId: '60', paymentMethodIds: { Check: '70' } };
    const first = await h.invoke(input);
    assert.equal(first.status, 400);
    assert.match(first.body.error, /Duplicate Name Exists Error/);
    assert.equal(h.rows.get('qbo_invoice_exports').status, 'review_required');
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 1);
    const catalog = await h.invoke({ action: 'invoice_catalog', environment: 'production', invoiceId });
    assert.equal(catalog.body.retryableNameConflict, true);
    assert.equal((await h.invoke(input)).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 1);
    const resolved = await h.invoke({ ...input, customerDisplayName: 'Client A (FuzedFlow)' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.payment_count, 2);
    const writes = h.requests.filter(r => r.init.method === 'POST');
    assert.deepEqual(writes.map(r => r.url.pathname), ['/v3/company/123456/customer',
      '/v3/company/123456/customer', '/v3/company/123456/invoice',
      '/v3/company/123456/payment', '/v3/company/123456/payment']);
    assert.equal(JSON.parse(writes[1].init.body).DisplayName, 'Client A (FuzedFlow)');
    assert.equal((await h.invoke({ ...input, customerDisplayName: 'Client A (FuzedFlow)' })).status, 400);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 5);
  } finally { h.close(); }
});

test('a remotely existing invoice still blocks duplicate-name recovery', async () => {
  const h = await fixture({ existingInvoice: true });
  try {
    h.rows.set('qbo_invoice_exports', { status: 'review_required', request_id: '00000000-0000-4000-8000-000000000099',
      realm_id: '123456', error_message: 'QuickBooks rejected the request: Duplicate Name Exists Error',
      payment_sync_status: 'not_applicable' });
    const result = await h.invoke({ ...payload, customerChoice: 'new', customerDisplayName: 'Client A (FuzedFlow)' });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /already has this invoice number/);
    assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 0);
    assert.equal(h.rows.get('qbo_invoice_exports').status, 'review_required');
  } finally { h.close(); }
});
