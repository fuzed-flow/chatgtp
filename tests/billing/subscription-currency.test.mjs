import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { currencyFactor } from '../../supabase/functions/_shared/checkout.js';
import { salesUuid } from '../../supabase/functions/_shared/salesNotifications.js';
import {
  SUBSCRIPTION_CURRENCY, SUBSCRIPTION_PRICES, BASE_USER_LIMITS,
  getBillingCycleFromPrice, getPlanIdFromPrice, getUsdPriceId, getUserLimitFromQuantity,
} from '../../supabase/functions/_shared/subscriptionPlans.js';

test('new and legacy links select the same plan and billing period in USD', () => {
  assert.equal(SUBSCRIPTION_CURRENCY, 'USD');
  for (const [planId, prices] of Object.entries(SUBSCRIPTION_PRICES)) {
    for (const cycle of ['monthly', 'annual']) {
      assert.equal(getPlanIdFromPrice(prices[cycle]), planId);
      assert.equal(getPlanIdFromPrice(prices.legacy[cycle]), planId);
      assert.equal(getUsdPriceId(prices[cycle]), prices[cycle]);
      assert.equal(getUsdPriceId(prices.legacy[cycle]), prices[cycle]);
      assert.equal(getBillingCycleFromPrice(prices[cycle]), cycle);
      assert.equal(getBillingCycleFromPrice(prices.legacy[cycle]), cycle);
    }
  }
  assert.equal(getUsdPriceId('price_unknown'), null);
  assert.equal(getUsdPriceId(null), null);
  assert.equal(getBillingCycleFromPrice('price_unknown'), null);
});

async function loadHandler(path) {
  let handler;
  const checkoutCalls = [];
  const companyUpdates = [];
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const withoutImports = source.replace(/^import .*\n/gm, '');
  const script = stripTypeScriptTypes(withoutImports, { mode: 'strip' });
  const env = {
    STRIPE_SECRET_KEY: 'test-secret',
    STRIPE_WEBHOOK_SECRET: 'test-webhook-secret',
    SUPABASE_URL: 'https://synthetic.supabase.invalid',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    APP_URL: 'https://app.fuzedflow.com',
  };
  class Stripe {
    static createFetchHttpClient() { return {}; }
    static createSubtleCryptoProvider() { return {}; }
    checkout = { sessions: { create: async (parameters) => {
      checkoutCalls.push(parameters);
      return { url: 'https://checkout.stripe.com/test' };
    } } };
    webhooks = { constructEventAsync: async (body, signature, secret, tolerance, cryptoProvider) => {
      assert.equal(signature, 'test-signature');
      assert.equal(secret, env.STRIPE_WEBHOOK_SECRET);
      assert.equal(tolerance, undefined);
      assert.equal(typeof cryptoProvider, 'object');
      return JSON.parse(body);
    } };
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-test' } }, error: null }) },
    from: (table) => {
      const filters = []; let values;
      const result = () => {
        if (values) {
          const [column, value] = filters.at(-1);
          companyUpdates.push({ table, values, column, value, filters });
          return { data: null, error: null };
        }
        if (table === 'profiles') return { data: { id: 'user-test', company_id: 'company-test', is_active: true, role: 'admin' }, error: null };
        if (table === 'companies') return { data: { id: 'company-test', stripe_customer_id: 'cus_test' }, error: null };
        throw new Error('Unexpected synthetic billing table: ' + table);
      };
      const query = {
        select() { return this; },
        update(input) { values = input; return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        single: async () => result(), maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject); },
      };
      return query;
    },
    rpc: async name => {
      if (name === 'notification_provider_server_config') return { data: { stripe_connect_webhook_secret: 'synthetic-connect-secret' }, error: null };
      if (name === 'stripe_payment_context') return { data: null, error: null };
      if (name === 'record_stripe_payment' || name === 'record_sales_event') return { data: true, error: null };
      throw new Error('Unexpected synthetic billing RPC: ' + name);
    },
  };
  const context = vm.createContext({
    Stripe, createClient: () => client,
    getBillingCycleFromPrice, getPlanIdFromPrice, getUsdPriceId, getUserLimitFromQuantity, BASE_USER_LIMITS,
    providerServerConfig: async db => (await db.rpc('notification_provider_server_config')).data,
    salesUuid, currencyFactor, crypto,
    Deno: { env: { get: (key) => env[key] || '' }, serve: (fn) => { handler = fn; } },
    serve: (fn) => { handler = fn; },
    Request, Response, console,
  });
  new vm.Script(script, { filename: path }).runInContext(context);
  assert.equal(typeof handler, 'function');
  return { handler, checkoutCalls, companyUpdates };
}

test('checkout maps all six CAD links to USD while preserving trial and quantities', async () => {
  const { handler, checkoutCalls } = await loadHandler('../../supabase/functions/create-checkout/index.ts');
  for (const [planId, prices] of Object.entries(SUBSCRIPTION_PRICES)) {
    for (const cycle of ['monthly', 'annual']) {
      const response = await handler(new Request('https://example.com/create-checkout', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_id: prices.legacy[cycle],
          plan_id: 'incorrect-client-value',
          company_id: 'company-test',
        }),
      }));
      assert.equal(response.status, 200);
      const parameters = checkoutCalls.at(-1);
      assert.equal(parameters.line_items[0].price, prices[cycle]);
      assert.equal(parameters.line_items[0].quantity, 1);
      assert.equal(parameters.mode, 'subscription');
      assert.equal(parameters.allow_promotion_codes, cycle === 'monthly');
      assert.equal(parameters.subscription_data.trial_period_days, 14);
      assert.equal(parameters.subscription_data.metadata.plan_id, planId);
      assert.equal(parameters.metadata.plan_id, planId);
      assert.equal(parameters.client_reference_id, 'company-test');
      assert.equal(parameters.automatic_tax, undefined);
    }
  }
});

test('checkout rejects an unknown price before creating a session', async () => {
  const { handler, checkoutCalls } = await loadHandler('../../supabase/functions/create-checkout/index.ts');
  const response = await handler(new Request('https://example.com/create-checkout', {
    method: 'POST',
    body: JSON.stringify({ price_id: 'price_unknown', company_id: 'company-test' }),
  }));
  assert.equal(response.status, 400);
  assert.equal(checkoutCalls.length, 0);
});

test('checkout applies FUZED25 once through the annual-only server gate', async () => {
  const { handler, checkoutCalls } = await loadHandler('../../supabase/functions/create-checkout/index.ts');
  const response = await handler(new Request('https://example.com/create-checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_id: SUBSCRIPTION_PRICES.business.annual,
      company_id: 'company-test',
      promotion_code: 'fuzed25',
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutCalls[0].discounts)), [{ coupon: 'q7ZuyPnp' }]);
  assert.equal(checkoutCalls[0].allow_promotion_codes, false);
  assert.equal(checkoutCalls[0].metadata.promotion_code, 'FUZED25');
  assert.equal(checkoutCalls[0].subscription_data.metadata.promotion_code, 'FUZED25');
});

test('checkout blocks FUZED25 from monthly plans before creating a session', async () => {
  const { handler, checkoutCalls } = await loadHandler('../../supabase/functions/create-checkout/index.ts');
  const response = await handler(new Request('https://example.com/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_id: SUBSCRIPTION_PRICES.starter.monthly,
      company_id: 'company-test',
      promotion_code: 'FUZED25',
    }),
  }));
  assert.equal(response.status, 400);
  assert.equal(checkoutCalls.length, 0);
});

test('subscription updates retain entitlements for all CAD and USD price variants', async () => {
  const { handler, companyUpdates } = await loadHandler('../../supabase/functions/stripe-webhook/index.ts');
  const includedUsers = { starter: 1, professional: 3, business: 10 };
  for (const [planId, prices] of Object.entries(SUBSCRIPTION_PRICES)) {
    for (const priceId of [prices.monthly, prices.annual, prices.legacy.monthly, prices.legacy.annual]) {
      const event = {
        type: 'customer.subscription.updated',
        data: { object: {
          customer: 'cus_test',
          status: 'trialing',
          items: { data: [{ price: { id: priceId }, quantity: 1 }] },
        } },
      };
      const response = await handler(new Request('https://example.com/stripe-webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 'test-signature' },
        body: JSON.stringify(event),
      }));
      assert.equal(response.status, 200);
      const update = companyUpdates.at(-1);
      assert.equal(update.table, 'companies');
      assert.equal(update.values.plan_id, planId);
      assert.equal(update.values.subscription_status, 'Active');
      assert.equal(update.values.max_users, includedUsers[planId]);
      assert.equal(update.column, 'stripe_customer_id');
      assert.equal(update.value, 'cus_test');
    }
  }
  assert.equal(companyUpdates.length, 12);
});
