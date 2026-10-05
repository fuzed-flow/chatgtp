import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { notificationLink } from '../../src/lib/notificationLinks.js';

const migrations = [
  '20261003220500_role_based_notifications.sql',
  '20261004031303_lead_created_notifications.sql',
  '20261004173051_warranty_document_workflows.sql',
  '20261004173132_subscriber_costs_assets_notifications.sql',
  '20261004173154_notification_personal_delivery.sql',
  '20261004173313_sales_finance_client_notifications.sql',
  '20261004174541_people_pm_task_workflows.sql',
  '20261004180605_subscriber_notification_final_integration.sql',
  '20261004180824_notification_provider_configuration.sql',
];
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('combined workflows preserve trusted actors, dates, tenant privacy and explicit support requests', async () => {
  const db = new PGlite();
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const actor = async (uid, role = 'authenticated') => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid || '', role]);
  };
  try {
    await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('./implementation-schema.sql', import.meta.url), 'utf8'));
    for (const migration of migrations) {
      try { await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')); }
      catch (error) { throw new Error(`${migration}: ${error.message}`, { cause: error }); }
    }
    const company = id(1), other = id(2), admin = id(10), office = id(11), employee = id(12), outsider = id(13), project = id(20), lead = id(30);
    await db.query("insert into companies(id,name,timezone) values($1,'Synthetic company','America/Edmonton'),($2,'Other company','Pacific/Auckland')", [company, other]);
    for (const [uid, co, role, name] of [[admin, company, 'admin', 'Gary Byrne'], [office, company, 'office', 'Office User'], [employee, company, 'employee', 'Field User'], [outsider, other, 'owner', 'Foreign Actor']]) {
      await db.query('insert into profiles(id,company_id,role,full_name,is_active,email) values($1,$2,$3,$4,true,$5)', [uid, co, role, name, `${role}@example.invalid`]);
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [uid, `${role}@example.invalid`]);
    }
    await actor(admin);
    await db.query("insert into projects(id,company_id,name,status) values($1,$2,'Synthetic build','Active')", [project, company]);
    await db.query('insert into project_staff(company_id,project_id,user_id,is_active) values($1,$2,$3,true)', [company, project, employee]);
    await db.query("insert into leads(id,company_id,contact_name,pipeline_stage) values($1,$2,'Tim Rich','New')", [lead, company]);
    const alerts = await rows("select * from notifications where event_key='lead_created' and related_id=$1", [lead]);
    assert.ok(alerts.length >= 2);
    for (const alert of alerts) {
      assert.match(alert.body, /^Gary Byrne created lead Tim Rich on [A-Za-z]+ \d{1,2}, \d{4}\./);
      assert.equal(alert.metadata.actor_id, admin);
      assert.equal(alert.metadata.actor_name, 'Gary Byrne');
      assert.equal(alert.metadata.entity_name, 'Tim Rich');
      assert.equal(alert.metadata.event_timezone, 'America/Edmonton');
      const date = new Intl.DateTimeFormat('en-US', { timeZone: alert.metadata.event_timezone, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(alert.metadata.event_at));
      assert.ok(alert.body.includes(`on ${date}.`));
      assert.equal(notificationLink(alert, 'office'), `/LeadDetail?id=${lead}`);
      assert.notEqual(alert.user_id, outsider);
    }
    assert.equal((await rows('select count(*)::int n from notification_private.delivery_outbox'))[0].n, 0, 'new delivery is opt-in');
    await actor(null, 'service_role');
    const display = (await rows('select notification_private.presentation($1,$2,$3,$4,null,$5,$6) data', [company, 'lead_assigned', 'Lead', lead, 'Assigned for follow-up.', outsider]))[0].data;
    assert.equal(display.actor_name, 'Fuzed Flow', 'a foreign-tenant actor is never attributed');
    assert.equal(display.actor_id, null);
    await actor(employee);
    await db.exec('set role authenticated');
    const ticket = (await rows('select submit_support_ticket($1,$2,null) id', ['Synthetic request', 'How do I locate my assigned task?']))[0].id;
    assert.equal((await rows('select count(*)::int n from support_tickets'))[0].n, 1);
    assert.equal((await rows('select count(*)::int n from support_ticket_messages where ticket_id=$1', [ticket]))[0].n, 1);
    await assert.rejects(db.query('select reply_support_ticket($1,$2,false)', [ticket, 'Spoofed support reply']), /permission denied/);
    await assert.rejects(db.query("select publish_platform_announcement('Spoofed update','Body')"), /permission denied/);
    await assert.rejects(db.query('select notification_provider_server_config()'), /permission denied/);
    await assert.rejects(db.query('select notification_delivery_server_config()'), /permission denied/);
    await db.exec('reset role');
    const jobs = await rows("select * from notification_private.delivery_outbox where payload->>'event_key'='support_request'");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].payload.to, 'support@fuzedflow.com');
    assert.equal(jobs[0].payload.url, `https://app.fuzedflow.com/Contact?ticket=${ticket}`);
    await actor(outsider);
    await db.exec('set role authenticated');
    assert.equal((await rows('select count(*)::int n from support_tickets'))[0].n, 0);
    assert.equal((await rows('select count(*)::int n from support_ticket_messages'))[0].n, 0);
    await assert.rejects(db.query('select submit_support_ticket($1,$2,$3)', ['Other subject', 'Foreign-tenant reply', ticket]), /unavailable/);
    await db.exec('reset role');
    await actor(null, 'service_role');
    await db.query('select reply_support_ticket($1,$2,false)', [ticket, 'Open your Employee Portal and select Tasks.']);
    const replies = await rows("select * from notifications where event_key='support_ticket_reply' and related_id=$1", [ticket]);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].user_id, employee);
    assert.equal(notificationLink(replies[0], 'employee'), `/Contact?ticket=${ticket}`);
    await db.query("select publish_platform_announcement('Synthetic feature','Open the updated guides.','help_updated','/HelpArticles')");
    const announcements = await rows("select * from notifications where event_key='help_updated'");
    assert.equal(announcements.length, 4, 'service announcements reach active subscribers across tenants with no company data');
    assert.ok(announcements.every(alert => notificationLink(alert, alert.user_id === employee ? 'employee' : 'admin') === '/HelpArticles'));
    await db.query("update companies set subscription_status='Past Due' where id=$1", [company]);
    assert.ok((await rows("select count(*)::int n from notifications where event_key='subscription_payment_failed'"))[0].n > 0, 'saved Stripe Past Due status triggers billing failure alerts');
    await db.exec("select notification_private.reminders('2026-10-06T16:00:00Z')");
    const first = (await rows('select count(*)::int n from notifications'))[0].n;
    await db.exec("select notification_private.reminders('2026-10-06T17:00:00Z')");
    assert.equal((await rows('select count(*)::int n from notifications'))[0].n, first, 'all reminder families dedupe across repeated cron ticks');
  } finally { await db.close(); }
});
