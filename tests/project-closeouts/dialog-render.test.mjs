import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    sourcefile: "project-closeout-dialog-fixture.jsx",
    loader: "jsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import DeficiencyItemDialog from './src/components/closeouts/DeficiencyItemDialog.jsx';
      const item={id:'item-1',photo_url:'https://example.invalid/one.jpg',photo_urls:['https://example.invalid/one.jpg','https://example.invalid/two.jpg'],deficiency_type:'Painting',description:'Touch up wall',status:'Open'};
      createRoot(document.getElementById('root')).render(<DeficiencyItemDialog open onOpenChange={()=>{}} item={item} vendors={[]} saving={false} onSave={()=>Promise.resolve(true)} />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: {
    "process.env.NODE_ENV": '"test"',
    "import.meta.env.VITE_SUPABASE_URL": '"https://example.supabase.co"',
    "import.meta.env.VITE_SUPABASE_ANON_KEY": '"test-anon-key"',
  },
  alias: { "@": `${root}/src` },
});

test("the real closeout dialog renders separate camera and mobile-library controls with multiple previews", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://fixture.example/ProjectCloseoutView?id=20000000-0000-4000-8000-000000000005",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  try {
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
    dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.eval(bundle.outputFiles[0].text);
    await new Promise(resolve => setTimeout(resolve, 500));

    const dialog = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /Take photo/);
    assert.match(dialog.textContent, /Choose from device/);
    assert.match(dialog.textContent, /2 of 10/);
    assert.equal(dialog.querySelectorAll("img").length, 2);

    const camera = dialog.querySelector('input[aria-label="Take a deficiency photo"]');
    const library = dialog.querySelector('input[aria-label="Choose deficiency photos from device"]');
    assert.equal(camera.getAttribute("capture"), "environment");
    assert.equal(camera.multiple, false);
    assert.equal(library.hasAttribute("capture"), false);
    assert.equal(library.multiple, true);
    assert.match(dialog.className, /h-\[100dvh\]/);

    dialog.querySelector('button[aria-label="Remove deficiency photo 2"]').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(dialog.querySelectorAll("img").length, 1);
    assert.match(dialog.textContent, /1 of 10/);
  } finally {
    dom.window.close();
  }
});
