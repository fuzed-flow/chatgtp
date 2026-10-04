import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { buildProviderPayload, quietUntil, retryOutcome, runDeliveryBatch, safeAppUrl } from '../../supabase/functions/notification-dispatch/delivery.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const COMPANY = id(1), OTHER = id(2), USER = id(10), FOREIGN = id(20);
const migration = new URL('../../supabase/migrations/20261004173154_notification_personal_delivery.sql', import.meta.url);
async function fixture() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec('alter table auth.users add column email_confirmed_at timestamptz');
  await db.exec(await readFile(new URL('../../supabase/migrations/20261003220500_role_based_notifications.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(migration, 'utf8'));
  await db.query("insert into companies(id,name,timezone) values($1,'Synthetic A','UTC'),($2,'Synthetic B','UTC')", [COMPANY, OTHER]);
  await db.query("insert into profiles(id,company_id,role,full_name,is_active) values($1,$2,'owner','Synthetic Owner',true),($3,$4,'owner','Other Owner',true)", [USER, COMPANY, FOREIGN, OTHER]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@synthetic.example',now()),($2,'other@synthetic.example',now())", [USER, FOREIGN]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [USER]);
  const save = async (prefs = {}) => (await db.query('select public.save_notification_preferences($1::jsonb) data', [JSON.stringify({ timezone: 'UTC', ...prefs })])).rows[0].data;
  const alert = async (number, options = {}) => db.query("insert into notifications(id,company_id,user_id,event_key,dedupe_key,title,body,category,severity,metadata,action_url) values($1,$2,$3,'company_settings_changed',$4,'Synthetic update','Synthetic body',$5,$6,'{}'::jsonb,'/AdminSettings')", [id(number), options.company || COMPANY, options.user || USER, 'synthetic:' + number, options.category || 'Admin', options.severity || 'Important']);
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  return { db, save, alert, query };
}

test('SQL personal delivery opt-in, tenant ownership, future-only queue and authoritative channel/category preferences', async () => {
  const f = await fixture();
  try {
    await f.alert(100);
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, 0);
    await f.save({ email: true, sms: true, sms_phone: '+17805551234', categories: { Security: false } });
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, 0, 'Opt-in never replays history.');
    await f.alert(101); await f.alert(102, { category: 'Security' }); await f.alert(103, { company: OTHER, user: FOREIGN });
    const jobs = await f.query('select * from notification_private.delivery_outbox order by channel');
    assert.deepEqual(jobs.map(job => job.channel), ['email', 'sms']);
    assert.ok(jobs.every(job => job.user_id === USER && job.company_id === COMPANY && job.notification_id === id(101)));
    await f.db.exec('set role authenticated');
    assert.equal((await f.query('select count(*)::int n from public.notification_preferences'))[0].n, 1);
    await assert.rejects(f.db.query("insert into public.notification_preferences(user_id,company_id) values($1,$2)", [FOREIGN, OTHER]), /permission denied/);
    await assert.rejects(f.db.query('select public.claim_notification_deliveries(10)'), /permission denied/);
    await assert.rejects(f.db.query('select public.notification_delivery_server_config()'), /permission denied/);
    await f.db.exec('reset role');
    await f.save({ email: false, sms: false });
    assert.equal((await f.query("select count(*)::int n from notification_private.delivery_outbox where state='cancelled'"))[0].n, 2);
    await f.save({ email: true });
    assert.equal((await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs.length, 0);
    await assert.rejects(f.save({ sms: true, sms_phone: '7805551234' }), /check constraint/);
    await assert.rejects(f.save({ timezone: 'Neverland/Invalid' }), /valid timezone/);
  } finally { await f.db.close(); }
});

test('SQL push subscription lifecycle rejects SSRF/shared-account takeover and is private to its owner', async () => {
  const f = await fixture();
  try {
    const subscription = { endpoint: 'https://fcm.googleapis.com/send/synthetic-token', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
    const register = async data => (await f.query('select public.register_notification_push($1::jsonb,$2) id', [JSON.stringify(data), 'Synthetic browser'] ))[0].id;
    const first = await register(subscription);
    assert.equal(await register(subscription), first, 'Reconnect upserts the same device.');
    await assert.rejects(register({ ...subscription, endpoint: 'https://127.0.0.1/private' }), /Unsupported push endpoint/);
    await assert.rejects(register({ ...subscription, endpoint: 'https://fcm.googleapis.com:444/send/synthetic' }), /Unsupported push endpoint/);
    await f.save({ push: true }); await f.alert(110);
    assert.equal((await f.query("select count(*)::int n from notification_private.delivery_outbox where channel='push'"))[0].n, 1);
    await f.db.query("select set_config('request.jwt.claim.sub',$1,false)", [FOREIGN]);
    await f.db.exec('set role authenticated');
    assert.equal((await f.query('select count(*)::int n from public.notification_push_subscriptions'))[0].n, 0);
    await assert.rejects(register(subscription), /shared browser/);
    assert.equal((await f.query('select public.remove_notification_push($1) removed', [subscription.endpoint]))[0].removed, false);
    await f.db.exec('reset role');
    await f.db.query("select set_config('request.jwt.claim.sub',$1,false)", [USER]);
    assert.equal((await f.query('select public.remove_notification_push($1) removed', [subscription.endpoint]))[0].removed, true);
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, 0, 'Removing a device cancels its queued push via FK.');
  } finally { await f.db.close(); }
});

test('SQL dispatch leases preserve provider payload, reject wrong tokens and revoke access before sends', async () => {
  const f = await fixture();
  try {
    await f.save({ email: true }); await f.alert(120);
    const jobs = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].recipient, 'owner@synthetic.example');
    assert.equal((await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs.length, 0, 'Active leases cannot be claimed twice.');
    const job = jobs[0], capture = payload => f.query('select public.capture_notification_delivery($1,$2,$3::jsonb) payload', [job.id, job.lease_token, JSON.stringify(payload)]);
    assert.deepEqual((await capture({ to: job.recipient, html: 'Original bytes' }))[0].payload, { to: job.recipient, html: 'Original bytes' });
    assert.deepEqual((await capture({ to: job.recipient, html: 'Changed bytes' }))[0].payload, { to: job.recipient, html: 'Original bytes' });
    assert.equal((await f.query("select public.finish_notification_delivery($1,$2,'sent') ok", [job.id, id(999)]))[0].ok, false);
    await f.save({ email: false });
    await assert.rejects(capture({}), /preferences changed/);
    await f.db.query("update notification_private.delivery_outbox set leased_at=now()-interval '10 minutes' where id=$1", [job.id]);
    assert.equal((await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs.length, 0);
    assert.equal((await f.query('select state from notification_private.delivery_outbox where id=$1', [job.id]))[0].state, 'cancelled');
  } finally { await f.db.close(); }
});

test('SQL digests use future eligible recipient events and deduplicate one batch per local day', async () => {
  const f = await fixture();
  try {
    await f.alert(130);
    await f.save({ digest_frequency: 'daily', digest_hour: 8, timezone: 'UTC' });
    await f.alert(131); await f.alert(132); await f.alert(133, { company: OTHER, user: FOREIGN });
    assert.equal((await f.query("select notification_private.prepare_digests('2026-10-05 07:59Z') n"))[0].n, 0);
    assert.equal((await f.query("select notification_private.prepare_digests('2026-10-05 08:00Z') n"))[0].n, 1);
    assert.equal((await f.query("select notification_private.prepare_digests('2026-10-05 08:01Z') n"))[0].n, 0);
    const job = (await f.query("select * from notification_private.delivery_outbox where job_kind='digest'"))[0];
    assert.deepEqual(job.payload.items.map(item => item.id), [id(131), id(132)]);
    await f.save({ digest_frequency: 'off' });
    assert.equal((await f.query('select state from notification_private.delivery_outbox where id=$1', [job.id]))[0].state, 'cancelled');
    await f.save({ digest_frequency: 'weekly', digest_weekday: 1, digest_hour: 8 });
    await f.alert(134);
    assert.equal((await f.query("select notification_private.prepare_digests('2026-10-06 09:00Z') n"))[0].n, 0);
    assert.equal((await f.query("select notification_private.prepare_digests('2026-10-12 09:00Z') n"))[0].n, 1);
  } finally { await f.db.close(); }
});

test('SQL public push config never exposes Vault private/cron secrets', async () => {
  const f = await fixture();
  try {
    await f.db.exec("create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('notification_vapid_public_key','synthetic-public'),('notification_vapid_private_key','synthetic-private'),('notification_cron_secret','synthetic-cron')");
    await f.db.exec('set role authenticated');
    const config = (await f.query('select public.notification_push_config() config'))[0].config;
    assert.deepEqual(config, { public_key: 'synthetic-public', configured: true, app_origin: 'https://app.fuzedflow.com' });
    assert.ok(!JSON.stringify(config).includes('synthetic-private') && !JSON.stringify(config).includes('synthetic-cron'));
    await f.db.exec('reset role');
  } finally { await f.db.close(); }
});

test('SQL explicitly requested workflow email dedupes retry, permits a renewed token and revokes stale requests before delivery', async () => {
  const f = await fixture();
  try {
    await f.db.exec("create schema workflow_private;create table workflow_private.synthetic_allowed(url text primary key);create function workflow_private.notification_request_mail_allowed(uuid,text,text) returns boolean language sql as 'select exists(select 1 from workflow_private.synthetic_allowed where url=$3)';");
    const oldUrl = 'https://app.fuzedflow.com/DocumentResponse?token=synthetic-old';
    const newUrl = 'https://app.fuzedflow.com/DocumentResponse?token=synthetic-renewed';
    await f.db.query('insert into workflow_private.synthetic_allowed values($1),($2)', [oldUrl, newUrl]);
    const enqueue = async url => (await f.query('select notification_private.enqueue_transactional_email($1,$2,$3,$4,$5,$6,$7) id', [COMPANY, id(300), 'document_request', 'customer@synthetic.example', 'Document review request', 'Synthetic staff requested a review.', url]))[0].id;
    const first = await enqueue(oldUrl); assert.equal(await enqueue(oldUrl), first);
    const renewed = await enqueue(newUrl); assert.notEqual(renewed, first);
    await f.db.exec('set role authenticated');
    await assert.rejects(enqueue(newUrl), /permission denied/);
    await f.db.exec('reset role');
    await f.db.query('delete from workflow_private.synthetic_allowed where url=$1', [oldUrl]);
    const jobs = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].id, renewed); assert.equal(jobs[0].recipient, 'customer@synthetic.example');
    assert.equal((await f.query('select state from notification_private.delivery_outbox where id=$1', [first]))[0].state, 'cancelled');
    await f.db.query('delete from workflow_private.synthetic_allowed where url=$1', [newUrl]);
    await assert.rejects(f.query('select public.capture_notification_delivery($1,$2,$3::jsonb)', [renewed, jobs[0].lease_token, JSON.stringify({ to: jobs[0].recipient })]), /access or preferences changed/);
  } finally { await f.db.close(); }
});

test('SQL stale SMS lease becomes unconfirmed instead of sending a duplicate after a worker crash', async () => {
  const f = await fixture();
  try {
    await f.save({ sms: true, sms_phone: '+17805551234' }); await f.alert(310);
    const job = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs[0];
    await f.query('select public.capture_notification_delivery($1,$2,$3::jsonb)', [job.id, job.lease_token, JSON.stringify({ to: job.recipient, body: 'Synthetic SMS' })]);
    await f.db.query("update notification_private.delivery_outbox set leased_at=now()-interval '10 minutes' where id=$1", [job.id]);
    assert.equal((await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs.length, 0);
    assert.equal((await f.query('select state from notification_private.delivery_outbox where id=$1', [job.id]))[0].state, 'unconfirmed');
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 1);
  } finally { await f.db.close(); }
});

test('SQL personal provider callbacks are service-only, idempotent and keep terminal failures after out-of-order delivery events', async () => {
  const f = await fixture();
  try {
    await f.save({ email: true }); await f.alert(320);
    const job = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs[0];
    await f.query("select public.finish_notification_delivery($1,$2,'sent',null,$3)", [job.id, job.lease_token, 'synthetic-resend-accepted']);
    const callback = async (providerId, eventId, status) => (await f.query("select public.record_personal_notification_delivery_callback('resend',$1,$2,$3) found", [providerId, eventId, status]))[0].found;
    assert.equal(await callback('unknown-provider-id', 'unknown-event', 'delivered'), false);
    assert.equal(await callback('synthetic-resend-accepted', 'invalid-event', null), false);
    await f.db.exec('set role authenticated');
    await assert.rejects(callback('synthetic-resend-accepted', 'browser-event', 'delivered'), /permission denied/);
    await assert.rejects(f.query('select * from notification_private.delivery_receipts'), /permission denied/);
    await f.db.exec('reset role');
    assert.equal(await callback('synthetic-resend-accepted', 'delivered-event', 'delivered'), true);
    assert.equal((await f.query('select state,provider_status from notification_private.delivery_outbox where id=$1', [job.id]))[0].state, 'delivered');
    assert.equal(await callback('synthetic-resend-accepted', 'bounce-event', 'bounced'), true);
    assert.equal(await callback('synthetic-resend-accepted', 'bounce-event', 'bounced'), true);
    assert.equal(await callback('synthetic-resend-accepted', 'late-delivery-event', 'delivered'), true);
    assert.deepEqual((await f.query('select state,provider_status from notification_private.delivery_outbox where id=$1', [job.id]))[0], { state: 'failed', provider_status: 'bounced' });
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_receipts'))[0].n, 3);
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 1);
  } finally { await f.db.close(); }
});

test('SQL delivery failures stay private to the current user without original content or recursive email/SMS/push/digest jobs', async () => {
  const f = await fixture();
  try {
    await f.save({ email: true, sms: true, sms_phone: '+17805551234', push: true, digest_frequency: 'daily', digest_hour: 0 });
    await f.query('select public.register_notification_push($1::jsonb)', [JSON.stringify({ endpoint: 'https://fcm.googleapis.com/send/synthetic-failure-device', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } })]);
    await f.alert(330);
    await f.db.query("update notifications set title='PRIVATE PROJECT TITLE',body='PRIVATE PROJECT DETAILS' where id=$1", [id(330)]);
    const jobs = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs;
    const job = jobs.find(item => item.job_kind === 'digest'); assert.ok(job);
    await f.query("select public.finish_notification_delivery($1,$2,'sent',null,$3)", [job.id, job.lease_token, 'synthetic-digest-provider']);
    await f.db.query("update profiles set role='employee' where id=$1", [USER]);
    const queuedBefore = (await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n;
    const digestBefore = (await f.query('select count(*)::int n from notification_private.digest_items'))[0].n;
    assert.equal((await f.query("select public.record_personal_notification_delivery_callback('resend','synthetic-digest-provider','synthetic-digest-bounced','bounced') ok"))[0].ok, true);
    const notices = await f.query("select * from notifications where event_key='personal_notification_delivery_failed'");
    assert.equal(notices.length, 1); assert.equal(notices[0].user_id, USER); assert.equal(notices[0].related_type, 'NotificationDelivery');
    assert.ok(notices[0].body.includes('Check your notification settings'));
    assert.ok(!JSON.stringify(notices).includes('PRIVATE PROJECT'));
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, queuedBefore);
    assert.equal((await f.query('select count(*)::int n from notification_private.digest_items'))[0].n, digestBefore);
    await f.db.query("insert into notifications(company_id,user_id,event_key,dedupe_key,title,body,category,severity) values($1,$2,'company_notification_failed','synthetic-company-failure','Company delivery failed','Generic failure','Support','Action Required')", [COMPANY, USER]);
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, queuedBefore);
    assert.equal((await f.query('select count(*)::int n from notification_private.digest_items'))[0].n, digestBefore);
    await f.db.exec('set role authenticated');
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 1, 'Generic personal notice remains visible after losing project access.');
    await f.db.exec('reset role');
    await f.db.query("select set_config('request.jwt.claim.sub',$1,false)", [FOREIGN]);
    await f.db.exec('set role authenticated');
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 0);
    await f.db.exec('reset role');
  } finally { await f.db.close(); }
});

test('SQL final immediate failures and unconfirmed outcomes emit one private notice while retries emit none', async () => {
  const f = await fixture();
  try {
    await f.save({ email: true }); await f.alert(340); await f.alert(341); await f.alert(342);
    const jobs = (await f.query('select notification_private.claim_deliveries(10) jobs'))[0].jobs;
    await f.query("select public.finish_notification_delivery($1,$2,'pending','Synthetic retry')", [jobs[0].id, jobs[0].lease_token]);
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 0);
    await f.query("select public.finish_notification_delivery($1,$2,'failed','Synthetic terminal failure')", [jobs[1].id, jobs[1].lease_token]);
    await f.query("select public.finish_notification_delivery($1,$2,'unconfirmed','Synthetic uncertain outcome')", [jobs[2].id, jobs[2].lease_token]);
    assert.equal((await f.query("select count(*)::int n from notifications where event_key='personal_notification_delivery_failed'"))[0].n, 2);
    assert.equal((await f.query('select count(*)::int n from notification_private.delivery_outbox'))[0].n, 3);
  } finally { await f.db.close(); }
});

test('quiet hours cross midnight and daylight saving boundaries without suppressing in-app history', () => {
  const prefs = { quiet_enabled: true, quiet_start: '22:00:00', quiet_end: '08:00:00', timezone: 'America/Edmonton' };
  assert.equal(quietUntil(prefs, new Date('2026-10-04T05:00:00Z')).toISOString(), '2026-10-04T14:00:00.000Z');
  assert.equal(quietUntil(prefs, new Date('2026-11-01T05:00:00Z')).toISOString(), '2026-11-01T15:00:00.000Z');
  assert.equal(quietUntil(prefs, new Date('2026-10-04T18:00:00Z')), null);
  assert.equal(quietUntil({ ...prefs, quiet_enabled: false }, new Date('2026-10-04T05:00:00Z')), null);
});

test('retry policy avoids duplicate ambiguous SMS, retries safe throttles and expires gone push subscriptions', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  assert.equal(retryOutcome('sms', new Error('Network uncertainty'), 1, now).state, 'unconfirmed');
  assert.equal(retryOutcome('sms', { status: 503 }, 1, now).state, 'unconfirmed');
  assert.equal(retryOutcome('sms', { status: 429 }, 1, now).state, 'pending');
  assert.equal(retryOutcome('push', { status: 410 }, 1, now).state, 'expired_push');
  assert.equal(retryOutcome('email', { status: 503 }, 1, now).state, 'pending');
  assert.equal(retryOutcome('email', { status: 400 }, 1, now).state, 'failed');
  assert.equal(retryOutcome('email', { status: 503 }, 8, now).state, 'failed');
});

test('email/push/SMS formatting keeps actor/date body and safe links, escaping HTML in digest/customer request content', () => {
  const job = { id: id(200), channel: 'email', recipient: 'synthetic@example.test', job_kind: 'alert', payload: { title: '<script>Update</script>', body: 'Sam changed Project Alpha\nOct 4, 2026 at 9:15 AM MDT', url: 'https://evil.example/' } };
  const payload = buildProviderPayload(job);
  assert.ok(payload.html.includes('&lt;script&gt;'));
  assert.ok(!payload.html.includes('href="https://evil.example'));
  assert.ok(payload.html.includes('Sam changed Project Alpha<br>Oct 4, 2026 at 9:15 AM MDT'));
  assert.equal(safeAppUrl('//evil.example'), 'https://app.fuzedflow.com/');
  const push = buildProviderPayload({ ...job, channel: 'push' });
  assert.equal(push.id, id(200)); assert.ok(push.body.includes('Sam changed'));
  const digest = buildProviderPayload({ ...job, job_kind: 'digest', payload: { frequency: 'weekly' }, digest_items: [job.payload] });
  assert.equal(digest.subject, 'Your weekly Fuzed Flow summary'); assert.ok(digest.html.includes('Sam changed'));
});

function fakeDelivery(jobs) {
  const captured = new Map(), outcomes = [];
  return { captured, outcomes, db: { rpc: async (name, args) => {
    if (name === 'claim_notification_deliveries') return { data: jobs, error: null };
    if (name === 'capture_notification_delivery') { if (!captured.has(args.p_id)) captured.set(args.p_id, structuredClone(args.p_payload)); return { data: captured.get(args.p_id), error: null }; }
    if (name === 'finish_notification_delivery') { outcomes.push(args); return { data: true, error: null }; }
    throw new Error('Unexpected fake RPC ' + name);
  } } };
}

test('dispatch uses exact captured provider bytes across retry, defers quiet hours and never makes real provider calls', async () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const job = { id: id(200), lease_token: id(201), attempts: 1, channel: 'email', recipient: 'synthetic@example.test', job_kind: 'alert', payload: { title: 'Synthetic update', body: 'Exact original body', url: '/AdminSettings' }, preferences: {} };
  const f = fakeDelivery([job]); let calls = 0; const sent = [];
  const providers = { email: async payload => { sent.push(structuredClone(payload)); if (++calls === 1) throw new Error('Uncertain transport'); return { id: 'synthetic-provider' }; } };
  await runDeliveryBatch(f.db, providers, now); assert.equal(f.outcomes[0].p_state, 'pending');
  job.payload.body = 'Changed after first attempt'; job.attempts = 2;
  await runDeliveryBatch(f.db, providers, now); assert.deepEqual(sent[1], sent[0]); assert.equal(f.outcomes[1].p_state, 'sent');
  job.preferences = { quiet_enabled: true, quiet_start: '11:00', quiet_end: '13:00', timezone: 'UTC' };
  await runDeliveryBatch(f.db, providers, now); assert.equal(calls, 2); assert.equal(f.outcomes[2].p_state, 'deferred');
  job.preferences = {}; job.first_attempt_at = '2026-10-03T11:00:00Z';
  await runDeliveryBatch(f.db, providers, now); assert.equal(calls, 2); assert.equal(f.outcomes[3].p_state, 'failed');
});
