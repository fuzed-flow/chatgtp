import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000010';
const PROJECT = '10000000-0000-4000-8000-000000000020';
const OLD = '10000000-0000-4000-8000-000000000030';
const NEXT = '10000000-0000-4000-8000-000000000031';
const TOKEN = 'b'.repeat(64);
const plain = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
const local = path => fileURLToPath(new URL(path, import.meta.url));
const bundle = build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Inbox from './src/pages/DocumentRequests.jsx';import Warranty from './src/pages/Warranty.jsx';import Plans from './src/components/employee/ProjectPlanList.jsx';import OfficeDocuments from './src/components/documents/DocumentWorkflows.jsx';const f=window.fixture;const components={inbox:Inbox,warranty:Warranty,plans:Plans,office:OfficeDocuments};window.queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});window.fixtureRoot=createRoot(document.getElementById('root'));window.fixtureRoot.render(React.createElement(BrowserRouter,null,React.createElement(QueryClientProvider,{client:window.queryClient},React.createElement(components[f.kind],f.props))));`, resolveDir: local('../..'), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') },
  plugins: [{ name: 'synthetic-workflow-routing', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/api\/supabaseClient|@\/lib\/AuthContext|sonner)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('supabaseClient') ? 'export const supabase={from:t=>window.fixture.from(t),rpc:(n,p)=>window.fixture.rpc(n,p)};' : args.path.includes('AuthContext') ? 'export const useAuth=()=>window.fixture.auth;' : 'export const toast={success:m=>window.fixture.toasts.push(m),error:m=>window.fixture.toasts.push(m)};' }));
  } }],
});

async function view(kind, options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error.message));
  const pathname = kind === 'inbox' ? `/DocumentRequests?id=${OLD}` : kind === 'warranty' ? `/Warranty?id=${OLD}` : kind === 'office' ? `/PMProjectWorkspace?id=${PROJECT}&tab=quotes-docs&request=${OLD}` : `/EmployeePortal?tab=projects&notificationProject=${PROJECT}&notificationDrawing=${OLD}`;
  const dom = new JSDOM('<div id="root"></div>', { url: `https://fixture.example${pathname}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const { window } = dom; const { document } = window;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const scrolled = []; window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  window.fetch = () => { throw new Error('Synthetic routing checks cannot access the network.'); };
  const profile = { id: USER, company_id: COMPANY, full_name: 'Assigned person', role: kind === 'office' ? 'owner' : 'employee' };
  const requests = [OLD, NEXT].map((id, index) => ({ id, company_id: COMPANY, project_id: PROJECT, title: index ? 'Second agreement' : 'Older assigned agreement', recipient_id: USER, recipient_name: 'Assigned person', request_type: 'signature', status: 'Pending', expires_at: '2026-11-01T12:00:00Z', document_name: 'Agreement.pdf', document_url: 'https://files.example.invalid/agreement.pdf' }));
  const claims = [OLD, NEXT].map((id, index) => ({ id, company_id: COMPANY, project_id: PROJECT, title: index ? 'Second claim' : 'Older assigned claim', description: 'Repair concern', customer_name: 'Synthetic Customer', assigned_to: USER, status: 'Open', response_due_at: '2026-10-06T12:00:00Z' }));
  const drawings = [
    { id: OLD, company_id: COMPANY, project_id: PROJECT, drawing_type: 'Floor Plan', title: 'Earlier plan', file_name: 'Earlier.pdf', file_url: 'https://files.example.invalid/earlier.pdf', revision: 'A' },
    { id: NEXT, company_id: COMPANY, project_id: PROJECT, drawing_type: 'Floor Plan', title: 'Current plan', file_name: 'Current.pdf', file_url: 'https://files.example.invalid/current.pdf', revision: 'B', supersedes_id: OLD },
  ];
  const rows = { document_requests: requests, warranty_claims: claims, warranty_updates: [], warranty_audit: [], project_drawings: drawings, profiles: [], document_request_audit: [] };
  const fixture = { kind, auth: { profile, company: { timezone: 'UTC' } }, props: kind === 'plans' ? { currentUser: profile, companyId: COMPANY, projectId: PROJECT } : kind === 'office' ? { project: { id: PROJECT }, documents: [] } : {}, queries: [], rpcs: [], toasts: [], releases: [], scrolled, ...options };
  fixture.from = table => {
    const record = { table, filters: [] }; fixture.queries.push(record);
    const response = () => {
      let matches = rows[table] || [];
      for (const [column, value] of record.filters) matches = matches.filter(row => row[column] === value);
      const selected = record.filters.some(([column]) => column === 'id');
      // The target deliberately predates the recent page even though exact-ID RLS reads can see it.
      if (!selected && ['document_requests', 'warranty_claims'].includes(table)) matches = [];
      return Promise.resolve({ data: record.single ? plain(matches[0] || null) : plain(matches), error: null });
    };
    const chain = { select() { return chain; }, eq(column, value) { record.filters.push([column, value]); return chain; }, or() { return chain; }, order() { return chain; }, limit(value) { record.limit = value; return chain; }, maybeSingle() { record.single = true; return response(); }, then(resolve, reject) { return response().then(resolve, reject); } };
    return chain;
  };
  fixture.rpc = (name, params) => { fixture.rpcs.push({ name, params: plain(params) }); return new Promise(resolve => fixture.releases.push(resolve)); };
  window.fixture = fixture; window.eval((await bundle).outputFiles[0].text);
  async function wait(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(); } throw new Error(`Expected route state: ${document.body.textContent.slice(0, 500)}. ${errors.join('; ')}`); }
  function navigate(path) { window.history.pushState({}, '', path); window.dispatchEvent(new window.PopStateEvent('popstate')); }
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  function close() { window.fixtureRoot.unmount(); window.queryClient.clear(); window.close(); assert.deepEqual(errors, []); }
  return { window, document, fixture, wait, navigate, button, close };
}

test('assigned document inbox loads an old request by ID, responds through the capability RPC, and locks duplicate opens', async () => {
  const ui = await view('inbox');
  try {
    await ui.wait(() => ui.document.querySelector(`[id="document-request-${OLD}"]`));
    const selected = ui.document.getElementById(`document-request-${OLD}`); assert.equal(selected.getAttribute('aria-current'), 'true');
    assert.equal(ui.document.activeElement, selected); assert.ok(ui.fixture.scrolled.includes(selected.id));
    const query = ui.fixture.queries.find(row => row.table === 'document_requests' && row.single);
    assert.deepEqual(query.filters, [['company_id', COMPANY], ['id', OLD]]);
    assert.equal(ui.document.querySelector('a').href, 'https://files.example.invalid/agreement.pdf');
    assert.equal(ui.button('Request review / signature'), undefined);
    ui.button('Open request').click(); ui.button('Open request').click(); await ui.wait(() => ui.fixture.rpcs.length === 1);
    assert.deepEqual(ui.fixture.rpcs[0], { name: 'open_document_request', params: { p_request: OLD } });
    ui.fixture.releases[0]({ data: { token: TOKEN }, error: null });
    await ui.wait(() => ui.window.location.pathname === '/DocumentResponse');
    assert.equal(new URLSearchParams(ui.window.location.search).get('token'), TOKEN);
  } finally { ui.close(); }
});

test('second document notification on an already mounted inbox fetches and highlights the new exact request', async () => {
  const ui = await view('inbox');
  try {
    await ui.wait(() => ui.document.getElementById(`document-request-${OLD}`));
    ui.navigate(`/DocumentRequests?id=${NEXT}`);
    await ui.wait(() => ui.document.getElementById(`document-request-${NEXT}`)?.getAttribute('aria-current') === 'true');
    assert.equal(ui.document.activeElement.id, `document-request-${NEXT}`);
    assert.ok(ui.fixture.queries.some(row => row.table === 'document_requests' && row.filters.some(([column, value]) => column === 'id' && value === NEXT)));
  } finally { ui.close(); }
});

test('PM document target outside the recent list stays project/company scoped and reacts to request changes', async () => {
  const ui = await view('office');
  try {
    await ui.wait(() => ui.document.getElementById(`document-request-${OLD}`));
    const query = ui.fixture.queries.find(row => row.table === 'document_requests' && row.single);
    assert.deepEqual(query.filters, [['company_id', COMPANY], ['id', OLD], ['project_id', PROJECT]]);
    ui.navigate(`/PMProjectWorkspace?id=${PROJECT}&tab=quotes-docs&request=${NEXT}`);
    await ui.wait(() => ui.document.getElementById(`document-request-${NEXT}`)?.getAttribute('aria-current') === 'true');
  } finally { ui.close(); }
});

test('second warranty notification replaces the selected old claim and clears its unsaved update', async () => {
  const ui = await view('warranty');
  try {
    await ui.wait(() => ui.document.body.textContent.includes('Older assigned claim'));
    const note = ui.document.getElementById('warranty-note'); Object.getOwnPropertyDescriptor(ui.window.HTMLTextAreaElement.prototype, 'value').set.call(note, 'Draft for the first claim'); note.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
    await ui.wait(() => ui.document.getElementById('warranty-note').value === 'Draft for the first claim');
    ui.navigate(`/Warranty?id=${NEXT}`); await ui.wait(() => ui.document.body.textContent.includes('Second claim'));
    assert.equal(ui.document.getElementById('warranty-note').value, ''); assert.ok(!ui.document.body.textContent.includes('Older assigned claim'));
    assert.ok(ui.fixture.queries.some(row => row.table === 'warranty_claims' && row.filters.some(([column, value]) => column === 'id' && value === NEXT)));
  } finally { ui.close(); }
});

test('field plans reveal a superseded notification target, focus its revision and expose read-only controls', async () => {
  const ui = await view('plans');
  try {
    await ui.wait(() => ui.document.getElementById(`project-drawing-${OLD}`));
    assert.match(ui.document.body.textContent, /highlighted drawing is an earlier revision/);
    assert.equal(ui.document.activeElement.id, `project-drawing-${OLD}`);
    assert.equal(ui.button('Upload Plan / Elevation'), undefined); assert.equal(ui.button('Upload revision'), undefined); assert.equal(ui.document.querySelector('[title="Delete file from server"]'), null);
    assert.ok(ui.document.querySelector('[title="Download file to device"]'));
    const query = ui.fixture.queries.find(row => row.table === 'project_drawings' && row.single);
    assert.deepEqual(query.filters, [['company_id', COMPANY], ['project_id', PROJECT], ['id', OLD]]);
    ui.navigate(`/EmployeePortal?tab=projects&notificationProject=${PROJECT}&notificationDrawing=${NEXT}`);
    await ui.wait(() => ui.document.getElementById(`project-drawing-${NEXT}`)?.getAttribute('aria-current') === 'true');
    assert.equal(ui.document.getElementById(`project-drawing-${OLD}`), null); assert.equal(ui.document.activeElement.id, `project-drawing-${NEXT}`);
  } finally { ui.close(); }
});
