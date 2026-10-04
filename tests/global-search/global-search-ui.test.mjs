import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundlePromise = build({
  entryPoints: [local('./ui-fixture.jsx')], bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') },
  plugins: [{ name: 'isolated-search-context', setup(builder) {
    builder.onResolve({ filter: /^(?:search-test-auth|@\/lib\/AuthContext|@\/lib\/globalSearch(?:\.js)?|@\/api\/supabaseClient)$/ }, args => ({
      path: args.path.includes('globalSearch') ? 'engine' : args.path.includes('supabaseClient') ? 'db' : 'auth', namespace: 'search-test',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'search-test' }, args => ({ loader: 'jsx', resolveDir: local('../../'), contents: args.path === 'auth'
      ? `import React,{createContext,useContext} from 'react';export const Context=createContext(null);export const useAuth=()=>useContext(Context);`
      : args.path === 'db' ? `export const supabase={from:()=>{throw new Error('UI must use the search engine');}};`
        : `export {EMPTY_SEARCH_FILTERS,SEARCH_ENTITY_TYPES,getSearchTypes,hasSearchCriteria,getSearchFilterError} from ${JSON.stringify(local('../../src/lib/globalSearch.js'))};
          export function searchGlobalRecords(params){return new Promise((resolve,reject)=>window.searchRequests.push({...params,resolve,reject}));}`,
    }));
  } }],
});

async function searchView() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message); });
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.example/Dashboard', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  const { document } = window;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  const wait = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await pause(15); }
    throw new Error(`Expected search UI state: ${document.body.textContent}`);
  };
  const input = (element, value) => {
    assert.ok(element, 'The requested search field exists.');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const select = (element, value) => { assert.ok(element); element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const field = text => {
    const label = [...document.querySelectorAll('label')].find(element => element.textContent.trim() === text);
    return label?.htmlFor ? document.getElementById(label.htmlFor) : document.querySelector(`[aria-label="${text}"]`);
  };
  const key = (element, value, extra = {}) => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
  const open = async () => { document.querySelector('[aria-label="Open global search"]').click(); await wait(() => document.querySelector('[aria-label="Search records"]')); };
  const close = async () => { document.querySelector('[aria-label="Close global search"]').click(); await wait(() => !document.querySelector('[role="dialog"]')); };
  const query = value => input(document.querySelector('[aria-label="Search records"]'), value);
  const requests = () => window.searchRequests;
  window.eval((await bundlePromise).outputFiles[0].text);
  await wait(() => document.querySelector('[aria-label="Open global search"]'));
  return { dom, window, document, wait, input, select, button, field, key, open, close, query, requests, errors };
}

const result = (title, id = title) => ({ type: 'Quote', title, subtitle: 'Q-1 · $0.00', id, page: '/QuoteView', status: 'Draft', url: `/QuoteView?id=${encodeURIComponent(id)}` });
const reply = (results = [], errors = []) => ({ results, errors, hasMore: false });

test('search waits for an open dialog and meaningful criteria, then collapses rapid typing into one request', async () => {
  const view = await searchView();
  try {
    await pause(330);
    assert.equal(view.requests().length, 0);
    await view.open();
    await pause(330);
    assert.equal(view.requests().length, 0, 'Opening an empty dialog does not load account records.');
    view.query('a');
    await pause(330);
    assert.equal(view.requests().length, 0, 'One character is not a meaningful unrestricted search.');
    view.query('alpha');
    await pause(60);
    view.query('alphabet');
    await view.wait(() => view.requests().length === 1);
    assert.equal(view.requests()[0].query, 'alphabet');
    view.requests()[0].resolve(reply([result('Alphabet quote')]));
    await view.wait(() => view.document.body.textContent.includes('Alphabet quote'));
    assert.equal(view.requests().length, 1);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('changed criteria abort old work and late responses cannot replace newer matches', async () => {
  const view = await searchView();
  try {
    await view.open();
    view.query('older');
    await view.wait(() => view.requests().length === 1);
    const old = view.requests()[0];
    view.query('newer');
    await view.wait(() => old.signal.aborted && view.requests().length === 2);
    view.requests()[1].resolve(reply([result('Newer match')]));
    await view.wait(() => view.document.body.textContent.includes('Newer match'));
    old.resolve(reply([result('Stale match')]));
    await pause(40);
    assert.ok(view.document.body.textContent.includes('Newer match'));
    assert.ok(!view.document.body.textContent.includes('Stale match'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('filter searches stop on close and clearing every filter returns to the empty state', async () => {
  const view = await searchView();
  try {
    await view.open();
    view.document.querySelector('[aria-label="Search filters"]').click();
    await view.wait(() => view.field('Record type'));
    view.select(view.field('Record type'), 'Quote');
    await view.wait(() => view.requests().length === 1);
    assert.equal(view.requests()[0].filters.type, 'Quote');
    assert.equal(view.requests()[0].query, '');
    const pending = view.requests()[0];
    await view.close();
    assert.ok(pending.signal.aborted);
    await pause(330);
    assert.equal(view.requests().length, 1, 'Closing with an active type filter never restarts a background request.');
    pending.resolve(reply([result('Closed-dialog match')]));
    await view.open();
    assert.ok(!view.document.body.textContent.includes('Closed-dialog match'));
    if (!view.field('Record type')) view.document.querySelector('[aria-label="Search filters"]').click();
    await view.wait(() => view.button('Clear filters'));
    view.button('Clear filters').click();
    await pause(330);
    assert.equal(view.field('Record type').value, 'all');
    assert.ok(!view.document.body.textContent.includes('Closed-dialog match'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('partial failures keep usable matches and retry is distinct from an empty search', async () => {
  const view = await searchView();
  try {
    await view.open();
    view.query('invoice');
    await view.wait(() => view.requests().length === 1);
    view.requests()[0].resolve(reply([result('Available quote')], [{ type: 'Invoice', message: 'Invoices could not be searched. Try again.' }]));
    await view.wait(() => view.button('Retry search') && view.document.body.textContent.includes('Available quote'));
    assert.ok(view.document.body.textContent.includes('Invoice'));
    assert.ok(!view.document.body.textContent.includes('No matches'), 'A request failure is not reported as no matches.');
    view.button('Retry search').click();
    await view.wait(() => view.requests().length === 2);
    assert.equal(view.requests()[1].query, 'invoice');
    view.requests()[1].resolve(reply([result('Retry succeeded')]));
    await view.wait(() => view.document.body.textContent.includes('Retry succeeded') && !view.button('Retry search'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('keyboard selection uses the verified encoded destination and Escape restores the trigger focus', async () => {
  const view = await searchView();
  try {
    const trigger = view.document.querySelector('[aria-label="Open global search"]');
    trigger.focus();
    await view.open();
    await view.wait(() => view.document.activeElement === view.document.querySelector('[aria-label="Search records"]'));
    view.query('selected');
    await view.wait(() => view.requests().length === 1);
    const id = 'record / with ? & #';
    view.requests()[0].resolve(reply([result('First selection', id), result('Second selection', 'second')]));
    await view.wait(() => view.document.body.textContent.includes('Second selection'));
    const input = view.document.querySelector('[aria-label="Search records"]');
    view.key(input, 'ArrowDown');
    view.key(view.document.activeElement, 'Enter');
    await view.wait(() => !view.document.querySelector('[role="dialog"]'));
    assert.equal(view.window.location.pathname + view.window.location.search, `/QuoteView?id=${encodeURIComponent(id)}`);
    await view.open();
    view.key(view.document.querySelector('[aria-label="Search records"]'), 'Escape');
    await view.wait(() => !view.document.querySelector('[role="dialog"]') && view.document.activeElement === trigger);
    assert.ok(view.window.sidebarClosed >= 1);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('account, company, and role changes discard pending work and restricted profiles never query office records', async () => {
  const view = await searchView();
  try {
    for (const changedProfile of [
      { id: 'owner-two', role: 'owner', company_id: 'company-one', is_active: true },
      { id: 'owner-two', role: 'owner', company_id: 'company-two', is_active: true },
      { id: 'owner-two', role: 'office', company_id: 'company-two', is_active: true, permissions: ['clients'] },
    ]) {
      await view.open();
      const previousCount = view.requests().length;
      view.query('sensitive');
      await view.wait(() => view.requests().length === previousCount + 1);
      const pending = view.requests().at(-1);
      view.window.setSearchProfile(changedProfile);
      await view.wait(() => !view.document.querySelector('[role="dialog"]') && pending.signal.aborted);
      pending.resolve(reply([result('Old account answer')]));
      await pause(30);
      await view.open();
      assert.equal(view.document.querySelector('[aria-label="Search records"]').value, '');
      assert.ok(!view.document.body.textContent.includes('Old account answer'));
      await view.close();
    }
    view.window.setSearchProfile({ id: 'field-worker', role: 'employee', company_id: 'company-two', is_active: true });
    await view.wait(() => !view.document.querySelector('[aria-label="Open global search"]'));
    const previousCount = view.requests().length;
    view.key(view.window, 'k', { ctrlKey: true });
    await pause(330);
    assert.ok(!view.document.querySelector('[role="dialog"]'));
    assert.equal(view.requests().length, previousCount);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('changing record type clears incompatible facets and disables fields that cannot apply', async () => {
  const view = await searchView();
  try {
    await view.open();
    view.document.querySelector('[aria-label="Search filters"]').click();
    await view.wait(() => view.field('From date'));
    view.input(view.field('From date'), '2026-10-01');
    view.input(view.field('Minimum amount'), '0');
    await view.wait(() => view.requests().length === 1);
    assert.equal(view.requests()[0].filters.dateFrom, '2026-10-01');
    assert.equal(view.requests()[0].filters.minAmount, '0');
    view.select(view.field('Record type'), 'Client');
    await view.wait(() => view.requests().length === 2);
    assert.equal(view.requests()[1].filters.type, 'Client');
    for (const label of ['From date', 'To date', 'Minimum amount', 'Maximum amount']) {
      assert.equal(view.field(label).value, '');
      assert.equal(view.field(label).disabled, true, `${label} cannot misleadingly filter clients.`);
    }
    view.select(view.field('Record type'), 'Lead');
    await view.wait(() => view.requests().length === 3);
    assert.equal(view.field('From date').disabled, true);
    assert.equal(view.field('Minimum amount').disabled, false);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('date and amount filter controls remain available at mobile sizes', async () => {
  const source = await fs.readFile(local('../../src/components/shared/GlobalSearch.jsx'), 'utf8');
  const view = await searchView();
  try {
    await view.open();
    view.document.querySelector('[aria-label="Search filters"]').click();
    await view.wait(() => view.field('From date'));
    for (const label of ['From date', 'To date', 'Minimum amount', 'Maximum amount']) {
      const control = view.field(label);
      assert.ok(control, `${label} can be used in the mobile dialog.`);
      for (let parent = control; parent && parent.getAttribute('role') !== 'dialog'; parent = parent.parentElement) {
        assert.ok(!/(?:^|\s)hidden(?:\s|$)/.test(parent.className), `${label} is not hidden by a desktop-only wrapper.`);
      }
    }
    assert.doesNotMatch(source, /hidden\s+(?:sm|md):(?:grid|flex|block)[^\n]*\{(?:\/\*\s*)?(?:DATE|AMOUNT)/i);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});
