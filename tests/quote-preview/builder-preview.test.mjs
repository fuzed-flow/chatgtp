import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from '@babel/parser';

const source = await fs.readFile(new URL('../../src/pages/QuoteBuilder.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
const handler = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
  .find(node => node.id.name === 'handlePreview').init;

function fixture({ dirty = true, quoteId = 'existing-quote', fail = false, editedDuringSave = false, blocked = false, loading = false, saving = false } = {}) {
  const events = [];
  let unsaved = dirty;
  const tab = {
    opener: {},
    close: () => events.push('close'),
    location: { replace: path => events.push(`preview:${path}`) },
  };
  const context = vm.createContext({
    quoteId, isDocumentLoading: loading, saveInFlight: { current: saving },
    hasUnsavedChanges: () => unsaved,
    window: {
      open: () => { events.push('open'); return blocked ? null : tab; },
      history: { state: {}, replaceState: (_state, _title, path) => events.push(`history:${path}`) },
    },
    handleSave: async (...args) => {
      events.push(['save', ...args]);
      unsaved = fail || editedDuringSave;
      return fail ? null : quoteId || 'new-quote';
    },
    toast: { info: message => events.push(`info:${message}`), error: message => events.push(`error:${message}`) },
  });
  return { preview: vm.runInContext(`(${source.slice(handler.start, handler.end)})`, context), events, tab };
}

test('existing quote preview saves edits before navigating and preserves status', async () => {
  const view = fixture();
  await view.preview();
  assert.deepEqual(view.events, ['open', ['save', null, false, true, true], 'preview:/QuoteView?id=existing-quote']);
  assert.equal(view.tab.opener, null);
});

test('unchanged quote preview does not write to the database', async () => {
  const view = fixture({ dirty: false });
  await view.preview();
  assert.deepEqual(view.events, ['open', 'preview:/QuoteView?id=existing-quote']);
});

test('new quote preview uses the saved quote ID', async () => {
  const view = fixture({ quoteId: null, dirty: false });
  await view.preview();
  assert.deepEqual(view.events, ['open', ['save', null, false, true, true], 'history:/QuoteBuilder?id=new-quote', 'preview:/QuoteView?id=new-quote']);
});

for (const options of [{ fail: true }, { editedDuringSave: true }]) {
  test(`preview does not show stale content when ${options.fail ? 'saving fails' : 'new edits arrive during saving'}`, async () => {
    const view = fixture(options);
    await view.preview();
    assert.ok(view.events.includes('close'));
    assert.ok(!view.events.some(event => typeof event === 'string' && event.startsWith('preview:')));
  });
}

test('blocked popups do not save edits and show recovery instructions', async () => {
  const view = fixture({ blocked: true });
  await view.preview();
  assert.equal(view.events.length, 2);
  assert.ok(view.events[1].includes('Allow pop-ups'));
});

for (const options of [{ loading: true }, { saving: true }]) {
  test(`preview waits for ${options.loading ? 'hydration' : 'another save'} to finish`, async () => {
    const view = fixture(options);
    await view.preview();
    assert.equal(view.events.length, 1);
    assert.ok(view.events[0].startsWith('info:'));
  });
}
