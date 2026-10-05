import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source=path=>readFile(new URL(path,import.meta.url),'utf8');
test('notification rollout retains current deposit ledger, tenant boundaries, seats and signing keys',async()=>{
 const db=new PGlite();try{
  await db.exec(await source('./schema.sql'));
  await db.exec(await source('./implementation-schema.sql'));
  await db.exec(`create or replace function public.get_auth_company_id() returns uuid language sql stable security definer as $$select company_id from public.profiles where id=auth.uid()$$;
   grant all on all tables in schema public to service_role; grant select,update on public.companies to authenticated; create policy existing_company_access on public.companies for all to authenticated using(id=public.get_auth_company_id()) with check(id=public.get_auth_company_id()); alter table vault.decrypted_secrets add column created_at timestamptz default now();`);
  const migrations=['20261003220500_role_based_notifications.sql','20261004031303_lead_created_notifications.sql','20261004173154_notification_personal_delivery.sql','20261004180824_notification_provider_configuration.sql','20261004201943_storefront_review_repairs.sql','20261004204119_project_tenant_boundaries.sql','20261004205809_storefront_enquiries.sql','20261004210507_reviewed_schedule_drafts.sql','20261004222930_stripe_connect_webhook_secret.sql','20261004173051_warranty_document_workflows.sql','20261004173132_subscriber_costs_assets_notifications.sql','20261004173313_sales_finance_client_notifications.sql','20261004174541_people_pm_task_workflows.sql','20261004180605_subscriber_notification_final_integration.sql','20261004234106_notification_current_release_compatibility.sql','20261005000053_protected_document_notification_relay.sql'];
  for(const name of migrations){try{await db.exec(await source('../../supabase/migrations/'+name));}catch(e){throw new Error(name+': '+e.message);}}
  await db.exec("grant all on all tables in schema public to service_role; insert into vault.decrypted_secrets(name,decrypted_secret) values('fuzedflow_stripe_connect_webhook','synthetic-connect-key');");
  await db.query("insert into companies(id,name,plan_id,max_users,stripe_account_id,timezone) values($1,'Synthetic','professional',4,'acct_synthetic','America/Edmonton'),($2,'Other','business',10,'acct_other','America/Edmonton')",[id(1),id(2)]);
  await db.query("insert into profiles(id,company_id,role,full_name,is_active,email) values($1,$2,'admin','Gary Byrne',true,'fixture@example.invalid')",[id(10),id(1)]);
  await db.query("insert into quotes(id,company_id,status,total,deposit_amount) values($1,$2,'Approved',1000,200)",[id(20),id(1)]);
  const record=(session,type,doc,amount)=>db.query("select record_stripe_payment($1,$2,$3,'acct_synthetic',$4,'pi_synthetic',$5,now()) result",[id(1),type,doc,session,amount]);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("select record_checkout_payment('cs_before_rollout',$1,null,$2,50,current_date)",[id(1),id(20)]);
  assert.equal((await record('cs_before_rollout','quote',id(20),50)).rows[0].result.processed,false);
  await record('cs_after_rollout','quote',id(20),150);await record('cs_after_rollout','quote',id(20),150);
  const quote=(await db.query('select deposit_paid_amount,status from quotes where id=$1',[id(20)])).rows[0];assert.equal(Number(quote.deposit_paid_amount),200);assert.equal(quote.status,'Approved');
  await db.query("insert into invoices(id,company_id,quote_id,total,status) values($1,$2,$3,1000,'Sent')",[id(30),id(1),id(20)]);
  assert.equal(Number((await db.query('select amount_paid from invoices where id=$1',[id(30)])).rows[0].amount_paid),200);
  await record('cs_invoice','invoice',id(30),300);await record('cs_invoice','invoice',id(30),300);
  assert.equal(Number((await db.query('select amount_paid from invoices where id=$1',[id(30)])).rows[0].amount_paid),500);
  assert.equal((await db.query("select stripe_payment_context(null,'cs_after_rollout') value")).rows[0].value.document_type,'quote');
  assert.equal((await db.query("select notification_provider_server_config() value")).rows[0].value.stripe_connect_webhook_secret,'synthetic-connect-key');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id(10)]);await db.exec('set role authenticated');
  await assert.rejects(record('cs_forged','invoice',id(30),1),/permission denied/);
  await assert.rejects(db.query('select notification_provider_server_config()'),/permission denied/);
  await assert.rejects(db.query('update companies set max_users=99 where id=$1',[id(1)]),/managed by the payment service/);
  await db.exec('reset role');
  await db.exec("insert into vault.decrypted_secrets(name,decrypted_secret) values('notification_cron_secret','synthetic-relay'),('project_url','https://synthetic.supabase.invalid');");
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','anon',false)");await db.exec('set role anon');
  assert.equal((await db.query("select request_document_notification($1,'quote_viewed','') sent",[id(20)])).rows[0].sent,true);
  assert.equal((await db.query("select request_document_notification($1,'quote_viewed','') sent",[id(20)])).rows[0].sent,false);
  await assert.rejects(db.query("select request_document_notification($1,'payment_received','fake')",[id(20)]),/Unsupported/);
  await assert.rejects(db.query("select request_document_notification($1,'quote_viewed','')",[id(999)]),/unavailable/);
  await assert.rejects(db.query('select * from notification_private.portal_relay_requests'),/permission denied/);
  await db.exec('reset role');
  const failures=(await db.query("select count(*)::int n from notifications where company_id=$1 and user_id!=$2",[id(1),id(10)])).rows[0];assert.equal(failures.n,0);
 }finally{await db.close();}
});
