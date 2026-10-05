import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM, VirtualConsole} from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const plain = value => JSON.parse(JSON.stringify(value));
const COMPANY = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-8000-000000000002';
const DOCUMENT = '00000000-0000-4000-8000-000000000003';
const COMPANY_EMAIL = ' office@builder.example ';
const CLIENT_EMAIL = 'customer@client.example';
const types = {
  quote: {table: 'quotes', numberField: 'quote_number', number: 'Q-1001', detail: ['quote'], list: ['quotes']},
  change_order: {table: 'change_orders', numberField: 'change_order_number', number: 'CO-1001', detail: ['change-order', 'change_order'], list: ['change-orders', 'change_orders']},
  invoice: {table: 'invoices', numberField: 'invoice_number', number: 'INV-1001', detail: ['invoice', 'invoice_client_view'], list: ['invoices']},
};

// These components are stringified into the isolated browser bundle below.
// The fixture uses the actual dialogs, actual shared hook and actual QueryClient.
function HookHarness({state, onOpenChange, onSuccess}) {
  const delivery = useDocumentEmailSend({
    open: state.open, documentId: state.documentId, documentType: state.documentType,
    companyEmail: window.emailFixture.companyEmail, onOpenChange, onSuccess,
  });
  window.emailHook = delivery;
  return React.createElement('div', {'data-hook': true},
    React.createElement('output', {'aria-label': 'Hook error'}, delivery.errorMessage));
}

function Fixture() {
  const [state, setState] = React.useState(window.emailFixture.initialState);
  window.updateEmailFixture = patch => setState(previous => ({...previous, ...patch}));
  const onOpenChange = React.useCallback(open => {
    window.emailFixture.openChanges.push(open);
    setState(previous => ({...previous, open}));
  }, []);
  const onSuccess = React.useCallback(() => { window.emailFixture.successes += 1; }, []);
  if (window.emailFixture.dialog === 'hook') {
    return React.createElement(HookHarness, {state, onOpenChange, onSuccess});
  }
  const Component = Dialogs[window.emailFixture.dialog];
  const props = {
    open: state.open, onOpenChange, onSuccess,
    clientName: 'Synthetic Client', clientEmail: CLIENT_EMAIL,
    quoteId: state.documentId, quoteName: 'Synthetic Quote',
    changeOrderId: state.documentId, coName: 'Synthetic Change Order',
    invoiceId: state.documentId, invoiceNumber: 'INV-1001', clientId: CLIENT,
  };
  return React.createElement(Component, props);
}

const fixtureSource = [
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {QueryClient, QueryClientProvider} from '@tanstack/react-query';",
  "import Quote from './src/components/quotes/SendQuoteEmailDialog.jsx';",
  "import ChangeOrder from './src/components/change-orders/SendChangeOrderEmailDialog.jsx';",
  "import Invoice from './src/components/invoices/SendInvoiceEmailDialog.jsx';",
  "import {useDocumentEmailSend} from './src/lib/emailCopy.js';",
  'const CLIENT=' + JSON.stringify(CLIENT) + ';',
  'const CLIENT_EMAIL=' + JSON.stringify(CLIENT_EMAIL) + ';',
  'const Dialogs={quote:Quote,change_order:ChangeOrder,invoice:Invoice};',
  HookHarness.toString(), Fixture.toString(),
  'window.emailQueryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});',
  'window.emailQueryClient.invalidateQueries=options=>{window.emailFixture.invalidations.push(options.queryKey);return Promise.resolve();};',
  "window.emailRoot=createRoot(document.getElementById('root'));",
  'window.emailRoot.render(React.createElement(QueryClientProvider,{client:window.emailQueryClient},React.createElement(Fixture)));',
].join('\n');

const bundlePromise = build({
  stdin: {contents: fixtureSource, resolveDir: local('../..'), loader: 'jsx', sourcefile: 'email-copy-dialog-fixture.jsx'},
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: {'process.env.NODE_ENV': '"test"'}, alias: {'@': local('../../src')},
  plugins: [{name: 'synthetic-email-services', setup(builder) {
    builder.onResolve({filter: /^(?:@\/api\/supabaseClient|@\/lib\/AuthContext|sonner)$|PDFGenerator/}, args => ({
      path: args.path.includes('PDFGenerator') ? 'pdf' : args.path.includes('AuthContext') ? 'auth'
        : args.path === 'sonner' ? 'toast' : 'database', namespace: 'email-copy-fixture',
    }));
    builder.onLoad({filter: /.*/, namespace: 'email-copy-fixture'}, args => ({
      loader: 'js', contents: args.path === 'auth'
        ? 'export const useAuth=()=>window.emailFixture.auth;'
        : args.path === 'database'
          ? 'export const supabase={from:table=>window.emailFixture.from(table),rpc:(name,args)=>window.emailFixture.rpc(name,args),functions:{invoke:(name,options)=>window.emailFixture.invoke(name,options)}};'
          : args.path === 'pdf'
            ? 'export const generateQuotePDF=(...args)=>window.emailFixture.pdf(...args);'
            : 'const record=(level,...args)=>{window.emailFixture.toasts.push({level,args});return "synthetic-toast";};export const toast={loading:(...args)=>record("loading",...args),error:(...args)=>record("error",...args),success:(...args)=>record("success",...args),dismiss:(...args)=>record("dismiss",...args)};',
    }));
  }}],
});

async function emailView(dialog, options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://fixture.example/QuoteBuilder', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole,
  });
  const {window} = dom;
  const {document} = window;
  window.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.crypto.randomUUID = randomUUID;
  window.fetch = () => { throw new Error('Synthetic dialog tests cannot make network requests.'); };
  const companyEmail = Object.hasOwn(options, 'companyEmail') ? options.companyEmail : COMPANY_EMAIL;
  const fixture = {
    dialog, companyEmail, successes: 0, openChanges: [], requests: [], writes: [], queries: [], rpcCalls: [],
    invalidations: [], pdfCalls: [], toasts: [], pendingReads: new Map(),
    initialState: {open: true, documentId: DOCUMENT, documentType: dialog === 'hook' ? 'invoice' : dialog},
    auth: {
      profile: {id: 'synthetic-user', company_id: COMPANY, role: 'owner', email: 'login@owner.example'},
      settings: {email: options.authEmail ?? companyEmail, company_name: 'Synthetic Builder', pdf: {brand_color: '#f59e0b'}},
    },
  };
  const rows = {
    companies: {id: COMPANY, name: 'Synthetic Builder', settings: {...fixture.auth.settings, email: companyEmail}, logo_url: 'https://fixture.example/logo.png'},
    clients: {id: CLIENT, name: 'Synthetic Client', email: CLIENT_EMAIL, company_id: COMPANY},
    projects: {id: 'synthetic-project', client_id: CLIENT, company_id: COMPANY},
    leads: {id: 'synthetic-lead', contact_name: 'Synthetic Lead', contact_email: 'lead@client.example', company_id: COMPANY},
    change_order_phases: [], change_order_line_items: [],
  };
  for (const [type, info] of Object.entries(types)) rows[info.table] = {
    id: DOCUMENT, company_id: COMPANY, title: 'Synthetic ' + type, client_id: CLIENT,
    project_id: 'synthetic-project', projects: {client_id: CLIENT}, [info.numberField]: info.number,
  };
  if (dialog === 'quote' && Object.hasOwn(options, 'quoteClientId')) rows.quotes.client_id = options.quoteClientId;
  const statusErrors = [...(options.statusErrors || [])];
  fixture.from = table => {
    const record = {table, mode: 'select', filters: []};
    fixture.queries.push(record);
    let result;
    const response = () => {
      if (result) return result;
      result = Promise.resolve().then(async () => {
        if (record.mode === 'update') {
          fixture.writes.push({table, payload: plain(record.payload), filters: plain(record.filters)});
          const message = statusErrors.shift();
          return {data: null, error: message ? {message} : null};
        }
        const id = record.filters.find(([field]) => field === 'id')?.[1];
        const pending = fixture.pendingReads.get(table + ':' + id);
        if (pending) await pending;
        if (!Object.hasOwn(rows, table)) throw new Error('Unexpected synthetic table: ' + table);
        return {data: plain(rows[table]), error: null};
      });
      return result;
    };
    const chain = {
      select(projection) {record.projection = projection; return chain;},
      eq(field, value) {record.filters.push([field, value]); return chain;},
      order() {return chain;}, limit() {return chain;},
      update(payload) {record.mode = 'update'; record.payload = payload; return chain;},
      single() {return response();}, maybeSingle() {return response();},
      then(resolve, reject) {return response().then(resolve, reject);},
    };
    return chain;
  };
  fixture.invoke = (name, {body}) => {
    assert.equal(name, 'send-email');
    return new Promise((resolve, reject) => fixture.requests.push({body: plain(body), resolve, reject}));
  };
  fixture.rpc = async (name, args) => {
    fixture.rpcCalls.push({name, args: plain(args)});
    if (name !== 'issue_quote_share_token') return {data: null, error: {message: 'Unexpected synthetic RPC: ' + name}};
    return {data: 'a'.repeat(64), error: null};
  };
  fixture.pdf = async (...args) => {
    fixture.pdfCalls.push(plain(args));
    if (fixture.pdfGate) await fixture.pdfGate;
    return 'U3ludGhldGljIFBERiBieXRlcw==' + fixture.pdfCalls.length;
  };
  window.emailFixture = fixture;
  const wait = async predicate => {
    for (let attempt = 0; attempt < 500; attempt++) {if (predicate()) return; await pause(10);}
    throw new Error('Expected email UI state: ' + document.body.textContent + '; errors: ' + errors.join('; '));
  };
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const submit = () => {
    const form = document.querySelector('form');
    assert.ok(form, 'A document send form exists.');
    form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  };
  const input = (element, value) => {
    assert.ok(element);
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', {bubbles: true}));
  };
  const copy = () => document.querySelector('input[id$="-send-copy"]');
  const reply = (index, data = {success: true, copy_status: 'not_requested'}) => fixture.requests[index].resolve({data, error: null});
  const fail = (index, status, message) => fixture.requests[index].resolve({
    data: null, error: {message, context: {status, json: async () => ({error: message})}},
  });
  const close = () => {
    window.emailRoot?.unmount();
    window.emailQueryClient?.clear();
    window.close();
  };
  try {
    window.eval((await bundlePromise).outputFiles[0].text);
    if (dialog === 'hook') await wait(() => window.emailHook);
    else await wait(() => copy() && document.querySelector('input[type="email"]')?.value === CLIENT_EMAIL && !document.querySelector('button[type="submit"]')?.disabled);
    return {dom, window, document, fixture, wait, button, submit, input, copy, reply, fail, errors, rows, close};
  } catch (error) {close(); throw error;}
}

test('quote: lead-only email keeps the secure quote link and omits the unavailable client portal link', async () => {
  const view = await emailView('quote', {quoteClientId: null});
  try {
    view.submit();
    await view.wait(() => view.fixture.requests.length === 1);
    const body = view.fixture.requests[0].body;
    assert.equal(body.client_id, null);
    assert.ok(body.html_body.includes('/PublicQuoteView?'));
    assert.ok(body.html_body.includes('token=' + 'a'.repeat(64)));
    assert.ok(!body.html_body.includes('/ClientPortal'));
    assert.ok(!body.html_body.includes('quote_token='));
    assert.ok(!body.html_body.includes('Access Client Portal'));
    view.reply(0);
    await view.wait(() => view.fixture.successes === 1);
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});

function assertInvalidations(view, type) {
  const actual = plain(view.fixture.invalidations);
  const info = types[type];
  for (const key of info.detail) assert.ok(actual.some(entry => entry[0] === key && entry[1] === DOCUMENT), key + ' detail invalidated');
  for (const key of info.list) assert.ok(actual.some(entry => entry[0] === key && entry.length === 1), key + ' list invalidated');
  assert.ok(actual.some(entry => entry[0] === 'project_documents' && entry.length === 1), 'Project document lists invalidated');
}

for (const type of Object.keys(types)) {
  test(type + ': copy checkbox is bottom-left, unchecked, and resets for each opening and document', async () => {
    const view = await emailView(type);
    try {
      const checkbox = view.copy();
      assert.equal(checkbox.checked, false);
      assert.equal(checkbox.disabled, false);
      assert.ok(view.document.body.textContent.includes('Copy to: office@builder.example'));
      const footer = checkbox.parentElement.parentElement.parentElement;
      assert.ok(footer.classList.contains('sm:flex-row'));
      assert.ok(footer.classList.contains('sm:justify-between'), 'Copy choice and send actions occupy opposite sides on desktop.');
      assert.ok(footer.firstElementChild.contains(checkbox), 'The copy choice precedes the action buttons.');
      checkbox.click();
      await view.wait(() => view.copy().checked);
      view.window.updateEmailFixture({open: false});
      await view.wait(() => !view.document.querySelector('[role="dialog"]'));
      view.window.updateEmailFixture({open: true});
      await view.wait(() => view.copy() && !view.copy().checked);
      view.copy().click();
      await view.wait(() => view.copy().checked);
      view.window.updateEmailFixture({documentId: '00000000-0000-4000-8000-000000000004'});
      await view.wait(() => view.copy() && !view.copy().checked);
      assert.equal(view.fixture.requests.length, 0);
      assert.deepEqual(view.errors, []);
    } finally {view.close();}
  });

  for (const email of [null, 'invalid-company-contact']) {
    test(type + ': missing or invalid business email disables copy despite a valid login email (' + email + ')', async () => {
      const view = await emailView(type, {companyEmail: email, authEmail: 'cached@builder.example'});
      try {
        assert.equal(view.copy().checked, false);
        assert.equal(view.copy().disabled, true);
        assert.ok(view.document.body.textContent.includes('Add a valid company email in Settings'));
        assert.ok(!view.document.body.textContent.includes('Copy to: login@owner.example'));
        assert.ok(!view.document.body.textContent.includes('Copy to: cached@builder.example'));
        view.submit();
        await view.wait(() => view.fixture.requests.length === 1);
        assert.equal(view.fixture.requests[0].body.send_copy_to_company, false);
        view.reply(0);
        await view.wait(() => view.fixture.successes === 1);
        assert.deepEqual(view.errors, []);
      } finally {view.close();}
    });
  }

  test(type + ': normal send includes document context, keeps the customer message, marks Sent and completes callbacks', async () => {
    const view = await emailView(type);
    try {
      const subject = view.document.querySelector('input:not([type])');
      view.input(subject, 'My edited customer subject');
      view.input(view.document.querySelector('textarea'), 'An exact synthetic customer message.');
      await pause(15);
      view.submit();
      await view.wait(() => view.fixture.requests.length === 1);
      const body = view.fixture.requests[0].body;
      assert.equal(body.document_type, type);
      assert.equal(body.document_id, DOCUMENT);
      assert.equal(body.send_copy_to_company, false);
      assert.match(body.request_id, /^[a-f0-9-]{36}$/i);
      assert.equal(body.to_email, CLIENT_EMAIL);
      assert.equal(body.subject, 'My edited customer subject');
      assert.ok(body.html_body.includes('An exact synthetic customer message.'));
      if (type === 'quote') {
        assert.ok(body.html_body.includes('token=' + 'a'.repeat(64)));
        assert.ok(body.html_body.includes('quote_token=' + 'a'.repeat(64)));
        assert.deepEqual(view.fixture.rpcCalls, [{name: 'issue_quote_share_token', args: {p_quote: DOCUMENT}}]);
      }
      assert.equal(body.client_id, CLIENT);
      assert.equal(Object.hasOwn(body, 'copy_to'), false, 'The browser cannot choose an arbitrary copy recipient.');
      view.reply(0);
      await view.wait(() => view.fixture.successes === 1 && !view.document.querySelector('[role="dialog"]'));
      assert.equal(view.fixture.writes.length, 1);
      assert.equal(view.fixture.writes[0].table, types[type].table);
      assert.deepEqual(view.fixture.writes[0].payload, {status: 'Sent'});
      assert.deepEqual(view.fixture.writes[0].filters, [['id', DOCUMENT]]);
      assertInvalidations(view, type);
      assert.deepEqual(view.fixture.openChanges, [false]);
      assert.deepEqual(view.errors, []);
    } finally {view.close();}
  });

  test(type + ': partial copy failure writes status and invalidates caches but defers closing until exact retry succeeds', async () => {
    const view = await emailView(type);
    try {
      view.copy().click();
      await view.wait(() => view.copy().checked);
      view.submit();
      await view.wait(() => view.fixture.requests.length === 1);
      const captured = plain(view.fixture.requests[0].body);
      assert.equal(captured.send_copy_to_company, true);
      if (type === 'change_order') {
        assert.equal(view.fixture.pdfCalls.length, 1);
        assert.equal(captured.attachments.length, 1);
      }
      view.reply(0, {success: true, resend_id: 'synthetic-primary', copy_status: 'failed'});
      await view.wait(() => view.button('Retry copy'));
      assert.equal(view.fixture.writes.length, 1);
      assert.equal(view.fixture.successes, 0);
      assert.deepEqual(view.fixture.openChanges, []);
      assert.ok(view.document.querySelector('[role="dialog"]'));
      assert.ok(view.document.querySelector('[role="alert"]').textContent.includes('client email was sent'));
      assert.equal(view.copy().disabled, true);
      for (const field of view.document.querySelectorAll('input[type="email"],input:not([type]),textarea')) assert.equal(field.disabled, true);
      assertInvalidations(view, type);
      view.rows.companies.name = 'Changed company after original send';
      view.submit();
      await view.wait(() => view.fixture.requests.length === 2);
      assert.deepEqual(view.fixture.requests[1].body, captured, 'Retry preserves the request ID, subject, original HTML and PDF bytes.');
      if (type === 'change_order') assert.equal(view.fixture.pdfCalls.length, 1, 'A retry never regenerates the PDF.');
      view.reply(1, {success: true, resend_id: 'synthetic-primary', copy_status: 'sent'});
      await view.wait(() => view.fixture.successes === 1 && !view.document.querySelector('[role="dialog"]'));
      assert.equal(view.fixture.writes.length, 1, 'Already-saved status is not written again after copy retry.');
      assert.deepEqual(view.fixture.openChanges, [false]);
      assert.deepEqual(view.errors, []);
    } finally {view.close();}
  });

  test(type + ': loading a different document blocks stale sends and resets the copy choice', async () => {
    const view = await emailView(type);
    const nextDocument = '00000000-0000-4000-8000-000000000004';
    let releaseSetup;
    try {
      view.copy().click();
      await view.wait(() => view.copy().checked);
      view.fixture.pendingReads.set(types[type].table + ':' + nextDocument,
        new Promise(resolve => {releaseSetup = resolve;}));
      view.window.updateEmailFixture({documentId: nextDocument});
      await view.wait(() => view.fixture.queries.some(query => query.table === types[type].table
        && query.filters.some(([field, value]) => field === 'id' && value === nextDocument)));
      await view.wait(() => !view.copy().checked && view.copy().disabled);
      assert.equal(view.document.querySelector('button[type="submit"]').disabled, true);
      view.submit();
      await pause(25);
      assert.equal(view.fixture.requests.length, 0, 'Pending setup cannot send the prior document contents.');
      releaseSetup();
      await view.wait(() => !view.document.querySelector('button[type="submit"]').disabled);
      view.submit();
      await view.wait(() => view.fixture.requests.length === 1);
      assert.equal(view.fixture.requests[0].body.document_id, nextDocument);
      assert.equal(view.fixture.requests[0].body.send_copy_to_company, false);
      view.reply(0);
      await view.wait(() => view.fixture.successes === 1);
      assert.deepEqual(view.errors, []);
    } finally {releaseSetup?.(); view.close();}
  });

  test(type + ': synchronous duplicate submits make one request, including while PDF generation is pending', async () => {
    const view = await emailView(type);
    let releasePdf;
    try {
      if (type === 'change_order') view.fixture.pdfGate = new Promise(resolve => {releasePdf = resolve;});
      view.submit();
      view.submit();
      if (type === 'change_order') {
        await view.wait(() => view.fixture.pdfCalls.length === 1);
        assert.equal(view.fixture.requests.length, 0);
        releasePdf();
      }
      await view.wait(() => view.fixture.requests.length === 1);
      await pause(25);
      assert.equal(view.fixture.requests.length, 1);
      assert.equal(view.document.querySelector('button[type="submit"]').disabled, true);
      view.reply(0);
      await view.wait(() => view.fixture.successes === 1);
      assert.equal(view.fixture.writes.length, 1);
      assert.deepEqual(view.errors, []);
    } finally {releasePdf?.(); view.close();}
  });
}

const hookPayload = () => ({
  to_email: CLIENT_EMAIL, subject: 'Captured subject', html_body: '<p>Captured original HTML</p>',
  client_id: CLIENT, attachments: [{filename: 'Synthetic.pdf', content: 'c3ludGhldGlj'}],
});
const sendHook = view => view.window.emailHook.send(async () => {
  view.fixture.buildCount = (view.fixture.buildCount || 0) + 1;
  return view.fixture.originalPayload;
});

for (const failure of ['502', 'transport']) {
  test('shared send hook retains captured HTML/PDF and request ID after ' + failure + ' ambiguity', async () => {
    const view = await emailView('hook');
    try {
      view.fixture.originalPayload = hookPayload();
      const first = sendHook(view);
      await view.wait(() => view.fixture.requests.length === 1);
      const captured = plain(view.fixture.requests[0].body);
      if (failure === '502') view.fail(0, 502, 'Synthetic original delivery attempt failed');
      else view.fixture.requests[0].reject(new Error('Synthetic uncertain transport result'));
      await first;
      await view.wait(() => view.window.emailHook.hasRetry && !view.window.emailHook.saving);
      assert.equal(view.fixture.writes.length, 0);
      view.fixture.originalPayload.html_body = '<p>Changed after initial request</p>';
      view.fixture.originalPayload.attachments[0].content = 'changed-pdf-bytes';
      const retry = sendHook(view);
      await view.wait(() => view.fixture.requests.length === 2);
      assert.deepEqual(view.fixture.requests[1].body, captured);
      assert.equal(view.fixture.buildCount, 1);
      view.reply(1);
      await retry;
      assert.equal(view.fixture.successes, 1);
      assert.equal(view.fixture.writes.length, 1);
      assert.deepEqual(view.errors, []);
    } finally {view.close();}
  });
}

test('shared send hook unlocks validation failures and generates a fresh intent for corrected content', async () => {
  const view = await emailView('hook');
  try {
    view.fixture.originalPayload = hookPayload();
    const first = sendHook(view);
    await view.wait(() => view.fixture.requests.length === 1);
    const originalRequestId = view.fixture.requests[0].body.request_id;
    view.fail(0, 400, 'Synthetic validation rejection before customer send');
    await first;
    await view.wait(() => !view.window.emailHook.hasRetry && !view.window.emailHook.inputsLocked);
    view.fixture.originalPayload.subject = 'Corrected customer subject';
    const corrected = sendHook(view);
    await view.wait(() => view.fixture.requests.length === 2);
    assert.equal(view.fixture.requests[1].body.subject, 'Corrected customer subject');
    assert.notEqual(view.fixture.requests[1].body.request_id, originalRequestId);
    assert.equal(view.fixture.buildCount, 2);
    view.reply(1);
    await corrected;
    assert.equal(view.fixture.successes, 1);
    assert.equal(view.fixture.writes.length, 1);
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});

test('shared send hook retries a failed status write without invoking the email function again', async () => {
  const view = await emailView('hook', {statusErrors: ['Synthetic status save failure']});
  try {
    view.fixture.originalPayload = hookPayload();
    const first = sendHook(view);
    await view.wait(() => view.fixture.requests.length === 1);
    view.reply(0);
    await first;
    await view.wait(() => view.window.emailHook.hasRetry && !view.window.emailHook.saving);
    assert.equal(view.fixture.successes, 0);
    assert.deepEqual(view.fixture.openChanges, []);
    await sendHook(view);
    assert.equal(view.fixture.requests.length, 1);
    assert.equal(view.fixture.writes.length, 2);
    assert.equal(view.fixture.buildCount, 1);
    assert.equal(view.fixture.successes, 1);
    assertInvalidations(view, 'invoice');
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});

test('shared send hook finishes a confirmed delivery status write after 24 hours without sending again', async () => {
  const view = await emailView('hook', {statusErrors: ['Synthetic status save failure']});
  try {
    let now = 1_800_000_000_000;
    view.window.Date.now = () => now;
    view.fixture.originalPayload = hookPayload();
    const first = sendHook(view);
    await view.wait(() => view.fixture.requests.length === 1);
    view.reply(0);
    await first;
    await view.wait(() => view.window.emailHook.hasRetry && !view.window.emailHook.saving);
    assert.equal(view.fixture.successes, 0);
    assert.deepEqual(view.fixture.openChanges, []);
    now += 25 * 60 * 60 * 1000;
    await sendHook(view);
    assert.equal(view.fixture.requests.length, 1, 'A confirmed email needs no provider retry.');
    assert.equal(view.fixture.writes.length, 2);
    assert.equal(view.fixture.buildCount, 1);
    assert.equal(view.fixture.successes, 1);
    assert.deepEqual(view.fixture.openChanges, [false]);
    assert.equal(view.window.emailHook.retryExpired, false);
    assertInvalidations(view, 'invoice');
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});

test('shared send hook refuses a copy when the configured business email is invalid', async () => {
  const view = await emailView('hook', {companyEmail: 'invalid'});
  try {
    view.fixture.originalPayload = hookPayload();
    view.window.emailHook.setSendCopy(true);
    await view.wait(() => view.window.emailHook.sendCopy);
    await sendHook(view);
    assert.equal(view.fixture.requests.length, 0);
    assert.equal(view.fixture.buildCount || 0, 0);
    assert.equal(view.fixture.successes, 0);
    assert.ok(view.fixture.toasts.some(toast => toast.level === 'error' && toast.args[0].includes('valid company email')));
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});

test('shared send hook prevents retry after the provider 24-hour idempotency window has expired', async () => {
  const view = await emailView('hook');
  try {
    let now = 1_800_000_000_000;
    view.window.Date.now = () => now;
    view.fixture.originalPayload = hookPayload();
    view.window.emailHook.setSendCopy(true);
    await view.wait(() => view.window.emailHook.sendCopy);
    const first = sendHook(view);
    await view.wait(() => view.fixture.requests.length === 1);
    view.reply(0, {success: true, copy_status: 'failed'});
    await first;
    await view.wait(() => view.window.emailHook.copyPending && !view.window.emailHook.saving);
    now += 24 * 60 * 60 * 1000;
    await sendHook(view);
    await view.wait(() => view.window.emailHook.retryExpired);
    assert.equal(view.fixture.requests.length, 1, 'An expired retry cannot re-send the primary or company copy.');
    assert.equal(view.fixture.writes.length, 1);
    assert.equal(view.fixture.successes, 0);
    assert.deepEqual(view.fixture.openChanges, []);
    assert.ok(view.window.emailHook.errorMessage.includes('client email was sent'));
    assert.ok(view.window.emailHook.errorMessage.includes('too old to retry safely'));
    assert.deepEqual(view.errors, []);
  } finally {view.close();}
});
