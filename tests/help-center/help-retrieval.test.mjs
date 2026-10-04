import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {transform} from 'esbuild';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import {renderToStaticMarkup} from 'react-dom/server';
import {getAllowedHelpLinks, isAllowedHelpLink, sanitizeHelpLinks} from '../../supabase/functions/_shared/helpLinks.js';

const local = name => fileURLToPath(new URL(name, import.meta.url));
const schema = await fs.readFile(local('./schema.sql'), 'utf8');
const baseMigration = await fs.readFile(local('../../supabase/migrations/20261004052410_help_center_refresh.sql'), 'utf8');
const portalMigration = await fs.readFile(local('../../supabase/migrations/20261004070726_help_articles_portal_schema.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const renderedHrefs = markdown => [...renderToStaticMarkup(React.createElement(ReactMarkdown, {skipHtml: true}, markdown)).matchAll(/href="([^"]*)"/g)].map(match => match[1].replaceAll('&amp;', '&'));

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
const edgeFixture = ({articles = [], embeddingFails = false, profile = {role: 'owner', company_id: id(99), is_active: true}, invalidUser = false, modelReply = 'Verified synthetic answer.'} = {}) => {
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
      return {choices: [{message: {content: modelReply}}]};
    }}};
  }
  const env = {SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'public-anon-key', OPENAI_API_KEY: 'test-only'};
  new Function('serve', 'createClient', 'OpenAI', 'Deno', 'Response', 'console', 'getAllowedHelpLinks', 'isAllowedHelpLink', 'sanitizeHelpLinks', edgeJavascript)(
    fn => {handler = fn;}, createClient, OpenAI, {env: {get: name => env[name]}}, Response, {warn() {}, error() {}}, getAllowedHelpLinks, isAllowedHelpLink, sanitizeHelpLinks,
  );
  const request = (body, authorized = true) => handler(new Request('https://edge.example/ai-help', {
    method: 'POST', headers: {'Content-Type': 'application/json', ...(authorized ? {Authorization: 'Bearer user-jwt'} : {})}, body: JSON.stringify(body),
  }));
  return {request, observed};
};

test('AI retrieves vague follow-ups from user context, bounds current excerpts, and links the portal', async () => {
  const articles = Array.from({length: 6}, (_, n) => ({slug: 'guide-' + n, question: 'Synthetic guide ' + n, feature_area: 'Notifications', answer: 'Verified current content. '.repeat(500)}));
  const {request, observed} = edgeFixture({articles});
  const response = await request({query: 'What if it is missing?', currentPath: '/LeadTracker?client_id=private-client-record', history: [
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
  assert.doesNotMatch(completion.messages[0].content, /private-client-record|\/LeadTracker|\"owner\"/);
  assert.ok(!completion.messages[0].content.includes(id(1)));
  assert.ok(!completion.messages[0].content.includes(id(99)));
  assert.equal(observed.rpc[0].params.current_path, '/LeadTracker?client_id=private-client-record');
  const context = completion.messages[0].content.split('Verified help articles:\n')[1];
  assert.ok(context.length <= 20000);
  assert.match(context, /\/HelpArticles\?article=guide-0/);
  assert.doesNotMatch(context, /\/FAQ\?/);
  assert.ok(context.includes('guide-3'));
  assert.ok(!context.includes('guide-4'));
  const payload = await response.json();
  assert.equal(payload.sources.length, 3);
  assert.deepEqual(payload.sources[0], {slug: 'guide-0', question: 'Synthetic guide 0'});
  assert.ok(payload.allowedLinks.some(link => link.href === '/HelpArticles?article=guide-0'));
  assert.ok(!payload.allowedLinks.some(link => link.href === '/HelpArticles?article=guide-4'));
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
  const noMatch = await response.json();
  assert.match(noMatch.reply, /Help Articles.*\/HelpArticles/);
  assert.deepEqual(noMatch.sources, []);
  assert.ok(noMatch.allowedLinks.some(link => link.href === '/HelpArticles'));
  assert.ok(noMatch.allowedLinks.some(link => link.href === '/Contact'));
  assert.ok(!noMatch.allowedLinks.some(link => /[?&]article=/.test(link.href)));
  const oversized = edgeFixture();
  assert.equal((await oversized.request({query: 'a'.repeat(2001)})).status, 400);
  assert.equal(oversized.observed.embeddingInputs.length, 0);
});

test('AI server preserves confirmed targets and removes invented, external, malformed, and historical links', async () => {
  const articles = [{slug: 'guide-lead-test', question: 'Lead troubleshooting', feature_area: 'Leads', route: '/LeadTracker', answer: 'Check the saved lead and clear filters.'}];
  const modelReply = [
    '[Verified article](/HelpArticles?article=guide-lead-test)',
    '[Unsupported feature shortcut](/LeadTracker)',
    '[Support](/Contact)',
    '[Invented article](/HelpArticles?article=guide-warranty-tracker)',
    '[Earlier article](/HelpArticles?article=guide-history-test)',
    '[Unavailable warranty page](/WarrantyClaims)',
    '[Recordless detail](/LeadDetail)',
    '[Fabricated detail record](/LeadDetail?id=made-up-record)',
    '[Unconfirmed list query](/LeadTracker?lead_id=made-up-record)',
    '[External site](https://example.com/help)',
    '[External application URL](https://app.fuzedflow.com/HelpArticles?article=guide-lead-test)',
    '[Protocol-relative](//example.com/help)',
    '[Encoded route](/%48elpArticles?article=guide-lead-test)',
    '[Unconfirmed fragment](/HelpArticles?article=guide-lead-test#made-up-section)',
    '[Malformed route](/HelpArticles?article=guide-lead-test&redirect=https://example.com)',
    '[Script link](javascript:alert%281%29)',
    '[Email link](mailto:unconfirmed@example.com)',
    '[Nested **label** [note]](/WarrantyClaims)',
    '[Angle target](</WarrantyClaims>)',
    '[Title variant](/WarrantyClaims "not a real page")',
    '[Wrapped target](\n/WarrantyClaims\n)',
    '[Reference invention][fabricated]\n\n[fabricated]: /HelpArticles?article=guide-fake-reference',
    '[Confirmed reference][current]\n\n[current]: /HelpArticles?article=guide-lead-test',
    '<https://example.com/automatic>',
    'Bare external URL: https://example.com/bare',
    'Bare guessed internal URL: /HelpArticles?article=guide-bare-invention',
    '<a href="/WarrantyClaims">HTML invention</a>',
  ].join('\n\n');
  const {request} = edgeFixture({articles, modelReply});
  const payload = await (await request({query: 'Help with this', history: [
    {role: 'user', content: 'Previously I read [Earlier article](/HelpArticles?article=guide-history-test).'},
    {role: 'assistant', content: '[Unsupported prior advice](/WarrantyClaims)'},
  ]})).json();
  assert.match(payload.reply, /\[Verified article\]\(\/HelpArticles\?article=guide-lead-test\)/);
  assert.match(payload.reply, /\[Support\]\(\/Contact\)/);
  for (const label of ['Invented article', 'Earlier article', 'Unavailable warranty page', 'Recordless detail', 'External site', 'Reference invention', 'HTML invention']) assert.ok(payload.reply.includes(label), 'Unsafe links retain their readable labels: ' + label);
  for (const target of ['guide-warranty-tracker', 'guide-history-test', '/WarrantyClaims', '/LeadDetail', '/LeadTracker', 'made-up-record', '/%48elpArticles', 'made-up-section', 'guide-fake-reference', 'guide-bare-invention', 'example.com', 'fuzedflow.com', 'javascript:']) assert.ok(!payload.reply.includes(target), 'Unconfirmed target removed: ' + target);
  const hrefs = renderedHrefs(payload.reply);
  assert.ok(hrefs.length >= 3, 'Confirmed links remain usable.');
  assert.ok(hrefs.every(href => isAllowedHelpLink(href, payload.allowedLinks) === href), 'The server reply has no clickable target outside its exact confirmed links.');
  assert.ok(hrefs.includes('/HelpArticles?article=guide-lead-test'));
  assert.ok(!hrefs.some(href => href.includes('example.com') || href.includes('fuzedflow.com') || href.startsWith('mailto:')));
  assert.deepEqual(payload.sources, [{slug: 'guide-lead-test', question: 'Lead troubleshooting'}]);
  assert.ok(payload.allowedLinks.some(link => link.href === '/HelpArticles?article=guide-lead-test'));
  assert.ok(!payload.allowedLinks.some(link => link.href === '/LeadTracker'));
  assert.ok(!payload.allowedLinks.some(link => link.href.includes('history-test') || link.href.includes('Warranty')));
});

test('AI link metadata permits retrieved guides and unconditional help pages without feature or record navigation', async () => {
  const articles = [{slug: 'guide-field-test', question: 'My assigned tasks', feature_area: 'Tasks', route: '/EmployeePortal?tab=tasks', answer: 'Open My Tasks to review your assignment.'}];
  const {request} = edgeFixture({articles, profile: {role: 'employee', company_id: id(99), is_active: true}, modelReply: [
    '[My tasks](/EmployeePortal?tab=tasks)',
    '[Field guide](/HelpArticles?article=guide-field-test)',
    '[Quick answers](/FAQ)',
    '[Video guidance](/Tutorials)',
    '[Office quotes](/Quotes)',
    '[HR](/HumanResources)',
    '[Company settings](/AdminSettings)',
    '[Restricted guide](/HelpArticles?article=guide-admin-test)',
  ].join('\n')});
  const payload = await (await request({query: 'What should I do next?'})).json();
  assert.doesNotMatch(payload.reply, /\/EmployeePortal/);
  assert.match(payload.reply, /\[Field guide\]\(\/HelpArticles\?article=guide-field-test\)/);
  assert.match(payload.reply, /\[Quick answers\]\(\/FAQ\)/);
  assert.match(payload.reply, /\[Video guidance\]\(\/Tutorials\)/);
  assert.doesNotMatch(payload.reply, /\/Quotes|\/HumanResources|\/AdminSettings|guide-admin-test/);
  assert.deepEqual(payload.allowedLinks.map(link => link.href).sort(), ['/HelpArticles', '/FAQ', '/Contact', '/Tutorials', '/HelpArticles?article=guide-field-test'].sort());
  assert.ok(payload.allowedLinks.every(link => typeof link.href === 'string' && typeof link.label === 'string'));
});

test('AI server removes multiline reference destinations before Markdown decodes entities or relative URLs', async () => {
  const articles = [{slug: 'guide-current-test', question: 'Verified current guide', feature_area: 'Help & Support', answer: 'Use the published article.'}];
  const destinations = [
    'https&#58;&#47;&#47;evil.example',
    '../WarrantyClaims',
    '?article=forged',
    './HelpArticles?article=forged',
    '&#x2f;WarrantyClaims',
  ];
  const styles = [
    {link: '[Unsafe shortcut]', definition: '[Unsafe shortcut]'},
    {link: '[Unsafe explicit][ref]', definition: '[ref]'},
    {link: '[Unsafe collapsed][]', definition: '[Unsafe collapsed]'},
  ];
  for (const destination of destinations) {
    for (const style of styles) {
      const modelReply = `[Verified article](/HelpArticles?article=guide-current-test)\n\n${style.link}\n\n${style.definition}:\n ${destination}`;
      const {request} = edgeFixture({articles, modelReply});
      const response = await request({query: 'Explain the verified guide'});
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.ok(payload.reply.includes('Unsafe'), 'The readable reference label remains.');
      assert.ok(!payload.reply.includes(destination), 'The raw API body removes the multiline destination: ' + destination);
      const hrefs = renderedHrefs(payload.reply);
      assert.deepEqual(hrefs, ['/HelpArticles?article=guide-current-test'], `${style.link} cannot establish a destination after Markdown parsing: ${destination}`);
      assert.ok(hrefs.every(href => isAllowedHelpLink(href, payload.allowedLinks) === href));
      assert.deepEqual(payload.sources, [{slug: 'guide-current-test', question: 'Verified current guide'}]);
    }
  }
  const {request} = edgeFixture({articles, modelReply: '[Confirmed shortcut]\n\n[Confirmed shortcut]:\n /HelpArticles?article=guide-current-test\n "Current guide"'});
  const payload = await (await request({query: 'Explain the verified guide'})).json();
  assert.deepEqual(renderedHrefs(payload.reply), ['/HelpArticles?article=guide-current-test'], 'An exact confirmed multiline reference remains usable.');
});

test('AI server resolves nested CommonMark references, deep continuations, CRLF, and escaped labels safely', async () => {
  const articles = [{slug: 'guide-current-test', question: 'Verified current guide', feature_area: 'Help & Support', answer: 'Use the published article.'}];
  const verifiedUrl = '/HelpArticles?article=guide-current-test';
  const cases = [
    {name: 'blockquote definition', markdown: '[Unsafe ref]\n\n> [Unsafe ref]: https://evil.example', forbidden: 'evil.example'},
    {name: 'unordered list definition', markdown: '[Unsafe ref]\n\n- [Unsafe ref]: ../WarrantyClaims', forbidden: '../WarrantyClaims'},
    {name: 'ordered list definition', markdown: '[Unsafe ref]\n\n1. [Unsafe ref]: ?article=forged', forbidden: '?article=forged'},
    {name: 'four-space continuation', markdown: '[Unsafe ref]\n\n[Unsafe ref]:\n    https&#58;&#47;&#47;evil.example', forbidden: 'evil.example'},
    {name: 'five-space continuation', markdown: '[Unsafe ref]\n\n[Unsafe ref]:\n     ./HelpArticles?article=forged', forbidden: 'article=forged'},
    {name: 'CRLF continuation', markdown: '[Unsafe ref]\r\n\r\n[Unsafe ref]:\r\n &#x2f;WarrantyClaims', forbidden: 'WarrantyClaims'},
    {name: 'escaped closing bracket label', markdown: '[Unsafe\\] label]\n\n[Unsafe\\] label]: https://evil.example', forbidden: 'evil.example'},
    {name: 'first definition wins across nested containers', markdown: '[Unsafe ref]\n\n> [Unsafe ref]: https://evil.example\n\n[Unsafe ref]: ' + verifiedUrl, forbidden: 'evil.example'},
  ];
  for (const example of cases) {
    const {request} = edgeFixture({articles, modelReply: `[Verified article](${verifiedUrl})\n\n${example.markdown}`});
    const response = await request({query: 'Explain the verified guide'});
    assert.equal(response.status, 200, example.name);
    const payload = await response.json();
    assert.ok(!payload.reply.includes(example.forbidden), example.name + ' removes the unconfirmed URL from the raw API reply.');
    assert.deepEqual(renderedHrefs(payload.reply), [verifiedUrl], example.name + ' cannot gain a link through CommonMark parsing.');
    assert.ok(payload.reply.includes('Unsafe'), example.name + ' retains its readable label.');
    assert.deepEqual(payload.sources, [{slug: 'guide-current-test', question: 'Verified current guide'}]);
  }
  for (const definition of [
    '> [Confirmed ref]: ' + verifiedUrl,
    '- [Confirmed ref]: ' + verifiedUrl,
    '[Confirmed ref]:\r\n     ' + verifiedUrl,
  ]) {
    const {request} = edgeFixture({articles, modelReply: '[Confirmed ref]\n\n' + definition});
    const payload = await (await request({query: 'Explain the verified guide'})).json();
    assert.deepEqual(renderedHrefs(payload.reply), [verifiedUrl], 'A confirmed nested or deeply continued reference remains usable.');
  }
});
