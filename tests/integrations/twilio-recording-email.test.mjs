import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHmac, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../../', import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL('supabase/functions/twilio-recording-email/index.ts', root))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  logLevel: 'silent',
});
const bundled = result.outputFiles[0].text;
const ACCOUNT = 'AC' + 'a'.repeat(32);
const CALL = 'CA' + 'b'.repeat(32);
const RECORDING = 'RE' + 'c'.repeat(32);
const TRANSCRIPTION = 'TR' + 'd'.repeat(32);
const TOKEN = 'synthetic-twilio-secret';
const BASE = 'https://synthetic.supabase.invalid';

function request(overrides = {}, options = {}) {
  const values = {
    AccountSid: ACCOUNT,
    CallSid: CALL,
    RecordingSid: RECORDING,
    RecordingUrl: `${BASE}/untrusted-recording-url`,
    TranscriptionSid: TRANSCRIPTION,
    TranscriptionStatus: 'completed',
    TranscriptionText: 'Please call me about <the project> & schedule.',
    From: '+14035550123',
    To: '+18559045509',
    RecordingDuration: '42',
    ...overrides,
  };
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) form.set(name, String(value));
  }
  const search = options.search || '';
  let signed = options.signUrl || `${BASE}/functions/v1/twilio-recording-email${search}`;
  for (const name of [...new Set(form.keys())].sort()) {
    for (const value of [...new Set(form.getAll(name))].sort()) signed += name + value;
  }
  const signature = createHmac('sha1', options.token || TOKEN).update(signed).digest('base64');
  return new Request(`${options.origin || BASE}/functions/v1/twilio-recording-email${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: options.body || form.toString(),
  });
}

function fixture(options = {}) {
  let handler;
  const fetches = [];
  const env = {
    SUPABASE_URL: BASE,
    TWILIO_ACCOUNT_SID: ACCOUNT,
    TWILIO_AUTH_TOKEN: TOKEN,
    RESEND_API_KEY: 'synthetic-resend-key',
    TWILIO_CALL_EMAIL_TO: options.recipient,
  };
  const context = {
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, atob, btoa, Date, Intl,
    console: { error() {} },
    Deno: { serve(callback) { handler = callback; }, env: { get(name) { return env[name]; } } },
    async fetch(url, init = {}) {
      fetches.push({ url: String(url), init });
      if (String(url).startsWith('https://api.twilio.com/')) {
        assert.equal(String(url), `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Recordings/${RECORDING}.mp3`);
        assert.match(init.headers.Authorization, /^Basic /);
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: options.recordingStatus || 200, headers: { 'content-length': '4' } });
      }
      assert.equal(String(url), 'https://api.resend.com/emails');
      return Response.json(options.emailStatus && options.emailStatus >= 400 ? { message: 'unavailable' } : { id: 'email-id' }, { status: options.emailStatus || 200 });
    },
  };
  vm.runInNewContext(bundled, context, { timeout: 1000 });
  return { handler, fetches };
}

test('signed transcription callback emails escaped transcript and authenticated MP3 exactly once', async () => {
  const view = fixture({ recipient: 'calls@example.invalid, office@example.invalid' });
  const response = await view.handler(request());
  assert.equal(response.status, 200);
  assert.equal(view.fetches.length, 2);
  const email = view.fetches[1];
  const payload = JSON.parse(email.init.body);
  assert.deepEqual(payload.to, ['calls@example.invalid', 'office@example.invalid']);
  assert.equal(payload.from, 'Fuzed Flow <alerts@mail.fuzedflow.com>');
  assert.equal(payload.subject, 'New FuzedFlow call recording from +14035550123');
  assert.match(payload.html, /Please call me about &lt;the project&gt; &amp; schedule\./);
  assert.doesNotMatch(payload.html, /<the project>/);
  assert.equal(payload.attachments[0].filename, `fuzedflow-call-${RECORDING}.mp3`);
  assert.equal(payload.attachments[0].content, Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.equal(email.init.headers['Idempotency-Key'], `twilio-recording/${TRANSCRIPTION}`);
});

for (const [name, overrides, options] of [
  ['bad signature', {}, { token: 'wrong' }],
  ['wrong account', { AccountSid: 'AC' + 'f'.repeat(32) }, {}],
  ['wrong signed URL', {}, { signUrl: 'https://foreign.invalid/functions/v1/twilio-recording-email' }],
  ['tampered body', {}, { body: 'TranscriptionText=tampered' }],
]) test(`rejects ${name} before any provider request`, async () => {
  const view = fixture();
  assert.equal((await view.handler(request(overrides, options))).status, 401);
  assert.equal(view.fetches.length, 0);
});

test('recording-only callback waits and does not send a transcript-less duplicate', async () => {
  const view = fixture();
  const response = await view.handler(request({ TranscriptionStatus: undefined, TranscriptionSid: undefined, TranscriptionText: undefined }));
  assert.equal(response.status, 200);
  assert.equal(view.fetches.length, 0);
});

test('failed transcription still emails the available recording to the default inbox', async () => {
  const view = fixture();
  assert.equal((await view.handler(request({ TranscriptionStatus: 'failed', TranscriptionText: '' }))).status, 200);
  const payload = JSON.parse(view.fetches[1].init.body);
  assert.deepEqual(payload.to, ['fuzedflow@gmail.com']);
  assert.match(payload.text, /could not create a transcript/i);
  assert.equal(payload.attachments.length, 1);
});

test('temporary recording or email failures remain retryable without reporting success', async () => {
  let view = fixture({ recordingStatus: 503 });
  assert.equal((await view.handler(request())).status, 503);
  assert.equal(view.fetches.length, 1);

  view = fixture({ emailStatus: 503 });
  assert.equal((await view.handler(request())).status, 503);
  assert.equal(view.fetches.length, 2);
});
