import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('login and signup display the shared FuzedFlow brand logo', async () => {
  const [logo, login, signup] = await Promise.all([
    read('../../src/components/shared/AuthBrandLogo.jsx'),
    read('../../src/pages/Login.jsx'),
    read('../../src/pages/Signup.jsx'),
  ]);

  assert.match(logo, /FuzedFlowHero\.webp/);
  assert.match(logo, /alt="FuzedFlow"/);
  assert.match(logo, /mb-4 h-24 w-24.*sm:h-28 sm:w-28/);
  assert.match(login, /<AuthBrandLogo \/>/);
  assert.match(signup, /<AuthBrandLogo \/>/);
  assert.match(signup, /min-h-\[100dvh\] bg-slate-50 px-4 py-8 sm:py-10/);
  assert.match(signup, /mx-auto max-w-md w-full space-y-6/);
});
