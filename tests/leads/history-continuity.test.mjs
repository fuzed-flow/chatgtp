import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const integration = await read('tests/notifications/implementation.test.mjs');
const migrations = [...integration.match(/const migrations = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map(m => m[1]);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company=id(1), other=id(2), admin=id(10), outsider=id(11), existing=id(20);

test('lead conversion preserves client history, pre-conversion reply routes and tenant boundaries', async t => {
  const db = new PGlite();
  const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const one = async (sql,args=[]) => (await rows(sql,args))[0];
  const actor = async (uid='',role='service_role') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,role]);
  };
  const lead = async (n,client=null,co=company) => {
    await db.query("insert into leads(id,company_id,contact_name,contact_email,contact_phone,pipeline_stage,client_id,description,notes,photos,documents) values($1,$2,$3,$4,$5,'New',$6,'Scope','Saved notes','[\"https://example.invalid/photo.webp\"]','[{\"url\":\"https://example.invalid/document.pdf\",\"name\":\"Plan.pdf\"}]')",[id(n),co,'Lead '+n,`lead${n}@example.invalid`,`+1780555${String(n).padStart(4,'0')}`,client]);
    return id(n);
  };
  const seed = async (leadId,n,co=company) => {
    const inbound=id(n), reminder=id(n+1), task=id(n+2), reply=id(n+3);
    await db.query("insert into client_communications(id,company_id,lead_id,type,direction,subject,message,status,provider,provider_message_id,response_due_at,answered_at,answered_delivery_id) values($1,$2,$3,'SMS','Inbound','Question','Keep this message','Received','twilio',$4,'2030-11-02T14:00Z','2026-10-02T14:00Z','twilio:old-reply')",[inbound,co,leadId,'incoming-'+n]);
    await db.query("insert into client_reminders(id,company_id,lead_id,title,due_date,status,priority,assigned_to) values($1,$2,$3,'Call back','2030-11-02','Pending','High',$4)",[reminder,co,leadId,co===company?admin:outsider]);
    await db.query("insert into tasks(id,company_id,lead_id,title,due_date,assigned_to,status,priority,task_type,estimated_hours) values($1,$2,$3,'Site visit','2030-11-02T17:30Z',$4,'Doing','High','Task',2.5)",[task,co,leadId,co===company?admin:outsider]);
    await db.query("insert into notification_private.outbound_deliveries(provider,provider_id,company_id,related_type,related_id,lead_id,kind,recipient,sender,reply_id,status) select 'twilio',$1,company_id,'Lead',id,id,'communication',contact_phone,'+17805559999',$2,'delivered' from leads where id=$3",['outgoing-'+n,inbound,leadId]);
    const route=(await one('select create_reply_route($1,null,$2) token',[co,leadId])).token;
    await db.query("insert into client_communications(id,company_id,lead_id,type,direction,subject,message,status,provider,provider_message_id) values($1,$2,$3,'SMS','Outbound','Reply','Already replied','Delivered','twilio',$4)",[reply,co,leadId,'outgoing-'+n]);
    return {inbound,reminder,task,reply,route,n};
  };
  const assertMoved = async (ids,client) => {
    for (const [table,key] of [['client_communications','inbound'],['client_communications','reply'],['client_reminders','reminder'],['tasks','task']]) {
      assert.deepEqual(await one(`select client_id,lead_id from ${table} where id=$1`,[ids[key]]),{client_id:client,lead_id:null});
    }
    assert.deepEqual(await one('select client_id,lead_id from notification_private.reply_routes where token=$1',[ids.route]),{client_id:client,lead_id:null});
    assert.deepEqual(await one('select client_id,lead_id,status,reply_id from notification_private.outbound_deliveries where provider_id=$1',['outgoing-'+ids.n]),{client_id:client,lead_id:null,status:'delivered',reply_id:ids.inbound});
    assert.deepEqual(await one('select status,priority,assigned_to,estimated_hours,due_date from tasks where id=$1',[ids.task]),{status:'Doing',priority:'High',assigned_to:admin,estimated_hours:'2.50',due_date:new Date('2030-11-02T17:30Z')});
    const saved=await one('select answered_at,answered_delivery_id,response_due_at,message from client_communications where id=$1',[ids.inbound]);
    assert.equal(saved.answered_at.toISOString(),'2026-10-02T14:00:00.000Z');
    assert.equal(saved.answered_delivery_id,'twilio:old-reply');
    assert.equal(saved.message,'Keep this message');
    assert.equal(saved.response_due_at.toISOString(),'2030-11-02T14:00:00.000Z');
  };
  try {
    await db.exec(await read('tests/notifications/schema.sql'));
    await db.exec(await read('tests/notifications/implementation-schema.sql'));
    for (const migration of migrations) await db.exec(await read('supabase/migrations/'+migration));
    await db.exec('alter table payments add column if not exists quote_id uuid');
    await db.exec(await read('supabase/migrations/20261005183000_sales_performance_foundation.sql'));
    await db.exec(await read('supabase/migrations/20261005224734_sales_performance_creator_attribution.sql'));
    await db.exec((await read('supabase/migrations/20261006160202_employee_portal_authorization_guardrails.sql')).split('-- Expenses:')[0]);
    // The unrelated invoice core is a fixture; both actual conversion RPCs are installed unchanged.
    await db.exec("create function convert_quote_to_invoice(uuid,uuid,jsonb,numeric,numeric,numeric) returns jsonb language sql as $$select '{}'::jsonb$$");
    await db.exec(await read('supabase/migrations/20261014195500_automatic_lead_client_quote_conversion.sql'));
    await db.query("insert into companies(id,name,timezone) values($1,'Test company','America/Edmonton'),($2,'Other company','UTC')",[company,other]);
    for (const [uid,co] of [[admin,company],[outsider,other]]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,uid+'@example.invalid']);
      await db.query("insert into profiles(id,company_id,full_name,role,is_active) values($1,$2,'Test admin','admin',true)",[uid,co]);
    }
    await db.query("insert into clients(id,company_id,name,email,phone) values($1,$2,'Existing client','saved@example.invalid',null)",[existing,company]);
    const historical=await lead(30,existing), old=await seed(historical,100);
    const fresh=await lead(31), pending=await seed(fresh,110);
    await actor(admin,'authenticated');
    await t.test('migration repairs already-converted leads without overwriting saved contact values',async()=>{
      await db.exec(await read('supabase/migrations/20261102145045_lead_client_history_continuity.sql'));
      await assertMoved(old,existing);
      assert.deepEqual(await one('select email,phone from clients where id=$1',[existing]),{email:'saved@example.invalid',phone:'+17805550030'});
      assert.equal((await one('select lead_id from tasks where id=$1',[pending.task])).lead_id,fresh);
    });
    let client;
    await t.test('manual conversion moves full history while retaining existing notes, photos, quotes and source lead',async()=>{
      await db.query("insert into notes(company_id,related_type,related_id,content,category,author_name,is_pinned,mention_user_ids) values($1,'Lead',$2,'Pinned note','General','Admin',true,$3)",[company,fresh,[admin]]);
      await db.query("insert into quotes(id,company_id,lead_id,title,status) values($1,$2,$3,'Linked quote','Draft')",[id(40),company,fresh]);
      const result=(await one('select convert_lead_to_client($1) result',[fresh])).result;
      client=result.client_id;
      assert.equal(result.created,true);await assertMoved(pending,client);
      assert.deepEqual(await one('select client_id,lead_id from quotes where id=$1',[id(40)]),{client_id:client,lead_id:null});
      assert.equal((await one('select pipeline_stage from leads where id=$1',[fresh])).pipeline_stage,'Won');
      assert.equal((await one("select count(*)::int n from attachments where related_type='Client' and related_id=$1",[client])).n,2);
      assert.deepEqual(await one("select is_pinned,mention_user_ids from notes where related_type='Client' and related_id=$1",[client]),{is_pinned:true,mention_user_ids:[admin]});
      assert.equal((await one('select notes from clients where id=$1',[client])).notes,'Scope\n\nSaved notes');
    });
    await t.test('repeat conversion is idempotent and does not duplicate history or notifications',async()=>{
      const counts=await one('select (select count(*) from client_communications) communications,(select count(*) from tasks) tasks,(select count(*) from notifications) notifications,(select count(*) from attachments) attachments');
      const result=(await one('select convert_lead_to_client($1) result',[fresh])).result;
      assert.equal(result.client_id,client);assert.equal(result.created,false);
      assert.deepEqual(await one('select (select count(*) from client_communications) communications,(select count(*) from tasks) tasks,(select count(*) from notifications) notifications,(select count(*) from attachments) attachments'),counts);
    });
    await t.test('old SMS and email replies and delivery callbacks now reach the client',async()=>{
      await actor();
      assert.equal((await one("select record_inbound_sms('after-conversion-sms','+17805550031','+17805559999','New SMS reply') ok")).ok,true);
      assert.equal((await one("select client_id from client_communications where provider_message_id='after-conversion-sms'")).client_id,client);
      assert.equal((await one("select record_inbound_reply('resend','after-conversion-email',$1,'lead31@example.invalid','Re: Earlier message','New email reply') ok",[pending.route])).ok,true);
      assert.equal((await one("select client_id from client_communications where provider_message_id='after-conversion-email'")).client_id,client);
      assert.equal((await one("select record_delivery_callback('twilio','outgoing-110','new-callback','delivered') ok")).ok,true);
      assert.equal((await one('select answered_delivery_id from client_communications where id=$1',[pending.inbound])).answered_delivery_id,'twilio:old-reply');
      assert.equal((await one("select record_inbound_reply('resend','bad-sender',$1,'stranger@example.invalid','No','No') ok",[pending.route])).ok,false);
    });
    await t.test('late provider registrations, reply links and stale lead-page inserts follow conversion',async()=>{
      await actor();
      assert.equal((await one('select create_reply_route($1,null,$2) token',[company,fresh])).token,pending.route);
      await db.query("select register_outbound_delivery('twilio','late-registration',$1,'Lead',$2,null,$2,$3,'communication',false,'+17805550031','+17805559999',$4)",[company,fresh,admin,pending.inbound]);
      assert.deepEqual(await one("select client_id,lead_id,reply_id from notification_private.outbound_deliveries where provider_id='late-registration'"),{client_id:client,lead_id:null,reply_id:pending.inbound});
      const late=await seed(fresh,130);await assertMoved(late,client);
    });
    await t.test('quote conversion uses the same transfer and safely matches an existing client',async()=>{
      await actor(admin,'authenticated');
      const l=await lead(32), history=await seed(l,140);
      await db.query("insert into clients(id,company_id,name,email,phone,notes) values($1,$2,'Matched client','lead32@example.invalid','+17805550032','Keep my notes')",[id(22),company]);
      await db.query("insert into quotes(id,company_id,lead_id,title,status) values($1,$2,$3,'Quote conversion','Draft')",[id(41),company,l]);
      const result=(await one('select ensure_quote_client($1) result',[id(41)])).result;
      assert.equal(result.client_id,id(22));assert.equal(result.created,false);await assertMoved(history,id(22));
      assert.equal((await one('select notes from clients where id=$1',[id(22)])).notes,'Keep my notes');
    });
    await t.test('foreign users, malformed links and private helper access cannot move another company history',async()=>{
      await actor(outsider,'authenticated');await db.exec('set role authenticated');
      await assert.rejects(db.query('select convert_lead_to_client($1)',[fresh]),/do not have access/);
      await assert.rejects(db.query('select sales_private.transfer_lead_client_history($1)',[fresh]),/permission denied/);
      await assert.rejects(db.query("select register_outbound_delivery('twilio','spoof',$1,'Lead',$2)",[company,fresh]),/permission denied/);
      assert.equal((await rows('select id from client_communications where client_id=$1',[client])).length,0);
      await actor();
      const foreignTask=id(155);
      await db.query("insert into tasks(id,company_id,lead_id,title) values($1,$2,$3,'Wrong company')",[foreignTask,other,fresh]);
      await db.query('select sales_private.transfer_lead_client_history($1)',[fresh]);
      assert.deepEqual(await one('select company_id,lead_id,client_id from tasks where id=$1',[foreignTask]),{company_id:other,lead_id:fresh,client_id:null});
      await assert.rejects(db.query("insert into client_communications(company_id,lead_id,client_id,type) values($1,$2,$3,'SMS')",[company,fresh,existing]),/outside this conversation/);
      await assert.rejects(db.query('select create_reply_route($1,null,$2)',[other,fresh]),/outside company/);
    });
  } finally { await db.close(); }
});
