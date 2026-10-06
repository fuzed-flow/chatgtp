import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readPublicQuoteLink } from '../../src/lib/publicQuoteLinks.js';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../supabase/functions/quote-reminder-cron/index.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  plugins: [{ name: 'synthetic-reminder-services', setup(builder) {
    builder.onResolve({ filter: /^https:\/\// }, args => ({ path: args.path, namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ loader: 'js', contents:
      args.path.includes('supabase-js') ? 'export const createClient=()=>globalThis.testClient();' :
      'export const serve=handler=>globalThis.captureHandler(handler);',
    }));
  } }],
});

const COMPANY = '00000000-0000-4000-8000-000000000001';
const QUOTE = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const TOKEN = 'a'.repeat(64);
const SERVICE = 'synthetic-service';
const plain = value => JSON.parse(JSON.stringify(value));
const NOW = Date.UTC(2026, 9, 6, 12);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }

function fixture(options = {}) {
  let handler;
  const sent = [], updates = [], lookups = [], errors = [];
  const quotes = [{ id: QUOTE, quote_number: 'SYNTHETIC-1', title: 'Renovation', status: 'Sent',
    company_id: COMPANY, client_id: 'synthetic-client', created_at: options.createdAt || '2026-10-01T12:00:00Z',
    automation_stage: options.stage || 0,
    companies: { id: COMPANY, settings: { automations: { quote_enabled: true, quote_followup_1: 3, quote_followup_2: 7 } } },
    clients: { name: 'Synthetic Client', email: 'client@example.invalid' },
  }];
  const approvals = options.approvals || [{ id: 'approval-1', quote_id: QUOTE, company_id: COMPANY,
    approval_token: TOKEN, approval_status: 'Sent', created_at: '2026-10-01' }];
  const db = { from(table) {
    const query = { table, filters: [], order: [], operation: 'select' };
    const chain = {
      select() { return chain; }, in(key, values) { query.filters.push([key, values]); return chain; },
      eq(key, value) { query.filters.push([key, value]); return chain; },
      or(expression) { query.or = expression; return chain; },
      order(key, config) { query.order.push([key, plain(config)]); return chain; },
      limit(count) { query.limit = count; return chain; },
      update(payload) { query.operation = 'update'; query.payload = plain(payload); return chain; },
      async maybeSingle() {
        assert.equal(table, 'quote_approvals'); lookups.push(plain(query));
        if (options.lookupError) return { data: null, error: { message: 'Synthetic failure' } };
        let candidates = approvals.filter(row => query.filters.every(([key, value]) => row[key] === value));
        if (query.or === 'approval_status.is.null,approval_status.neq.Revoked') candidates = candidates.filter(row => row.approval_status !== 'Revoked');
        for (const [key, config] of [...query.order].reverse()) candidates.sort((a, b) => {
          if (a[key] == null) return config.nullsFirst === false ? 1 : -1;
          if (b[key] == null) return config.nullsFirst === false ? -1 : 1;
          return String(a[key]).localeCompare(String(b[key])) * (config.ascending ? 1 : -1);
        });
        return { data: candidates.slice(0, query.limit)[0] || null, error: null };
      },
      then(resolve, reject) {
        assert.equal(table, 'quotes');
        if (query.operation === 'update') updates.push(plain(query));
        return Promise.resolve({ data: query.operation === 'update' ? null : quotes, error: null }).then(resolve, reject);
      },
    };
    return chain;
  } };
  const env = { SUPABASE_URL: 'https://synthetic.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: SERVICE, APP_URL: 'https://app.fuzedflow.com' };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    Request, Response, Headers, URL, TextEncoder, Uint8Array, crypto: webcrypto, Date: FixedDate,
    Deno: { env: { get: key => env[key] } }, testClient: () => db, captureHandler: value => { handler = value; },
    fetch: async (url, config) => { sent.push({ url: String(url), body: JSON.parse(config.body) });
      return Response.json({ success: options.deliveryFailure !== true }, { status: options.deliveryFailure ? 503 : 200 }); },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
  });
  const run = (authorization = `Bearer ${SERVICE}`) => handler(new Request('https://synthetic.supabase.invalid/quote-reminder-cron', { method: 'POST', headers: { Authorization: authorization } }));
  return { run, sent, updates, lookups, errors };
}

test('a due reminder includes the existing secure link and advances only after delivery', async () => {
  const view = fixture(); assert.equal((await view.run()).status, 200);
  assert.equal(view.sent.length, 1);
  const href = view.sent[0].body.html_body.match(/href="([^"]+)"/)[1];
  assert.deepEqual(readPublicQuoteLink(new URL(href)), { quoteId: QUOTE, token: TOKEN });
  assert.equal(new URL(href).search, '');
  assert.deepEqual(view.updates[0].payload, { automation_stage: 1 });
});

test('reminders select the latest active approval in the same company and quote', async () => {
  const view = fixture({ approvals: [
    { id: 'active', quote_id: QUOTE, company_id: COMPANY, approval_token: TOKEN, approval_status: null, created_at: '2026-10-01' },
    { id: 'revoked', quote_id: QUOTE, company_id: COMPANY, approval_token: 'b'.repeat(64), approval_status: 'Revoked', created_at: '2026-10-05' },
    { id: 'foreign-company', quote_id: QUOTE, company_id: OTHER, approval_token: 'c'.repeat(64), approval_status: 'Sent', created_at: '2026-10-06' },
    { id: 'foreign-quote', quote_id: OTHER, company_id: COMPANY, approval_token: 'd'.repeat(64), approval_status: 'Sent', created_at: '2026-10-06' },
    { id: 'older', quote_id: QUOTE, company_id: COMPANY, approval_token: 'e'.repeat(64), approval_status: 'Sent', created_at: '2026-09-30' },
  ] });
  await view.run();
  const href = view.sent[0].body.html_body.match(/href="([^"]+)"/)[1];
  assert.equal(readPublicQuoteLink(new URL(href)).token, TOKEN);
});

for (const options of [{ approvals: [] }, { lookupError: true }, { approvals: [{ quote_id: QUOTE, company_id: COMPANY, approval_token: 'invalid' }] }]) {
  test('no email or status update is sent without usable secure access: ' + JSON.stringify(options), async () => {
    const view = fixture(options); await view.run();
    assert.equal(view.sent.length, 0); assert.equal(view.updates.length, 0); assert.equal(view.errors.length, 1);
    assert.ok(!view.errors.join(' ').includes(TOKEN));
  });
}

test('a reminder that is not due never looks up tokens or sends a message', async () => {
  const view = fixture({ createdAt: '2026-10-06T12:00:00Z' }); await view.run();
  assert.equal(view.lookups.length, 0); assert.equal(view.sent.length, 0); assert.equal(view.updates.length, 0);
});

test('failed delivery retries keep the same link and never advance the reminder stage', async () => {
  const view = fixture({ deliveryFailure: true }); await view.run(); await view.run();
  assert.equal(view.updates.length, 0); assert.equal(view.sent.length, 2);
  assert.equal(view.sent[0].body.html_body, view.sent[1].body.html_body);
  assert.equal(view.sent[0].body.request_id, view.sent[1].body.request_id);
});

test('the final follow-up includes the secure link too', async () => {
  const view = fixture({ stage: 1, createdAt: '2026-09-20T12:00:00Z' }); await view.run();
  assert.match(view.sent[0].body.subject, /Following up:/);
  assert.equal(view.updates[0].payload.automation_stage, 2);
  assert.ok(view.sent[0].body.html_body.includes(`/${QUOTE}/${TOKEN}`));
});

test('an unauthenticated request cannot access or send reminders', async () => {
  const view = fixture(); assert.equal((await view.run('Bearer synthetic-anon')).status, 401);
  assert.equal(view.lookups.length, 0); assert.equal(view.sent.length, 0);
});
