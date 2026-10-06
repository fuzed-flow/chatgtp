import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const local = name => fileURLToPath(new URL(name, import.meta.url));
const targetSlugs = [
  'guide-employee-portal',
  'guide-portal-module-settings',
  'employee-portal-features',
  'guide-mobile-navigation',
  'mobile-office-navigation',
];

const readJson = async name => JSON.parse(await fs.readFile(local(name), 'utf8'));
const canonicalArticles = [
  ...await readJson('../../docs/help-guides-field-settings.json'),
  ...await readJson('../../docs/help-guides-core.json'),
  ...await readJson('../../docs/help-faq-corrections-field.json'),
  ...await readJson('../../docs/help-faq-corrections-sales-performance.json'),
].filter(article => targetSlugs.includes(article.slug));
const browserArticles = await readJson('./browser/articles.json');
const migration = await fs.readFile(local('../../supabase/migrations/20261006161120_employee_portal_help_content.sql'), 'utf8');

test('employee portal help source and browser fixture describe the role-aware navigation', () => {
  assert.equal(canonicalArticles.length, targetSlugs.length);
  const bySlug = new Map(canonicalArticles.map(article => [article.slug, article]));
  const fixtureBySlug = new Map(browserArticles.map(article => [article.slug, article]));

  for (const slug of targetSlugs) {
    const article = bySlug.get(slug);
    const fixture = fixtureBySlug.get(slug);
    assert.ok(article, `canonical article exists: ${slug}`);
    assert.ok(fixture, `browser article exists: ${slug}`);
    assert.equal(fixture.answer_short, article.answer_short, `${slug} short answer is synchronized`);
    assert.equal(fixture.answer_long, article.answer_long, `${slug} long answer is synchronized`);
    assert.equal(article.last_verified_at, '2026-10-06');
  }

  const portal = bySlug.get('guide-employee-portal').answer_long;
  assert.match(portal, /\*\*Clock\*\* when enabled, \*\*Projects\*\*, \*\*Schedule\*\*, \*\*Tasks\*\*, and \*\*More\*\*/);
  assert.match(portal, /\*\*Profile\*\*.*\*\*Warranty\*\*/s);
  assert.match(portal, /compact \*\*My Portal\*\* section selector/);
  assert.match(portal, /directly does not bypass role, module, or assignment access/);
  assert.match(portal, /Clock In, timesheets, pay, time off, and expenses require a plan with HR access/);
  assert.match(portal, /Assigned projects, schedule, project notes, tasks, inventory, Profile, and Warranty do not require HR plan access/);

  const settings = bySlug.get('guide-portal-module-settings').answer_long;
  for (const label of ['Clock In & Out', 'Timesheets', 'My Pay', 'Time Off', 'Expense Tracking', 'Daily Logs & Project Notes', 'Task Assignments', 'Inventory Checks']) {
    assert.match(settings, new RegExp(label.replaceAll('&', '\\&')), `settings guide names ${label}`);
  }
});

test('employee portal help migration is idempotent and only clears embeddings for changed content', async () => {
  const db = new PGlite({ extensions: { vector } });
  try {
    const schema = await fs.readFile(local('./schema.sql'), 'utf8');
    const base = await fs.readFile(local('../../supabase/migrations/20261004052410_help_center_refresh.sql'), 'utf8');
    const access = await fs.readFile(local('../../supabase/migrations/20261004065128_help_embedding_view_access.sql'), 'utf8');
    const portalSchema = await fs.readFile(local('../../supabase/migrations/20261004070726_help_articles_portal_schema.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(base);
    await db.exec(access);
    await db.exec(portalSchema);

    const embedding = JSON.stringify([1, ...Array(1535).fill(0)]);
    for (const slug of targetSlugs) {
      await db.query(`
        INSERT INTO help_faqs (slug,feature_area,audience,question,answer_short,answer_long,route,search_terms,embedding)
        VALUES ($1,'Help & Support','all','Stale question','Stale summary','Stale employee portal copy.','/HelpArticles','{}',$2::vector)
        ON CONFLICT (slug) DO UPDATE SET
          question='Stale question', answer_short='Stale summary', answer_long='Stale employee portal copy.', embedding=$2::vector
      `, [slug, embedding]);
    }
    await db.query("update help_faqs set answer_long='Untargeted sentinel copy.',embedding=$1::vector where slug='help-search-tips'", [embedding]);
    const idsBefore = new Map((await db.query('select slug,id from help_faqs where slug = any($1::text[])', [targetSlugs])).rows.map(row => [row.slug, row.id]));

    await db.exec(migration);
    const first = (await db.query('select slug,id,answer_short,answer_long,last_verified_at::text as verified_at,embedding is null as embedding_cleared from help_faqs where slug = any($1::text[])', [targetSlugs])).rows;
    assert.equal(first.length, targetSlugs.length, 'the focused migration updates exactly the requested records');
    for (const row of first) {
      const expected = canonicalArticles.find(article => article.slug === row.slug);
      assert.equal(row.id, idsBefore.get(row.slug), `${row.slug} keeps its stable ID`);
      assert.equal(row.answer_short, expected.answer_short);
      assert.equal(row.answer_long, expected.answer_long);
      assert.equal(row.verified_at, '2026-10-06');
      assert.equal(row.embedding_cleared, true, `${row.slug} invalidates its stale embedding`);
    }
    const sentinel = (await db.query("select answer_long,embedding is null as embedding_cleared from help_faqs where slug='help-search-tips'")).rows[0];
    assert.deepEqual(sentinel, { answer_long: 'Untargeted sentinel copy.', embedding_cleared: false }, 'the focused migration leaves other help records unchanged');

    await db.query("update help_faqs set embedding=$1::vector where slug='guide-employee-portal'", [embedding]);
    await db.exec(migration);
    const second = (await db.query("select id,embedding is null as embedding_cleared from help_faqs where slug='guide-employee-portal'")).rows[0];
    assert.equal(second.id, idsBefore.get('guide-employee-portal'));
    assert.equal(second.embedding_cleared, false, 'reapplying unchanged content preserves the current embedding');
  } finally {
    await db.close();
  }
});
