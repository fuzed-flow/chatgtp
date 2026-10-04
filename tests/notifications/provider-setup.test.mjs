import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_CALLBACK, SMS_CALLBACK, RECEIVING_DOMAIN, runProviderSetup, publicSetupError } from '../../supabase/functions/notification-provider-setup/setup.js';

const config = { setup_secret: 'synthetic-setup-secret', resend_callback_url: EMAIL_CALLBACK, twilio_callback_url: SMS_CALLBACK, receiving_domain: RECEIVING_DOMAIN };
const credentials = { resendKey: 'synthetic-resend-key', twilioSid: 'AC' + 'a'.repeat(32), twilioToken: 'synthetic-twilio-token', twilioFrom: '+17805551234' };
const number = { sid: 'PN' + 'b'.repeat(32), phone_number: credentials.twilioFrom, sms_url: 'https://old.synthetic.example/sms', sms_method: 'GET', sms_application_sid: '' };
const secret = 'whsec_' + 's'.repeat(40);
const domain = { id: 'synthetic-domain', name: RECEIVING_DOMAIN, status: 'pending', capabilities: { sending: 'disabled', receiving: 'enabled' }, records: [{ record: 'Receiving', type: 'MX', name: 'reply', value: 'inbound.resend.com', priority: 10, ttl: 'Auto', status: 'pending' }] };
function fake(routes) {
  const calls = [], stored = [];
  return { calls, stored, fetch: async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(!url.includes('/emails') && !url.includes('/Messages'), 'Setup never uses message send endpoints.');
    const route = routes[options.method + ' ' + url];
    assert.ok(route, 'Unexpected provider request ' + options.method + ' ' + url);
    return Response.json(typeof route === 'function' ? route(options) : route, { status: route.statusCode || 200 });
  }, store: async (name, value) => stored.push({ name, value }) };
}
const resendLists = (webhooks = [], domains = []) => ({ 'GET https://api.resend.com/webhooks?limit=100': { data: webhooks, has_more: false }, 'GET https://api.resend.com/domains?limit=100': { data: domains, has_more: false } });
const numberList = 'GET https://api.twilio.com/2010-04-01/Accounts/' + credentials.twilioSid + '/IncomingPhoneNumbers.json?PhoneNumber=%2B17805551234&PageSize=50';

test('provider inspection is read-only and receipts never return API keys, raw signing secrets or account tokens', async () => {
  const f = fake({ ...resendLists([{ id: 'synthetic-webhook', endpoint: EMAIL_CALLBACK, status: 'enabled', events: ['email.sent'], signing_secret: secret }], [domain]), 'GET https://api.resend.com/domains/synthetic-domain': domain, [numberList]: { incoming_phone_numbers: [number] } });
  const receipt = await runProviderSetup('inspect', config, credentials, f.fetch, f.store);
  assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.stored.length, 0);
  const text = JSON.stringify(receipt);
  for (const value of [secret, credentials.resendKey, credentials.twilioToken, config.setup_secret]) assert.ok(!text.includes(value));
  assert.equal(receipt.resend.domains[0].records[0].type, 'MX'); assert.equal(receipt.twilio.configured, false);
});

test('Resend configuration reuses callback and verified Fuzed Flow receiving subdomain without rotating secrets', async () => {
  const existing = { id: 'existing-webhook', endpoint: EMAIL_CALLBACK, status: 'enabled', events: ['email.sent'], signing_secret: secret };
  const reused = { ...domain, name: 'replies.fuzedflow.com', status: 'verified' };
  const f = fake({ ...resendLists([existing], [reused]), 'GET https://api.resend.com/webhooks/existing-webhook': existing,
    'PATCH https://api.resend.com/webhooks/existing-webhook': { id: existing.id }, 'GET https://api.resend.com/domains/synthetic-domain': reused });
  const receipt = await runProviderSetup('configure_resend', config, credentials, f.fetch, f.store);
  assert.equal(receipt.signing_secret_stored, true); assert.equal(receipt.reply_routing_ready, true); assert.equal(receipt.domain.name, reused.name);
  assert.deepEqual(f.stored, [{ name: 'resend_webhook_secret', value: secret }, { name: 'resend_reply_domain', value: reused.name }]);
  assert.ok(!f.calls.some(call => call.url.includes('rotate') || call.method === 'POST'));
  assert.ok(!JSON.stringify(receipt).includes(secret));
  const body = JSON.parse(f.calls.find(call => call.method === 'PATCH').body);
  assert.equal(body.endpoint, EMAIL_CALLBACK); assert.ok(body.events.includes('email.received'));
});

test('new receiving subdomain returns required DNS while leaving existing business apex and DNS untouched', async () => {
  const f = fake({ ...resendLists([], [{ ...domain, id: 'synthetic-apex-domain', name: 'fuzedflow.com', status: 'verified' }]),
    'GET https://api.resend.com/domains/synthetic-apex-domain': { ...domain, id: 'synthetic-apex-domain', name: 'fuzedflow.com', status: 'verified' },
    'GET https://api.resend.com/domains/synthetic-domain': domain,
    'POST https://api.resend.com/domains/synthetic-domain/verify': { id: domain.id, object: 'domain' },
    'POST https://api.resend.com/webhooks': { id: 'new-webhook', signing_secret: secret },
    'POST https://api.resend.com/domains': options => { assert.deepEqual(JSON.parse(options.body), { name: RECEIVING_DOMAIN, capabilities: { sending: 'disabled', receiving: 'enabled' } }); return domain; } });
  const receipt = await runProviderSetup('configure_resend', config, credentials, f.fetch, f.store);
  assert.equal(receipt.domain.name, RECEIVING_DOMAIN); assert.equal(receipt.domain.records[0].value, 'inbound.resend.com');
  assert.equal(receipt.reply_routing_ready, false);
  assert.equal(receipt.verification_requested, true);
  assert.deepEqual(f.stored, [{ name: 'resend_webhook_secret', value: secret }], 'Pending receiving DNS must never publish the Reply-To domain.');
  assert.ok(f.calls.every(call => call.url.startsWith('https://api.resend.com/')));
});

test('repeated receiving setup verifies existing DNS and reuses the same domain/webhook without duplicate creation or secret rotation', async () => {
  let createdDomain = false, webhook = null, verificationCalls = 0;
  const currentDomain = { ...domain, status: 'not_started' };
  const f = fake({
    'GET https://api.resend.com/webhooks?limit=100': () => ({ data: webhook ? [webhook] : [], has_more: false }),
    'GET https://api.resend.com/domains?limit=100': () => ({ data: createdDomain ? [currentDomain] : [], has_more: false }),
    'POST https://api.resend.com/webhooks': options => { webhook = { ...JSON.parse(options.body), id: 'reused-webhook', status: 'enabled', signing_secret: secret }; return webhook; },
    'GET https://api.resend.com/webhooks/reused-webhook': () => webhook,
    'POST https://api.resend.com/domains': () => { createdDomain = true; return currentDomain; },
    'GET https://api.resend.com/domains/synthetic-domain': () => currentDomain,
    'POST https://api.resend.com/domains/synthetic-domain/verify': () => { if (++verificationCalls === 2) currentDomain.status = 'verified'; return { object: 'domain', id: currentDomain.id }; },
  });
  const initial = await runProviderSetup('configure_resend', config, credentials, f.fetch, f.store);
  assert.equal(initial.verification_requested, true); assert.equal(initial.reply_routing_ready, false);
  assert.ok(!f.stored.some(item => item.name === 'resend_reply_domain'));
  const afterDns = await runProviderSetup('configure_resend', config, credentials, f.fetch, f.store);
  assert.equal(afterDns.verification_requested, true); assert.equal(afterDns.reply_routing_ready, true);
  assert.equal(afterDns.domain.status, 'verified');
  const repeated = await runProviderSetup('configure_resend', config, credentials, f.fetch, f.store);
  assert.equal(repeated.verification_requested, false); assert.equal(repeated.reply_routing_ready, true);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url === 'https://api.resend.com/domains').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url === 'https://api.resend.com/webhooks').length, 1);
  assert.equal(verificationCalls, 2); assert.ok(!f.calls.some(call => call.url.includes('rotate')));
});

test('Twilio callback update is fixed to configured sender and preserves voice/application settings', async () => {
  const f = fake({ [numberList]: { incoming_phone_numbers: [number] }, ['POST https://api.twilio.com/2010-04-01/Accounts/' + credentials.twilioSid + '/IncomingPhoneNumbers/' + number.sid + '.json']: options => {
    assert.deepEqual(Object.fromEntries(options.body), { SmsUrl: SMS_CALLBACK, SmsMethod: 'POST' });
    return { ...number, sms_url: SMS_CALLBACK, sms_method: 'POST' };
  } });
  const receipt = await runProviderSetup('configure_twilio', config, credentials, f.fetch, f.store);
  assert.equal(receipt.twilio.configured, true); assert.equal(f.stored.length, 0);
  const blocked = fake({ [numberList]: { incoming_phone_numbers: [{ ...number, sms_application_sid: 'AP' + 'c'.repeat(32) }] } });
  await assert.rejects(runProviderSetup('configure_twilio', config, credentials, blocked.fetch, blocked.store), error => error.status === 409);
  assert.equal(blocked.calls.length, 1);
});

test('setup restricts actions/configuration and safely reports provider account permission failures', async () => {
  const f = fake({ 'GET https://api.resend.com/webhooks?limit=100': { statusCode: 403, message: secret }, 'GET https://api.resend.com/domains?limit=100': { statusCode: 403 }, [numberList]: { statusCode: 401, code: 20003, message: credentials.twilioToken } });
  const receipt = await runProviderSetup('inspect', config, credentials, f.fetch, f.store);
  assert.equal(receipt.resend.status, 403); assert.equal(receipt.twilio.code, 20003);
  assert.ok(!JSON.stringify(receipt).includes(secret) && !JSON.stringify(receipt).includes(credentials.twilioToken));
  await assert.rejects(runProviderSetup('send_email', config, credentials, f.fetch, f.store), error => error.status === 400);
  await assert.rejects(runProviderSetup('configure_resend', { ...config, receiving_domain: 'customer.example' }, credentials, f.fetch, f.store), error => error.status === 503);
  assert.deepEqual(publicSetupError(new Error(secret)), { provider: 'setup', status: 503, error: 'Provider configuration could not finish. Inspect the account before retrying.' });
});
