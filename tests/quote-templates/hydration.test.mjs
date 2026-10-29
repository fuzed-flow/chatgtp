import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundle = build({
  stdin: { resolveDir: local('../../'), sourcefile: 'template-hydration-fixture.jsx', loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {createMemoryRouter,RouterProvider} from 'react-router-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import QuoteBuilder from './src/pages/QuoteBuilder';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    window.fixtureQueryClient=client;
    // Reproduce the legacy picker cache before the builder mounts.
    client.setQueryData(['quote-templates-list','company-one'],[{id:'template-one',title:'Master Template'}]);
    client.setQueryData(['quote-template-options','company-one'],[{id:'template-one',title:'Master Template'}]);
    const router=createMemoryRouter([{path:'/QuoteBuilder',element:<QuoteBuilder/>}],{initialEntries:[window.location.pathname+window.location.search]});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);`,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' },
  alias: { '@/api/supabaseClient': local('./mockDb.js'), '@': local('../../src') },
  plugins: [{ name: 'template-fixture', setup(builder) {
    builder.onLoad({ filter: /\/src\/pages\/QuoteBuilder\.jsx$/ }, async args => {
      const source = await fs.readFile(args.path, 'utf8');
      return { loader: 'jsx', contents: source.replace('  const missingTemplate =',
        '  window.fixtureState = {form,phases,paymentScheduleItems,pdfSettings,manualDeposit,localTitle,localTerms,localNotes,importingTemplateId,isDocumentLoading,isDirty};\n  const missingTemplate =') };
    });
    builder.onResolve({ filter: /AuthContext$|AuthStateContext$/ }, () => ({ path: 'auth', namespace: 'template-stub' }));
    builder.onResolve({ filter: /\/PhaseCard$|\/QuoteBuilderSidebar$|\/SendQuoteEmailDialog$|\/SendQuoteTextDialog$|\/CreateClientDialog$|\/AddressAutocomplete$/ }, args => ({ path: args.path, namespace: 'template-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'template-stub' }, args => ({ loader: 'jsx', resolveDir: local('../../'), contents: args.path === 'auth'
      ? `const profile={company_id:'company-one',id:'user-one'}; const settings={quote_intro:'Company introduction',quote_client_message:'Company message',default_terms:'Company terms',default_deposit:50};export const useAuth=()=>({profile,settings});export const useAuthState=()=>({});`
      : `import React from 'react';export default function Stub(){return null;}` }));
  } }],
});

async function fixture({ fromTemplate = true, failTable, templateOverrides } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://fixtures.invalid/QuoteBuilder?client_id=selected-client${fromTemplate ? '&templateId=template-one' : ''}`,
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  let finishDetail;
  window.templateTest = { queries: [], failTable: failTable === 'quotes' ? null : failTable, templateOverrides, detailGate: new Promise(resolve => { finishDetail = resolve; }) };
  window.eval((await bundle).outputFiles[0].text);
  const wait = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await pause(10); }
    throw new Error(`Expected template state. Errors: ${errors.join('; ')}. UI: ${window.document.body.textContent.slice(0,1500)}`);
  };
  await wait(() => window.fixtureState);
  const button = text => [...window.document.querySelectorAll('button')].find(el => el.textContent.trim() === text);
  const beginImport = async () => {
    button('Import Template').click();
    await wait(() => window.document.querySelector('[role=dialog]'));
    const choice = [...window.document.querySelectorAll('[role=dialog] button')].find(el => el.textContent.includes('Master Template'));
    assert.ok(choice);
    choice.click();
    await wait(() => window.fixtureState.importingTemplateId);
  };
  return { window, dom, errors, wait, button, finishDetail, beginImport, get state() { return window.fixtureState; }, close() { window.fixtureQueryClient.clear(); dom.window.close(); } };
}

function assertTemplateContent(view) {
  const { form, pdfSettings } = view.state;
  assert.equal(form.overall_scope, 'Saved introduction');
  assert.equal(form.client_message, 'Saved client message');
  assert.equal(form.terms, 'Saved terms');
  assert.equal(form.notes, 'Saved internal notes');
  assert.equal(view.state.localNotes, form.notes);
  assert.equal(form.show_discount_amount, true);
  assert.equal(form.show_overall_scope, false);
  assert.equal(form.hero_image_url, 'https://fixtures.invalid/hero.webp');
  assert.equal(form.documents[0].file_name, 'Saved attachment.pdf');
  assert.equal(form.end_photos.length, 1);
  assert.equal(form.has_payment_schedule, true);
  assert.equal(form.deposit_amount, 77, 'Company auto-deposit cannot replace the saved template deposit.');
  assert.equal(view.state.paymentScheduleItems.length, 1);
  assert.equal(pdfSettings.primary_color, '#123456');
  assert.equal(pdfSettings.show_line_item_images, true);
  assert.equal(pdfSettings.page_margins.top, 1.25);
  assert.equal(pdfSettings.page_margins.bottom, 0.75);
  assert.equal(form.client_id, 'selected-client');
  assert.equal(form.status, 'Draft');
  assert.notEqual(form.issue_date, '2020-01-01');
  assert.equal(form.internal_review_status, null);
}

test('new quote waits for the full selected record despite a cached title-only picker result', async () => {
  const view = await fixture();
  try {
    await pause(80);
    assert.match(view.window.document.body.textContent, /Loading quote/);
    assert.equal(view.state.form.hero_image_url, '');
    assert.equal(view.state.isDocumentLoading, true);
    view.finishDetail();
    await view.wait(() => !view.state.isDocumentLoading);
    assertTemplateContent(view);
    assert.equal(view.state.form.title, 'Master Template');
    assert.equal(view.state.isDirty, false, 'Initial hydration is not an unsaved edit.');
    assert.equal(view.state.phases.length, 1);
    assert.equal(view.state.phases[0].items[0].material_cost, 40);
    assert.equal(view.window.document.querySelector('img[alt="Hero"]').getAttribute('src'), view.state.form.hero_image_url);
    const reads = view.window.templateTest.queries.filter(query => query.table === 'quotes' && query.single);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].columns, '*');
    assert.deepEqual(JSON.parse(JSON.stringify(reads[0].filters)), [['company_id','company-one'],['id','template-one'],['is_template',true]]);
    // A later refetch must not overwrite the user's in-progress text.
    const terms = [...view.window.document.querySelectorAll('textarea')].find(el => el.value === 'Saved terms');
    assert.ok(terms);
    Object.getOwnPropertyDescriptor(view.window.HTMLTextAreaElement.prototype,'value').set.call(terms,'Edited terms');
    terms.dispatchEvent(new view.window.Event('input',{bubbles:true}));
    await view.wait(() => view.state.localTerms === 'Edited terms');
    await view.window.fixtureQueryClient.invalidateQueries({queryKey:['quote-template-detail']});
    assert.equal(view.state.localTerms, 'Edited terms');
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('Import Template replaces company defaults with the same saved content, PDF and schedule settings', async () => {
  const view = await fixture({ fromTemplate: false });
  try {
    await view.wait(() => view.button('Import Template'));
    view.button('Add Phase').click();
    const blankPhase = () => [...view.window.document.querySelectorAll('button')].find(el => el.textContent.startsWith('Blank Phase'));
    await view.wait(blankPhase);
    blankPhase().click();
    await view.wait(() => view.state.phases.length === 1);
    await view.beginImport();
    assert.equal(view.state.form.terms, 'Company terms', 'Nothing changes while reads are pending.');
    view.finishDetail();
    await view.wait(() => !view.state.importingTemplateId);
    assertTemplateContent(view);
    assert.equal(view.state.form.title, '', 'Import preserves the current quote title.');
    assert.equal(view.state.phases.length, 2, 'Existing phases remain, with template phases appended.');
    assert.equal(view.state.isDirty, true);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

for (const failTable of ['quotes','quote_phases','quote_line_items','quote_payment_schedules']) {
  test(`failed ${failTable} read leaves all current quote content intact`, async () => {
    const view = await fixture({ fromTemplate: false, failTable });
    try {
      await view.wait(() => view.button('Import Template'));
      // Only fail the import reads, not the template-options list.
      if (failTable === 'quotes') view.window.templateTest.failTable = null;
      await view.wait(() => view.window.templateTest.queries.some(q => q.table === 'quotes'));
      await pause(30);
      view.window.templateTest.failTable = failTable;
      await view.beginImport();
      view.finishDetail();
      await view.wait(() => !view.state.importingTemplateId);
      assert.equal(view.state.form.terms, 'Company terms');
      assert.equal(view.state.form.notes, '');
      assert.equal(view.state.form.hero_image_url, '');
      assert.equal(view.state.phases.length, 0);
      assert.equal(view.state.paymentScheduleItems.length, 0);
      assert.equal(view.state.isDirty, false);
    } finally { view.close(); }
  });
}

test('canceling a pending import discards its late response', async () => {
  const view = await fixture({ fromTemplate: false });
  try {
    await view.wait(() => view.button('Import Template'));
    await view.beginImport();
    [...view.window.document.querySelectorAll('[role=dialog] button')].find(el => el.textContent.trim() === 'Close').click();
    await view.wait(() => !view.state.importingTemplateId);
    view.finishDetail();
    await pause(80);
    assert.equal(view.state.form.terms, 'Company terms');
    assert.equal(view.state.phases.length, 0);
    assert.equal(view.state.isDirty, false);
  } finally { view.close(); }
});

test('a missing or foreign-company template blocks creation instead of opening a blank quote', async () => {
  const view = await fixture({ templateOverrides: { company_id: 'another-company' } });
  try {
    view.finishDetail();
    await view.wait(() => view.window.document.body.textContent.includes('could not be loaded'));
    assert.equal(view.state.form.hero_image_url, '');
    assert.equal(view.state.isDocumentLoading, true);
    assert.equal(view.state.isDirty, false);
  } finally { view.close(); }
});
