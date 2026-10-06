import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
import {fileURLToPath} from 'node:url';
import {canReadHelp,findHelpArticles,helpPageRoute} from '../../src/lib/helpContent.js';
const local=name=>fileURLToPath(new URL(name,import.meta.url));
const helpCatalog=JSON.parse(await fs.readFile(local('./browser/articles.json'),'utf8'));
const articles=helpCatalog.filter(article=>(article.article_type||'faq')==='faq');
const viewAccessMigration=await fs.readFile(local('../../supabase/migrations/20261004065128_help_embedding_view_access.sql'),'utf8');

test('invoice delivery help matches secure link, save, template and status behavior',()=>{
 const bySlug=slug=>{
  const article=helpCatalog.find(item=>item.slug===slug);
  assert.ok(article,`Missing help article: ${slug}`);
  return `${article.answer_short}\n${article.answer_long}`;
 };
 const emailTemplate=bySlug('invoice-email-template');
 const emailSend=bySlug('send-invoice-email');
 const smsSend=bySlug('send-invoice-sms');
 const smsLink=bySlug('invoice-sms-link');
 const statuses=bySlug('invoice-statuses');
 const sharingGuide=bySlug('guide-invoices-share-customer-pay');

 assert.match(emailTemplate,/auto-fills the recipient, subject, message and signature/i);
 assert.match(emailTemplate,/\{\{balance_due\}\}/);
 assert.match(emailSend,/saves them before opening the send dialog/i);
 assert.match(smsSend,/saves any pending edits before opening the dialog/i);
 assert.match(smsSend,/Retry text.*same captured message and request.*duplicate/s);
 assert.match(smsSend,/Retry status.*does not send the text again/s);
 for(const content of [emailSend,smsSend,smsLink,sharingGuide]){
  assert.match(content,/invoice ID and private token/i);
  assert.match(content,/invalid or (?:has been )?revoked/i);
  assert.match(content,/resend the invoice/i);
 }
 assert.match(emailSend,/does not attach a PDF or include an Access Client Portal link/i);
 assert.match(emailSend,/same formatted email and private link, without a PDF attachment/i);
 assert.match(sharingGuide,/company copy has the same formatted body and private invoice link/i);
 assert.match(sharingGuide,/copy does not contain one either/i);
 for(const content of [emailSend,smsSend,statuses,sharingGuide]){
  assert.match(content,/only (?:a )?\*\*Draft\*\*.*\*\*Sent\*\*/s);
  assert.match(content,/Partial.*Paid.*Overdue/s);
 }
});

test('help policies and canonical search enforce current roles and include articles without embeddings',async()=>{
 const db=new PGlite({extensions:{vector}});
 try{
  await db.exec(await fs.readFile(local('./schema.sql'),'utf8'));
  const roles=['owner','admin','manager','office','employee','subcontractor','user'];
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  for(let i=0;i<roles.length;i++)await db.query('insert into profiles(id,company_id,role) values($1,$2,$3)',[id(i+1),id(99),roles[i]]);
  await db.query("insert into profiles(id,company_id,role,is_active) values($1,$2,'owner',false),($3,null,'owner',true)",[id(20),id(99),id(21)]);
  await db.query("insert into help_faqs(id,slug,feature_area,audience,question,answer_short,answer_long,requires_admin) values($1,'quote-lock','Quotes','all','What does Quote is Currently Locked mean?','Old incorrect lock promise','Old incorrect lock promise',false)",[id(40)]);
  const migration=await fs.readFile(local('../../supabase/migrations/20261004052410_help_center_refresh.sql'),'utf8');
  await db.exec(migration);
  await db.exec(migration); // replay does not duplicate articles or change existing IDs
  await db.exec(viewAccessMigration);
  assert.equal((await db.query("select id,is_active from help_faqs where slug='quote-lock'")).rows[0].id,id(40));
  assert.equal((await db.query("select is_active from help_faqs where slug='quote-lock'")).rows[0].is_active,false);
  const dbArticles=(await db.query('select * from help_faqs where is_active')).rows;
  const actor=async(who)=>{await db.exec('RESET ROLE');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who||'']);await db.exec('SET ROLE authenticated');};
  for(let i=0;i<roles.length;i++){
   await actor(id(i+1));
   const visible=(await db.query('select slug from help_faqs order by slug')).rows.map(x=>x.slug);
   assert.deepEqual(visible,dbArticles.filter(x=>canReadHelp(x,roles[i])).map(x=>x.slug).sort(),roles[i]);
   const found=(await db.query("select * from search_help_articles('filter assigned person',null,'/PMProjects',5)")).rows;
   assert.equal(found.some(x=>x.slug==='pm-task-assignee-filter'),['owner','admin','manager','office'].includes(roles[i]),'PM filter respects office audience');
   assert.ok((await db.query("select * from search_help_articles('notifications missing',null,'/FAQ',5)")).rows.length,'new unembedded help is searchable');
   assert.ok(!(await db.query("select slug from search_help_articles('team roles',null,null,8)")).rows.some(x=>x.slug==='team-roles')||['owner','admin'].includes(roles[i]));
  }
  for(const who of [id(20),id(21),null]){await actor(who);assert.equal((await db.query('select * from help_faqs')).rows.length,0);}
  await db.exec('RESET ROLE');
  const vec=JSON.stringify([1,...Array(1535).fill(0)]);
  await db.query("update help_faqs set embedding=$1::vector where slug='notification-missing'",[vec]);
  await actor(id(1));
  assert.equal((await db.query("select slug from search_help_articles('unrelated vocabulary',$1::vector,null,1)",[vec])).rows[0].slug,'notification-missing');
  await db.exec('RESET ROLE');
  await db.query("update help_faqs set answer_long='Current canonical answer: use All users.' where slug='pm-task-assignee-filter'");
  await actor(id(1));
  assert.equal((await db.query("select answer from search_help_articles('assigned person',null,null,5) where slug='pm-task-assignee-filter'")).rows[0].answer,'Current canonical answer: use All users.');
  await assert.rejects(()=>db.query("update help_faqs set answer_short='tampered'"),/permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon;');
  await assert.rejects(()=>db.query('select * from help_faqs'),/permission denied/);
  await assert.rejects(()=>db.query("select * from search_help_articles('notifications',null,null,5)"),/permission denied/);
 }finally{await db.close();}
});

test('embedding maintenance view cannot bypass role policies or accept public writes',async()=>{
 const db=new PGlite({extensions:{vector}});
 try{
  await db.exec(await fs.readFile(local('./schema.sql'),'utf8'));
  await db.exec(await fs.readFile(local('../../supabase/migrations/20261004052410_help_center_refresh.sql'),'utf8'));
  await db.query("insert into knowledge_chunks(slug,title,content,feature_area,requires_admin,audience) values('restricted-content','Internal team guidance','Admin-only guidance','Team',true,'admin')");
  // Before the fix, table RLS is ineffective through the public definer view.
  await db.exec('SET ROLE anon');
  assert.equal((await db.query('select title from knowledge_chunks_needing_embedding')).rows[0].title,'Internal team guidance');
  await db.exec('RESET ROLE');
  await db.exec(viewAccessMigration);
  await db.exec(viewAccessMigration); // repeat deployment safely
  const options=(await db.query("select reloptions from pg_class where oid='public.knowledge_chunks_needing_embedding'::regclass")).rows[0].reloptions;
  assert.ok(options.includes('security_invoker=true'));
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(()=>db.query('select * from knowledge_chunks_needing_embedding'),/permission denied/);
   await assert.rejects(()=>db.query("insert into knowledge_chunks_needing_embedding(slug,title) values('tampered','Tampered')"),/permission denied/);
   await assert.rejects(()=>db.query("update knowledge_chunks_needing_embedding set content='Tampered'"),/permission denied/);
   await assert.rejects(()=>db.query('delete from knowledge_chunks_needing_embedding'),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  assert.equal((await db.query('select content from knowledge_chunks_needing_embedding')).rows[0].content,'Admin-only guidance');
  await db.exec('RESET ROLE');
  await db.exec('DROP VIEW knowledge_chunks_needing_embedding');
  await db.exec(viewAccessMigration); // compatible with databases lacking the view
 }finally{await db.close();}
});

test('FAQ finds full answers, offers safe links, expands accessible steps and recovers from load errors',async()=>{
 assert.equal(helpPageRoute('//external.example','owner'),null);
 assert.equal(helpPageRoute('/Tasks','employee'),'/EmployeePortal?tab=tasks');
 assert.equal(helpPageRoute('/AdminSettings','office'),null);
 assert.ok(findHelpArticles([{question:'Test',answer_long:'A unique search token',feature_area:'Account'}],'unique token').length);
 const bundle=await build({entryPoints:[local('./browser/main.jsx')],bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'},alias:{'@/api/supabaseClient':local('./browser/mockDb.js'),'@/lib/AuthContext':local('./browser/mockAuth.jsx'),'@':local('../../src')},loader:{'.css':'empty'}});
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e.message);});
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.example/FAQ?article=pm-task-assignee-filter',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,d=w.document;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Expected help UI state: '+d.body.textContent);};
 const button=text=>[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
 const input=(el,value)=>{const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 try{
  w.eval(bundle.outputFiles[0].text);
  await wait(()=>d.querySelector('[aria-expanded="true"]'));
  assert.match(d.querySelector('[role="region"]:not([hidden])').textContent,/Choose Staff & Tasks/);
  assert.ok(d.querySelector('[role="region"]:not([hidden]) ol'));
  input(d.querySelector('#help-search'),'overwriting');
  await wait(()=>d.body.textContent.includes('Can two people edit the same quote'));
  d.querySelector('[aria-label="Clear search"]').click();await wait(()=>d.querySelectorAll('article').length===18);
  button('Show more answers ('+(articles.filter(a=>a.is_active!==false).length-18)+' remaining)').click();
  await wait(()=>d.querySelectorAll('article').length===36);
  const select=d.querySelector('[aria-label="Preview role"]');select.value='employee';select.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(()=>[...d.querySelector('#help-topic').options].some(x=>x.value==='Employee Portal'));
  assert.ok(![...d.querySelector('#help-topic').options].some(x=>x.value==='Quotes'));
  assert.ok([...d.querySelector('#help-topic').options].some(x=>x.value==='Employee Portal'));
  button('Simulate load error').click();await wait(()=>d.querySelector('[role="alert"]'));
  assert.match(d.querySelector('[role="alert"]').textContent,/couldn't load/);
  button('Try again').click();await wait(()=>!d.querySelector('[role="alert"]')&&d.querySelectorAll('article').length>0);
  [...d.querySelectorAll('a')].find(link=>link.textContent.trim()==='Contact support').click();
  await wait(()=>d.querySelector('#support-subject'));
  input(d.querySelector('#support-subject'),'Help with my task');
  input(d.querySelector('#support-message'),'I cannot find my assignment.');
  d.querySelector('#support-subject').closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>d.body.textContent.includes('Review it and tap Send there'));
  assert.ok(d.querySelector('a[href="mailto:support@fuzedflow.com"]'));
  assert.ok(d.querySelector('a[href="tel:+18554003000"]'));
  assert.deepEqual(errors,[]);
 }finally{w.close();}
});
