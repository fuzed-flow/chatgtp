import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const resolve = value => fileURLToPath(new URL(value, import.meta.url));
const bundle = build({
  stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Personal from './src/components/settings/PersonalNotificationSettings.jsx';import{clearNotificationPushOnSignOut}from'./src/lib/notificationPush.js';window.logoutPush=clearNotificationPushOnSignOut;window.qc=new QueryClient({defaultOptions:{queries:{retry:false}}});window.root=createRoot(document.getElementById('root'));window.root.render(React.createElement(QueryClientProvider,{client:window.qc},React.createElement(Personal)));", resolveDir: resolve('../..'), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': resolve('../../src') },
  plugins: [{ name: 'synthetic-channels', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/supabaseClient$|^@\/lib\/AuthContext$|^sonner$/ }, args => ({ path: args.path, namespace: 'synthetic-channels' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic-channels' }, args => ({ contents: args.path.includes('AuthContext') ? 'export const useAuth=()=>window.fixture.auth;' : args.path === 'sonner' ? 'export const toast={success:message=>window.fixture.messages.push(message),error:message=>window.fixture.messages.push(message)};' : 'export const supabase={from:table=>window.fixture.from(table),rpc:(name,args)=>window.fixture.rpc(name,args)};', loader: 'js' }));
  } }],
});
async function view() {
  const errors = [], virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.fuzedflow.com/AdminSettings', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  Object.defineProperty(window, 'isSecureContext', { value: true });
  window.PushManager = class {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const fixture = { errors, calls: [], messages: [], permissionRequests: 0, subscribed: null, registered: false, unsubscribeCount: 0, saved: null, publicKey: 'B'.repeat(87),
    auth: { profile: { id: 'synthetic-user', company_id: 'synthetic-company', phone: '+17805551234' }, user: { email: 'verified@synthetic.example' }, company: { timezone: 'UTC' } } };
  window.Notification = class { static permission = 'default'; static async requestPermission() { fixture.permissionRequests++; this.permission = 'granted'; return 'granted'; } };
  const registration = {
    getNotifications: async () => [], pushManager: {
      getSubscription: async () => fixture.subscribed,
      subscribe: async options => {
        fixture.calls.push({ name: 'subscribe', options });
        fixture.subscribed = { endpoint: 'https://fcm.googleapis.com/send/synthetic', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/send/synthetic', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }), unsubscribe: async () => { fixture.unsubscribeCount++; fixture.subscribed = null; return true; } };
        return fixture.subscribed;
      },
    },
  };
  Object.defineProperty(window.navigator, 'serviceWorker', { value: { getRegistration: async () => fixture.registered ? registration : undefined, register: async path => { assert.equal(path, '/notification-worker.js'); fixture.registered = true; return registration; }, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} } });
  fixture.from = table => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: table === 'notification_preferences' ? fixture.saved : fixture.subscribed ? { id: 'synthetic-device' } : null, error: null }) });
  fixture.rpc = async (name, args) => {
    fixture.calls.push({ name, args });
    if (name === 'notification_push_config') return { data: { public_key: fixture.publicKey, configured: true }, error: null };
    if (name === 'save_notification_preferences') { fixture.saved = structuredClone(args.p_preferences); return { data: fixture.saved, error: null }; }
    return { data: true, error: null };
  };
  window.fetch = () => { throw new Error('Synthetic settings cannot make network requests'); };
  window.fixture = fixture;
  window.eval((await bundle).outputFiles[0].text);
  const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } window.root?.unmount(); window.qc?.clear(); window.close(); throw new Error('Expected personal notification UI; errors: ' + errors.join('; ')); };
  await wait(() => window.document.querySelector('[aria-label="Instant email"]'));
  const button = text => [...window.document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const close = () => { window.root.unmount(); window.qc.clear(); window.close(); };
  return { window, fixture, wait, button, close };
}

test('personal settings default outbound off, save user channels/categories/digest and never ask permission on page load', async () => {
  const v = await view();
  try {
    assert.equal(v.fixture.permissionRequests, 0);
    for (const label of ['Instant email', 'SMS text messages', 'Device push notifications']) assert.equal(v.window.document.querySelector(`[aria-label="${label}"]`).getAttribute('aria-checked'), 'false');
    v.window.document.querySelector('[aria-label="Instant email"]').click();
    const category = [...v.window.document.querySelectorAll('label')].find(label => label.textContent.trim() === 'Security').querySelector('input');
    category.click();
    const digest = [...v.window.document.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'daily'));
    digest.value = 'weekly'; digest.dispatchEvent(new v.window.Event('change', { bubbles: true }));
    await v.wait(() => v.window.document.body.textContent.includes('Send after'));
    v.button('Save my preferences').click();
    await v.wait(() => v.fixture.saved);
    assert.equal(v.fixture.saved.email, true); assert.equal(v.fixture.saved.sms, false); assert.equal(v.fixture.saved.push, false);
    assert.equal(v.fixture.saved.categories.Security, false); assert.equal(v.fixture.saved.digest_frequency, 'weekly');
    assert.ok(!Object.hasOwn(v.fixture.calls.find(call => call.name === 'save_notification_preferences').args, 'user_id'), 'Server derives account identity.');
    assert.ok(v.button('Save my preferences').classList.contains('min-h-11'));
    assert.deepEqual(v.fixture.errors, []);
  } finally { v.close(); }
});

test('explicit device connect registers public-key push, saves subscription, and logout removes device before account switch', async () => {
  const v = await view();
  try {
    await v.wait(() => !v.button('Connect this device').disabled);
    v.button('Connect this device').click();
    await v.wait(() => v.button('Disable on this device'));
    assert.equal(v.fixture.permissionRequests, 1);
    const call = v.fixture.calls.find(value => value.name === 'subscribe');
    assert.equal(call.options.userVisibleOnly, true); assert.equal(call.options.applicationServerKey.length, 65);
    assert.equal(v.fixture.calls.filter(value => value.name === 'register_notification_push').length, 1);
    assert.ok(!JSON.stringify(v.fixture.calls).includes('private_key'));
    await v.window.logoutPush();
    assert.equal(v.fixture.unsubscribeCount, 1);
    assert.equal(v.fixture.calls.filter(value => value.name === 'remove_notification_push').length, 1);
    assert.equal(v.fixture.subscribed, null);
    assert.deepEqual(v.fixture.errors, []);
  } finally { v.close(); }
});

test('service worker displays encrypted push payload data once and follows only app-origin links', async () => {
  const handlers = {}, notifications = [], broadcasts = [], opened = [], storage = new Map();
  const self = { location: { origin: 'https://app.fuzedflow.com' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, registration: { showNotification: async (title, options) => notifications.push({ title, options }) }, clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://app.fuzedflow.com/Dashboard', postMessage: message => broadcasts.push(message), navigate: async url => opened.push(url), focus: async () => {} }], openWindow: async url => opened.push(url) } };
  const cache = { match: async request => storage.get(request.url), put: async (request, value) => storage.set(request.url, value), keys: async () => [...storage.keys()].map(url => new Request(url)), delete: async request => storage.delete(request.url) };
  vm.runInNewContext(await readFile(new URL('../../public/notification-worker.js', import.meta.url), 'utf8'), { self, URL, Request, Response, caches: { open: async () => cache } });
  const dispatch = async (name, data) => { let promise; handlers[name]({ ...data, waitUntil: value => { promise = value; } }); await promise; };
  const payload = { id: 'synthetic-job', title: 'Task assigned', body: 'Sam assigned Project Alpha on Oct 4, 2026', url: 'https://evil.example/' };
  await dispatch('push', { data: { json: () => payload } }); await dispatch('push', { data: { json: () => payload } });
  assert.equal(notifications.length, 1); assert.ok(notifications[0].options.body.includes('Sam assigned'));
  assert.equal(notifications[0].options.tag, 'synthetic-job');
  await dispatch('notificationclick', { notification: { data: { url: 'https://evil.example/' }, close() {} } });
  assert.deepEqual(opened, ['https://app.fuzedflow.com/']);
  await dispatch('pushsubscriptionchange', {}); assert.equal(broadcasts[0].type, 'fuzedflow-push-expired');
  const show = self.registration.showNotification;
  self.registration.showNotification = async () => { throw new Error('Synthetic display failure'); };
  const retry = { ...payload, id: 'synthetic-display-retry' };
  await assert.rejects(dispatch('push', { data: { json: () => retry } }), /Synthetic display failure/);
  self.registration.showNotification = show;
  await dispatch('push', { data: { json: () => retry } });
  assert.equal(notifications.length, 2, 'A failed display must not suppress the next delivery attempt.');
});
