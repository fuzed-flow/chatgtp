import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (await fs.readFile(new URL('../../supabase/functions/quote-reminder-cron/index.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '');

function configuredUrl(value) {
  return vm.runInNewContext(source + '\nAPP_URL;', {
    Deno: { env: { get: name => name === 'APP_URL' ? value : undefined } },
    serve() {},
    createClient() { throw new Error('Do not connect to a live database.'); },
    fetch() { throw new Error('Do not send a live reminder.'); },
  });
}

test('quote reminders use the live Fuzed Flow app without an explicit URL', () => {
  for (const value of [undefined, '']) assert.equal(configuredUrl(value), 'https://app.fuzedflow.com');
});

test('legacy Pro-Trades app settings cannot send clients to the old brand', () => {
  for (const value of ['https://app.pro-trades.com', 'https://pro-trades.com/', 'http://app.pro-trades.ca/', 'https://APP.PRO-TRADES.COM/']) {
    assert.equal(configuredUrl(value), 'https://app.fuzedflow.com');
  }
});

test('valid explicitly configured app domains are retained and slash-normalized', () => {
  assert.equal(configuredUrl('https://custom.example/'), 'https://custom.example');
  assert.equal(configuredUrl('https://app.fuzedflow.com'), 'https://app.fuzedflow.com');
  assert.equal(configuredUrl('https://pro-trades.com.custom.example'), 'https://pro-trades.com.custom.example');
});
