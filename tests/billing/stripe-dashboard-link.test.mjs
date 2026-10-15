import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edgeFunction = await readFile(
  new URL('../../supabase/functions/connect-stripe-account/index.ts', import.meta.url),
  'utf8',
);
const paymentSettings = await readFile(
  new URL('../../src/components/settings/PaymentSettings.jsx', import.meta.url),
  'utf8',
);

test('dashboard links are generated for the authenticated company Stripe account', () => {
  assert.match(edgeFunction, /action === ["']dashboard["']/);
  assert.match(
    edgeFunction,
    /accounts\/\$\{encodeURIComponent\(stripeAccountId\)\}\/login_links/,
  );
  assert.match(edgeFunction, /stripeAccountId = company\.stripe_account_id/);
  assert.doesNotMatch(edgeFunction, /requestBody\?\.stripe_account_id/);
});

test('Payments settings requests a secure dashboard link instead of opening a generic URL', () => {
  assert.match(paymentSettings, /JSON\.stringify\(\{ action: ['"]dashboard['"] \}\)/);
  assert.match(paymentSettings, /window\.location\.assign\(result\.url\)/);
  assert.doesNotMatch(paymentSettings, /window\.open\(['"]https:\/\/dashboard\.stripe\.com/);
});
