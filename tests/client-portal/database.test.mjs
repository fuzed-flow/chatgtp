import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), CLIENT = id(3), OTHER_CLIENT = id(4), FOREIGN_CLIENT = id(5), USER = id(6);
const QUOTE = id(10), INVOICE = id(11), CHANGE = id(12);
const Q_TOKEN = 'a'.repeat(64), I_TOKEN = 'b'.repeat(64), C_TOKEN = 'c'.repeat(64);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea language sql immutable as $$ select decode(md5(value)||md5('hash:'||value),'hex') $$;
    create function extensions.hmac(value text, secret text, algorithm text) returns bytea language sql immutable as $$ select decode(md5(secret||value)||md5(value||secret),'hex') $$;
    create schema app_review_private;
    create function app_review_private.module_allowed(module text) returns boolean language sql stable as $$ select auth.uid() is not null $$;
    create table companies(id uuid primary key,name text,logo_url text,company_logo_url text,settings jsonb default '{}');
    create table clients(id uuid primary key,company_id uuid,name text,private_notes text);
    create table profiles(id uuid primary key,company_id uuid,role text,is_active boolean default true);
    create table quotes(id uuid primary key,company_id uuid,client_id uuid,is_template boolean default false,quote_number text,title text,status text,total numeric default 100,created_at timestamptz default now(),issue_date date,expiry_date date,hero_image_url text,end_photos jsonb,documents jsonb);
    create table quote_approvals(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,approval_token text,approval_status text,created_at timestamptz default now());
    create table invoices(id uuid primary key,company_id uuid,client_id uuid,invoice_number text,status text,total numeric default 100,amount_paid numeric default 0,balance_due numeric default 100,issue_date date,due_date date,created_at timestamptz default now());
    create table change_orders(id uuid primary key,company_id uuid,client_id uuid,change_order_number text,title text,status text,total numeric default 100,created_at timestamptz default now());
    create table invoice_share_links(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,client_id uuid,token_hash text unique,status text default 'Active',revoked_at timestamptz,expires_at timestamptz);
    create table change_order_share_links(id uuid primary key default gen_random_uuid(),company_id uuid,change_order_id uuid,client_id uuid,token_hash text unique,status text default 'Active',revoked_at timestamptz,expires_at timestamptz);
    create schema workflow_private;
    create function workflow_private.client_portal_updates(p_client uuid) returns table(id uuid,title text) language sql as $$ select gen_random_uuid(),'Published update' $$;
    create function workflow_private.client_portal_closeouts(p_client uuid) returns table(id uuid,title text) language sql as $$ select gen_random_uuid(),'Published closeout' $$;
  `);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261120235020_unified_client_portal.sql', import.meta.url),'utf8'));
  await db.query("insert into companies(id,name,settings) values($1,'Builder A',$2),($3,'Builder B','{}')",[COMPANY,JSON.stringify({ client_portal:{show_quotes:true,show_invoices:true,show_change_orders:true}, currency:'CAD',private_billing_key:'never-expose' }),id(2)]);
  await db.query("insert into clients values($1,$2,'Client A','never-expose'),($3,$2,'Other client A','secret'),($4,$5,'Client B','secret')",[CLIENT,COMPANY,OTHER_CLIENT,FOREIGN_CLIENT,id(2)]);
  await db.query("insert into profiles(id,company_id,role) values($1,$2,'owner')",[USER,COMPANY]);
  await db.query("insert into quotes(id,company_id,client_id,quote_number,title,status) values($1,$2,$3,'Q-A','Quote A','Sent'),($4,$2,$5,'Q-OTHER','Other client','Sent'),($6,$2,$3,'Q-DRAFT','Draft quote','Draft')",[QUOTE,COMPANY,CLIENT,id(20),OTHER_CLIENT,id(21)]);
  await db.query("insert into quote_approvals(company_id,quote_id,approval_token,approval_status) values($1,$2,$3,'Sent'),($1,$4,$5,'Sent'),($1,$6,$7,'Sent')",[COMPANY,QUOTE,Q_TOKEN,id(20),'d'.repeat(64),id(21),'e'.repeat(64)]);
  await db.query("insert into invoices(id,company_id,client_id,invoice_number,status) values($1,$2,$3,'INV-A','Sent'),($4,$2,$5,'INV-OTHER','Sent'),($6,$2,$3,'INV-DRAFT','Draft')",[INVOICE,COMPANY,CLIENT,id(30),OTHER_CLIENT,id(31)]);
  await db.query("insert into change_orders(id,company_id,client_id,change_order_number,status) values($1,$2,$3,'CO-A','Sent'),($4,$2,$5,'CO-OTHER','Sent'),($6,$2,$3,'CO-DRAFT','Draft')",[CHANGE,COMPANY,CLIENT,id(40),OTHER_CLIENT,id(41)]);
  await db.query("insert into invoice_share_links(company_id,invoice_id,client_id,token_hash) values($1,$2,$3,encode(extensions.digest($4,'sha256'),'hex'))",[COMPANY,INVOICE,CLIENT,I_TOKEN]);
  await db.query("insert into change_order_share_links(company_id,change_order_id,client_id,token_hash) values($1,$2,$3,encode(extensions.digest($4,'sha256'),'hex'))",[COMPANY,CHANGE,CLIENT,C_TOKEN]);
  const query = db.query.bind(db);
  // Expected permission errors should not abort the surrounding fixture transaction.
  db.query = async (...args) => {
    await query('savepoint portal_test_query');
    try {
      const result = await query(...args);
      await query('release savepoint portal_test_query');
      return result;
    } catch (error) {
      await query('rollback to savepoint portal_test_query');
      await query('release savepoint portal_test_query');
      throw error;
    }
  };
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });

const bundle = async (token = Q_TOKEN, client = CLIENT) => (await db.query('select get_client_portal_bundle($1,$2) as bundle',[client,token])).rows[0].bundle;
const link = async (kind, document, token = Q_TOKEN) => (await db.query('select get_client_portal_document_link($1,$2,$3,$4) as token',[CLIENT,token,kind,document])).rows[0].token;

for (const [kind,token] of [['quote',Q_TOKEN],['invoice',I_TOKEN],['change order',C_TOKEN]]) {
  test(`a valid ${kind} link opens all enabled shared document modules`, async () => {
    const result = await bundle(token);
    assert.deepEqual(result.quotes.map(q=>q.id),[QUOTE]);
    assert.deepEqual(result.invoices.map(i=>i.id),[INVOICE]);
    assert.deepEqual(result.change_orders.map(c=>c.id),[CHANGE]);
    assert.equal(result.updates[0].title,'Published update');
    assert.equal(result.closeouts[0].title,'Published closeout');
    assert.equal(result.company.settings.private_billing_key,undefined);
    assert.equal(result.client.private_notes,undefined);
  });
}

test('a credential cannot be used for another client or company', async () => {
  for (const client of [OTHER_CLIENT,FOREIGN_CLIENT]) await assert.rejects(bundle(Q_TOKEN,client),/invalid|expired/);
});
test('guessed IDs and invalid credentials cannot load documents', async () => {
  for (const token of [null,'short','f'.repeat(64)]) await assert.rejects(bundle(token),/secure portal|invalid|expired/);
});
test('revoked quote and draft quote links cannot authenticate the portal', async () => {
  await db.query("update quote_approvals set approval_status='Revoked' where quote_id=$1",[QUOTE]);
  await assert.rejects(bundle(),/invalid|expired/);
  await assert.rejects(bundle('e'.repeat(64)),/invalid|expired/);
});
for (const [table,token] of [['invoice_share_links',I_TOKEN],['change_order_share_links',C_TOKEN]]) {
  test(`expired and revoked ${table} credentials are rejected`, async () => {
    await db.exec(`update ${table} set expires_at=now()-interval '1 second'`);
    await assert.rejects(bundle(token),/invalid|expired/);
    await db.exec(`update ${table} set expires_at=null, revoked_at=now()`);
    await assert.rejects(bundle(token),/invalid|expired/);
  });
}
test('disabled modules return no data and cannot issue document links', async () => {
  await db.query("update companies set settings=jsonb_build_object('client_portal',jsonb_build_object('show_quotes',false,'show_documents',false,'show_portfolio',false,'show_invoices',false,'show_change_orders',false,'show_client_updates',false,'show_project_closeouts',false)) where id=$1",[COMPANY]);
  const result=await bundle();
  for(const key of ['quotes','invoices','change_orders','updates','closeouts']) assert.deepEqual(result[key],[]);
  for(const [kind,doc] of [['quote',QUOTE],['invoice',INVOICE],['change_order',CHANGE]]) await assert.rejects(link(kind,doc),/unavailable/);
});
test('disabling the whole portal blocks access', async () => {
  await db.query("update companies set settings=jsonb_build_object('client_portal',jsonb_build_object('portal_active',false)) where id=$1",[COMPANY]);
  await assert.rejects(bundle(),/unavailable/);
});
test('document opening only authorizes a shared document for this client', async () => {
  assert.equal(await link('quote',QUOTE),Q_TOKEN);
  for(const [kind,doc] of [['quote',id(20)],['invoice',id(30)],['change_order',id(40)],['invoice',id(31)],['change_order',id(41)],['other',QUOTE]]) await assert.rejects(link(kind,doc),/unavailable/);
});
for(const [kind,doc,table] of [['invoice',INVOICE,'invoice_share_links'],['change_order',CHANGE,'change_order_share_links']]) {
  test(`${kind} opens with a hashed short-lived reusable document credential`, async () => {
    const token=await link(kind,doc);
    assert.match(token,/^[a-f0-9]{64}$/);
    assert.notEqual(token,Q_TOKEN);
    assert.equal(await link(kind,doc),token);
    await assert.rejects(bundle(token),/invalid|expired/,'A document-only credential cannot become portal access.');
    const rows=await db.query(`select token_hash,expires_at>now() as valid, expires_at<now()+interval '61 minutes' as short from ${table} where token_hash=encode(extensions.digest($1,'sha256'),'hex')`,[token]);
    assert.equal(rows.rows.length,1); assert.equal(rows.rows[0].valid,true); assert.equal(rows.rows[0].short,true);
    assert.notEqual(rows.rows[0].token_hash,token);
    await db.query(`update ${table} set revoked_at=now() where token_hash=encode(extensions.digest($1,'sha256'),'hex')`,[token]);
    await assert.rejects(link(kind,doc),/revoked/);
  });
}
test('only authorized staff can create a new portal credential', async () => {
  await assert.rejects(db.query('select issue_client_portal_token($1)',[CLIENT]),/permission/);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[USER]);
  await assert.rejects(db.query('select issue_client_portal_token($1)',[FOREIGN_CLIENT]),/permission/);
  const token=(await db.query('select issue_client_portal_token($1) as token',[CLIENT])).rows[0].token;
  assert.equal((await bundle(token)).client.id,CLIENT);
  const stored=(await db.query('select token_hash from client_portal_private.links')).rows[0].token_hash;
  assert.notEqual(stored,token);
  await db.exec('update client_portal_private.links set revoked_at=now()');
  await assert.rejects(bundle(token),/invalid|expired/);
});
test('temporary document links cannot keep a revoked shared document in the portal', async () => {
  await link('invoice',INVOICE);
  await db.query("update invoice_share_links set revoked_at=now() where token_hash=encode(extensions.digest($1,'sha256'),'hex')",[I_TOKEN]);
  assert.deepEqual((await bundle()).invoices,[]);
  await assert.rejects(link('invoice',INVOICE),/unavailable/);
});
test('anonymous callers have only the validated entrypoints', async () => {
  assert.equal((await db.query("select has_schema_privilege('anon','client_portal_private','usage') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('anon','public.issue_client_portal_token(uuid)','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('anon','public.get_client_portal_bundle(uuid,text)','execute') as allowed")).rows[0].allowed,true);
  await db.exec('set local role anon');
  assert.equal((await bundle()).client.id,CLIENT);
});
