import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { canReadHelp, findHelpArticles, helpPageRoute } from '../../src/lib/helpContent.js';
import { FEATURED_HELP, getHelpSections, helpArticleUrl, helpBrowseUrl, isPublicHelpRoute, relatedHelpArticles } from '../../src/lib/helpPortal.js';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const fixtureArticles = JSON.parse(await fs.readFile(local('./browser/articles.json'), 'utf8')).filter(article => article.is_active !== false);
const guides = fixtureArticles.filter(article => article.article_type === 'guide');
const bundlePromise = build({
  entryPoints: [local('./browser/main.jsx')], bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  alias: { '@/api/supabaseClient': local('./browser/mockDb.js'), '@/lib/AuthContext': local('./browser/mockAuth.jsx'), '@': local('../../src') },
  loader: { '.css': 'empty' },
  plugins: [{ name: 'synthetic-notifications', setup(builder) { builder.onResolve({ filter: /^\.\/components\/shared\/EnhancedNotificationCenter$/ }, () => ({ path: local('./browser/mockNotification.jsx') })); } }],
});

async function portal(path = '/HelpArticles') {
  const errors = [];
  const scrolled = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message); });
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://fixture.example${path}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const window = dom.window;
  const document = window.document;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.hasAttribute('data-help-reader') ? 'article-reader-start' : this.id); };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const wait = async predicate => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected portal UI state at ${window.location.pathname}${window.location.search}: ${document.body.textContent}`);
  };
  const main = () => document.querySelector('main');
  const cards = () => [...document.querySelectorAll('main a[aria-label^="Read "]')];
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const input = (element, value) => {
    assert.ok(element, 'The input must exist before it is used.');
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const select = (element, value) => {
    assert.ok(element, 'The selector must exist before it is used.');
    element.value = value;
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const route = nextPath => {
    window.history.pushState(null, '', nextPath);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  };
  const ready = async () => {
    await wait(() => document.querySelector('#all-help-heading') && document.querySelector('#portal-topic') && cards().length > 0 && !main().textContent.includes('Loading help articles'));
  };
  window.eval((await bundlePromise).outputFiles[0].text);
  return { dom, window, document, errors, scrolled, wait, main, cards, button, input, select, route, ready };
}

const cardSlug = card => new URL(card.href).searchParams.get('article');

test('article contents preserve Markdown anchors and safe role-aware page routes', () => {
  const sections = getHelpSections('## First **step**\nFollow this step.\n```md\n## Hidden inside code\n```\n## First step\n## Check [your work](/Tasks)');
  assert.deepEqual(sections, [
    { id: 'section-first-step', title: 'First step', line: 1 },
    { id: 'section-first-step-2', title: 'First step', line: 6 },
    { id: 'section-check-your-work', title: 'Check your work', line: 7 },
  ]);
  assert.equal(helpArticleUrl('guide-getting-started', 'q=phone&type=guide'), '/HelpArticles?q=phone&type=guide&article=guide-getting-started');
  assert.equal(helpBrowseUrl('q=phone&type=guide&article=guide-getting-started'), '/HelpArticles?q=phone&type=guide');
  assert.equal(helpPageRoute('//external.example', 'owner'), null);
  assert.equal(helpPageRoute('/AdminSettings', 'office'), null);
  assert.equal(helpPageRoute('/AdminSettings?section=notifications', 'office'), null);
  assert.equal(helpPageRoute('/Invoices?status=Overdue', 'manager'), null);
  assert.equal(helpPageRoute('/HumanResources?tab=staff', 'manager'), null);
  assert.equal(helpPageRoute('/HumanResources', 'office'), '/HumanResources');
  assert.equal(helpPageRoute('/Tasks', 'employee'), '/EmployeePortal?tab=tasks');
  assert.equal(helpPageRoute('/Tasks?status=Doing', 'employee'), '/EmployeePortal?tab=tasks');
  assert.equal(helpPageRoute('/HelpArticles', 'employee'), '/HelpArticles');
  assert.equal(helpPageRoute('/HelpArticles?article=guide-getting-started', 'employee'), '/HelpArticles?article=guide-getting-started');
  assert.equal(helpPageRoute('/HelpArticles-admin', 'employee'), null);
  assert.equal(helpPageRoute('/EmployeePortal-admin', 'employee'), null);
  for (const path of ['/Clients', '/ClientDetail', '/ClientForms', '/EmployeePortal']) assert.equal(isPublicHelpRoute(path), false);
  for (const path of ['/ClientPortal', '/ContractorPortal', '/contractor-portal', '/PublicQuoteView', '/PublicInvoiceView', '/PublicPOView', '/PublicChangeOrderView']) assert.equal(isPublicHelpRoute(path), true);
  const related = relatedHelpArticles({ slug: 'first', feature_area: 'Account', related_slugs: ['second'] }, [
    { slug: 'first', feature_area: 'Account' }, { slug: 'second', feature_area: 'Help & Support' }, { slug: 'third', feature_area: 'Account' },
  ]);
  assert.deepEqual(related.map(article => article.slug), ['second', 'third']);
});

test('portal landing highlights essential guides and searches complete article text', async () => {
  const view = await portal();
  try {
    await view.ready();
    assert.equal(view.main().querySelector('h1').textContent, 'Help Articles');
    const featured = view.document.querySelector('#recommended-help-heading').closest('section');
    assert.deepEqual([...featured.querySelectorAll('a')].map(cardSlug), FEATURED_HELP);
    assert.ok(view.document.querySelector('#help-topics-heading'), 'Readers can browse grouped topics.');
    assert.equal(view.cards().length, 12, 'The first page stays bounded.');
    const gettingStarted = guides.find(article => article.slug === 'guide-getting-started');
    assert.ok(gettingStarted.answer_long.includes('automatically put'));
    assert.ok(!`${gettingStarted.question} ${gettingStarted.answer_short}`.includes('automatically put'));
    view.input(view.document.querySelector('#portal-search'), 'automatically put');
    const expected = findHelpArticles(fixtureArticles, 'automatically put');
    await view.wait(() => view.cards().length === expected.length && view.cards().some(card => cardSlug(card) === gettingStarted.slug) && !view.document.querySelector('#recommended-help-heading'));
    assert.deepEqual(view.cards().map(cardSlug), expected.map(article => article.slug));
    assert.equal(new URL(view.window.location.href).searchParams.get('q'), 'automatically put');
    view.document.querySelector('[aria-label="Clear search"]').click();
    await view.wait(() => view.document.querySelector('#recommended-help-heading') && view.cards().length === 12);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('guide and topic filters paginate independently and survive opening an article', async () => {
  const view = await portal();
  try {
    await view.ready();
    view.button('Guides').click();
    await view.wait(() => new URL(view.window.location.href).searchParams.get('type') === 'guide' && view.cards().length === Math.min(12, guides.length) && view.cards().every(card => guides.some(article => article.slug === cardSlug(card))));
    assert.ok(guides.length > 12, 'The fixture exercises guide pagination.');
    view.button(`Show more articles (${guides.length - 12} remaining)`).click();
    await view.wait(() => view.cards().length === Math.min(24, guides.length));
    const slug = cardSlug(view.cards()[0]);
    view.cards()[0].click();
    await view.wait(() => view.main().querySelector('h1')?.textContent === guides.find(article => article.slug === slug).question && !view.document.querySelector('#portal-search'));
    [...view.document.querySelectorAll('a')].find(link => link.textContent.trim() === 'Back to all help articles').click();
    await view.ready();
    assert.equal(new URL(view.window.location.href).searchParams.get('type'), 'guide');
    assert.equal(view.cards().length, Math.min(24, guides.length));

    view.select(view.document.querySelector('#portal-topic'), 'Quotes');
    const quotes = findHelpArticles(guides, '', 'Quotes');
    await view.wait(() => view.main().querySelector('#all-help-heading')?.textContent === 'Quotes' && view.cards().length === Math.min(12, quotes.length));
    assert.ok(quotes.length > 0);
    assert.ok(view.cards().every(card => quotes.some(article => article.slug === cardSlug(card))));
    view.cards()[0].click();
    await view.wait(() => !!view.main().querySelector('article h1'));
    [...view.document.querySelectorAll('a')].find(link => link.textContent.trim() === 'Back to all help articles').click();
    await view.ready();
    assert.equal(view.document.querySelector('#portal-topic').value, 'Quotes');
    assert.equal(new URL(view.window.location.href).searchParams.get('type'), 'guide');
    assert.equal(view.document.querySelector('[aria-label="Article type"] button[aria-pressed="true"]').textContent, 'Guides');
    view.button('Reset filters').click();
    await view.wait(() => view.cards().length === 12 && view.document.querySelector('#portal-topic').value === 'all' && !new URL(view.window.location.href).searchParams.has('type'));
    view.button('Quick answers').click();
    await view.wait(() => new URL(view.window.location.href).searchParams.get('type') === 'faq' && view.cards().length === 12 && view.cards().every(card => fixtureArticles.find(article => article.slug === cardSlug(card))?.article_type !== 'guide'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('the article reader renders structured steps and working mobile and desktop contents', async () => {
  const article = guides.find(item => item.slug === 'guide-getting-started');
  const view = await portal('/HelpArticles?article=guide-getting-started');
  try {
    await view.wait(() => view.main()?.querySelector('article h1')?.textContent === article.question);
    assert.ok(view.scrolled.includes('article-reader-start'), 'Opening an article moves to its beginning instead of retaining the list scroll position.');
    const sections = getHelpSections(article.answer_long);
    const contents = view.document.querySelector('[aria-label="On this page"]');
    assert.ok(contents);
    assert.equal(contents.querySelectorAll('button').length, sections.length);
    for (const section of sections) {
      assert.equal(view.document.getElementById(section.id)?.tagName, 'H2');
      assert.equal(view.document.getElementById(section.id)?.textContent, section.title);
    }
    assert.ok(view.main().querySelector('article ol li strong'), 'Ordered steps retain emphasized action names.');
    const jump = view.document.querySelector('#article-section');
    assert.equal(jump.options.length, sections.length + 1);
    const chosen = sections[1];
    view.select(jump, chosen.id);
    await view.wait(() => view.document.activeElement?.id === chosen.id);
    assert.ok(view.scrolled.includes(chosen.id));
    assert.equal(contents.querySelector('[aria-current="location"]')?.textContent, chosen.title);
    contents.querySelectorAll('button')[0].click();
    await view.wait(() => view.document.activeElement?.id === sections[0].id);
    assert.equal(jump.value, sections[0].id);
    assert.ok(view.main().textContent.includes('Reviewed Oct 4, 2026'));
    assert.ok(view.cards().some(card => cardSlug(card) === 'guide-mobile-navigation'), 'Related guides connect the reader to the next useful topic.');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('AI Help stays available on office client pages and is hidden on public portal pages', async () => {
  for (const path of ['/Clients', '/ClientDetail', '/ClientForms']) {
    const view = await portal(path);
    try {
      await view.ready();
      assert.ok(view.document.querySelector('[aria-label="Open AI help"]'), `AI Help is available on ${path}.`);
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  }
  for (const path of ['/ClientPortal', '/ContractorPortal', '/PublicQuoteView']) {
    const view = await portal(path);
    try {
      await view.ready();
      assert.equal(view.document.querySelector('[aria-label="Open AI help"]'), null, `The public ${path} surface does not expose the signed-in helper.`);
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  }
});

test('field access hides office and admin guidance and unavailable slugs cannot reveal it', async () => {
  const view = await portal();
  try {
    await view.ready();
    const officeGuide = guides.find(article => article.audience === 'office');
    const adminGuide = guides.find(article => article.requires_admin || article.audience === 'admin');
    assert.ok(officeGuide, 'Fixture includes office-specific guidance.');
    assert.ok(adminGuide, 'Fixture includes administrator-specific guidance.');
    assert.ok([...view.document.querySelector('#portal-topic').options].some(option => option.value === 'Quotes'));
    view.select(view.document.querySelector('[aria-label="Preview role"]'), 'employee');
    const available = fixtureArticles.filter(article => canReadHelp(article, 'employee'));
    await view.wait(() => view.document.querySelector('#portal-topic') && ![...view.document.querySelector('#portal-topic').options].some(option => option.value === 'Quotes') && view.main().querySelector('[role="status"]')?.textContent === `${available.length} articles`);
    assert.ok(view.cards().every(card => canReadHelp(fixtureArticles.find(article => article.slug === cardSlug(card)), 'employee')));
    for (const slug of [officeGuide.slug, adminGuide.slug, '../../AdminSettings', 'javascript:alert(1)', 'nonexistent-article']) {
      view.route(`/HelpArticles?article=${encodeURIComponent(slug)}`);
      await view.wait(() => view.main().querySelector('h1')?.textContent === "This article isn't available");
      assert.ok(!view.main().textContent.includes(officeGuide.question));
      assert.ok(!view.main().textContent.includes(adminGuide.question));
      assert.ok(!view.main().querySelector('article'));
      assert.ok(!view.main().querySelector('a[href^="javascript:"]'));
    }
    [...view.document.querySelectorAll('a')].find(link => link.textContent.trim() === 'Browse help articles').click();
    await view.ready();
    assert.equal(view.document.querySelector('[aria-label="Preview role"]').value, 'employee');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('portal recovers from a load error and AI source links open the canonical article reader', async () => {
  const view = await portal();
  try {
    await view.ready();
    view.button('Simulate load error').click();
    await view.wait(() => view.document.querySelector('[role="alert"]')?.textContent.includes("couldn't load"));
    view.button('Try again').click();
    await view.ready();
    assert.ok(!view.document.querySelector('[role="alert"]'));
    view.document.querySelector('[aria-label="Open AI help"]').click();
    await view.wait(() => view.document.querySelector('[role="dialog"]'));
    view.input(view.document.querySelector('[aria-label="Your question"]'), 'How do I filter assigned project tasks?');
    view.document.querySelector('[role="dialog"] form').dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true }));
    const source = () => view.document.querySelector('[role="dialog"] a[href="/HelpArticles?article=pm-task-assignee-filter"]');
    await view.wait(() => source());
    assert.equal(view.window.__helpLastRequest.query, 'How do I filter assigned project tasks?');
    assert.equal(view.window.__helpLastRequest.currentPath, '/HelpArticles');
    assert.ok(view.document.querySelector('[role="dialog"] a[href="/HelpArticles"]'), 'AI has a direct portal entry point.');
    source().click();
    const faq = fixtureArticles.find(article => article.slug === 'pm-task-assignee-filter');
    await view.wait(() => !view.document.querySelector('[role="dialog"]') && view.main().querySelector('article h1')?.textContent === faq.question);
    assert.equal(new URL(view.window.location.href).searchParams.get('article'), faq.slug);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});
