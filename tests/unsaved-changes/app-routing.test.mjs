import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const authModule = `
  import React, { createContext, useContext, useState } from 'react';
  export const AuthContext = createContext(null);
  export function AuthProvider({ children }) {
    const [auth] = useState(() => {
      window.fixtureAuthMounts = (window.fixtureAuthMounts || 0) + 1;
      return window.fixtureAuth;
    });
    return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
  }
  export function useAuth() {
    const auth = useContext(AuthContext);
    if (!auth) throw new Error('Protected auth hook used outside AuthProvider');
    return auth;
  }
`;
const configModule = `
  import React, { useContext, useState } from 'react';
  import { Link, useLocation, useNavigate } from 'react-router-dom';
  import { AuthContext } from '@/lib/AuthContext';
  import UnsavedChangesGuard from ${JSON.stringify(local('../../src/components/shared/UnsavedChangesGuard.jsx'))};
  import { useDocumentChanges, useDocumentState } from ${JSON.stringify(local('../../src/hooks/useDocumentChanges.js'))};
  function Page({ name }) {
    const auth = useContext(AuthContext);
    return <main data-auth-scope={auth ? 'protected' : 'public'}><h1>{name}</h1></main>;
  }
  function Builder({ name }) {
    const location = useLocation();
    const navigate = useNavigate();
    const changes = useDocumentChanges();
    const [mount] = useState(() => ++window.fixtureBuilderMounts);
    const [title, setTitle] = useDocumentState(() => new URLSearchParams(location.search).get('id') || 'new', changes.markDirty);
    const [saving, setSaving] = useState(false);
    const save = async () => {
      const revision = changes.getRevision();
      const snapshot = { title, id: new URLSearchParams(location.search).get('id'), name };
      setSaving(true);
      try {
        const result = await new Promise(resolve => window.fixtureSaveRequests.push({ resolve, snapshot }));
        return result && changes.markSaved(revision) ? result : null;
      } finally { setSaving(false); }
    };
    window.fixtureBuilder = { dirty: changes.hasUnsavedChanges, navigate, mount };
    return <>
      <main data-auth-scope='protected'><h1>{name}</h1>
        <input aria-label='Document title' value={title} onChange={event => setTitle(event.target.value)} />
        <output aria-label='Builder mount'>{mount}</output>
      </main>
      <UnsavedChangesGuard documentName={name} isDirty={changes.isDirty} hasUnsavedChanges={changes.hasUnsavedChanges} saving={saving} onSave={save} />
    </>;
  }
  const simple = name => () => <Page name={name} />;
  export const pagesConfig = {
    mainPage: 'Dashboard',
    Layout: ({ children }) => <div data-layout='app'><Link to='/Dashboard'>Dashboard</Link>{children}</div>,
    Pages: {
      Dashboard: simple('Dashboard'), Invoices: simple('Invoices'), HumanResources: simple('HumanResources'), AdminSettings: simple('AdminSettings'),
      QuoteBuilder: () => <Builder name='QuoteBuilder' />,
      ChangeOrderBuilder: () => <Builder name='ChangeOrderBuilder' />,
      InvoiceBuilder: () => <Builder name='InvoiceBuilder' />,
    },
  };
`;
const mockPlugin = {
  name: 'synthetic-app-boundaries',
  setup(plugin) {
    plugin.onResolve({ filter: /AuthContext|pages\.config|NavigationTracker|AIHelpWidget|\/pages\/|\/ui\/(toaster|use-toast)$/ }, args => {
      if (args.path === '@/lib/AuthContext') return { path: 'auth', namespace: 'app-fixture' };
      if (args.path === './pages.config') return { path: 'config', namespace: 'app-fixture' };
      if (args.path === '@/lib/NavigationTracker') return { path: 'navigation', namespace: 'app-fixture' };
      if (args.path === './components/shared/AIHelpWidget') return { path: 'help', namespace: 'app-fixture' };
      if (args.path === '@/components/ui/toaster') return { path: 'toaster', namespace: 'app-fixture' };
      if (args.path === '@/components/ui/use-toast') return { path: 'toast-hook', namespace: 'app-fixture' };
      if (args.importer.endsWith('/src/App.jsx') && args.path.startsWith('./pages/')) {
        return { path: `page:${args.path.split('/').pop()}`, namespace: 'app-fixture' };
      }
    });
    plugin.onLoad({ filter: /.*/, namespace: 'app-fixture' }, args => {
      let contents;
      if (args.path === 'auth') contents = authModule;
      else if (args.path === 'config') contents = configModule;
      else if (args.path === 'navigation') contents = `import { useNavigate } from 'react-router-dom'; export default function NavigationTracker() { window.fixtureNavigate = useNavigate(); return null; }`;
      else if (args.path === 'help') contents = `export default function AIHelpWidget() { return <aside aria-label='AI help'>AI help</aside>; }`;
      else if (args.path === 'toaster') contents = `export function Toaster() { return null; }`;
      else if (args.path === 'toast-hook') contents = `export const useToast = () => ({});`;
      else contents = `import React, { useContext } from 'react'; import { AuthContext } from '@/lib/AuthContext'; export default function Page() { const auth = useContext(AuthContext); return <main data-auth-scope={auth ? 'protected' : 'public'}><h1>${args.path.slice(5)}</h1></main>; }`;
      return { contents, loader: 'jsx', resolveDir: local('../..') };
    });
  },
};
const bundlePromise = build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './src/App.jsx'; createRoot(document.getElementById('root')).render(<App />);`,
    resolveDir: local('../..'), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') }, plugins: [mockPlugin],
});

async function appView(path, role = 'owner', authenticated = true) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://fixture.example${path}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  for (const key of ['Request', 'Response', 'Headers', 'AbortController', 'AbortSignal']) window[key] = globalThis[key];
  window.fixtureAuth = { loading: false, user: authenticated ? { id: 'synthetic-user' } : null, profile: { role } };
  window.fixtureAuthMounts = 0;
  window.fixtureBuilderMounts = 0;
  window.fixtureSaveRequests = [];
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { document } = window;
  const wait = async predicate => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (predicate()) return;
      await pause(15);
    }
    throw new Error(`Expected App routing state: ${document.body.textContent}; errors: ${errors.join('; ')}`);
  };
  const heading = () => document.querySelector('main h1')?.textContent;
  const prompt = () => document.querySelector('[role="alertdialog"]');
  const button = label => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label);
  const title = () => document.querySelector('input[aria-label="Document title"]');
  window.eval((await bundlePromise).outputFiles[0].text);
  await wait(() => heading() && window.fixtureNavigate);
  await pause(25);
  return { dom, window, document, wait, heading, prompt, button, title, errors };
}

test('actual App public routes and sign-in aliases remain outside AuthProvider', async () => {
  const view = await appView('/PublicQuoteView?id=synthetic-public', 'employee', false);
  try {
    assert.equal(view.heading(), 'PublicQuoteView');
    for (const [path, name] of [
      ['/PublicInvoiceView', 'PublicInvoiceView'], ['/PublicChangeOrderView', 'PublicChangeOrderView'],
      ['/PublicPOView', 'PublicPOView'], ['/ClientPortal', 'ClientPortal'], ['/ContractorPortal', 'ContractorPortal'],
      ['/contractor-portal', 'ContractorPortal'], ['/privacy-policy', 'PrivacyPolicy'], ['/signup', 'Signup'],
      ['/SignIn', 'Login'], ['/signin', 'Login'], ['/login', 'Login'],
    ]) {
      view.window.fixtureNavigate(path);
      await view.wait(() => view.heading() === name && (name !== 'Login' || view.window.location.pathname === '/login'));
      assert.equal(view.document.querySelector('main').dataset.authScope, 'public');
      assert.equal(view.window.fixtureAuthMounts, 0, `${path} bypasses protected auth`);
      assert.equal(view.document.querySelector('[data-layout="app"]'), null);
      assert.equal(view.document.querySelector('[aria-label="AI help"]'), null);
    }
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('actual App redirects unauthenticated protected routes to login', async () => {
  for (const path of ['/Dashboard', '/QuoteBuilder?id=synthetic-document', '/Invoices']) {
    const view = await appView(path, 'owner', false);
    try {
      await view.wait(() => view.heading() === 'Login' && view.window.location.pathname === '/login');
      assert.equal(view.window.fixtureAuthMounts, 1);
      assert.equal(view.document.querySelector('main').dataset.authScope, 'public');
      assert.equal(view.document.querySelector('[aria-label="AI help"]'), null);
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  }
});

test('actual App retains manager, office, and employee RoleGuard boundaries', async () => {
  for (const [role, route, expected] of [
    ['manager', '/', 'Dashboard'], ['manager', '/QuoteBuilder?id=one', 'QuoteBuilder'],
    ['manager', '/AdminSettings', 'AdminSettings'], ['manager', '/Invoices', 'EmployeePortal'],
    ['office', '/Invoices', 'Invoices'], ['office', '/HumanResources', 'HumanResources'],
    ['office', '/AdminSettings', 'EmployeePortal'], ['employee', '/Dashboard', 'EmployeePortal'],
    ['employee', '/HelpArticles', 'HelpArticles'], ['employee', '/Contact', 'Contact'],
  ]) {
    const view = await appView(route, role);
    try {
      await view.wait(() => view.heading() === expected);
      assert.equal(view.document.querySelector('main').dataset.authScope, 'protected');
      assert.ok(view.document.querySelector('[data-layout="app"]'));
      assert.ok(view.document.querySelector('[aria-label="AI help"]'));
      assert.equal(view.window.location.pathname, expected === 'EmployeePortal' ? '/EmployeePortal' : route.split('?')[0]);
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  }
});

test('actual App keeps canceled edits and remounts each builder when Save and exit opens another document', async () => {
  for (const builder of ['QuoteBuilder', 'ChangeOrderBuilder', 'InvoiceBuilder']) {
    const view = await appView(`/${builder}?id=doc-one`);
    try {
      assert.equal(view.title().value, 'doc-one');
      assert.equal(view.window.fixtureBuilderMounts, 1);
      Object.getOwnPropertyDescriptor(view.window.HTMLInputElement.prototype, 'value').set.call(view.title(), 'Preserve focused edits');
      view.title().dispatchEvent(new view.window.Event('input', { bubbles: true }));
      await view.wait(() => view.window.fixtureBuilder.dirty());
      view.window.fixtureNavigate(`/${builder}?id=doc-one#details`);
      await view.wait(() => view.window.location.hash === '#details');
      assert.equal(view.prompt(), null);
      assert.equal(view.window.fixtureBuilderMounts, 1, 'A hash change stays in the current document.');
      view.window.fixtureNavigate(`/${builder}?id=doc-two`);
      await view.wait(() => view.prompt());
      view.button('Cancel').click();
      await view.wait(() => !view.prompt());
      assert.equal(view.window.location.search, '?id=doc-one');
      assert.equal(view.title().value, 'Preserve focused edits');
      assert.equal(view.window.fixtureBuilderMounts, 1);
      view.window.fixtureNavigate(`/${builder}?id=doc-two`);
      await view.wait(() => view.prompt());
      view.button('Save and exit').click();
      await view.wait(() => view.window.fixtureSaveRequests.length === 1);
      assert.equal(view.window.location.search, '?id=doc-one', 'Persistence must finish before changing documents.');
      assert.equal(view.window.fixtureBuilderMounts, 1);
      assert.equal(view.window.fixtureSaveRequests[0].snapshot.title, 'Preserve focused edits');
      assert.equal(view.window.fixtureSaveRequests[0].snapshot.id, 'doc-one');
      view.window.fixtureSaveRequests[0].resolve('saved-document');
      await view.wait(() => view.window.location.search === '?id=doc-two' && view.title()?.value === 'doc-two');
      assert.equal(view.window.fixtureBuilderMounts, 2, 'The next document gets a new state and dirty tracker.');
      assert.equal(view.window.fixtureBuilder.dirty(), false);
      assert.equal(view.prompt(), null);
      assert.deepEqual(view.errors, []);
    } finally { view.dom.window.close(); }
  }
});
