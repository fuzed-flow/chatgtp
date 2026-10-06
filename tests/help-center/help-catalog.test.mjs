import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {canReadHelp} from '../../src/lib/helpContent.js';

const local = name => fileURLToPath(new URL(name, import.meta.url));
const docsPath = local('../../docs/');
const docNames = (await fs.readdir(docsPath)).sort();
const readJson = async name => JSON.parse(await fs.readFile(docsPath + name, 'utf8'));
const guides = (await Promise.all(docNames.filter(name => /^help-guides-.*\.json$/.test(name)).map(readJson))).flat();
const corrections = (await Promise.all(docNames.filter(name => /^help-faq-corrections-.*\.json$/.test(name)).map(readJson))).flat();
const coverage = await readJson('help-articles-coverage.json');
const migrations = await Promise.all([
  '20261004052410_help_center_refresh.sql',
  '20261004065128_help_embedding_view_access.sql',
  '20261004070726_help_articles_portal_schema.sql',
  '20261004071225_help_articles_portal_content.sql',
  '20261004155307_fuzed_flow_contractor_portal_branding.sql',
  '20261004164956_document_email_company_copy_help.sql',
  '20261004180636_subscriber_notification_workflow_help.sql',
  '20261005140001_recent_feature_help.sql',
  '20261005193000_recent_feature_help.sql',
  '20261005195600_recent_feature_help.sql',
  '20261006161120_employee_portal_help_content.sql',
].map(name => fs.readFile(local('../../supabase/migrations/' + name), 'utf8')));
const schema = await fs.readFile(local('./schema.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roles = ['owner', 'admin', 'manager', 'office', 'employee', 'subcontractor', 'user'];

async function catalogDatabase() {
  const db = new PGlite({extensions: {vector}});
  try {
    await db.exec(schema);
    for (const migration of migrations) await db.exec(migration);
    for (let n = 0; n < roles.length; n++) await db.query('insert into profiles(id,company_id,role) values($1,$2,$3)', [id(n + 1), id(99), roles[n]]);
    await db.query("insert into profiles(id,company_id,role,is_active) values($1,$3,'owner',false),($2,null,'owner',true)", [id(20), id(21), id(99)]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function actor(db, who) {
  await db.exec('RESET ROLE');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who || '']);
  await db.exec('SET ROLE authenticated');
}

test('full guide and corrected FAQ migrations insert current source text, preserve IDs, and enforce staff visibility', async () => {
  const db = await catalogDatabase();
  try {
    assert.equal(guides.length, coverage.guide_count);
    assert.equal(corrections.length, coverage.corrected_faq_count);
    assert.ok(guides.length >= 93);
    assert.ok(corrections.length >= 31);
    const before = (await db.query('select id,slug from help_faqs order by slug')).rows;
    await db.query('update help_faqs set embedding=$1::vector where slug=$2', [JSON.stringify(Array(1536).fill(0.1)), 'guide-project-contractor-portal']);
    for (const migration of migrations.slice(2)) await db.exec(migration);
    assert.deepEqual((await db.query('select id,slug from help_faqs order by slug')).rows, before, 'Reapplying the release does not duplicate or replace records.');
    const actual = (await db.query('select * from help_faqs where is_active')).rows;
    const bySlug = new Map(actual.map(article => [article.slug, article]));
    assert.equal(actual.filter(article => article.article_type === 'guide').length, guides.length);
    for (const expected of [...guides, ...corrections]) {
      const saved = bySlug.get(expected.slug);
      assert.ok(saved, expected.slug + ' is inserted or updated.');
      assert.equal(saved.question, expected.question, expected.slug);
      assert.equal(saved.answer_long, expected.answer_long, expected.slug + ' uses the current source answer.');
      assert.equal(saved.answer_short, expected.answer_short, expected.slug);
      assert.equal(saved.feature_area, expected.feature_area, expected.slug);
      assert.equal(saved.audience, expected.audience, expected.slug);
      assert.equal(saved.requires_admin, expected.requires_admin, expected.slug);
      assert.equal(saved.article_type, expected.article_type || 'faq', expected.slug);
      assert.equal(saved.read_minutes, expected.read_minutes || 2, expected.slug);
      assert.deepEqual(saved.related_slugs, expected.related_slugs || [], expected.slug);
    }
    assert.ok(actual.filter(article => article.article_type === 'guide').every(article => article.embedding === null), 'Every new guide is available before embedding maintenance.');
    const contractorGuide = bySlug.get('guide-project-contractor-portal');
    assert.match(contractorGuide.answer_long, /Fuzed Flow branded outside portal/);
    assert.match(contractorGuide.answer_long, /project company’s configured business contact email/);
    assert.match(contractorGuide.answer_long, /contact who sent their invitation/);
    assert.doesNotMatch(contractorGuide.answer_long, /Pro[- ]?Trades/i);
    assert.equal(contractorGuide.embedding, null, 'Updating the guide invalidates its previous embedding.');
    assert.equal((await db.query("select last_verified_at::text as verified_at from help_faqs where slug='guide-project-contractor-portal'")).rows[0].verified_at, '2026-10-04');
    for (let n = 0; n < roles.length; n++) {
      await actor(db, id(n + 1));
      const visible = (await db.query('select slug from help_faqs where is_active order by slug')).rows.map(row => row.slug);
      const expected = actual.filter(article => canReadHelp(article, roles[n])).map(article => article.slug).sort();
      assert.deepEqual(visible, expected, roles[n] + ' matches the UI audience rules.');
      if (['employee', 'subcontractor', 'user'].includes(roles[n])) {
        for (const slug of ['guide-employee-portal', 'guide-expense-claims', 'guide-field-tasks', 'guide-mobile-navigation', 'guide-equipment-reservations', 'equipment-reservations', 'field-material-return']) assert.ok(visible.includes(slug), roles[n] + ' can read personal-work guidance.');
        for (const slug of ['guide-project-workspace', 'guide-hr-approvals', 'guide-quotes-pricing-tax-discount', 'guide-office-daily-logs']) assert.ok(!visible.includes(slug), roles[n] + ' cannot read office-only guide ' + slug);
      }
      if (!['owner', 'admin'].includes(roles[n])) {
        for (const slug of ['guide-team-invites', 'guide-company-branding', 'guide-stripe-and-subscription']) assert.ok(!visible.includes(slug), roles[n] + ' cannot read administrator guide ' + slug);
      }
    }
    for (const who of [id(20), id(21), null]) {
      await actor(db, who);
      assert.equal((await db.query('select * from help_faqs')).rows.length, 0, 'Inactive, unassigned, and missing accounts cannot read the catalog.');
      assert.equal((await db.query("select * from search_help_articles('Employee Portal',null,null,8)")).rows.length, 0);
    }
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(() => db.query('select * from help_faqs'), /permission denied/);
    await assert.rejects(() => db.query("select * from search_help_articles('Employee Portal',null,null,8)"), /permission denied/);
  } finally { await db.close(); }
});

test('AI retrieves useful current sections for real notification, expense, pricing, availability, mobile, and contractor portal questions', async () => {
  const db = await catalogDatabase();
  try {
    await actor(db, id(1));
    const currentArticles = new Map((await db.query('select * from help_faqs where is_active')).rows.map(article => [article.slug, article]));
    const cases = [
      {query: 'missing lead notifications action-only', slug: 'guide-notifications', content: /## Understand new lead alerts[\s\S]*Action Required/},
      {query: 'Submitted expense claim hidden by HR Pending Only', slug: 'guide-expense-claims', content: /## Troubleshooting[\s\S]*All Statuses/},
      {query: 'quote percentage discount customer totals', slug: 'guide-quotes-pricing-tax-discount', content: /Discount[\s\S]*customer|customer[\s\S]*Discount/i},
      {query: 'warranty claim intake tracking', slug: 'guide-warranty-claims', content: /New claim[\s\S]*Assigned team member/},
      {query: 'document approval electronic signature', slug: 'document-signature-availability', content: /Reviews & signatures[\s\S]*electronic consent[\s\S]*does not itself capture/},
      {query: 'general document signing signature tracking availability', slug: 'guide-feature-availability', content: /## Approval and general document signing[\s\S]*Request review \/ signature/},
      {query: 'Navigate on a phone field primary bottom bar', slug: 'guide-employee-portal', content: /## Navigate on a phone[\s\S]*Clock[\s\S]*Projects[\s\S]*Schedule[\s\S]*Tasks[\s\S]*More[\s\S]*Profile[\s\S]*Warranty/},
      {query: 'contractor portal quote email contact invitation', slug: 'guide-project-contractor-portal', content: /Fuzed Flow[\s\S]*configured business contact email[\s\S]*contact who sent their invitation/},
      {query: 'quote send me a copy company email retry copy', slug: 'guide-quotes-review-send', content: /Send me a copy[\s\S]*Branding & PDFs[\s\S]*Retry copy[\s\S]*without sending another client email/},
      {query: 'invoice send me a copy company email', slug: 'guide-invoices-share-customer-pay', content: /\[COPY\] Invoice from LBProjects - Invoice #INV-1001 for Jane Smith/},
      {query: 'change order send me a copy company email', slug: 'guide-change-order-draft', content: /\[COPY\] Change Order from LBProjects - Change Order #CO-1001 for Jane Smith/},
      {query: 'Client Updates form Project summary Completed work Upcoming work Client notes', slug: 'guide-project-client-updates', content: /## Create and save the report[\s\S]*Completed work[\s\S]*Upcoming work/},
      {query: 'project closeout quick photo guided walkthrough deficiency', slug: 'guide-project-closeouts', content: /Quick photo capture[\s\S]*Guided walkthrough/},
      {query: 'project closeout assigned subcontractor trade-specific PDF package', slug: 'guide-project-closeouts', content: /## Send trade-specific packages[\s\S]*only the items assigned/},
      {query: 'AI Rewrite Professional Business usage limit undo expand', slug: 'guide-ai-writing-tools', content: /## Plans and usage protection[\s\S]*Professional and Business[\s\S]*10,000 characters/},
      {query: 'quote change order invoice leave without saving save and exit', slug: 'guide-builder-unsaved-changes', content: /Leave without saving[\s\S]*Save and exit/},
      {query: 'sales performance funnel pipeline value velocity monthly target', slug: 'guide-sales-performance', content: /## Set and use a monthly target[\s\S]*Edit target[\s\S]*approved quote value/},
      {query: 'phone bottom navigation Dashboard Leads Projects Tasks More', slug: 'guide-mobile-navigation', content: /## Use the office bottom navigation[\s\S]*Dashboard[\s\S]*More/},
      {query: 'live sales funnel team performance Professional plan', slug: 'sales-performance-dashboard', content: /saved leads, quotes, payments[\s\S]*Professional and Business plans/},
    ];
    for (const example of cases) {
      const results = (await db.query('select * from search_help_articles($1,null,null,4)', [example.query])).rows;
      const found = results.find(article => article.slug === example.slug);
      assert.ok(found, `${example.query}: expected ${example.slug} in AI's four results, received ${results.map(article => article.slug).join(', ')}`);
      assert.match(found.answer, example.content, example.query + ' includes the useful section.');
      assert.ok(found.answer.length <= 6000, example.query + ' remains bounded.');
      assert.ok(results.every(article => article.answer.length <= 6000));
    }
    await actor(db, id(5));
    assert.ok((await db.query("select slug from search_help_articles('Submitted expense claim hidden by HR Pending Only',null,null,4)")).rows.some(article => article.slug === 'guide-expense-claims'), 'Field users receive their personal expense guide.');
    for (const example of [
      { query: 'equipment Request checkout Reserved office approval Confirm equipment returned', slug: 'guide-equipment-reservations', content: /Request checkout[\s\S]*remains Reserved[\s\S]*Confirm equipment returned/ },
      { query: 'Return materials to stock usage history refund once', slug: 'field-material-return', content: /Return materials to stock[\s\S]*Returned to stock[\s\S]*cannot refund that quantity again/ },
    ]) {
      const results = (await db.query('select * from search_help_articles($1,null,null,4)', [example.query])).rows;
      const found = results.find(article => article.slug === example.slug);
      assert.ok(found, `${example.query}: field AI retrieves ${example.slug}, received ${results.map(article => article.slug).join(', ')}`);
      assert.match(found.answer, example.content);
    }
    for (const query of ['quote percentage discount customer totals', 'HR staff bulk approve employee expense claims', 'company branding logo administrator']) {
      const result = (await db.query('select slug from search_help_articles($1,null,null,8)', [query])).rows;
      assert.ok(result.every(article => currentArticles.has(article.slug) && canReadHelp(currentArticles.get(article.slug), 'employee')));
      assert.ok(!result.some(article => ['guide-quotes-pricing-tax-discount', 'guide-hr-approvals', 'guide-company-branding'].includes(article.slug)), 'Office/admin guidance is denied even when its keywords match.');
    }
    assert.doesNotMatch(currentArticles.get('guide-approvals-review').answer_long, /Internal Review|Request Internal Review/);
    assert.match(currentArticles.get('guide-document-recipient').answer_long, /hidden from the regular sidebar/);
  } finally { await db.close(); }
});

test('coverage documents every page apart from explicit legacy and policy exemptions with real complete guides', async () => {
  const pageFiles = (await fs.readdir(local('../../src/pages/'))).filter(name => name.endsWith('.jsx')).map(name => name.slice(0, -4)).sort();
  assert.deepEqual(coverage.pages.map(page => page.page).sort(), pageFiles, 'Adding a page requires an explicit coverage entry.');
  assert.equal(coverage.guide_count, guides.length);
  assert.equal(coverage.guide_words, guides.reduce((total, guide) => total + guide.answer_long.trim().split(/\s+/).length, 0));
  assert.equal(coverage.corrected_faq_count, corrections.length);
  assert.deepEqual(coverage.topics, [...new Set(guides.map(guide => guide.feature_area))].sort());
  const bySlug = new Map(guides.map(guide => [guide.slug, guide]));
  assert.equal(bySlug.size, guides.length, 'Guide slugs are unique.');
  assert.equal(new Set(corrections.map(faq => faq.slug)).size, corrections.length, 'Correction slugs are unique.');
  const exemptions = new Map([['ClientView', 'legacy_or_policy_reference'], ['PrivacyPolicy', 'legacy_or_policy_reference']]);
  for (const page of coverage.pages) {
    assert.equal(page.source, `src/pages/${page.page}.jsx`);
    if (exemptions.has(page.page)) {
      assert.equal(page.status, exemptions.get(page.page));
      continue;
    }
    assert.equal(page.status, 'documented', page.page);
    assert.ok(page.guides.length > 0, page.page + ' has useful instructions.');
    for (const reference of page.guides) {
      const guide = bySlug.get(reference.slug);
      assert.ok(guide, page.page + ' references a published guide.');
      assert.equal(reference.title, guide.question);
      assert.ok(guide.source_files.includes(page.source), page.page + ' is one of the verified guide sources.');
    }
  }
  for (const guide of guides) {
    const words = guide.answer_long.trim().split(/\s+/).length;
    assert.ok(words >= 250 && words <= 600, `${guide.slug} has ${words} words; guides should provide complete readable instructions.`);
    assert.ok((guide.answer_long.match(/^## /gm) || []).length >= 3, guide.slug + ' supports section navigation.');
    assert.ok(guide.answer_short && guide.search_terms.length > 0);
    for (const related of guide.related_slugs) assert.ok(bySlug.has(related), guide.slug + ' related guide exists: ' + related);
    for (const source of guide.source_files) assert.ok((await fs.stat(local('../../' + source))).isFile(), guide.slug + ' source exists: ' + source);
  }
});
