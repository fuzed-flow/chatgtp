import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const project = {
  id: 'project-fixture', company_id: 'company-fixture',
  name: 'Kitchen & Bath #2 — Rénovation ✓',
  site_address: 'Synthetic project address', description: 'Synthetic renovation scope.',
};
const contact = { data: { email: ' bids+renovations@builder.example ' }, error: null };
const bundlePromise = build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import ContractorPortal from './src/pages/ContractorPortal.jsx';
      window.portalQueryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.portalRoot=createRoot(document.getElementById('root'));
      window.portalRoot.render(<QueryClientProvider client={window.portalQueryClient}><ContractorPortal/></QueryClientProvider>);`,
    resolveDir: local('../../'), loader: 'jsx', sourcefile: 'contractor-portal-fixture.jsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') },
  plugins: [{ name: 'isolated-contractor-services', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/api\/supabaseClient|sonner)$/ }, args => ({ path: args.path, namespace: 'contractor-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'contractor-test' }, args => ({
      loader: 'js', contents: args.path === 'sonner'
        ? 'export const toast={loading:()=>{},dismiss:()=>{}};'
        : 'export const supabase={from:table=>window.portalDatabase.from(table),functions:{invoke:(...args)=>window.portalDatabase.invoke(...args)}};',
    }));
  } }],
});

async function portalView({ search = '?projectId=project-fixture&token=synthetic-token', projectData = project, files = [], contactResponse = contact } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://fixture.example/ContractorPortal${search}`,
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const queries = [];
  const fetches = [];
  const downloads = [];
  const revoked = [];
  window.fetch = async url => {
    fetches.push(url);
    return { blob: async () => new window.Blob(['synthetic bid document'], { type: 'application/pdf' }) };
  };
  window.URL.createObjectURL = () => 'blob:https://fixture.example/synthetic-bid-document';
  window.URL.revokeObjectURL = url => revoked.push(url);
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, filename: this.download }); };
  window.open = () => { throw new Error('A synthetic document download must not open a fallback window.'); };
  window.portalDatabase = {
    async invoke(name, {body}) {
      queries.push({function:name,body:JSON.parse(JSON.stringify(body))});
      const result=await (typeof contactResponse==='function'?contactResponse():contactResponse);
      return {data:{project:projectData,files,contact_email:projectData?.company_id?result?.data?.email:null},error:null};
    },
    from(table) {
      const record = { table, projection: null, filters: [], order: null, terminal: null };
      queries.push(record);
      const response = () => {
        if (table === 'projects') return Promise.resolve({ data: projectData, error: null });
        if (table === 'contractor_portal_files') return Promise.resolve({ data: files, error: null });
        if (table === 'companies') return Promise.resolve(typeof contactResponse === 'function' ? contactResponse() : contactResponse);
        throw new Error(`Unexpected table query: ${table}`);
      };
      const chain = {
        select(projection) { record.projection = projection; return chain; },
        eq(field, value) { record.filters.push([field, value]); return chain; },
        order(field, options) { record.order = [field, options]; return chain; },
        single() { record.terminal = 'single'; return response(); },
        maybeSingle() { record.terminal = 'maybeSingle'; return response(); },
        then(resolve, reject) { return response().then(resolve, reject); },
      };
      return chain;
    },
  };
  const wait = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await pause(15);
    }
    throw new Error(`Expected contractor portal state: ${window.document.body.textContent}`);
  };
  const close = () => {
    window.portalRoot?.unmount();
    window.portalQueryClient?.clear();
    window.close();
  };
  try {
    window.eval((await bundlePromise).outputFiles[0].text);
    await wait(() => window.document.body.textContent.trim().length > 0 || window.document.querySelector('.animate-spin'));
    return { window, document: window.document, queries, fetches, downloads, revoked, errors, wait, close };
  } catch (error) { close(); throw error; }
}

const replyInstructions = 'Reply to the project contact who sent your invitation to submit your quote.';

test('quote contact is fetched only for the project company and produces an escaped email subject', async () => {
  const view = await portalView();
  try {
    await view.wait(() => view.document.querySelector('a[href^="mailto:"]'));
    const link = view.document.querySelector('a[href^="mailto:"]');
    assert.equal(link.textContent.trim(), 'Email Your Quote');
    assert.equal(link.getAttribute('href'), `mailto:bids%2Brenovations@builder.example?subject=${encodeURIComponent(`Quote Submission: ${project.name}`)}`);
    const destination = new URL(link.href);
    assert.equal(destination.hash, '');
    assert.equal(destination.searchParams.get('subject'), `Quote Submission: ${project.name}`);
    assert.deepEqual([...destination.searchParams.keys()], ['subject']);
    assert.ok(view.document.body.textContent.includes('Send to: bids+renovations@builder.example'));
    assert.deepEqual(view.queries,[{function:'public-project',body:{kind:'contractor',document_id:'project-fixture',token:'synthetic-token'}}]);
    assert.deepEqual(view.fetches, [], 'Rendering the portal does not make any external document requests.');
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('a pending company contact never creates a fallback or guessed email link', async () => {
  let resolveContact;
  const pendingContact = new Promise(resolve => { resolveContact = resolve; });
  const view = await portalView({ contactResponse: () => pendingContact });
  try {
    await pause(30);
    assert.equal(view.queries.length,1);
    assert.equal(view.document.querySelector('a[href^="mailto:"]'), null);
    resolveContact(contact);
    await view.wait(() => view.document.querySelector('a[href^="mailto:"]'));
    assert.equal(view.queries.filter(query => query.function === 'public-project').length, 1);
    assert.deepEqual(view.errors, []);
  } finally { resolveContact(contact); view.close(); }
});

for (const [label, email] of [
  ['blank', '   '],
  ['missing email', null],
  ['non-string', 123],
  ['missing address separator', 'not-an-email'],
  ['missing domain suffix', 'quotes@builder'],
  ['email with an injected query', 'quotes@builder.example?bcc=other@example.test'],
  ['email with an injected fragment', 'quotes@builder.example#fragment'],
  ['multiple recipients', 'quotes@builder.example,other@example.test'],
  ['domain containing a path', 'quotes@builder.example/path'],
  ['prebuilt mailto URL', 'mailto:quotes@builder.example'],
]) {
  test(`${label} company contact shows invitation reply instructions without a mailto`, async () => {
    const view = await portalView({ contactResponse: { data: { email }, error: null } });
    try {
      await view.wait(() => view.document.body.textContent.includes(replyInstructions));
      assert.equal(view.document.querySelector('a[href^="mailto:"]'), null);
      assert.ok(!view.document.body.textContent.includes('Send to:'));
      assert.deepEqual(view.errors, []);
    } finally { view.close(); }
  });
}

test('unavailable company email falls back to the invitation contact without retries or guessed recipients', async () => {
  const view = await portalView({ contactResponse: { data: null, error: { message: 'Synthetic unavailable contact', code: '42501' } } });
  try {
    await view.wait(() => view.document.body.textContent.includes(replyInstructions));
    assert.equal(view.document.querySelector('a[href^="mailto:"]'), null);
    assert.equal(view.queries.filter(query => query.function === 'public-project').length, 1);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('a project without a company never queries the company directory and retains reply instructions', async () => {
  const view = await portalView({ projectData: { ...project, company_id: null } });
  try {
    await view.wait(() => view.document.body.textContent.includes(replyInstructions));
    assert.equal(view.queries.filter(query => query.table === 'companies').length, 0);
    assert.equal(view.document.querySelector('a[href^="mailto:"]'), null);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('an invitation without a project ID fetches no project, documents, or company records', async () => {
  const view = await portalView({ search: '' });
  try {
    await view.wait(() => view.document.body.textContent.includes('No project specified in the link.'));
    await pause(30);
    assert.deepEqual(view.queries, []);
    assert.equal(view.document.querySelector('a[href^="mailto:"]'), null);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('bid documents retain separate View and Download actions with the correct URL and filename', async () => {
  const file = { id: 'file-fixture', file_name: 'Bid package & scope.pdf', file_url: 'https://fixture.example/synthetic-bid.pdf', description: 'Synthetic project document.' };
  const view = await portalView({ files: [file] });
  try {
    await view.wait(() => view.document.body.textContent.includes(file.file_name));
    const viewLink = [...view.document.querySelectorAll('a')].find(link => link.textContent.trim() === 'View');
    const downloadButton = [...view.document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Download');
    assert.ok(viewLink);
    assert.ok(downloadButton);
    assert.equal(viewLink.href, file.file_url);
    assert.equal(viewLink.target, '_blank');
    assert.ok(viewLink.rel.includes('noopener') && viewLink.rel.includes('noreferrer'));
    assert.equal(view.queries[0].body.token,'synthetic-token');
    downloadButton.click();
    await view.wait(() => view.downloads.length === 1);
    assert.deepEqual(view.fetches, [file.file_url]);
    assert.deepEqual(view.downloads, [{ href: 'blob:https://fixture.example/synthetic-bid-document', filename: file.file_name }]);
    assert.deepEqual(view.revoked, ['blob:https://fixture.example/synthetic-bid-document']);
    assert.equal(view.document.querySelector('img').alt, 'Fuzed Flow Logo');
    assert.ok(!view.document.body.textContent.includes('Pro-Trades'));
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});
