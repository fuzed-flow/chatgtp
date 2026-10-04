import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../../',import.meta.url);
const integration=await readFile(new URL('tests/notifications/implementation.test.mjs',root),'utf8');
const migrationBlock=integration.match(/const migrations = \[([\s\S]*?)\];/);
assert.ok(migrationBlock,'Use the same complete migration list as the integration suite.');
const migrations=[...migrationBlock[1].matchAll(/'([^']+\.sql)'/g)].map(match=>match[1]);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('sales domain workflows against the full synthetic integration schema',async t=>{
  const db=new PGlite();
  const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const one=async(sql,args=[]) => (await rows(sql,args))[0];
  const actor=async(uid=null,role='service_role') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid || '',role]);
  };
  const company=id(1),other=id(2),admin=id(10),office=id(11),employee=id(12),outsider=id(13),client=id(20),otherClient=id(21),project=id(30);
  let sequence=100;
  const next=()=>id(sequence++);
  const eventCount=async(event,document) => Number((await one('select count(*) n from notifications where event_key=$1 and related_id=$2',[event,document])).n);
  const quote=async(status='Draft',co=company) => {
    const uuid=next();
    await db.query('insert into quotes(id,company_id,client_id,title,quote_number,status,total,is_template) values($1,$2,$3,$4,$5,$6,1000,false)',[uuid,co,co===company?client:otherClient,'Synthetic quote','QT-'+sequence,status]);
    return uuid;
  };
  const invoice=async(total=1000,co=company) => {
    const uuid=next();
    await db.query("insert into invoices(id,company_id,client_id,invoice_number,status,total,amount_paid,balance_due) values($1,$2,$3,$4,'Sent',$5,0,$5)",[uuid,co,co===company?client:otherClient,'INV-'+sequence,total]);
    return uuid;
  };
  const inbound=async(co=company,party=client) => {
    const uuid=next();
    await db.query("insert into client_communications(id,company_id,client_id,type,subject,message,direction,status,response_due_at) values($1,$2,$3,'Email','Synthetic incoming','A saved client question','Inbound','Received',now()-interval '2 days')",[uuid,co,party]);
    return uuid;
  };
  const register=async({provider='resend',providerId,related='Message',document=client,party=client,co=company,kind='communication',copy=false,reply=null,sender='alerts@example.invalid',recipient='client@example.invalid',user=admin}) => {
    await db.query('select register_outbound_delivery($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11,$12)',[provider,providerId,co,related,document,party,user,kind,copy,recipient,sender,reply]);
  };
  const callback=async(provider,providerId,event,status) => (await one('select record_delivery_callback($1,$2,$3,$4) result',[provider,providerId,event,status])).result;
  const payment=async(document,session,amount,{co=company,type='invoice',account='acct_synthetic',intent='pi_'+session}={}) =>
    (await one('select record_stripe_payment($1,$2,$3,$4,$5,$6,$7,$8) result',[co,type,document,account,session,intent,amount,'2026-10-04T15:00:00Z'])).result;
  const scenario=async(name,run) => t.test(name,async()=>{await actor();await run();});
  try {
    await db.exec(await readFile(new URL('tests/notifications/schema.sql',root),'utf8'));
    await db.exec(await readFile(new URL('tests/notifications/implementation-schema.sql',root),'utf8'));
    for(const migration of migrations) await db.exec(await readFile(new URL('supabase/migrations/'+migration,root),'utf8'));
    await db.query("insert into companies(id,name,timezone,stripe_account_id) values($1,'Synthetic sales','America/Edmonton','acct_synthetic'),($2,'Other sales','Pacific/Auckland','acct_other')",[company,other]);
    for(const [uuid,co,role,name] of [[admin,company,'admin','Synthetic Admin'],[office,company,'office','Synthetic Office'],[employee,company,'employee','Synthetic Employee'],[outsider,other,'owner','Other Owner']]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uuid,role+'@example.invalid']);
      await db.query('insert into profiles(id,company_id,role,full_name,email,is_active) values($1,$2,$3,$4,$5,true)',[uuid,co,role,name,role+'@example.invalid']);
    }
    await db.query("insert into clients(id,company_id,name,email,phone) values($1,$2,'Saved Client','client@example.invalid','(780) 555-1234'),($3,$4,'Other Client','other@example.invalid','+6495551234')",[client,company,otherClient,other]);
    await db.query("insert into projects(id,company_id,client_id,name,status) values($1,$2,$3,'Synthetic project','Active')",[project,company,client]);

    await scenario('lead assignment, stage and conversion emit from saved changes only',async()=>{
      await actor(admin,'authenticated');
      const lead=next();
      await db.query("insert into leads(id,company_id,contact_name,pipeline_stage,assigned_to) values($1,$2,'Synthetic lead','New',$3)",[lead,company,office]);
      assert.ok(await eventCount('lead_assigned',lead)>0);
      const assigned=await eventCount('lead_assigned',lead);
      await db.query('update leads set assigned_to=$1 where id=$2',[office,lead]);
      assert.equal(await eventCount('lead_assigned',lead),assigned);
      await db.query('update leads set assigned_to=$1 where id=$2',[admin,lead]);
      assert.ok(await eventCount('lead_reassigned',lead)>0);
      await db.query("update leads set pipeline_stage='Won',client_id=$1 where id=$2",[client,lead]);
      assert.ok(await eventCount('lead_won',lead)>0);assert.ok(await eventCount('lead_converted',lead)>0);
      await db.query("update leads set pipeline_stage='Lost' where id=$1",[lead]);
      assert.ok(await eventCount('lead_lost',lead)>0);
      assert.equal(Number((await one('select count(*) n from notifications where related_id=$1 and company_id!=$2',[lead,company])).n),0);
    });

    await scenario('sales reminders use each company local date and dedupe repeated cron ticks',async()=>{
      const localLead=next(),nzLead=next(),q=await quote('Sent'),co=next();
      await db.query("insert into leads(id,company_id,contact_name,pipeline_stage,next_follow_up_date) values($1,$2,'Local lead','New','2030-10-05'),($3,$4,'NZ lead','New','2030-10-05')",[localLead,company,nzLead,other]);
      await db.query("update quotes set next_follow_up_date='2030-10-04',expiry_date='2030-10-06' where id=$1",[q]);
      await db.query("insert into change_orders(id,company_id,project_id,title,status,next_follow_up_date,approval_due_date) values($1,$2,$3,'Synthetic scope','Sent','2030-10-04','2030-10-03')",[co,company,project]);
      await db.query("select notification_private.sales_reminders('2030-10-05T00:30:00Z')");
      assert.ok(await eventCount('lead_followup_upcoming',localLead)>0);assert.equal(await eventCount('lead_followup_due',localLead),0);
      assert.ok(await eventCount('lead_followup_due',nzLead)>0);
      for(const event of ['quote_followup_due','quote_expiring']) assert.ok(await eventCount(event,q)>0,event);
      for(const event of ['co_followup_due','co_approval_overdue']) assert.ok(await eventCount(event,co)>0,event);
      const before=Number((await one('select count(*) n from notifications')).n);
      await db.query("select notification_private.sales_reminders('2030-10-05T01:30:00Z')");
      assert.equal(Number((await one('select count(*) n from notifications')).n),before);
    });

    await scenario('terminal documents and quote templates do not produce sales reminder alerts',async()=>{
      for(const status of ['Draft','Approved','Declined','Paid','Cancelled','Invoiced']) {
        const q=await quote(status);
        await db.query("update quotes set next_follow_up_date='2030-10-04',expiry_date='2030-10-06' where id=$1",[q]);
        await db.query("select notification_private.sales_reminders('2030-10-05T00:30:00Z')");
        assert.equal(await eventCount('quote_followup_due',q),0);assert.equal(await eventCount('quote_expiring',q),0);
      }
      const template=await quote('Sent');
      await db.query("update quotes set is_template=true,next_follow_up_date='2030-10-04',expiry_date='2030-10-06' where id=$1",[template]);
      await db.query("select notification_private.sales_reminders('2030-10-05T00:30:00Z')");
      assert.equal(await eventCount('quote_followup_due',template),0);assert.equal(await eventCount('quote_expiring',template),0);
    });

    await scenario('review guard rejects anonymous, field staff and module-ineligible requests',async()=>{
      const q=await quote();
      for(const [uid,role] of [[null,'anon'],[employee,'authenticated'],[outsider,'authenticated']]) {
        await actor(uid,role);
        await assert.rejects(db.query("update quotes set status='Pending Review',internal_review_status='Pending' where id=$1",[q]),/authentication|permission|account|not permitted/i);
      }
      await actor(admin,'authenticated');await db.query("update profiles set permissions='[\"leads\"]'::jsonb where id=$1",[office]);
      await actor(office,'authenticated');
      await assert.rejects(db.query("update quotes set status='Pending Review',internal_review_status='Pending' where id=$1",[q]),/permission/i);
      await actor(admin,'authenticated');await db.query("update profiles set permissions='[]'::jsonb where id=$1",[office]);
      assert.equal((await one('select status from quotes where id=$1',[q])).status,'Draft');
    });

    await scenario('internal approval records trusted reviewer and stays separate from client acceptance',async()=>{
      const q=await quote();await actor(office,'authenticated');
      await db.query("update quotes set status='Pending Review',internal_review_status='Pending' where id=$1",[q]);
      await db.query("update quotes set status='Draft',internal_review_status='Approved',internal_reviewed_by=$1,internal_reviewed_at='2000-01-01' where id=$2",[outsider,q]);
      const saved=await one('select status,internal_review_status,internal_reviewed_by,internal_reviewed_at from quotes where id=$1',[q]);
      assert.equal(saved.status,'Draft');assert.equal(saved.internal_reviewed_by,office);assert.equal(saved.internal_review_status,'Approved');
      assert.ok(new Date(saved.internal_reviewed_at).getFullYear()>2000);
      assert.ok(await eventCount('quote_internal_review_approved',q)>0);assert.equal(await eventCount('quote_approved',q),0);
      await db.query("update quotes set status='Pending Review',internal_review_status='Pending',internal_reviewed_at=null,internal_reviewed_by=null where id=$1",[q]);
      await db.query("update quotes set status='Draft',internal_review_status='Changes Required' where id=$1",[q]);
      assert.ok(await eventCount('quote_internal_changes_required',q)>0);
    });

    await scenario('review cannot reset a customer decision or approve without a pending review',async()=>{
      const accepted=await quote('Approved'),draft=await quote();await actor(admin,'authenticated');
      await assert.rejects(db.query("update quotes set status='Pending Review',internal_review_status='Pending' where id=$1",[accepted]),/Customer decisions/i);
      await assert.rejects(db.query("update quotes set internal_review_status='Approved' where id=$1",[draft]),/pending internal review/i);
      await assert.rejects(db.query("update quotes set status='Pending Review' where id=$1",[draft]),/Invalid internal review|pending outcome/i);
      assert.equal((await one('select status from quotes where id=$1',[accepted])).status,'Approved');
    });

    await scenario('anonymous public status-only writes cannot bypass a pending internal review',async()=>{
      const q=await quote();await actor(office,'authenticated');
      await db.query("update quotes set status='Pending Review',internal_review_status='Pending' where id=$1",[q]);
      await actor(null,'anon');
      for(const status of ['Approved','Declined','Draft']) await assert.rejects(db.query('update quotes set status=$1 where id=$2',[status,q]),/review|permission|authentication|permitted/i);
      assert.equal((await one('select status from quotes where id=$1',[q])).status,'Pending Review');
    });

    await scenario('change order internal decision stays Draft and customer acceptance remains a different event',async()=>{
      const co=next();
      await db.query("insert into change_orders(id,company_id,project_id,title,status,total) values($1,$2,$3,'Review scope','Draft',1000)",[co,company,project]);
      await actor(office,'authenticated');
      await db.query("update change_orders set status='Pending Review',internal_review_status='Pending' where id=$1",[co]);
      await db.query("update change_orders set status='Draft',internal_review_status='Approved' where id=$1",[co]);
      const saved=await one('select status,internal_review_status,internal_reviewed_by from change_orders where id=$1',[co]);
      assert.deepEqual(saved,{status:'Draft',internal_review_status:'Approved',internal_reviewed_by:office});
      assert.ok(await eventCount('co_internal_review_approved',co)>0);assert.equal(await eventCount('co_approved',co),0);
    });

    await scenario('a customer signed into another company can decline without spoofing a staff actor',async()=>{
      const q=await quote('Sent');await actor(outsider,'authenticated');
      await db.query("update quotes set status='Declined',decline_reason='Scope changed' where id=$1",[q]);
      const notifications=await rows("select metadata from notifications where event_key='quote_declined' and related_id=$1",[q]);
      assert.ok(notifications.length>0);
      assert.ok(notifications.every(row=>row.metadata.actor_id===null && row.metadata.actor_name==='Saved Client'));
      await assert.rejects(db.query("update quotes set title='Foreign edit' where id=$1",[q]),/not permitted/i);
    });

    await scenario('communications and reminders enforce both company and leadership RLS',async()=>{
      const message=await inbound(),foreign=await inbound(other,otherClient),reminder=next();
      await db.query("insert into client_reminders(id,company_id,client_id,title,status,due_date) values($1,$2,$3,'Synthetic reminder','Pending','2030-10-04')",[reminder,company,client]);
      await actor(office,'authenticated');await db.exec('set role authenticated');
      assert.ok((await rows('select id from client_communications')).some(row=>row.id===message));
      assert.equal((await rows('select id from client_communications')).some(row=>row.id===foreign),false);
      await assert.rejects(db.query("insert into client_communications(company_id,client_id,type,subject,direction) values($1,$2,'Email','Foreign','Outbound')",[other,otherClient]),/account|policy|permission/i);
      await actor(employee,'authenticated');await db.exec('set role authenticated');
      assert.equal((await rows('select * from client_communications')).length,0);assert.equal((await rows('select * from client_reminders')).length,0);
      await assert.rejects(db.query("insert into client_reminders(company_id,client_id,title) values($1,$2,'Forbidden')",[company,client]),/policy|permission/i);
      await actor();
    });

    await scenario('communication recipient and reminder assignee must be saved in the same company',async()=>{
      await assert.rejects(db.query("insert into client_communications(company_id,client_id,type,subject) values($1,$2,'Email','Wrong client')",[company,otherClient]),/outside this company/i);
      await assert.rejects(db.query("insert into client_reminders(company_id,client_id,title,assigned_to) values($1,$2,'Wrong assignee',$3)",[company,client,outsider]),/outside this company/i);
      await assert.rejects(db.query("insert into client_communications(company_id,type,subject) values($1,'Email','No recipient')",[company]),/saved client or lead/i);
    });

    await scenario('only an explicitly linked delivered human reply marks that incoming message answered',async()=>{
      const reply=await inbound(),unrelated=await inbound(),q=await quote('Sent');
      await register({providerId:'document-send',related:'Quote',document:q,kind:'document'});
      assert.equal((await one('select answered_at from client_communications where id=$1',[reply])).answered_at,null);
      assert.equal(await callback('resend','document-send','doc-delivered','delivered'),true);
      assert.equal((await one('select answered_at from client_communications where id=$1',[reply])).answered_at,null);
      await register({providerId:'explicit-reply',reply});
      assert.equal((await one('select answered_at from client_communications where id=$1',[reply])).answered_at,null);
      assert.equal(await callback('resend','explicit-reply','reply-delivered','delivered'),true);
      assert.ok((await one('select answered_at from client_communications where id=$1',[reply])).answered_at);
      assert.equal((await one('select answered_at from client_communications where id=$1',[unrelated])).answered_at,null);
    });

    await scenario('delivery callbacks handle unknown IDs, replay and terminal failures without duplicate alerts',async()=>{
      const q=await quote('Sent');
      assert.equal(await callback('resend','unknown-id','unknown-event','failed'),false);
      await register({providerId:'bounced-document',related:'Quote',document:q,kind:'document'});
      assert.equal(await callback('resend','bounced-document','bounce-event','bounced'),true);
      const count=await eventCount('quote_send_failed',q);assert.ok(count>0);
      assert.equal(await callback('resend','bounced-document','bounce-event','bounced'),true);
      assert.equal(await eventCount('quote_send_failed',q),count);
      assert.equal(await callback('resend','bounced-document','late-delivery','delivered'),true);
      assert.equal((await one("select status from notification_private.outbound_deliveries where provider_id='bounced-document'")).status,'bounced');
    });

    await scenario('a deleted sender does not prevent a saved delivery failure callback',async()=>{
      const sender=next(),q=await quote('Sent');
      await db.query("insert into profiles(id,company_id,role,full_name,is_active) values($1,$2,'office','Temporary sender',true)",[sender,company]);
      await register({providerId:'deleted-actor-document',related:'Quote',document:q,kind:'document',user:sender});
      await db.query('delete from profiles where id=$1',[sender]);
      assert.equal(await callback('resend','deleted-actor-document','deleted-actor-failure','failed'),true);
      assert.ok(await eventCount('quote_send_failed',q)>0);
    });

    await scenario('a later bounce reopens only its own automatic reply completion and preserves another delivered reply',async()=>{
      const reply=await inbound();
      await register({providerId:'completion-one',reply});
      await register({providerId:'completion-two',reply});
      await register({providerId:'unrelated-failed-reply',reply});
      await callback('resend','completion-one','completion-one-delivered','delivered');
      const completed=await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]);
      assert.ok(completed.answered_at);assert.equal(completed.answered_delivery_id,'resend:completion-one');
      await callback('resend','unrelated-failed-reply','unrelated-bounced','bounced');
      assert.deepEqual(await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]),completed);
      await callback('resend','completion-two','completion-two-delivered','delivered');
      await callback('resend','completion-one','completion-one-later-bounced','bounced');
      const surviving=await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]);
      assert.ok(surviving.answered_at);assert.equal(surviving.answered_delivery_id,'resend:completion-two');
      await callback('resend','completion-two','completion-two-later-bounced','bounced');
      assert.deepEqual(await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]),{answered_at:null,answered_delivery_id:null});
    });

    await scenario('manual Mark handled remains answered after the outgoing reply later bounces',async()=>{
      const reply=await inbound();await register({providerId:'manually-handled-reply',reply});
      await callback('resend','manually-handled-reply','manual-delivered','delivered');
      await actor(office,'authenticated');
      await db.query('update client_communications set answered_at=now(),answered_delivery_id=null where id=$1 and company_id=$2',[reply,company]);
      const manuallyHandled=await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]);
      await actor();await callback('resend','manually-handled-reply','manual-later-bounced','bounced');
      assert.deepEqual(await one('select answered_at,answered_delivery_id from client_communications where id=$1',[reply]),manuallyHandled);
    });

    await scenario('removed document delivery failure produces a valid generic company alert and acknowledges replay',async()=>{
      const q=await quote('Sent');await register({providerId:'removed-document',related:'Quote',document:q,kind:'document'});
      await db.query('delete from quotes where id=$1',[q]);
      const before=await eventCount('company_notification_failed',company);
      assert.equal(await callback('resend','removed-document','removed-bounced','bounced'),true);
      assert.ok(await eventCount('company_notification_failed',company)>before);
      const alerts=await rows("select company_id,related_type,related_id,action_url from notifications where event_key='company_notification_failed' and related_id=$1",[company]);
      assert.ok(alerts.every(row=>row.company_id===company && row.related_type==='Company' && row.related_id===company && row.action_url && !row.action_url.includes(q)));
      const after=await eventCount('company_notification_failed',company);
      assert.equal(await callback('resend','removed-document','removed-bounced','bounced'),true);assert.equal(await eventCount('company_notification_failed',company),after);
    });

    await scenario('private unknown delivery callback timer preserves first seen, bounds retries and denies browser access',async()=>{
      const retry=async(provider,providerId)=>(await one('select retry_unregistered_delivery($1,$2) result',[provider,providerId])).result;
      assert.equal(await retry('twilio','SM-synthetic-unknown'),true);
      const first=await one("select first_seen_at::text from notification_private.unregistered_delivery_callbacks where provider='twilio' and provider_id='SM-synthetic-unknown'");
      assert.equal(await retry('twilio','SM-synthetic-unknown'),true);
      assert.deepEqual(await one("select first_seen_at::text from notification_private.unregistered_delivery_callbacks where provider='twilio' and provider_id='SM-synthetic-unknown'"),first);
      await db.exec("update notification_private.unregistered_delivery_callbacks set first_seen_at=now()-interval '11 minutes' where provider_id='SM-synthetic-unknown'");
      assert.equal(await retry('twilio','SM-synthetic-unknown'),false);
      assert.equal(await retry('invalid-provider','synthetic'),false);
      await actor(office,'authenticated');await db.exec('set role authenticated');
      await assert.rejects(retry('twilio','SM-browser-spoof'),/permission denied/i);
      await assert.rejects(rows('select * from notification_private.unregistered_delivery_callbacks'),/permission denied/i);
      await actor();
      await db.exec("update notification_private.unregistered_delivery_callbacks set first_seen_at=now()-interval '8 days' where provider_id='SM-synthetic-unknown'");
      assert.equal(await retry('resend','retention-next-callback'),true);
      assert.equal(Number((await one("select count(*) n from notification_private.unregistered_delivery_callbacks where provider_id='SM-synthetic-unknown'")).n),0);
    });

    await scenario('saved SMS intents enforce fingerprints and allow retry only after a confirmed rejection',async()=>{
      const claim=async(request,fingerprint='a'.repeat(64))=>(await one('select claim_sms_intent($1,$2,$3) result',[company,request,fingerprint])).result;
      const finish=async(request,status,providerId=null)=>db.query('select finish_sms_intent($1,$2,$3,$4)',[company,request,status,providerId]);
      const pending=next(),sent=next(),failed=next(),sid='SM'+'a'.repeat(32);
      assert.deepEqual(await claim(pending),{claimed:true,status:'pending',provider_id:null});
      assert.deepEqual(await claim(pending),{claimed:false,status:'pending',provider_id:null});
      await assert.rejects(claim(pending,'b'.repeat(64)),/payload changed/i);
      await finish(pending,'unknown');assert.deepEqual(await claim(pending),{claimed:false,status:'unknown',provider_id:null});
      await claim(sent);await finish(sent,'sent',sid);assert.deepEqual(await claim(sent),{claimed:false,status:'sent',provider_id:sid});
      await claim(failed);await finish(failed,'failed');assert.deepEqual(await claim(failed),{claimed:true,status:'pending',provider_id:null});
      await assert.rejects(finish(sent,'sent','invalid-provider-sid'),/invalid/i);
      await actor(office,'authenticated');await db.exec('set role authenticated');
      await assert.rejects(claim(next()),/permission denied/i);await assert.rejects(finish(sent,'failed'),/permission denied/i);
      await actor();
    });

    await scenario('SMS replies normalize local saved phones and stop after phone ownership changes',async()=>{
      await register({provider:'twilio',providerId:'sms-normalization',sender:'+17805559876',recipient:'+17805551234'});
      assert.equal((await one("select record_inbound_sms('sms-reply-one','+17805551234','+17805559876','Synthetic reply') result")).result,true);
      assert.equal((await one("select record_inbound_sms('sms-reply-one','+17805551234','+17805559876','Synthetic reply') result")).result,false);
      await db.query("update clients set phone='+17805551111' where id=$1",[client]);
      assert.equal((await one("select record_inbound_sms('sms-reply-two','+17805551234','+17805559876','Old contact') result")).result,false);
      await db.query("update clients set phone='(780) 555-1234' where id=$1",[client]);
    });

    await scenario('incoming email routes require the current saved sender and dedupe reply retries',async()=>{
      const route=(await one('select create_reply_route($1,$2,null) id',[company,client])).id;
      assert.equal((await one('select create_reply_route($1,$2,null) id',[company,client])).id,route,'Routes are stable across original email retries.');
      const reply=async(event,sender)=>(await one("select record_inbound_reply('resend',$1,$2,$3,'Reply','Synthetic answer') result",[event,route,sender])).result;
      assert.equal(await reply('email-wrong-sender','foreign@example.invalid'),false);
      assert.equal(await reply('email-valid-sender','CLIENT@example.invalid'),true);
      assert.equal(await reply('email-valid-sender','CLIENT@example.invalid'),false);
      await db.query("update clients set email='new-client@example.invalid' where id=$1",[client]);
      assert.equal(await reply('email-former-sender','client@example.invalid'),false);
      await db.query("update clients set email='client@example.invalid' where id=$1",[client]);
    });

    await scenario('a shared SMS number never chooses between two tenant conversations',async()=>{
      await db.query("update clients set phone='+17805551234' where id=$1",[otherClient]);
      await register({provider:'twilio',providerId:'sms-ambiguous-tenant',co:other,party:otherClient,document:otherClient,user:outsider,sender:'+17805559876',recipient:'+17805551234'});
      assert.equal((await one("select record_inbound_sms('sms-ambiguous-reply','+17805551234','+17805559876','Ambiguous') result")).result,false);
      await db.query("update clients set phone='+6495551234' where id=$1",[otherClient]);
    });

    await scenario('Stripe fulfillment rejects foreign accounts/documents and missing documents atomically',async()=>{
      const inv=await invoice(),foreign=await invoice(1000,other);
      await assert.rejects(payment(inv,'cs_foreign_account',100,{account:'acct_other'}),/account outside company/i);
      await assert.rejects(payment(foreign,'cs_foreign_document',100),/Invoice outside company/i);
      await assert.rejects(payment(next(),'cs_missing_document',100),/Invoice outside company/i);
      assert.equal((await one('select amount_paid from invoices where id=$1',[inv])).amount_paid,'0.00');
      assert.equal(Number((await one("select count(*) n from notification_private.provider_events where provider='stripe'")).n),0);
      await actor(office,'authenticated');await db.exec('set role authenticated');
      await assert.rejects(payment(inv,'cs_client_spoof',100),/permission denied/i);
      await actor();
    });

    await scenario('partial and full invoice payments persist once and emit once per recipient',async()=>{
      const inv=await invoice(),schedule=next();
      await db.query("insert into invoice_payment_schedules(id,company_id,invoice_id,amount,amount_paid,status,sort_order) values($1,$2,$3,1000,0,'Pending',1)",[schedule,company,inv]);
      assert.equal((await payment(inv,'cs_partial_invoice',250)).processed,true);
      assert.deepEqual(await one('select amount_paid,balance_due,status from invoices where id=$1',[inv]),{amount_paid:'250.00',balance_due:'750.00',status:'Partially Paid'});
      const count=await eventCount('partial_payment_received',inv);assert.equal(count,2,'Invoice update and payment insert share one dedupe bucket for admin and office.');
      assert.equal((await payment(inv,'cs_partial_invoice',250)).processed,false);
      assert.equal(await eventCount('partial_payment_received',inv),count);
      assert.equal((await payment(inv,'cs_full_invoice',750)).processed,true);
      assert.deepEqual(await one('select amount_paid,balance_due,status from invoices where id=$1',[inv]),{amount_paid:'1000.00',balance_due:'0.00',status:'Paid'});
      assert.deepEqual(await one('select amount_paid,status,paid_date::text from invoice_payment_schedules where id=$1',[schedule]),{amount_paid:'1000',status:'Paid',paid_date:'2026-10-04'});
      assert.equal(await eventCount('payment_received',inv),2);
      assert.equal(Number((await one('select count(*) n from payments where invoice_id=$1',[inv])).n),2);
    });

    await scenario('a full invoice payment allocates across every unpaid installment',async()=>{
      const inv=await invoice(),first=next(),second=next();
      await db.query("insert into invoice_payment_schedules(id,company_id,invoice_id,amount,amount_paid,status,sort_order) values($1,$3,$4,400,0,'Pending',1),($2,$3,$4,600,0,'Pending',2)",[first,second,company,inv]);
      await payment(inv,'cs_all_installments',1000);
      const schedules=await rows('select amount_paid,status from invoice_payment_schedules where invoice_id=$1 order by sort_order',[inv]);
      assert.deepEqual(schedules,[{amount_paid:'400',status:'Paid'},{amount_paid:'600',status:'Paid'}]);
    });

    await scenario('quote deposits are saved atomically, replay safely and complete at the saved deposit threshold',async()=>{
      const q=await quote('Approved');await db.query('update quotes set deposit_amount=100 where id=$1',[q]);
      assert.equal((await payment(q,'cs_quote_deposit_partial',40,{type:'quote'})).processed,true);
      assert.equal((await one('select status from quotes where id=$1',[q])).status,'Approved');
      assert.equal((await payment(q,'cs_quote_deposit_partial',40,{type:'quote'})).processed,false);
      assert.equal(Number((await one('select count(*) n from notification_private.quote_deposits where quote_id=$1',[q])).n),1);
      assert.equal((await payment(q,'cs_quote_deposit_final',60,{type:'quote'})).processed,true);
      assert.equal((await one('select status from quotes where id=$1',[q])).status,'Paid');
      assert.equal((await one('select sum(amount) paid from notification_private.quote_deposits where quote_id=$1',[q])).paid,'100');
      assert.equal(await eventCount('quote_deposit_received',q),4,'Each trusted deposit produces one notification per eligible admin/office.');
    });
  } finally { await db.close(); }
});
