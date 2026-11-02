import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const source=await read('tests/notifications/implementation.test.mjs');
const migrations=[...source.match(/const migrations = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map(m=>m[1]);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company=id(1),other=id(2),admin=id(3),outsider=id(4),client=id(10),foreign=id(11),second=id(12),quote=id(20),invoice=id(21),co=id(22);
const qt='a'.repeat(64),it='b'.repeat(64),ct='c'.repeat(64);

test('portal capability security, client-visible projection and server-owned message delivery',async t=>{
  const db=new PGlite(),rows=async(sql,args=[]) => (await db.query(sql,args)).rows,one=async(sql,args=[]) => (await rows(sql,args))[0];
  const actor=async(uid='',role='service_role')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,role]);};
  const history=async(c=client,token=qt,kind='quote',before=null,beforeId=null)=>(await one('select get_client_portal_communications($1,$2,$3,$4,$5) data',[c,token,kind,before,beforeId])).data;
  const claim=async({request=id(50),channel='Email',subject='Portal question',message='<script>literal text</script>',reply=null,c=client,token=qt,kind='quote'}={})=>(await one('select claim_client_portal_message($1,$2,$3,$4,$5,$6,$7,$8) data',[c,token,kind,request,channel,subject,message,reply])).data;
  try {
    await db.exec(await read('tests/notifications/schema.sql'));
    await db.exec(await read('tests/notifications/implementation-schema.sql'));
    for(const file of migrations)await db.exec(await read('supabase/migrations/'+file));
    await db.exec(`alter table client_communications add column if not exists delivery_kind text;
      create schema extensions;
      -- Synthetic digest implementation only: the live migration uses pgcrypto SHA-256.
      create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$select decode(md5(value)||md5(reverse(value)),'hex')$$;
      create table invoice_share_links(id uuid primary key default gen_random_uuid(),company_id uuid,client_id uuid,invoice_id uuid,token_hash text,status text,revoked_at timestamptz,expires_at timestamptz);
      create table change_order_share_links(id uuid primary key default gen_random_uuid(),company_id uuid,client_id uuid,change_order_id uuid,token_hash text,status text,revoked_at timestamptz,expires_at timestamptz);`);
    await db.exec(await read('supabase/migrations/20261102150726_client_portal_communications.sql'));
    await db.query("insert into companies(id,name,phone,settings,timezone) values($1,'Company A','(403) 555-1234','{\"email\":\"office@example.invalid\"}','America/Edmonton'),($2,'Company B','+14035559999','{}','UTC')",[company,other]);
    for(const [uid,c] of [[admin,company],[outsider,other]]){
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,uid+'@example.invalid']);
      await db.query("insert into profiles(id,company_id,full_name,role,is_active) values($1,$2,'Saved admin','admin',true)",[uid,c]);
    }
    await db.query("insert into clients(id,company_id,name,email,phone) values($1,$2,'Client A','client@example.invalid','(403) 555-2345'),($3,$4,'Other client','other@example.invalid','+14035553456'),($5,$2,'Second client','second@example.invalid','+14035554567')",[client,company,foreign,other,second]);
    await db.query("insert into quotes(id,company_id,client_id,title,status,is_template) values($1,$2,$3,'Shared quote','Sent',false)",[quote,company,client]);
    await db.query("insert into quote_approvals(company_id,quote_id,client_id,approval_token,approval_status) values($1,$2,$3,$4,'Sent')",[company,quote,client,qt]);
    await db.query("insert into invoices(id,company_id,client_id,status) values($1,$2,$3,'Sent')",[invoice,company,client]);
    await db.query("insert into invoice_share_links(company_id,client_id,invoice_id,token_hash,status) values($1,$2,$3,encode(extensions.digest($4,'sha256'),'hex'),'Active')",[company,client,invoice,it]);
    await db.query("insert into change_orders(id,company_id,client_id,status,title) values($1,$2,$3,'Sent','Change')",[co,company,client]);
    await db.query("insert into change_order_share_links(company_id,client_id,change_order_id,token_hash,status) values($1,$2,$3,encode(extensions.digest($4,'sha256'),'hex'),'Active')",[company,client,co,ct]);
    await t.test('feature starts off and is enforced by both read and write RPCs',async()=>{
      assert.deepEqual(await history(),{enabled:false,messages:[]});
      await assert.rejects(claim(),/unavailable/);
      await db.query("update companies set settings=settings||'{\"client_portal\":{\"show_communications\":true}}' where id=$1",[company]);
      assert.equal((await history()).enabled,true);
    });
    await t.test('each supported token binds to the saved client, tenant, live document and revocation state',async()=>{
      await actor('','anon');await db.exec('set role anon');
      for(const [token,kind] of [[qt,'quote'],[it,'invoice'],[ct,'change_order']]){
        assert.equal((await history(client,token,kind)).enabled,true);
        await assert.rejects(history(foreign,token,kind),/unavailable/);
        await assert.rejects(history(second,token,kind),/unavailable/);
      }
      await assert.rejects(history(client,'bad','quote'),/valid private/);
      await assert.rejects(history(client,'d'.repeat(64),'quote'),/unavailable/);
      await assert.rejects(history(client,qt,'invoice'),/unavailable/);
      await assert.rejects(claim(),/permission denied/);
      await assert.rejects(db.query('select * from client_communications'),/permission denied/);
      await assert.rejects(db.query('select * from portal_private.message_intents'),/permission denied/);
      await actor();
      await db.query("update quote_approvals set approval_status='Revoked' where quote_id=$1",[quote]);
      await assert.rejects(history(),/unavailable/);
      await db.query("update quote_approvals set approval_status='Sent' where quote_id=$1",[quote]);
      await db.query("update invoice_share_links set expires_at=now()-interval '1 minute'");await assert.rejects(history(client,it,'invoice'),/unavailable/);
      await db.query('update invoice_share_links set expires_at=null');
      await db.query("update change_order_share_links set revoked_at=now()");await assert.rejects(history(client,ct,'change_order'),/unavailable/);
      await db.query('update change_order_share_links set revoked_at=null');
      await db.query("update invoices set status='Draft' where id=$1",[invoice]);await assert.rejects(history(client,it,'invoice'),/unavailable/);
      await db.query("update invoices set status='Sent' where id=$1",[invoice]);
    });
    await t.test('only actual client email/SMS exchanges are returned; notes, copies, documents and other recipients stay private',async()=>{
      for(const [n,type,direction,provider,kind] of [[30,'Email','Inbound','resend',null],[31,'SMS','Outbound','twilio','communication'],[32,'Phone Call','Outbound',null,null],[33,'Email','Outbound','resend','document'],[34,'Email','Outbound','resend','communication'],[35,'Email','Outbound','resend','communication'],[36,'Email','Outbound','resend','communication'],[37,'Email','Inbound',null,null]]){
        await db.query("insert into client_communications(id,company_id,client_id,type,direction,subject,message,status,provider,provider_message_id,delivery_kind,answered_at,sent_by) values($1,$2,$3,$4,$5,'Subject','Body','Sent',$6,$7,$8,now(),'Private staff identity')",[id(n),company,client,type,direction,provider,provider?'provider-'+n:null,kind]);
      }
      for(const [n,provider,recipient,copy] of [[31,'twilio','+14035552345',false],[34,'resend','client@example.invalid',true],[35,'resend','someone-else@example.invalid',false],[36,'resend','client@example.invalid',false]]){
        await db.query("insert into notification_private.outbound_deliveries(provider,provider_id,company_id,related_type,related_id,client_id,kind,recipient,is_copy) values($1,$2,$3,'Message',$4,$4,'communication',$5,$6)",[provider,'provider-'+n,company,client,recipient,copy]);
      }
      await db.query("insert into client_communications(company_id,client_id,type,direction,message,provider,provider_message_id) values($1,$2,'Email','Inbound','Other client secret','resend','foreign-msg')",[other,foreign]);
      const view=await history();assert.deepEqual(view.messages.map(m=>m.id).sort(),[id(30),id(31),id(36)]);
      assert.deepEqual(Object.keys(view.messages[0]).sort(),['created_at','direction','id','message','status','subject','type']);
    });
    let token, messageId;
    await t.test('new update/closeout portal capabilities are hashed, expire and require a saved active staff account',async()=>{
      await actor(outsider,'authenticated');await db.exec('set role authenticated');
      await assert.rejects(db.query('select issue_client_portal_communication_token($1)',[client]),/Active company/);
      await actor(admin,'authenticated');await db.exec('set role authenticated');
      token=(await one('select issue_client_portal_communication_token($1) token',[client])).token;assert.match(token,/^[a-f0-9]{64}$/);
      await actor();
      const stored=await one('select token_hash,expires_at from portal_private.communication_links');assert.notEqual(stored.token_hash,token);assert.ok(stored.expires_at>new Date());
      assert.equal((await history(client,token,'portal')).enabled,true);
      await db.exec("update portal_private.communication_links set expires_at=now()-interval '1 day'");await assert.rejects(history(client,token,'portal'),/unavailable/);
      await db.exec("update portal_private.communication_links set expires_at=now()+interval '1 day'");
    });
    await t.test('service message claim fixes the recipient to the saved company and safely preserves literal customer text',async()=>{
      const value=await claim({reply:id(36)});messageId=value.message_id;
      assert.equal(value.claimed,true);assert.equal(value.recipient,'office@example.invalid');assert.equal(value.client_name,'Client A');
      const saved=await one('select * from client_communications where id=$1',[messageId]);
      assert.equal(saved.client_id,client);assert.equal(saved.direction,'Inbound');assert.equal(saved.provider,'portal');assert.equal(saved.message,'<script>literal text</script>');
      assert.equal(saved.status,'Sending');assert.ok((await history()).messages.some(m=>m.id===messageId));
      await assert.rejects(claim({request:id(51),reply:id(35)}),/outside this conversation/);
      await assert.rejects(claim({request:id(52),reply:id(30)}),/outside this conversation/);
      await assert.rejects(claim({request:id(53),message:'x'.repeat(1601),channel:'SMS'}),/valid subject and message/);
    });
    await t.test('replayed sends cannot duplicate notifications or change payload, including ambiguous provider failures',async()=>{
      const count=(await one('select count(*)::int n from client_communications')).n;
      assert.deepEqual(await claim({reply:id(36)}),{claimed:false,status:'pending',message_id:messageId});
      assert.equal((await one('select count(*)::int n from client_communications')).n,count);
      await assert.rejects(claim({message:'Changed',reply:id(36)}),/request has changed/);
      await db.query("select finish_client_portal_message($1,$2,'sent','resend','accepted-provider')",[client,id(50)]);
      assert.equal((await claim({reply:id(36)})).status,'sent');
      await db.query("select finish_client_portal_message($1,$2,'failed')",[client,id(50)]);
      assert.equal((await one('select status from client_communications where id=$1',[messageId])).status,'Sent','late failure cannot undo confirmed acceptance');
      const uncertain=await claim({request:id(54),channel:'SMS',subject:'',message:'SMS question'});assert.equal(uncertain.recipient,'(403) 555-1234');
      await db.query("select finish_client_portal_message($1,$2,'unknown')",[client,id(54)]);
      assert.equal((await claim({request:id(54),channel:'SMS',subject:'',message:'SMS question'})).status,'unknown');
    });
    await t.test('company off switch, inactive portal and per-client messaging override block API access immediately',async()=>{
      await db.query("update companies set settings=jsonb_set(settings,'{client_portal,show_communications}','false') where id=$1",[company]);
      assert.equal((await history()).enabled,false);await assert.rejects(claim({request:id(60)}),/unavailable/);
      await db.query("update companies set settings=jsonb_set(settings,'{client_portal,show_communications}','true') where id=$1",[company]);
      await db.query("update companies set settings=jsonb_set(settings,'{client_portal,portal_active}','false') where id=$1",[company]);
      assert.equal((await history()).enabled,false);await assert.rejects(claim({request:id(60)}),/unavailable/);
      await db.query("update companies set settings=jsonb_set(settings,'{client_portal,portal_active}','true') where id=$1",[company]);
      await db.query("update clients set portal_features='{\"direct_messaging\":false}' where id=$1",[client]);
      assert.equal((await history()).enabled,false);await assert.rejects(claim({request:id(60)}),/unavailable/);
      await db.query('update clients set portal_features=to_jsonb($1::text) where id=$2',['{"direct_messaging":false}',client]);
      assert.equal((await history()).enabled,false);await assert.rejects(claim({request:id(60)}),/unavailable/);
      await db.query("update clients set portal_features='{}' where id=$1",[client]);
    });
    await t.test('rate limit is enforced atomically across tokens and channels with safe idempotent replay',async()=>{
      for(let n=60;n<68;n++)await claim({request:id(n),channel:'SMS',subject:'',message:'A new question '+n});
      await assert.rejects(claim({request:id(68),token,kind:'portal'}),/Message limit reached/);
      assert.equal((await claim({reply:id(36)})).status,'sent','read-only replay does not consume a send');
    });
    await t.test('history pagination keeps deterministic order when timestamps tie and new messages arrive',async()=>{
      await db.query("insert into client_communications(id,company_id,client_id,type,direction,message,provider,provider_message_id,created_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,'Email','Inbound','History','resend','history-'||n,'2025-01-01' from generate_series(100,164) n",[company,client]);
      const first=await history();assert.equal(first.messages.length,50);assert.equal(first.has_more,true);
      const last=first.messages.at(-1),next=await history(client,qt,'quote',last.created_at,last.id);
      assert.equal(new Set([...first.messages,...next.messages].map(m=>m.id)).size,first.messages.length+next.messages.length);
      assert.equal(next.has_more,false);
    });
  } finally {await db.close();}
});
