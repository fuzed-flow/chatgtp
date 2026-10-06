import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const source = await fs.readFile(new URL('../../supabase/functions/storefront-enquiry/index.ts', import.meta.url), 'utf8');
const javascript = (await transform(source.replace(/^import .*\n/gm, ''), { loader: 'ts', format: 'iife' })).code;
const visitor = 'visitor@example.invalid';

function fixture({ databaseError = false, providerStatus = 200, databaseThrows = false } = {}) {
  const observed = { saved: [], notifications: [], updates: [] };
  let handler;
  const db = {
    async rpc(name, parameters) {
      assert.equal(name, 'record_storefront_enquiry');
      assert.equal(parameters.p_digest.length, 64);
      if (databaseThrows) throw new Error('Synthetic database failure');
      if (databaseError) return { error: { message: 'Rate limited' } };
      observed.saved.push(parameters.p_fields);
      return { data: '00000000-0000-4000-8000-000000000001', error: null };
    },
    from(table) {
      assert.equal(table, 'storefront_enquiries');
      return { update(values) { return { async eq(field, value) {
        observed.updates.push({ values, field, value });
        return { error: null };
      } }; } };
    },
  };
  vm.runInNewContext(javascript, {
    Deno: {
      serve(callback) { handler = callback; },
      env: { get(name) { return { SUPABASE_URL: 'https://database.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', RESEND_API_KEY: 'synthetic-provider-key' }[name]; } },
    },
    createClient() { return db; },
    crypto: webcrypto,
    TextEncoder,
    Response,
    console: { error() {} },
    async fetch(url, options) {
      assert.equal(url, 'https://api.resend.com/emails');
      observed.notifications.push(JSON.parse(options.body));
      return new Response('{}', { status: providerStatus });
    },
  });
  const invoke = overrides => handler(new Request('https://edge.example.invalid/storefront-enquiry', {
    method: 'POST',
    headers: { Origin: 'https://www.fuzedflow.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'contact', name: 'Routing check', email: visitor, message: '<script>unsafe</script>', ...overrides }),
  }));
  return { observed, invoke };
}

for (const kind of ['contact', 'demo']) {
  test(kind + ' sends to the private inbox and preserves visitor Reply-To', async () => {
    const { observed, invoke } = fixture();
    const response = await invoke({ kind, to: 'other@example.invalid', to_email: 'other@example.invalid' });
    assert.equal(response.status, 200);
    assert.equal(observed.saved.length, 1);
    assert.equal(observed.notifications.length, 1);
    const notification = observed.notifications[0];
    assert.equal(notification.to, 'fuzedflow@gmail.com');
    assert.equal(notification.reply_to, visitor);
    assert.equal(notification.from, 'Fuzed Flow <alerts@mail.fuzedflow.com>');
    assert.equal(notification.subject, 'Storefront ' + kind + ' request');
    assert.match(notification.html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.equal(observed.updates[0].values.notification_status, 'sent');
    assert.doesNotMatch(await response.text(), /@/);
  });
}

test('invalid and honeypot submissions do not save or send', async () => {
  const { observed, invoke } = fixture();
  assert.equal((await invoke({ email: 'invalid' })).status, 400);
  assert.equal((await invoke({ website: 'spam' })).status, 200);
  assert.equal(observed.saved.length, 0);
  assert.equal(observed.notifications.length, 0);
});

test('database failures show a phone fallback without an email address', async () => {
  for (const options of [{ databaseError: true }, { databaseThrows: true }]) {
    const { observed, invoke } = fixture(options);
    const response = await invoke({});
    assert.equal(response.status, options.databaseError ? 429 : 500);
    const result = await response.json();
    assert.match(result.error, /1\(855\) 904-5509/);
    assert.doesNotMatch(result.error, /@/);
    assert.equal(observed.notifications.length, 0);
  }
});

test('provider failure is recorded for the saved enquiry', async () => {
  const { observed, invoke } = fixture({ providerStatus: 503 });
  assert.equal((await invoke({})).status, 200);
  assert.equal(observed.notifications[0].to, 'fuzedflow@gmail.com');
  assert.equal(observed.updates[0].values.notification_status, 'failed');
});
