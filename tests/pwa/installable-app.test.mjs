import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the web app manifest supports iPhone, Android, and Windows installation', async () => {
  const manifest = JSON.parse(await read('../../public/manifest.json'));

  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.ok(manifest.icons.every(icon => icon.src.startsWith('/')));
});

test('the app registers one shared service worker without caching authenticated pages', async () => {
  const [main, worker] = await Promise.all([
    read('../../src/main.jsx'),
    read('../../public/notification-worker.js'),
  ]);

  assert.match(main, /registerAppServiceWorker/);
  assert.match(worker, /event\.request\.mode !== 'navigate'/);
  assert.match(worker, /fetch\(event\.request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request/);
});

test('install actions and Apple app metadata are visible to users', async () => {
  const [html, login, help] = await Promise.all([
    read('../../index.html'),
    read('../../src/pages/Login.jsx'),
    read('../../src/components/shared/HelpMenu.jsx'),
  ]);

  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon\.png/);
  assert.match(login, /Install FuzedFlow on this device/);
  assert.match(help, /Install FuzedFlow app/);
});
