import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261102173115_invoice_installment_reminders_and_payment_rounding.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C=id(1), OTHER=id(2), I=id(3), S=id(4), S2=id(5);

test('installment balances, card allocations and delivery scopes in Postgres', async t => {
  const db = new PGlite();
  const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
  const context = async (company=C, invoice=I) => (await one('select public.invoice_reminder_context($1,$2) result',[company,invoice])).result;
  const policy = async (schedule=S, date='2026-11-05', stage=1) => (await one('select public.invoice_installment_reminder_policy($1,$2,$3,$4,$5) result',[C,I,schedule,date,stage])).result;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema notification_private;
      grant usage on schema public,notification_private to service_role;
      create table companies(id uuid primary key);
      create table quotes(id uuid primary key,company_id uuid,deposit_paid_amount numeric default 0);
      create table invoices(id uuid primary key,company_id uuid,client_id uuid,quote_id uuid,status text,total numeric,amount_paid numeric default 0,balance_due numeric,due_date date,has_payment_schedule boolean,created_at timestamptz default now());
      create table payments(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,quote_id uuid,amount numeric,payment_method text,notes text,payment_date date,stripe_checkout_session_id text unique);
      create table invoice_payment_schedules(id uuid primary key,company_id uuid,invoice_id uuid,amount numeric,amount_paid numeric default 0,status text,sort_order integer,amount_type text,percentage numeric,due_date date,payment_name text,paid_date date);
      create table notification_private.outbound_deliveries(company_id uuid,related_type text,related_id uuid,kind text,is_copy boolean default false,provider text,status text,created_at timestamptz default now());
      grant select,insert,update on all tables in schema public to service_role;
      grant select on notification_private.outbound_deliveries to service_role;
    `);
    await db.query('insert into companies values($1),($2)',[C,OTHER]);
    await db.query("insert into invoices(id,company_id,status,total,amount_paid,balance_due,due_date,has_payment_schedule) values($1,$2,'Partially Paid',18244.67,5473.40,12771.27,'2026-10-14',true)",[I,C]);
    await db.query("insert into invoice_payment_schedules(id,company_id,invoice_id,amount,amount_paid,status,sort_order,amount_type,percentage,payment_name) values($1,$2,$3,5473.40,5473.40,'Partial',0,'percentage',30,'Deposit'),($4,$2,$3,5473.40,0,'Pending',1,'percentage',30,'Payment 2')",[S,C,I,S2]);
    await db.query("insert into payments(company_id,invoice_id,amount,payment_date,stripe_checkout_session_id) values($1,$2,5473.40,'2026-10-14','cs_existing')",[C,I]);
    await db.exec(migration);

    await t.test('repairs the paid deposit and preserves its money and receipt',async()=>{
      const s=await one('select status,amount_paid::text,paid_date::text from invoice_payment_schedules where id=$1',[S]);
      assert.deepEqual(s,{status:'Paid',amount_paid:'5473.40',paid_date:'2026-10-14'});
      assert.equal((await one('select count(*)::int n from payments')).n,1);
      assert.equal((await one('select amount_paid::text from invoices where id=$1',[I])).amount_paid,'5473.40');
    });
    await t.test('paid deposit plus undated milestones has no reminder target',async()=>assert.equal(await context(),null));
    await t.test('selects the dated unpaid installment without the original invoice date',async()=>{
      await db.query("update invoice_payment_schedules set due_date='2026-11-05' where id=$1",[S2]);
      assert.deepEqual(await context(),{schedule_item_id:S2,due_date:'2026-11-05',payment_name:'Payment 2',balance_due:5473.4});
    });
    await t.test('uses only the remaining cents of a partial installment',async()=>{
      await db.query('update invoice_payment_schedules set amount_paid=1000 where id=$1',[S2]);
      assert.equal((await context()).balance_due,4473.4);
      await db.query('update invoice_payment_schedules set amount_paid=0 where id=$1',[S2]);
    });
    await t.test('tenant mismatch and fully paid ledger fail closed',async()=>{
      assert.equal(await context(OTHER),null);
      await db.query('update invoices set amount_paid=18244.67 where id=$1',[I]);
      assert.equal(await context(),null);
      await db.query('update invoices set amount_paid=5473.40 where id=$1',[I]);
    });
    await t.test('ordinary invoices keep their date and balance; empty schedules never fall back',async()=>{
      const otherInvoice=id(9);
      await db.query("insert into invoices(id,company_id,status,total,due_date,has_payment_schedule) values($1,$2,'Sent',100,'2026-11-01',false)",[otherInvoice,C]);
      assert.deepEqual(await context(C,otherInvoice),{schedule_item_id:null,due_date:'2026-11-01',payment_name:null,balance_due:100});
      await db.query('update invoices set has_payment_schedule=true where id=$1',[otherInvoice]);
      assert.equal(await context(C,otherInvoice),null);
    });
    await t.test('terminal invoices cannot become reminder targets',async()=>{
      for(const status of ['Paid','Draft','Cancelled','Void']){
        await db.query('update invoices set status=$1 where id=$2',[status,I]);
        assert.equal(await context(),null);
      }
      await db.query("update invoices set status='Partially Paid' where id=$1",[I]);
    });
    await t.test('channels require a successful original send, excluding copies and receipts',async()=>{
      await db.query("insert into notification_private.outbound_deliveries(company_id,related_type,related_id,kind,is_copy,provider,status) values($1,'Invoice',$2,'receipt',false,'twilio','delivered'),($1,'Invoice',$2,'document',true,'twilio','delivered'),($1,'Invoice',$2,'document',false,'twilio','failed'),($1,'Invoice',$2,'document',false,'resend','delivered')",[C,I]);
      const p=await policy(S2);assert.equal(p.email,true);assert.equal(p.sms,false);assert.equal(p.email_sent,false);
    });
    await t.test('accepted reminders dedupe by installment, due date, stage and channel',async()=>{
      await db.query("select record_invoice_installment_reminder($1,$2,$3,'2026-11-05',1,'email')",[C,I,S2]);
      assert.equal((await policy(S2)).email_sent,true);
      assert.equal((await policy(S2,'2026-11-05',2)).email_sent,false);
      await assert.rejects(db.query("select record_invoice_installment_reminder($1,$2,$3,'2026-11-05',1,'sms')",[C,I,S2]),/channel unavailable/);
      await db.query("update invoice_payment_schedules set due_date='2026-11-06' where id=$1",[S2]);
      assert.equal((await policy(S2,'2026-11-06')).email_sent,false);
      await assert.rejects(policy(S2),/unavailable/);
      await assert.rejects(policy(S,'2026-11-06'),/unavailable/);
    });
    await t.test('new card payment closes a 30 percent deposit exactly and replay is idempotent',async()=>{
      const invoice=id(10),schedule=id(11),schedule2=id(12);
      await db.query("insert into invoices(id,company_id,status,total,balance_due,has_payment_schedule) values($1,$2,'Sent',18244.67,18244.67,true)",[invoice,C]);
      await db.query("insert into invoice_payment_schedules(id,company_id,invoice_id,amount,amount_paid,status,sort_order,amount_type,percentage,payment_name) values($1,$2,$3,5473.40,0,'Pending',0,'percentage',30,'Deposit'),($4,$2,$3,5473.40,0,'Pending',1,'percentage',30,'Payment 2')",[schedule,C,invoice,schedule2]);
      const pay=async()=>one("select record_checkout_payment('cs_new',$1,$2,null,5473.40,'2026-11-02') result",[C,invoice]);
      assert.equal((await pay()).result.duplicate,false);
      const paid=await one('select status,amount_paid::text,paid_date::text from invoice_payment_schedules where id=$1',[schedule]);
      assert.deepEqual(paid,{status:'Paid',amount_paid:'5473.40',paid_date:'2026-11-02'});
      assert.equal((await one('select amount_paid::text from invoice_payment_schedules where id=$1',[schedule2])).amount_paid,'0');
      assert.equal((await pay()).result.duplicate,true);
      assert.equal((await one('select amount_paid::text from invoices where id=$1',[invoice])).amount_paid,'5473.40');
    });
    await t.test('payment crossing installments allocates cents without phantom arrears',async()=>{
      const invoice=id(10),schedule=id(12);
      await one("select record_checkout_payment('cs_next',$1,$2,null,5473.41,'2026-11-03') result",[C,invoice]);
      assert.equal((await one('select status from invoice_payment_schedules where id=$1',[schedule])).status,'Paid');
    });
    await t.test('RPCs and private delivery records are inaccessible to clients',async()=>{
      for(const role of ['anon','authenticated']){
        assert.equal((await one("select has_function_privilege($1,'public.invoice_reminder_context(uuid,uuid)','execute') allowed",[role])).allowed,false);
        assert.equal((await one("select has_function_privilege($1,'public.invoice_installment_reminder_policy(uuid,uuid,uuid,date,integer)','execute') allowed",[role])).allowed,false);
        assert.equal((await one("select has_table_privilege($1,'notification_private.invoice_installment_reminder_deliveries','select') allowed",[role])).allowed,false);
      }
      await db.exec('set role service_role');
      assert.equal((await context()).schedule_item_id,S2);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
