import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter, Route, Routes } from 'react-router-dom';
      import { Toaster } from './src/components/ui/toaster';
      import { toast, useToast } from './src/components/ui/use-toast';
      import Login from './src/pages/Login';
      function Controls() {
        const { toasts, dismiss } = useToast();
        window.dismissAll = dismiss;
        return <output id="toast-count">{toasts.length}</output>;
      }
      window.showToast = toast;
      window.fixtureRoot = createRoot(document.getElementById('root'));
      window.fixtureRoot.render(<MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>
        <Controls />
        <Toaster />
      </MemoryRouter>);
    `,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: { '@': `${root}/src` },
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'synthetic-auth', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/supabaseClient$|^@\/lib\/AuthContext$|InstallAppDialog/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents:
      path.includes('supabaseClient')
        ? 'export const supabase={auth:window.authFixture};'
        : path.includes('AuthContext')
          ? 'export const useAuth=()=>({user:null});'
          : 'export default function InstallAppDialog(){return null;} export const useInstallApp=()=>({status:"installed",platform:"android",install:async()=>({outcome:"unavailable"})});',
    }));
  } }],
});

async function fixture() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://app.fuzedflow.com/login',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.fetch = () => { throw new Error('A notification test must not make live requests.'); };
  let attempts = 0;
  window.authFixture = {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ++attempts === 1
      ? { error: { message: 'Invalid login credentials' } }
      : { data: { session: { user: { id: 'synthetic-user' } } }, error: null },
    signInWithOAuth: async () => ({ error: { message: 'Synthetic Google connection failed' } }),
  };
  window.eval(bundle.outputFiles[0].text);
  const wait = async predicate => {
    for (let attempt = 0; attempt < 700; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Notification did not reach expected state. ${errors.join('; ')}`);
  };
  await wait(() => window.document.querySelector('form') && window.dismissAll);
  const notifications = () => [...window.document.querySelectorAll('li[data-state="open"]')];
  return {
    window, errors, wait, notifications,
    close() { window.fixtureRoot.unmount(); window.close(); },
  };
}

test('the visible close button dismisses a notification and its stored state is removed', async () => {
  const view = await fixture();
  try {
    view.window.showToast({ title: 'Saved successfully', duration: Infinity });
    await view.wait(() => view.notifications().length === 1);
    const close = view.notifications()[0].querySelector('button[aria-label="Dismiss notification"]');
    close.click();
    await view.wait(() => view.notifications().length === 0);
    await view.wait(() => view.window.document.querySelector('#toast-count').textContent === '0');
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('ordinary notices expire automatically while explicitly persistent notices can be dismissed', async () => {
  const view = await fixture();
  try {
    view.window.showToast({ title: 'An ordinary notice' });
    await view.wait(() => view.notifications().length === 1);
    await view.wait(() => view.notifications().length === 0);
    view.window.showToast({ title: 'Persistent notice', duration: Infinity });
    await view.wait(() => view.notifications().length === 1);
    view.window.dismissAll();
    await view.wait(() => view.notifications().length === 0);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('a successful login clears the previous credential warning and opens the dashboard', async () => {
  const view = await fixture();
  try {
    view.window.document.querySelector('form').dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true }));
    await view.wait(() => view.notifications().some(node => node.textContent.includes('Incorrect email or password')));
    view.window.document.querySelector('form').dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true }));
    await view.wait(() => view.window.document.querySelector('h1')?.textContent === 'Dashboard');
    assert.equal(view.notifications().length, 0);
    assert.ok(!view.window.document.body.textContent.includes('Welcome back!'));
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});

test('Google connection failures show a dismissible notification', async () => {
  const view = await fixture();
  try {
    const google = [...view.window.document.querySelectorAll('button')].find(button => button.textContent.includes('Sign in with Google'));
    google.click();
    await view.wait(() => view.notifications().some(node => node.textContent.includes('Synthetic Google connection failed')));
    view.notifications()[0].querySelector('button[aria-label="Dismiss notification"]').click();
    await view.wait(() => view.notifications().length === 0);
    assert.deepEqual(view.errors, []);
  } finally { view.close(); }
});
