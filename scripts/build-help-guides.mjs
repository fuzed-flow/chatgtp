import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = path.join(root, 'docs');
const files = (await fs.readdir(docs)).sort();
const guideFiles = files.filter(name => /^help-guides-.*\.json$/.test(name));
const correctionFiles = files.filter(name => /^help-faq-corrections-.*\.json$/.test(name));
const readGroups = async names => (await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(docs, name), 'utf8'))))).flat();
const guides = await readGroups(guideFiles);
const corrections = await readGroups(correctionFiles);
const items = [...guides, ...corrections];
const slugs = new Set();
const allowedAreas = ['Account','Change Orders','Client Portal','Client Timeline','Clients','Contractor Portal','Daily Logs','Employee Portal','HR','Help & Support','Inventory','Invoices','Leads','Notifications','Payments','Plans & Elevations','Pricebook','Project Materials','Project Phases','Projects','Purchase Orders','Quotes','Reports','Resource Library','Settings','Tasks','Team','Templates','Timesheets','Vendors'];
for (const item of items) {
  if (!/^[-a-z0-9]+$/.test(item.slug) || slugs.has(item.slug)) throw new Error(`Invalid or duplicate slug: ${item.slug}`);
  slugs.add(item.slug);
  if (!allowedAreas.includes(item.feature_area)) throw new Error(`Invalid topic: ${item.slug}`);
  if (!['all','office','admin','employee','contractor'].includes(item.audience)) throw new Error(`Invalid audience: ${item.slug}`);
  if (!item.question || !item.answer_short || !item.answer_long || !/^\/[a-zA-Z]/.test(item.route)) throw new Error(`Incomplete article: ${item.slug}`);
  if (item.article_type === 'guide' && (item.answer_long.split(/\s+/).length < 220 || !/^## /m.test(item.answer_long))) throw new Error(`Guide needs substantive sections: ${item.slug}`);
  if (!Array.isArray(item.source_files) || item.source_files.length === 0) throw new Error(`Missing source evidence: ${item.slug}`);
  for (const source of item.source_files) await fs.access(path.join(root, source));
}
const guideSlugs = new Set(guides.map(item => item.slug));
for (const guide of guides) for (const related of guide.related_slugs || []) if (!guideSlugs.has(related)) throw new Error(`Unresolved related guide ${related}: ${guide.slug}`);

const fixturePath = path.join(root, 'tests/help-center/browser/articles.json');
const original = JSON.parse(await fs.readFile(fixturePath, 'utf8')).filter(item => (item.article_type || 'faq') === 'faq');
const updated = new Map(original.map(item => [item.slug, { ...item, article_type: 'faq', read_minutes: item.read_minutes || 2, related_slugs: item.related_slugs || [] }]));
for (const item of corrections) updated.set(item.slug, { ...updated.get(item.slug), ...item });
const fixture = [...updated.values(), ...guides.map((item, index) => ({ ...item, id: `fixture-guide-${index}` }))].map(({ source_files, ...item }) => item);
await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n');

const columns = ['slug','feature_area','audience','question','answer_short','answer_long','route','search_terms','priority','requires_admin','is_active','last_verified_at','article_type','read_minutes','related_slugs','source_key'];
const normalizedItems = items.map(item => ({
  ...updated.get(item.slug),
  ...item,
  priority: item.priority ?? updated.get(item.slug)?.priority ?? 50,
  is_active: item.is_active ?? updated.get(item.slug)?.is_active ?? true,
  requires_admin: item.requires_admin ?? updated.get(item.slug)?.requires_admin ?? false,
}));
const payload = normalizedItems.map(item => Object.fromEntries(columns.map(key => [key, key === 'source_key' ? (item.article_type === 'guide' ? 'help_articles_portal' : 'help_articles_faq_correction') : key === 'read_minutes' ? item.read_minutes || 2 : key === 'related_slugs' ? item.related_slugs || [] : item[key]])));
const sql = `-- Source-verified guides and corrected quick answers share the canonical help table.\n-- Stable slugs preserve existing IDs; updated answers are immediately used by AI.\nINSERT INTO public.help_faqs (${columns.join(',')})\nSELECT ${columns.join(',')}\nFROM jsonb_to_recordset($articles$${JSON.stringify(payload)}$articles$::jsonb)\nAS a(slug text,feature_area text,audience text,question text,answer_short text,answer_long text,route text,search_terms text[],priority smallint,requires_admin boolean,is_active boolean,last_verified_at date,article_type text,read_minutes smallint,related_slugs text[],source_key text)\nON CONFLICT (slug) DO UPDATE SET\n ${columns.filter(key => key !== 'slug').map(key => `${key}=EXCLUDED.${key}`).join(',\n ')},\n embedding=CASE WHEN help_faqs.question=EXCLUDED.question THEN help_faqs.embedding ELSE NULL END;\n`;
const migrationArg = process.argv.indexOf('--migration');
if (migrationArg !== -1) {
  const target = process.argv[migrationArg + 1];
  if (!target || !/^supabase\/migrations\/\d+_help_articles_portal_content\.sql$/.test(target)) throw new Error('Pass the CLI-created content migration path.');
  await fs.access(path.join(root, target));
  await fs.writeFile(path.join(root, target), sql);
}

const pageFiles = (await fs.readdir(path.join(root, 'src/pages'))).filter(name => name.endsWith('.jsx'));
const coverage = pageFiles.map(file => {
  const source = `src/pages/${file}`;
  const entries = guides.filter(item => item.source_files.includes(source));
  return { page: file.replace('.jsx',''), source, guides: entries.map(item => ({ slug: item.slug, title: item.question })), status: entries.length ? 'documented' : ['ClientView.jsx','PrivacyPolicy.jsx'].includes(file) ? 'legacy_or_policy_reference' : 'needs_review' };
});
const report = { verified_at: '2026-10-04', source_commit: '9b0c3b75ebd3c2dee3d746069a352c7e7de18da6', guide_count: guides.length, guide_words: guides.reduce((sum,item) => sum + item.answer_long.split(/\s+/).length,0), corrected_faq_count: corrections.length, topics: [...new Set(guides.map(item => item.feature_area))].sort(), pages: coverage };
await fs.writeFile(path.join(docs, 'help-articles-coverage.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ guides: guides.length, words: report.guide_words, corrections: corrections.length, uncovered: coverage.filter(item => item.status === 'needs_review').map(item => item.page) }));
