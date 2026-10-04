import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundlePromise = build({
  entryPoints: [local('./ui-fixture.jsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
  alias: { '@': local('../../src') },
});

async function builderView(documentName = 'quote') {
  const errors = [];
  const navigationAttempts = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    if (error.message.includes('navigation')) navigationAttempts.push(error.message);
    else errors.push(error.message);
  });
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://fixture.example/QuoteBuilder?id=existing',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  for (const key of ['Request', 'Response', 'Headers', 'AbortController', 'AbortSignal']) window[key] = globalThis[key];
  window.fixtureDocumentName = documentName;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const wait = async predicate => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (predicate()) return;
      await pause(15);
    }
    throw new Error(`Expected unsaved-changes UI state: ${document.body.textContent}`);
  };
  const button = label => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label);
  const link = label => [...document.querySelectorAll('a')].find(element => element.textContent.trim() === label);
  const input = (element, value) => {
    assert.ok(element, 'Requested input is rendered.');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const edit = async (value = 'Unsaved document') => {
    input(document.getElementById('document-title'), value);
    await wait(() => window.documentFixture.dirty());
  };
  const prompt = () => document.querySelector('[role="alertdialog"], [role="dialog"]');
  const heading = () => document.querySelector('main h1')?.textContent;
  window.eval((await bundlePromise).outputFiles[0].text);
  await wait(() => heading() === 'Quote builder' && window.documentFixture);
  // React Router registers the blocker in passive effects after first render.
  await pause(25);
  return { dom, window, document, wait, button, link, input, edit, prompt, heading, errors, navigationAttempts };
}

test('a clean builder leaves immediately and unrelated search inputs never mark the document unsaved', async () => {
  const view = await builderView();
  try {
    view.input(view.document.getElementById('unrelated-search'), 'Find a customer');
    await pause(25);
    assert.equal(view.window.documentFixture.dirty(), false);
    view.link('Dashboard link').click();
    await view.wait(() => view.heading() === 'Dashboard');
    assert.equal(view.prompt(), null);
    assert.equal(view.window.saveRequests.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('hydrating server data remains clean while button-driven line changes require a save', async () => {
  const view = await builderView();
  try {
    view.window.documentFixture.hydrate('Loaded from server');
    await view.wait(() => view.document.getElementById('document-title').value === 'Loaded from server');
    assert.equal(view.window.documentFixture.dirty(), false);
    view.button('Add line').click();
    await view.wait(() => view.window.documentFixture.dirty());
    assert.equal(view.document.querySelector('[aria-label="Line count"]').textContent, '1');
    view.button('Open dashboard').click();
    await view.wait(() => view.prompt());
    assert.equal(view.heading(), 'Quote builder');
    assert.equal(view.window.saveRequests.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('a nested object mutated before the tracked setter is still recognized as an unsaved edit', async () => {
  const view = await builderView();
  try {
    view.window.documentFixture.hydrateLine();
    await view.wait(() => view.document.querySelector('[aria-label="Line amounts"]').textContent === '10');
    assert.equal(view.window.documentFixture.dirty(), false);
    const loadedRevision = view.window.documentFixture.revision();
    view.window.documentFixture.mutateLineThenSet();
    await view.wait(() => view.document.querySelector('[aria-label="Line amounts"]').textContent === '25');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.ok(view.window.documentFixture.revision() > loadedRevision);
    view.button('Open dashboard').click();
    await view.wait(() => view.prompt());
    assert.equal(view.heading(), 'Quote builder');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('sequential functional edits accumulate and each change advances the document revision', async () => {
  const view = await builderView();
  try {
    const loadedRevision = view.window.documentFixture.revision();
    view.window.documentFixture.addTwoLines();
    await view.wait(() => view.document.querySelector('[aria-label="Line count"]').textContent === '2');
    assert.equal(view.document.querySelector('[aria-label="Line amounts"]').textContent, '11,12');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.equal(view.window.documentFixture.revision(), loadedRevision + 2);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('a tracked setter that preserves document content does not create an unsaved change', async () => {
  const view = await builderView();
  try {
    const loadedRevision = view.window.documentFixture.revision();
    view.window.documentFixture.noChange();
    await pause(25);
    assert.equal(view.window.documentFixture.dirty(), false);
    assert.equal(view.window.documentFixture.revision(), loadedRevision);
    view.button('Open dashboard').click();
    await view.wait(() => view.heading() === 'Dashboard');
    assert.equal(view.prompt(), null);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('Cancel keeps the requested link destination blocked and preserves all edits', async () => {
  const view = await builderView();
  try {
    await view.edit('Keep this quote');
    view.link('Dashboard link').click();
    await view.wait(() => view.prompt());
    assert.match(view.prompt().textContent, /unsaved changes/i);
    assert.match(view.prompt().textContent, /quote/i);
    view.button('Cancel').click();
    await view.wait(() => !view.prompt());
    assert.equal(view.heading(), 'Quote builder');
    assert.equal(view.window.fixtureRouter.state.location.pathname, '/QuoteBuilder');
    assert.equal(view.document.getElementById('document-title').value, 'Keep this quote');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.equal(view.window.saveRequests.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('Save and exit awaits persistence then resumes the exact requested route, without duplicate saves', async () => {
  const view = await builderView('invoice');
  try {
    await view.edit('Invoice awaiting save');
    view.window.documentFixture.navigate('/Reports?filter=unpaid#totals');
    await view.wait(() => view.prompt());
    assert.match(view.prompt().textContent, /invoice/i);
    const save = view.button('Save and exit');
    save.click();
    save.click();
    await view.wait(() => view.window.saveRequests.length === 1);
    assert.equal(view.heading(), 'Quote builder', 'Pending persistence must not leave the builder.');
    assert.ok(view.prompt(), 'Confirmation remains visible while saving.');
    assert.ok([...view.prompt().querySelectorAll('button')].every(element => element.disabled));
    view.window.saveRequests[0].resolve('saved-invoice');
    await view.wait(() => view.heading() === 'Reports');
    assert.equal(view.window.fixtureRouter.state.location.pathname, '/Reports');
    assert.equal(view.window.fixtureRouter.state.location.search, '?filter=unpaid');
    assert.equal(view.window.fixtureRouter.state.location.hash, '#totals');
    assert.equal(view.window.savedSnapshots[0].title, 'Invoice awaiting save');
    assert.equal(view.window.saveRequests.length, 1);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('a normal save followed immediately by navigation does not show a second unsaved prompt', async () => {
  const view = await builderView();
  try {
    await view.edit('Saved quote ready for preview');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.equal(view.window.documentFixture.saveThenNavigate('/Reports?preview=saved'), true);
    await view.wait(() => view.heading() === 'Reports');
    assert.equal(view.prompt(), null);
    assert.equal(view.window.fixtureRouter.state.location.search, '?preview=saved');
    assert.equal(view.window.saveRequests.length, 0, 'The guard must not request a redundant save.');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

for (const failure of ['null result', 'rejected save']) {
  test(`a ${failure} keeps the change order open and allows retry or Cancel`, async () => {
    const view = await builderView('change order');
    try {
      await view.edit('Change order not yet saved');
      view.button('Open dashboard').click();
      await view.wait(() => view.prompt());
      view.button('Save and exit').click();
      await view.wait(() => view.window.saveRequests.length === 1);
      if (failure === 'null result') view.window.saveRequests[0].resolve(null);
      else view.window.saveRequests[0].reject(new Error('Synthetic save failure'));
      await view.wait(() => view.button('Save and exit') && !view.button('Save and exit').disabled);
      assert.equal(view.heading(), 'Quote builder');
      assert.ok(view.prompt());
      assert.equal(view.window.documentFixture.dirty(), true);
      assert.equal(view.document.getElementById('document-title').value, 'Change order not yet saved');
      assert.ok(view.prompt().querySelector('[role="alert"]'), 'Save failure is actionable in the current dialog.');
      view.button('Cancel').click();
      await view.wait(() => !view.prompt());
      assert.equal(view.window.fixtureRouter.state.location.pathname, '/QuoteBuilder');
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  });
}

test('an edit arriving during persistence remains unsaved and prevents exiting', async () => {
  const view = await builderView();
  try {
    await view.edit('First revision');
    view.button('Open dashboard').click();
    await view.wait(() => view.prompt());
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 1);
    view.window.documentFixture.edit('Newer revision while saving');
    await view.wait(() => view.document.getElementById('document-title').value === 'Newer revision while saving');
    view.window.saveRequests[0].resolve('saved-first-revision');
    await view.wait(() => view.button('Save and exit') && !view.button('Save and exit').disabled);
    assert.equal(view.heading(), 'Quote builder');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.ok(view.prompt());
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 2);
    assert.equal(view.window.saveRequests[1].snapshot.title, 'Newer revision while saving');
    view.window.saveRequests[1].resolve('saved-current-revision');
    await view.wait(() => view.heading() === 'Dashboard');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('a truthy save result cannot exit while the document still has unsaved edits', async () => {
  const view = await builderView();
  try {
    view.window.fixtureSkipCleanSave = true;
    await view.edit('Current revision must be persisted');
    view.button('Open dashboard').click();
    await view.wait(() => view.prompt());
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 1);
    view.window.saveRequests[0].resolve('truthy-but-not-clean');
    await view.wait(() => view.button('Save and exit') && !view.button('Save and exit').disabled);
    assert.equal(view.heading(), 'Quote builder');
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.ok(view.prompt()?.querySelector('[role="alert"]'));
    view.window.fixtureSkipCleanSave = false;
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 2);
    view.window.saveRequests[1].resolve('saved-current-revision');
    await view.wait(() => view.heading() === 'Dashboard');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('browser history POP can be canceled repeatedly without adding synthetic history entries', async () => {
  const view = await builderView();
  try {
    await view.edit('Keep on browser back');
    for (let attempt = 0; attempt < 2; attempt++) {
      view.button('Go back').click();
      await view.wait(() => view.prompt()).catch(error => {
        throw new Error(`Back attempt ${attempt + 1}, dirty=${view.window.documentFixture.dirty()}, blockers=${JSON.stringify([...view.window.fixtureRouter.state.blockers])}: ${error.message}`);
      });
      view.button('Cancel').click();
      await view.wait(() => !view.prompt());
      assert.equal(view.window.fixtureRouter.state.location.pathname, '/QuoteBuilder');
      assert.equal(view.document.getElementById('document-title').value, 'Keep on browser back');
    }
    view.button('Go back').click();
    await view.wait(() => view.prompt());
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 1);
    view.window.saveRequests[0].resolve('saved-quote');
    await view.wait(() => view.heading() === 'Dashboard');
    assert.equal(view.window.fixtureRouter.state.location.pathname, '/Dashboard');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('replace navigation is guarded and same-document hash changes are not treated as an exit', async () => {
  const view = await builderView();
  try {
    await view.edit();
    view.window.documentFixture.navigate('/QuoteBuilder?id=existing#details');
    await view.wait(() => view.window.fixtureRouter.state.location.hash === '#details');
    assert.equal(view.prompt(), null);
    view.window.documentFixture.replace('/Reports');
    await view.wait(() => view.prompt());
    view.button('Cancel').click();
    await view.wait(() => !view.prompt());
    assert.equal(view.window.fixtureRouter.state.location.pathname, '/QuoteBuilder');
    assert.equal(view.window.fixtureRouter.state.location.hash, '#details');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('native refresh and close-tab protection is attached only while there are unsaved document edits', async () => {
  const view = await builderView();
  try {
    const unload = () => {
      const event = new view.window.Event('beforeunload', { cancelable: true });
      view.window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.equal(unload(), false);
    await view.edit();
    assert.equal(unload(), true);
    const save = view.window.documentFixture.beginOrdinarySave();
    await view.wait(() => view.window.saveRequests.length === 1);
    assert.equal(unload(), true, 'An in-flight save still requires a native leave warning.');
    view.window.saveRequests[0].resolve('saved-quote');
    await save;
    await view.wait(() => !view.window.documentFixture.dirty());
    assert.equal(unload(), false);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('same-tab external and full-document links ask before leaving, and Cancel preserves editing', async () => {
  const view = await builderView();
  try {
    await view.edit('Preserved outside navigation');
    for (const label of ['External link', 'Full document link']) {
      view.link(label).click();
      await view.wait(() => view.prompt());
      assert.equal(view.navigationAttempts.length, 0, 'The native anchor navigation is held until the user decides.');
      view.button('Cancel').click();
      await view.wait(() => !view.prompt());
      assert.equal(view.document.getElementById('document-title').value, 'Preserved outside navigation');
      assert.equal(view.window.documentFixture.dirty(), true);
    }
    assert.equal(view.window.saveRequests.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('an external link exits only after the document has actually been saved', async () => {
  const view = await builderView();
  try {
    await view.edit('Save before external navigation');
    view.link('External link').click();
    await view.wait(() => view.prompt());
    view.button('Save and exit').click();
    await view.wait(() => view.window.saveRequests.length === 1);
    await pause(25);
    assert.equal(view.navigationAttempts.length, 0);
    assert.equal(view.window.documentFixture.dirty(), true);
    view.window.saveRequests[0].resolve('saved-before-external');
    await view.wait(() => view.navigationAttempts.length === 1);
    assert.equal(view.window.documentFixture.dirty(), false);
    assert.equal(view.window.savedSnapshots[0].title, 'Save before external navigation');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('new tabs, downloads, anchors, and modified link clicks do not interrupt the open document', async () => {
  const view = await builderView();
  try {
    await view.edit();
    for (const label of ['New tab', 'Download document', 'Details anchor']) {
      const anchor = view.link(label);
      const click = new view.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      anchor.dispatchEvent(click);
      assert.equal(click.defaultPrevented, false, `${label} retains its normal browser behavior.`);
      await pause(20);
      assert.equal(view.prompt(), null);
    }
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      const click = new view.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [key]: true });
      view.link('External link').dispatchEvent(click);
      assert.equal(click.defaultPrevented, false, `${key} is not converted into same-tab navigation.`);
      await pause(20);
      assert.equal(view.prompt(), null);
    }
    assert.equal(view.window.documentFixture.dirty(), true);
    assert.equal(view.window.saveRequests.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});
