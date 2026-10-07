import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';

const path = value => fileURLToPath(new URL(value, import.meta.url));
test('notification centre counts beyond 100, filters, pages, persists preferences and follows links', async () => {
  const bundle = await build({
    entryPoints: [path('./browser/main.jsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"' },
    alias: {
      '@/api/supabaseClient': path('./browser/mockDb.js'),
      '@/lib/AuthContext': path('./browser/mockAuth.jsx'),
      '@': path('../../src'),
    },
  });
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.example/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const wait = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Expected notification UI state did not appear: ' + window.document.body.textContent);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const button = text => [...window.document.querySelectorAll('button')].find(el => el.textContent.trim() === text);
  try {
    window.eval(bundle.outputFiles[0].text);
    await wait(() => window.document.querySelector('[aria-label="Notifications, 140 unread"]'));
    await wait(() => window.document.querySelector('[aria-label="Open AI help"]'));
    const helpTrigger = window.document.querySelector('[aria-label="Open AI help"]');
    assert.ok(!helpTrigger.classList.contains('pointer-events-none'));
    window.document.querySelector('[aria-label="Notifications, 140 unread"]').click();
    await wait(() => button('Next') && window.document.querySelectorAll('li').length === 30);
    await wait(() => helpTrigger.classList.contains('pointer-events-none'));
    assert.equal(window.document.querySelector('[data-ai-help-dialog-trigger]'), null, 'Notifications has no AI Help control.');
    button('Next').click();
    await wait(() => window.document.body.textContent.includes('Page 2'));
    button('Financial').click();
    await wait(() => window.document.querySelectorAll('li').length === 2);
    assert.match(window.document.body.textContent, /Quote approved/);
    button('Mentions').click();
    await wait(() => window.document.body.textContent.includes('No mentions notifications to show.'));
    button('All').click();
    await wait(() => window.document.querySelectorAll('li').length === 30);
    window.document.querySelector('[aria-label="Notification settings"]').click();
    await wait(() => window.document.querySelector('input[type="checkbox"]'));
    assert.equal(window.document.querySelector('[data-ai-help-dialog-trigger]'), null, 'Notification settings also hides AI Help.');
    window.document.querySelector('input[type="checkbox"]').click();
    await wait(() => window.localStorage.getItem('fixture-action-only') === 'true');
    window.document.querySelector('[aria-label="Notification settings"]').click();
    await wait(() => window.document.querySelectorAll('li').length === 1);
    assert.match(window.document.body.textContent, /Task overdue/);
    button('Mark this view read').click();
    await wait(() => !window.document.querySelector('li [aria-label="Unread"]'));
    window.document.querySelector('[aria-label="Notification settings"]').click();
    await wait(() => window.document.querySelector('input[type="checkbox"]'));
    window.document.querySelector('input[type="checkbox"]').click();
    await wait(() => window.localStorage.getItem('fixture-action-only') === 'false');
    window.document.querySelector('[aria-label="Notification settings"]').click();
    await wait(() => window.document.querySelectorAll('li').length === 30 && window.localStorage.getItem('fixture-action-only') === 'false');
    button('Financial').click();
    await wait(() => window.document.querySelectorAll('li').length === 2);
    button('Mark this view read').click();
    await wait(() => !window.document.querySelector('li [aria-label="Unread"]'));
    button('Unread (137)').click();
    await wait(() => window.document.querySelectorAll('li').length === 30 &&
      ![...window.document.querySelectorAll('li')].some(row => /Task overdue|Quote approved|Client viewed quote/.test(row.textContent)));
    window.document.querySelector('li button').click();
    await wait(() => window.location.pathname === '/QuoteBuilder');
    await wait(() => !helpTrigger.classList.contains('pointer-events-none'));
    assert.equal(window.location.search, '?id=fixture-quote');
    assert.deepEqual(errors, []);
  } finally { window.close(); }
});
