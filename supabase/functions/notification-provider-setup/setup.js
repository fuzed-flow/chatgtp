/* Temporary account configuration helper. No email/SMS send endpoints are allowed. */
export const EMAIL_CALLBACK = 'https://ochqexofahdssmarnict.supabase.co/functions/v1/email-events';
export const SMS_CALLBACK = 'https://ochqexofahdssmarnict.supabase.co/functions/v1/sms-events';
export const RECEIVING_DOMAIN = 'reply.fuzedflow.com';
const EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.received'];
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const safeReceivingDomain = value => typeof value === 'string' && /^[a-z0-9-]+\.fuzedflow\.com$/.test(value);
const publicWebhook = item => ({ id: item.id, endpoint: item.endpoint, status: item.status, events: item.events || [] });
const publicDomain = item => ({ id: item.id, name: item.name, status: item.status, capabilities: item.capabilities || {},
  records: (item.records || []).map(record => Object.fromEntries(['record', 'name', 'type', 'value', 'priority', 'ttl', 'status'].filter(key => record[key] !== undefined).map(key => [key, record[key]]))) });
export class SetupError extends Error {
  constructor(provider, status, code) { super('Provider configuration could not finish'); this.provider = provider; this.status = status; this.code = code; }
}
export const publicSetupError = error => ({ provider: error.provider || 'setup', status: error.status || 503,
  error: error.status === 401 || error.status === 403 ? 'The configured provider API credentials do not allow account configuration.' : 'Provider configuration could not finish. Inspect the account before retrying.',
  ...(Number.isInteger(error.code) ? { code: error.code } : {}) });

export async function runProviderSetup(action, config, credentials, fetcher, storeSecret) {
  if (!['inspect', 'configure_resend', 'configure_twilio'].includes(action)) throw new SetupError('setup', 400);
  if (config.resend_callback_url !== EMAIL_CALLBACK || config.twilio_callback_url !== SMS_CALLBACK || config.receiving_domain !== RECEIVING_DOMAIN) throw new SetupError('setup', 503);
  const resend = async (path, method = 'GET', body) => {
    // Every path is constructed here from a fixed resource and a validated provider ID.
    const resourcePath = /^\/(webhooks|domains)(\/[a-zA-Z0-9-]{1,80})?(\?limit=100(&after=[a-zA-Z0-9-]{1,80})?)?$/.test(path);
    const verificationPath = method === 'POST' && /^\/domains\/[a-zA-Z0-9-]{1,80}\/verify$/.test(path);
    if (!resourcePath && !verificationPath) throw new SetupError('setup', 400);
    if (!credentials.resendKey) throw new SetupError('resend', 503);
    const response = await fetcher('https://api.resend.com' + path, { method, headers: { Authorization: `Bearer ${credentials.resendKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new SetupError('resend', response.status);
    return response.json();
  };
  const list = async resource => {
    let after = '', items = [];
    for (let page = 0; page < 20; page++) {
      const result = await resend(`/${resource}?limit=100${after ? '&after=' + after : ''}`);
      if (!Array.isArray(result.data)) throw new SetupError('resend', 502);
      items = items.concat(result.data);
      if (!result.has_more) return items;
      const next = result.data.at(-1)?.id;
      if (!safeId(next) || next === after) throw new SetupError('resend', 502);
      after = next;
    }
    throw new SetupError('resend', 409);
  };
  const inspectResend = async () => {
    const [webhooks, domains] = await Promise.all([list('webhooks'), list('domains')]);
    // Domain listing omits DNS records. Only retrieve Fuzed Flow's own domain details.
    await Promise.all(domains.filter(domain => domain.name === 'fuzedflow.com' || safeReceivingDomain(domain.name)).slice(0, 20).map(async domain => {
      if (!safeId(domain.id)) throw new SetupError('resend', 502);
      Object.assign(domain, await resend('/domains/' + domain.id));
    }));
    return { webhooks, domains };
  };
  const inspectTwilio = async configure => {
    const { twilioSid: sid, twilioToken: token, twilioFrom: from } = credentials;
    if (!/^AC[a-fA-F0-9]{32}$/.test(sid || '') || !token || !/^\+[1-9][0-9]{7,14}$/.test(from || '')) throw new SetupError('twilio', 503);
    const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers`;
    const request = async (url, body) => {
      const response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body ? { body: new URLSearchParams(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) { let code; try { code = (await response.json()).code; } catch { /* Do not return provider bodies. */ } throw new SetupError('twilio', response.status, code); }
      return response.json();
    };
    const result = await request(`${base}.json?${new URLSearchParams({ PhoneNumber: from, PageSize: '50' })}`);
    const numbers = (result.incoming_phone_numbers || []).filter(number => number.phone_number === from);
    if (numbers.length !== 1 || !/^PN[a-fA-F0-9]{32}$/.test(numbers[0].sid || '')) throw new SetupError('twilio', 409);
    let number = numbers[0];
    if (configure) {
      // An SMS application has precedence over SmsUrl. Do not disturb another integration.
      if (number.sms_application_sid) throw new SetupError('twilio', 409);
      number = await request(`${base}/${number.sid}.json`, { SmsUrl: SMS_CALLBACK, SmsMethod: 'POST' });
    }
    return { id: number.sid, phone_number: number.phone_number, sms_url: number.sms_url || '', sms_method: number.sms_method || '',
      sms_application_configured: Boolean(number.sms_application_sid), configured: number.sms_url === SMS_CALLBACK && number.sms_method === 'POST' };
  };
  if (action === 'inspect') {
    const [email, sms] = await Promise.allSettled([inspectResend(), inspectTwilio(false)]);
    return { action, resend: email.status === 'fulfilled' ? { webhooks: email.value.webhooks.map(publicWebhook), domains: email.value.domains.map(publicDomain) } : publicSetupError(email.reason),
      twilio: sms.status === 'fulfilled' ? sms.value : publicSetupError(sms.reason) };
  }
  if (action === 'configure_twilio') return { action, twilio: await inspectTwilio(true) };
  const { webhooks, domains } = await inspectResend();
  const matching = webhooks.filter(item => item.endpoint === EMAIL_CALLBACK);
  if (matching.length > 1) throw new SetupError('resend', 409);
  let webhook;
  if (matching.length) {
    if (!safeId(matching[0].id)) throw new SetupError('resend', 502);
    webhook = await resend('/webhooks/' + matching[0].id);
    const events = [...new Set([...(webhook.events || []), ...EVENTS])];
    if (webhook.status !== 'enabled' || EVENTS.some(event => !webhook.events?.includes(event))) {
      await resend('/webhooks/' + webhook.id, 'PATCH', { endpoint: EMAIL_CALLBACK, events, status: 'enabled' });
      webhook = { ...webhook, status: 'enabled', events };
    }
  } else webhook = { ...await resend('/webhooks', 'POST', { endpoint: EMAIL_CALLBACK, events: EVENTS }), endpoint: EMAIL_CALLBACK, events: EVENTS, status: 'enabled' };
  let secretStored = false;
  if (typeof webhook.signing_secret === 'string' && /^whsec_[a-zA-Z0-9+/=_-]{16,500}$/.test(webhook.signing_secret)) {
    await storeSecret('resend_webhook_secret', webhook.signing_secret); secretStored = true;
  }
  // Reuse an already verified receiving subdomain, never the business email apex.
  let domain = domains.find(item => item.name === RECEIVING_DOMAIN);
  let verificationRequested = false;
  if (!domain) domain = domains.find(item => safeReceivingDomain(item.name) && item.status === 'verified' && item.capabilities?.receiving === 'enabled');
  if (domain) {
    if (!safeId(domain.id) || !safeReceivingDomain(domain.name)) throw new SetupError('resend', 502);
    if (domain.capabilities?.receiving !== 'enabled') {
      await resend('/domains/' + domain.id, 'PATCH', { capabilities: { receiving: 'enabled' } });
      verificationRequested = true;
    }
    domain = await resend('/domains/' + domain.id);
  } else domain = await resend('/domains', 'POST', { name: RECEIVING_DOMAIN, capabilities: { sending: 'disabled', receiving: 'enabled' } });
  if (!safeId(domain.id) || !safeReceivingDomain(domain.name) || domain.capabilities?.receiving !== 'enabled') throw new SetupError('resend', 502);
  // Start/recheck Resend's DNS verification. This never edits the domain's DNS records.
  if (verificationRequested || domain.status !== 'verified') {
    verificationRequested = true;
    await resend('/domains/' + domain.id + '/verify', 'POST');
    domain = await resend('/domains/' + domain.id);
    if (!safeReceivingDomain(domain.name) || domain.capabilities?.receiving !== 'enabled') throw new SetupError('resend', 502);
  }
  // Enabling receiving still requires verified DNS. Do not publish a broken Reply-To route.
  const replyRoutingReady = domain.status === 'verified' && domain.capabilities.receiving === 'enabled';
  if (replyRoutingReady) await storeSecret('resend_reply_domain', domain.name);
  return { action, webhook: publicWebhook(webhook), signing_secret_stored: secretStored, verification_requested: verificationRequested, reply_routing_ready: replyRoutingReady, domain: publicDomain(domain),
    ...(secretStored ? {} : { warning: 'The provider did not return the webhook signing secret. No signing secret was rotated.' }) };
}
