import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('shared dialogs stay above desktop and mobile navigation with safe viewport bounds', async () => {
  const [dialog, alertDialog, layout] = await Promise.all([
    read('../../src/components/ui/dialog.jsx'),
    read('../../src/components/ui/alert-dialog.jsx'),
    read('../../src/Layout.jsx'),
  ]);

  assert.match(layout, /z-\[100\]/);
  assert.match(layout, /z-\[110\]/);
  assert.match(dialog, /inset-0 z-\[150\]/);
  assert.match(dialog, /top-\[50%\] z-\[160\]/);
  assert.match(dialog, /env\(safe-area-inset-top\).*env\(safe-area-inset-bottom\)/);
  assert.match(alertDialog, /inset-0 z-\[210\]/);
  assert.match(alertDialog, /top-\[50%\] z-\[220\]/);
});

test('portalled form controls and AI Help remain usable above an open dialog', async () => {
  const [select, menu, help] = await Promise.all([
    read('../../src/components/ui/select.jsx'),
    read('../../src/components/ui/dropdown-menu.jsx'),
    read('../../src/components/shared/AIHelpWidget.jsx'),
  ]);

  assert.match(select, /z-\[300\]/);
  assert.equal((menu.match(/z-\[300\]/g) || []).length, 2);
  assert.match(help, /z-\[250\]/);
  assert.match(help, /z-\[260\]/);
});

test('dashboard note dialogs reserve control space and fullscreen viewers clear the app chrome', async () => {
  const [notes, plans, photos] = await Promise.all([
    read('../../src/components/dashboard/DashboardNotes.jsx'),
    read('../../src/components/pm/PMPlansElevationsTab.jsx'),
    read('../../src/components/pm/ClientProjectPhotos.jsx'),
  ]);

  assert.equal((notes.match(/DialogHeader className="min-h-12 pr-24 text-left"/g) || []).length, 2);
  assert.match(notes, /fixed inset-0 z-\[270\]/);
  assert.match(plans, /fixed inset-0 z-\[270\]/);
  assert.match(photos, /fixed inset-0 z-\[270\]/);
});
