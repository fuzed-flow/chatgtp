import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {transform} from 'esbuild';

const local = name => fileURLToPath(new URL(name, import.meta.url));
const schema = await fs.readFile(local('./schema.sql'), 'utf8');
const baseMigration = await fs.readFile(local('../../supabase/migrations/20261004052410_help_center_refresh.sql'), 'utf8');
const portalMigration = await fs.readFile(local('../../supabase/migrations/20261004070726_help_articles_portal_schema.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('current long guides retrieve relevant bounded sections, retain roles, and need no embedding', async () => {
  const db = new PGlite({extensions: {vector}});
  try {
    await db.exec(schema);
    await db.exec(baseMigration);
    await db.exec(portalMigration);
    await db.exec(portalMigration);
    await db.query("insert into profiles(id,company_id,role) values($1,$3,'owner'),($2,$3,'employee')", [id(1), id(2), id(99)]);
    const body = 'Use this verified guide to review in-app alerts.\n\n' +
      '## Importing suppliers\n' + 'Unrelated purchasing instructions. '.repeat(180) +
      '\n## Missing notification alerts\nCheck **Unread**, then choose **All**. A missing notification can be a read alert.\n' +
      '\n## Notification history\nUse **Read** to review notification history.\n' +
      '\n## Exporting vendors\n' + 'Unrelated vendor export instructions. '.repeat(120);
    await db.query("insert into help_faqs(slug,feature_area,audience,question,answer_short,answer_long,article_type,read_minutes,related_slugs) values('guide-notification-test','Notifications','all','Troubleshoot notifications','Review alerts.',$1,'guide',5,ARRAY['notification-missing'])", [body]);
    await db.query("insert into help_faqs(slug,feature_area,audience,question,answer_short,answer_long,article_type,requires_admin) values('guide-admin-test','Team','admin','Secret payroll controls','Admin steps.','## Secret payroll controls\nOwner-only synthetic test instructions.','guide',true)");
    await db.query("insert into help_faqs(slug,feature_area,audience,question,answer_short,answer_long) values('faq-long-test','Help & Support','all','Bounded aubergine FAQ','Aubergine summary',$1)", ['Aubergine FAQ text. '.repeat(500)]);
    const defaults = (await db.query("select article_type,read_minutes,related_slugs from help_faqs where slug='help-search-tips'")).rows[0];
    assert.deepEqual(defaults, {article_type: 'faq', read_minutes: 2, related_slugs: []});
    const actor = async who => {
      await db.exec('RESET ROLE');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
      await db.exec('SET ROLE authenticated');
    };
    await actor(id(1));
    const result = (await db.query("select * from search_help_articles('missing notification',null,null,8) where slug='guide-notification-test'")).rows[0];
    assert.ok(result, 'new guide with null embedding is retrieved immediately');
    assert.match(result.answer, /## Missing notification alerts/);
    assert.match(result.answer, /choose \*\*All\*\*/);
    assert.ok(result.answer.length <= 6000);
    assert.doesNotMatch(result.answer, /Importing suppliers|Exporting vendors/);
    assert.equal((await db.query("select length(answer)::int as size from search_help_articles('aubergine',null,null,8) where slug='faq-long-test'")).rows[0].size, 6000);
    assert.equal((await db.query("select count(*)::int as count from search_help_articles('galactic pineapple',null,null,8)")).rows[0].count, 0);
    assert.equal((await db.query("select slug from search_help_articles('secret payroll',null,null,8) where slug='guide-admin-test'")).rows.length, 1);
    await actor(id(2));
    assert.equal((await db.query("select * from help_faqs where slug='guide-admin-test'")).rows.length, 0);
    assert.equal((await db.query("select slug from search_help_articles('secret payroll',null,null,8) where slug='guide-admin-test'")).rows.length, 0);
    assert.equal((await db.query("select slug from search_help_articles('missing notification',null,null,8) where slug='guide-notification-test'")).rows.length, 1);
    await assert.rejects(() => db.query("update help_faqs set answer_long='tampered'"), /permission denied/);
    await db.exec('RESET ROLE');
    await db.query("update help_faqs set answer_long='Current canonical guide.\n\n## Missing notification recovery\nThe fresh current answer uses the bell filter.' where slug='guide-notification-test'");
    await actor(id(1));
    const updated = (await db.query("select answer from search_help_articles('missing notification recovery',null,null,8) where slug='guide-notification-test'")).rows[0].answer;
    assert.match(updated, /fresh current answer/);
    assert.doesNotMatch(updated, /choose \*\*All\*\*/);
    await db.exec('RESET ROLE');
    await assert.rejects(() => db.query("update help_faqs set article_type='invalid' where slug='guide-notification-test'"), /check constraint/);
    await assert.rejects(() => db.query("update help_faqs set read_minutes=0 where slug='guide-notification-test'"), /check constraint/);
    const vectorValue = JSON.stringify([1, ...Array(1535).fill(0)]);
    await db.query("update help_faqs set embedding=$1::vector where slug='guide-admin-test'", [vectorValue]);
    await actor(id(2));
    assert.equal((await db.query("select slug from search_help_articles('galactic pineapple',$1::vector,null,8) where slug='guide-admin-test'", [vectorValue])).rows.length, 0, 'embedding similarity cannot reveal denied articles');
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(() => db.query("select * from search_help_articles('notifications',null,null,8)"), /permission denied/);
  } finally {
    await db.close();
  }
});

const edgeSource = await fs.readFile(local('../../supabase/functions/ai-help/index.ts'), 'utf8');
const edgeJavascript = (await transform(edgeSource.replace(/^import .*\n/gm, ''), {loader: 'ts', format: 'iife'})).code;
const edgeFixture = ({articles = [], embeddingFails = false, profile = {role: 'owner', company_id: id(99), is_active: true}, invalidUser = false} = {}) => {
  const observed = {embeddingInputs: [], rpc: [], completions: [], clients: [], tokens: []};
  let handler;
  const createClient = (...args) => {
    observed.clients.push(args);
    return {
      auth: {getUser: async token => {observed.tokens.push(token); return {data: {user: invalidUser ? null : {id: id(1)}}, error: null};}},
      from: () => ({select: () => ({eq: () => ({maybeSingle: async () => ({data: profile, error: null})})})}),
      rpc: async (name, params) => {observed.rpc.push({name, params}); return {data: articles, error: null};},
    };
  };
  class OpenAI {
    embeddings = {create: async params => {
      observed.embeddingInputs.push(params.input);
      if (embeddingFails) throw new Error('synthetic outage');
      return {data: [{embedding: [1]}]};
    }};
    chat = {completions: {create: async params => {
      observed.completions.push(params);
      return {choices: [{message: {content: 'Verified synthetic answer.'}}]};
    }}};
  }
  const env = {SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'public-anon-key', OPENAI_API_KEY: 'test-only'};
  new Function('serve', 'createClient', 'OpenAI', 'Deno', 'Response', 'console', edgeJavascript)(
    fn => {handler = fn;}, createClient, OpenAI, {env: {get: name => env[name]}}, Response, {warn() {}, error() {}},
  );
  const request = (body, authorized = true) => handler(new Request('https://edge.example/ai-help', {
    method: 'POST', headers: {'Content-Type': 'application/json', ...(authorized ? {Authorization: 'Bearer user-jwt'} : {})}, body: JSON.stringify(body),
  }));
  return {request, observed};
};

test('AI retrieves vague follow-ups from user context, bounds current excerpts, and links the portal', async () => {
  const articles = Array.from({length: 6}, (_, n) => ({slug: 'guide-' + n, question: 'Synthetic guide ' + n, feature_area: 'Notifications', answer: 'Verified current content. '.repeat(500)}));
  const {request, observed} = edgeFixture({articles});
  const response = await request({query: 'What if it is missing?', currentPath: '/LeadTracker', history: [
    {role: 'user', content: 'I created a lead and did not get a notification.'},
    {role: 'assistant', content: 'Hallucinated galaxy transport feature.'},
  ]});
  assert.equal(response.status, 200);
  assert.match(observed.embeddingInputs[0], /created a lead/);
  assert.match(observed.rpc[0].params.query_text, /What if it is missing/);
  assert.doesNotMatch(observed.rpc[0].params.query_text, /galaxy/);
  assert.equal(observed.rpc[0].params.match_count, 4);
  assert.equal(observed.clients[0][1], 'public-anon-key');
  assert.equal(observed.clients[0][2].global.headers.Authorization, 'Bearer user-jwt');
  assert.deepEqual(observed.tokens, ['user-jwt']);
  const completion = observed.completions[0];
  assert.equal(completion.max_tokens, 1100);
  const context = completion.messages[0].content.split('Verified help articles:\n')[1];
  assert.ok(context.length <= 20000);
  assert.match(context, /\/HelpArticles\?article=guide-0/);
  assert.doesNotMatch(context, /\/FAQ\?/);
  assert.ok(context.includes('guide-3'));
  assert.ok(!context.includes('guide-4'));
  const payload = await response.json();
  assert.equal(payload.sources.length, 3);
  assert.deepEqual(payload.sources[0], {slug: 'guide-0', question: 'Synthetic guide 0'});
  await request({query: 'How do I create a quote?', history: [{role: 'user', content: 'Earlier notification question.'}]});
  assert.equal(observed.embeddingInputs[1], 'How do I create a quote?');
  await request({query: 'Tell me more', history: [{role: 'user', content: 'How do I filter PM tasks by user?'}]});
  assert.match(observed.embeddingInputs[2], /filter PM tasks by user/);
});

test('AI authenticates before reading, uses lexical fallback, and declines uncovered requests', async () => {
  const noAuth = edgeFixture();
  assert.equal((await noAuth.request({query: 'Notifications'}, false)).status, 401);
  assert.equal(noAuth.observed.clients.length, 0);
  const invalid = edgeFixture({invalidUser: true});
  assert.equal((await invalid.request({query: 'Notifications'})).status, 401);
  assert.equal(invalid.observed.rpc.length, 0);
  const inactive = edgeFixture({profile: {role: 'owner', company_id: id(99), is_active: false}});
  assert.equal((await inactive.request({query: 'Notifications'})).status, 403);
  assert.equal(inactive.observed.rpc.length, 0);
  const fallback = edgeFixture({embeddingFails: true});
  const response = await fallback.request({query: 'Notifications'});
  assert.equal(response.status, 200);
  assert.equal(fallback.observed.rpc[0].params.query_embedding, null);
  assert.equal(fallback.observed.completions.length, 0);
  assert.match((await response.json()).reply, /Help Articles.*\/HelpArticles/);
  const oversized = edgeFixture();
  assert.equal((await oversized.request({query: 'a'.repeat(2001)})).status, 400);
  assert.equal(oversized.observed.embeddingInputs.length, 0);
});
