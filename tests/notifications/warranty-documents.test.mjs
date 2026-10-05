import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { workflowToken, safeDocumentUrl, workflowLink } from '../../src/lib/documentWorkflows.js';

async function seedLegacyFilePolicies(db) {
  // Match the two reviewed production policies, including the permissive PUBLIC
  // ALL true policy which otherwise bypasses the tenant-isolation policy.
  await db.exec(`
    alter table public.project_documents enable row level security;
    alter table public.project_drawings enable row level security;
    grant select,insert,update,delete on public.project_documents,public.project_drawings to anon,authenticated;
    create policy "Company users can access project docs" on public.project_documents for all to public using(true) with check(true);
    create policy "Tenant Isolation" on public.project_documents for all to authenticated using(company_id=public.get_auth_company_id()) with check(company_id=public.get_auth_company_id());
    create policy "Company users can access project drawings" on public.project_drawings for all to public using(true) with check(true);
    create policy "Tenant Isolation" on public.project_drawings for all to authenticated using(company_id=public.get_auth_company_id()) with check(company_id=public.get_auth_company_id());
  `);
}

test('public workflow links reject malformed tokens and unsafe document destinations', () => {
  const token = 'a'.repeat(64);
  assert.equal(workflowToken(`?token=${token}`), token);
  assert.equal(workflowLink('document', token), `https://app.fuzedflow.com/DocumentResponse?token=${token}`);
  assert.equal(workflowLink('warranty', token), `https://app.fuzedflow.com/WarrantyResponse?token=${token}`);
  for (const value of ['', 'abc', 'x'.repeat(64), 'a'.repeat(65), '../']) assert.equal(workflowToken(`?token=${value}`), null);
  for (const url of ['javascript:alert(1)', 'http://example.invalid/file', '//example.invalid', 'https://user:secret@example.invalid']) assert.equal(safeDocumentUrl(url), null);
  assert.equal(safeDocumentUrl('https://example.invalid/file.pdf'), 'https://example.invalid/file.pdf');
});

test('warranty, immutable document responses, revisions, tenant access and queued request delivery', async () => {
  const db = new PGlite();
  const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const C=id(1), OTHER=id(2), PROJECT=id(3), CLIENT=id(4), DOC=id(5), DRAWING=id(6), REV=id(7), OWNER=id(10), STAFF=id(11), FOREIGN=id(12), OTHERSTAFF=id(13);
  const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const actor = async value => db.query("select set_config('request.jwt.claim.sub',$1,false)", [value || '']);
  const rpc = async (sql,args) => (await rows(sql,args))[0].result;
  try {
    await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261003220500_role_based_notifications.sql', import.meta.url), 'utf8'));
    await db.exec('create table project_drawings(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,file_name text,file_url text,drawing_type text,title text,revision text,notes text,created_at timestamptz default now())');
    await seedLegacyFilePolicies(db);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261004173051_warranty_document_workflows.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261004173154_notification_personal_delivery.sql', import.meta.url), 'utf8'));
    await db.query("insert into companies(id,name,timezone) values($1,'Synthetic Company','America/Edmonton'),($2,'Other Company','UTC')",[C,OTHER]);
    await db.query("insert into profiles(id,company_id,role,full_name,email,is_active) values($1,$2,'owner','Gary Test','owner@example.invalid',true),($3,$2,'employee','Assigned Worker','worker@example.invalid',true),($4,$5,'owner','Other Owner','other@example.invalid',true),($6,$2,'employee','Unassigned Worker','unassigned@example.invalid',true)",[OWNER,C,STAFF,FOREIGN,OTHER,OTHERSTAFF]);
    await db.query("insert into clients(id,company_id,name,email) values($1,$2,'Tim Test','client@example.invalid')",[CLIENT,C]);
    await db.query("insert into projects(id,company_id,client_id,name) values($1,$2,$3,'Synthetic Project')",[PROJECT,C,CLIENT]);
    await actor(OWNER);
    await db.query('insert into project_staff(company_id,project_id,user_id,is_active) values($1,$2,$3,true),($1,$2,$4,true)',[C,PROJECT,STAFF,OTHERSTAFF]);
    await db.query("insert into project_documents(id,company_id,project_id,file_name,file_url,doc_type,file_sha256) values($1,$2,$3,'Agreement.pdf','https://files.example.invalid/agreement.pdf','Contract',$4)",[DOC,C,PROJECT,'f'.repeat(64)]);
    await db.query("insert into project_drawings(id,company_id,project_id,file_name,file_url,title,revision) values($1,$2,$3,'plan-a.pdf','https://files.example.invalid/plan-a.pdf','Kitchen plan','A')",[DRAWING,C,PROJECT]);
    await db.query("insert into project_drawings(id,company_id,project_id,file_name,file_url,title,revision,supersedes_id) values($1,$2,$3,'plan-b.pdf','https://files.example.invalid/plan-b.pdf','Kitchen plan','B',$4)",[REV,C,PROJECT,DRAWING]);
    assert.equal((await rows("select count(*)::int n from notifications where event_key='plan_revised' and user_id=$1",[STAFF]))[0].n,1);
    const expires = new Date(Date.now()+7*86400000).toISOString();
    const created = await rpc('select public.create_document_request($1,$2,$3,$4,$5,$6,$7) result',[DOC,'signature','Assigned Worker','worker@example.invalid',expires,'Please review and sign',STAFF]);
    assert.match(created.token,/^[a-f0-9]{64}$/);
    assert.equal((await rows('select token_hash from workflow_private.capabilities where entity_id=$1',[created.request_id]))[0].token_hash.length,64);
    assert.notEqual((await rows('select token_hash from workflow_private.capabilities where entity_id=$1',[created.request_id]))[0].token_hash,created.token);
    const queueId = await rpc('select public.email_document_request($1,$2,false) result',[created.request_id,created.token]);
    assert.equal(await rpc('select public.email_document_request($1,$2,false) result',[created.request_id,created.token]),queueId,'email replay is deduplicated');
    const queued=(await rows('select payload from notification_private.delivery_outbox where id=$1',[queueId]))[0].payload;
    assert.ok(JSON.stringify(queued).includes('worker@example.invalid'));
    assert.ok(JSON.stringify(queued).includes(workflowLink('document',created.token)));
    assert.equal(await rpc('select workflow_private.notification_request_mail_allowed($1,$2,$3) result',[created.request_id,'document_request',workflowLink('document',created.token)]),true);
    await actor(FOREIGN); await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.create_document_request($1,$2,$3,$4,$5)',[DOC,'signature','Fake','fake@example.invalid',expires]),/access denied/);
    await assert.rejects(db.query('select public.email_document_request($1,$2)',[created.request_id,created.token]),/access denied/);
    assert.equal((await rows('select count(*)::int n from document_requests'))[0].n,0);
    assert.equal((await rows('select count(*)::int n from project_documents where company_id=$1',[C]))[0].n,0);
    await db.exec('reset role'); await actor(STAFF); await db.exec('set role authenticated');
    assert.equal((await rows('select count(*)::int n from document_requests'))[0].n,1,'only explicitly assigned document recipient can read request');
    await assert.rejects(db.query("update document_requests set status='Signed' where id=$1",[created.request_id]),/permission denied/);
    await assert.rejects(db.query('select public.create_document_request($1,$2,$3,$4,$5)',[DOC,'signature','Worker','worker@example.invalid',expires]),/access denied/);
    await db.exec('reset role'); await actor(null); await db.exec('set role anon');
    await assert.rejects(db.exec('select * from document_requests'),/permission denied/);
    await assert.rejects(db.query('select public.document_request_details($1)',['0'.repeat(64)]),/invalid or expired/);
    const detail=await rpc('select public.document_request_details($1) result',[created.token]);
    assert.equal(detail.document_sha256,'f'.repeat(64)); assert.equal(detail.recipient_name,'Assigned Worker');
    assert.equal(detail.recipient_email,undefined,'capability detail omits private recipient address');
    await assert.rejects(db.query('select public.respond_document_request($1,$2,$3,$4,$5)',[created.token,'complete','Worker','',false]),/consent/);
    const signed=await rpc('select public.respond_document_request($1,$2,$3,$4,$5) result',[created.token,'complete','Assigned Worker','Accepted terms',true]);
    assert.equal(signed.status,'Signed'); assert.equal(signed.signer_name,'Assigned Worker');
    const replay=await rpc('select public.respond_document_request($1,$2,$3,$4,$5) result',[created.token,'decline','Different name','changed',false]);
    assert.equal(replay.status,'Signed'); assert.equal(replay.signer_name,'Assigned Worker','recorded signatures cannot be overwritten');
    await db.exec('reset role');
    assert.equal((await rows("select count(*)::int n from document_request_audit where request_id=$1 and event='signed'",[created.request_id]))[0].n,1);
    assert.equal(await rpc('select workflow_private.notification_request_mail_allowed($1,$2,$3) result',[created.request_id,'document_request',workflowLink('document',created.token)]),false,'completed requests are never delivered from pending outbox');
    await actor(OWNER);
    const review=await rpc('select public.create_document_request($1,$2,$3,$4,$5) result',[DOC,'review','Tim Test','client@example.invalid',expires]);
    const renewed=await rpc('select public.refresh_document_request_link($1) result',[review.request_id]);
    await assert.rejects(db.query('select public.document_request_details($1)',[review.token]),/invalid or expired/);
    assert.equal((await rpc('select public.document_request_details($1) result',[renewed.token])).status,'Pending');
    await db.query('select public.cancel_document_request($1)',[review.request_id]);
    await assert.rejects(db.query('select public.document_request_details($1)',[renewed.token]),/invalid or expired/);
    const portal=await rpc('select public.create_warranty_link($1,null,$2) result',[PROJECT,expires]);
    await db.exec('set role authenticated');
    await db.query("insert into warranty_claims(company_id,project_id,title,description,assigned_to) values($1,$2,'Door alignment','Door needs adjustment',$3)",[C,PROJECT,STAFF]);
    await db.exec('reset role');
    let claim=(await rows("select * from warranty_claims where title='Door alignment'"))[0];
    assert.equal(claim.customer_name,'Tim Test'); assert.equal(claim.client_id,CLIENT); assert.equal(claim.created_by,OWNER);
    assert.equal((await rows("select count(*)::int n from notifications where event_key='warranty_assigned' and user_id=$1",[STAFF]))[0].n,1);
    await actor(OTHERSTAFF); await db.exec('set role authenticated');
    assert.equal((await rows('select count(*)::int n from warranty_claims'))[0].n,0,'unassigned workers cannot read warranty cases');
    await db.exec('reset role'); await actor(OWNER);
    await db.query("insert into warranty_updates(company_id,claim_id,message,visible_to_customer) values($1,$2,'Internal cost discussion',false),($1,$2,'Repair scheduled',true)",[C,claim.id]);
    await db.query("update warranty_claims set repair_visit_at=now()+interval '1 day',status='Awaiting Customer',resolution='Door adjusted and checked' where id=$1",[claim.id]);
    await actor(FOREIGN); await db.exec('set role authenticated');
    let portalDetail=await rpc('select public.warranty_portal_details($1) result',[portal.token]);
    assert.ok(!JSON.stringify(portalDetail).includes('Internal cost discussion'));
    assert.ok(JSON.stringify(portalDetail).includes('Repair scheduled'));
    portalDetail=await rpc('select public.respond_warranty_claim($1,$2,$3,$4,$5) result',[portal.token,'confirm',claim.id,'','Repair complete']);
    assert.equal(portalDetail.claims[0].status,'Resolved','valid capability works without trusting unrelated signed-in account');
    portalDetail=await rpc('select public.respond_warranty_claim($1,$2,$3,$4,$5) result',[portal.token,'reopen',claim.id,'','Issue returned']);
    assert.equal(portalDetail.claims[0].status,'Open');
    portalDetail=await rpc('select public.respond_warranty_claim($1,$2,null,$3,$4) result',[portal.token,'create','New issue','New customer-submitted details']);
    assert.equal(portalDetail.claims.length,2);
    await db.exec('reset role'); await actor(OWNER);
    claim=(await rows('select * from warranty_claims where id=$1',[claim.id]))[0];
    assert.equal(claim.updated_by,null,'customer changes do not impersonate an unrelated signed-in user');
    await db.query("update warranty_claims set response_due_at=now()-interval '1 day' where id=$1",[claim.id]);
    await actor(null);
    await db.exec('select notification_private.document_reminders(now())');
    const before=(await rows("select count(*)::int n from notifications where event_key='warranty_response_overdue'"))[0].n;
    await db.exec('select notification_private.document_reminders(now())');
    assert.equal((await rows("select count(*)::int n from notifications where event_key='warranty_response_overdue'"))[0].n,before,'deadline alerts dedupe per local day');
    assert.ok(before>0);
    await actor(OWNER); const newPortal=await rpc('select public.create_warranty_link($1,null,$2) result',[PROJECT,expires]);
    await assert.rejects(db.query('select public.warranty_portal_details($1)',[portal.token]),/invalid or expired/);
    assert.ok((await rpc('select public.warranty_portal_details($1) result',[newPortal.token])).claims.length>0);
    await db.query("update clients set email='corrected-client@example.invalid' where id=$1 and company_id=$2",[CLIENT,C]);
    const correctedPortal=await rpc('select public.create_warranty_link($1,null,$2) result',[PROJECT,expires]);
    const warrantyQueueId=await rpc('select public.email_warranty_link($1,$2) result',[correctedPortal.portal_id,correctedPortal.token]);
    assert.equal((await rows('select payload from notification_private.delivery_outbox where id=$1',[warrantyQueueId]))[0].payload.to,'corrected-client@example.invalid','renewed warranty access uses the current saved project client email');
    assert.equal(await rpc('select workflow_private.notification_request_mail_allowed($1,$2,$3) result',[correctedPortal.portal_id,'warranty_access_'+id(99),workflowLink('warranty',correctedPortal.token)]),true);
    await assert.rejects(db.query('select public.email_warranty_link($1,$2)',[correctedPortal.portal_id,correctedPortal.token]),/wait one minute/,'accidental repeated warranty emails are rate-limited');
    console.log('Verified document version snapshots, consent and immutable signatures, explicit request mail dedupe/cancellation, plan revisions, tenant RLS, customer claim submission/confirmation/reopening and local-day deadline dedupe.');
  } finally { await db.close(); }
});

test('additive restrictive file policies preserve legacy policies and grants while blocking anonymous, foreign and field writes', async () => {
  const db = new PGlite();
  const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const COMPANY=id(1), OTHER=id(2), PROJECT=id(3), OWNER=id(10), ASSIGNED=id(11), UNASSIGNED=id(12), FOREIGN=id(13);
  const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
  const actor = async value => db.query("select set_config('request.jwt.claim.sub',$1,false)", [value || '']);
  const policies = () => rows("select tablename,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('project_documents','project_drawings') and policyname not like 'workflow_project_file_%' order by tablename,policyname");
  const grants = () => rows("select relname,relacl::text from pg_class where oid in ('public.project_documents'::regclass,'public.project_drawings'::regclass) order by relname");
  try {
    await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261003220500_role_based_notifications.sql',import.meta.url),'utf8'));
    await db.exec('create table project_drawings(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,file_name text,file_url text,drawing_type text,title text,revision text,notes text,created_at timestamptz default now())');
    await seedLegacyFilePolicies(db);
    const originalPolicies = await policies(), originalGrants = await grants();
    assert.equal(originalPolicies.length,4);
    assert.ok(originalPolicies.some(policy => policy.roles === '{public}' && policy.qual === 'true' && policy.with_check === 'true'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261004173051_warranty_document_workflows.sql',import.meta.url),'utf8'));
    assert.deepEqual(await policies(),originalPolicies,'every existing policy name, role, operation and expression remains unchanged');
    assert.deepEqual(await grants(),originalGrants,'all legacy table grants remain byte-for-byte unchanged');
    const boundaries=await rows("select tablename,cmd,permissive,roles::text from pg_policies where schemaname='public' and tablename in ('project_documents','project_drawings') and policyname like 'workflow_project_file_%' order by tablename,cmd");
    assert.equal(boundaries.length,10); assert.ok(boundaries.every(policy => policy.permissive === 'RESTRICTIVE'));
    for (const table of ['project_documents','project_drawings']) {
      const scoped = boundaries.filter(policy => policy.tablename === table);
      assert.deepEqual(scoped.map(policy => policy.cmd).sort(),['ALL','DELETE','INSERT','SELECT','UPDATE']);
      assert.ok(scoped.every(policy => policy.roles === (policy.cmd === 'ALL' ? '{public}' : '{authenticated}')));
    }
    await db.query("insert into companies(id,name) values($1,'Test company'),($2,'Other company')",[COMPANY,OTHER]);
    await db.query("insert into profiles(id,company_id,role,full_name,is_active) values($1,$2,'owner','Owner',true),($3,$2,'employee','Assigned',true),($4,$2,'employee','Unassigned',true),($5,$6,'owner','Foreign owner',true)",[OWNER,COMPANY,ASSIGNED,UNASSIGNED,FOREIGN,OTHER]);
    await db.query("insert into projects(id,company_id,name) values($1,$2,'Test project')",[PROJECT,COMPANY]);
    await db.query('insert into project_staff(company_id,project_id,user_id,is_active) values($1,$2,$3,true)',[COMPANY,PROJECT,ASSIGNED]);
    await actor(OWNER); await db.exec('set role authenticated');
    for (const [index,table] of ['project_documents','project_drawings'].entries()) {
      const recordId=id(20+index);
      await db.query(`insert into public.${table}(id,company_id,project_id,file_name,file_url) values($1,$2,$3,'Safe.pdf','https://files.example.invalid/safe.pdf')`,[recordId,COMPANY,PROJECT]);
      assert.equal((await rows(`select count(*)::int n from public.${table}`))[0].n,1,'permitted staff can insert and read');
      assert.equal((await rows(`update public.${table} set file_name='Staff update.pdf' where id=$1 returning id`,[recordId])).length,1,'permitted staff can update');
      await db.query(`insert into public.${table}(id,company_id,project_id,file_name,file_url) values($1,$2,$3,'Temporary.pdf','https://files.example.invalid/temporary.pdf')`,[id(30+index),COMPANY,PROJECT]);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id(30+index)])).length,1,'permitted staff can delete');
    }
    await db.exec('reset role');
    for (const user of [FOREIGN,UNASSIGNED,null]) {
      await actor(user); await db.exec(user ? 'set role authenticated' : 'set role anon');
      for (const table of ['project_documents','project_drawings']) {
        assert.equal((await rows(`select count(*)::int n from public.${table}`))[0].n,0,'anonymous, foreign and unassigned accounts cannot read through the preserved true policy');
        assert.equal((await rows(`update public.${table} set file_name='Denied' returning id`)).length,0);
        assert.equal((await rows(`delete from public.${table} returning id`)).length,0);
        await assert.rejects(db.query(`insert into public.${table}(company_id,project_id,file_name,file_url) values($1,$2,'Denied.pdf','https://files.example.invalid/denied.pdf')`,[COMPANY,PROJECT]),/access denied|row-level security/i);
      }
      await db.exec('reset role');
    }
    await actor(ASSIGNED); await db.exec('set role authenticated');
    for (const table of ['project_documents','project_drawings']) {
      assert.equal((await rows(`select count(*)::int n from public.${table}`))[0].n,1,'active assigned field accounts retain project-file read access');
      assert.equal((await rows(`update public.${table} set file_name='Field write' returning id`)).length,0);
      assert.equal((await rows(`delete from public.${table} returning id`)).length,0);
      await assert.rejects(db.query(`insert into public.${table}(company_id,project_id,file_name,file_url) values($1,$2,'Field write.pdf','https://files.example.invalid/field.pdf')`,[COMPANY,PROJECT]),/access denied|row-level security/i);
    }
    await db.exec('reset role'); await actor(OWNER); await db.query('update profiles set is_active=false where id=$1',[ASSIGNED]);
    await actor(ASSIGNED); await db.exec('set role authenticated');
    for (const table of ['project_documents','project_drawings']) assert.equal((await rows(`select count(*)::int n from public.${table}`))[0].n,0,'inactive assignments do not retain reads');
    await db.exec('reset role'); await actor(OWNER); await db.query('update profiles set is_active=true where id=$1',[ASSIGNED]);
    // An anonymous SQL role must not inherit private-table access from a retained UID.
    await actor(ASSIGNED); await db.exec('set role anon');
    for (const table of ['project_documents','project_drawings']) assert.equal((await rows(`select count(*)::int n from public.${table}`))[0].n,0);
    await db.exec('reset role');
    assert.deepEqual(await policies(),originalPolicies); assert.deepEqual(await grants(),originalGrants);
    assert.equal((await rows("select has_table_privilege('anon','public.project_documents','SELECT') allowed"))[0].allowed,true,'anonymous denial comes from the restrictive boundary, not revoked grants');
  } finally { await db.close(); }
});
