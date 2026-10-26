import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { galleryThumbnailUrl, galleryViewerUrl } from "../../src/lib/galleryImages.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
const original = index => `https://fixture.supabase.co/storage/v1/object/public/lead_files/lead/photo-${index}.jpg`;
const photos = Array.from({ length: 18 }, (_, index) => ({ id: String(index), url: original(index), name: `Photo ${index + 1}` }));
const bundle = await build({
  stdin: {
    resolveDir: root, loader: "jsx", sourcefile: "gallery-fixture.jsx",
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import PhotoGallery from './src/components/shared/PhotoGallery.jsx';
      window.galleryRoot=createRoot(document.getElementById('root'));
      window.renderGallery=(photos=window.fixture.photos)=>window.galleryRoot.render(<PhotoGallery
        photos={photos} onUpload={files=>window.fixture.uploads.push(files.length)}
        onDelete={photo=>window.fixture.deletes.push(photo.id)} />);
      window.renderGallery();`,
  },
  bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": `${root}/src` },
  plugins: [{ name: "isolated-ai-help", setup(builder) {
    builder.onResolve({ filter: /^@\/components\/shared\/AIHelpContext$/ }, () => ({ path: "help", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useAIHelp=()=>({isAvailable:false,registerModalDialog:()=>()=>{}});" }));
  } }],
});

async function view(connection) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://fixture.example/LeadDetail", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  const requests = [];
  const idle = new Map();
  let idleId = 0;
  window.fixture = { photos, uploads: [], deletes: [] };
  if (connection) Object.defineProperty(window.navigator, "connection", { value: connection });
  window.requestIdleCallback = callback => { idle.set(++idleId, callback); return idleId; };
  window.cancelIdleCallback = id => idle.delete(id);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.Image = class {
    naturalWidth = 1920;
    naturalHeight = 1280;
    set src(url) { this.url = url; requests.push(this); }
    get src() { return this.url; }
    decode() { return this.decodeGate || Promise.resolve(); }
  };
  const wait = async predicate => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await pause(); }
    throw new Error(`Expected gallery state. Requests: ${requests.map(r => r.src)}. UI: ${document.body.textContent}`);
  };
  const finish = async (request, failed = false) => {
    assert.ok(request, "The requested image has started loading.");
    if (failed) request.onerror(); else void request.onload();
    await pause();
  };
  window.eval(bundle.outputFiles[0].text);
  await wait(() => document.querySelectorAll("#root img").length === 5);
  await pause();
  return {
    window, document, requests, errors, wait, finish,
    button: text => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === text),
    runIdle: () => { const callbacks = [...idle.values()]; idle.clear(); callbacks.forEach(callback => callback()); },
    close: async () => { window.galleryRoot.unmount(); await pause(); dom.window.close(); },
  };
}

test("viewing images fit within 1920 pixels without cropping; private and external URLs remain unchanged", () => {
  const viewer = new URL(galleryViewerUrl(original(0)));
  assert.match(viewer.pathname, /\/render\/image\/public\//);
  assert.equal(viewer.searchParams.get("width"), "1920");
  assert.equal(viewer.searchParams.get("height"), "1920");
  assert.equal(viewer.searchParams.get("resize"), "contain");
  assert.equal(viewer.searchParams.get("quality"), "80");
  assert.equal(new URL(galleryThumbnailUrl(original(0))).searchParams.get("resize"), "cover");
  for (const url of ["https://other.example/photo.jpg", "https://fixture.supabase.co/storage/v1/object/sign/private/photo.jpg?token=keep", "invalid-url"]) {
    assert.equal(galleryViewerUrl(url), url);
  }
});

test("opening a photo shows its cached thumbnail, waits for decode, then preloads neighbours one at a time", async () => {
  const v = await view();
  try {
    v.document.querySelector("#root img").click();
    await v.wait(() => v.requests.length === 1 && v.document.querySelector("[data-gallery-viewer]"));
    const viewer = () => v.document.querySelector("[data-gallery-viewer]");
    assert.equal(viewer().querySelector("img").src, galleryThumbnailUrl(original(0)));
    assert.equal(viewer().getAttribute("aria-busy"), "true");
    assert.equal(v.requests[0].src, galleryViewerUrl(original(0)));
    assert.equal(v.requests[0].fetchPriority, "high");
    assert.equal(v.document.querySelector('a[target="_blank"]').href, original(0));
    let decoded;
    v.requests[0].decodeGate = new Promise(resolve => { decoded = resolve; });
    await v.finish(v.requests[0]);
    assert.equal(v.requests.length, 1, "Neighbours wait until the selected image is decoded.");
    decoded();
    await v.wait(() => viewer().getAttribute("aria-busy") === "false" && v.requests.length === 2);
    assert.equal(viewer().querySelector("img").src, galleryViewerUrl(original(0)));
    assert.equal(v.requests[1].src, galleryViewerUrl(original(1)));
    await v.finish(v.requests[1]);
    await v.wait(() => v.requests.length === 3);
    assert.equal(v.requests[2].src, galleryViewerUrl(original(17)));
    assert.ok(v.requests.every(request => request.src.includes("/render/image/")), "No originals are downloaded.");
    v.document.querySelector('[aria-label="Next photo"]').click();
    await v.wait(() => viewer().querySelector("img").src === galleryViewerUrl(original(1)));
    assert.equal(v.requests.filter(r => r.src === galleryViewerUrl(original(1))).length, 1, "Navigation reuses the decoded preload.");
    assert.deepEqual(v.errors, []);
  } finally { await v.close(); }
});

test("idle preloading is sequential, warms 15 thumbnails and five viewing images, and survives ordinary rerenders", async () => {
  const v = await view();
  try {
    assert.equal(v.requests.length, 0);
    v.runIdle();
    await v.wait(() => v.requests.length === 1);
    for (let i = 0; i < 20; i++) {
      assert.equal(v.requests.length, i + 1, "Only one background image is started at a time.");
      assert.equal(v.requests[i].src, i < 15 ? galleryThumbnailUrl(original(i)) : galleryViewerUrl(original(i - 15)));
      if (i === 0) {
        v.window.renderGallery(photos.map(photo => ({ ...photo })));
        await pause();
        v.runIdle();
        assert.equal(v.requests.length, 1, "Fresh photo objects do not restart the preload queue.");
      }
      await v.finish(v.requests[i]);
    }
    assert.equal(v.requests.length, 20);
    v.document.querySelectorAll("#root img")[4].click();
    await v.wait(() => v.document.querySelector("[data-gallery-viewer] img")?.src === galleryViewerUrl(original(4)));
    assert.equal(v.requests.filter(r => r.src === galleryViewerUrl(original(4))).length, 1);
  } finally { await v.close(); }
});

test("opening during a background download pauses the queue and rapid navigation cannot display an old photo", async () => {
  const v = await view();
  try {
    v.runIdle();
    await v.wait(() => v.requests.length === 1);
    v.document.querySelector("#root img").click();
    await v.wait(() => v.requests.length === 2);
    await v.finish(v.requests[0]);
    assert.equal(v.requests.length, 2, "The remaining background queue is paused.");
    v.document.querySelector('[aria-label="Next photo"]').click();
    await v.wait(() => v.requests.length === 3);
    await v.finish(v.requests[1], true);
    assert.equal(v.requests.length, 3, "An abandoned photo does not start an original fallback.");
    assert.equal(v.document.querySelector("[data-gallery-viewer] img").src, galleryThumbnailUrl(original(1)));
    await v.finish(v.requests[2]);
    await v.wait(() => v.document.querySelector("[data-gallery-viewer] img").src === galleryViewerUrl(original(1)));
  } finally { await v.close(); }
});

test("failed transforms fall back only for the selected photo and failed originals show an error", async () => {
  const v = await view();
  try {
    v.document.querySelector("#root img").click();
    await v.wait(() => v.requests.length === 1);
    await v.finish(v.requests[0], true);
    await v.wait(() => v.requests.length === 2);
    assert.equal(v.requests[1].src, original(0));
    await v.finish(v.requests[1], true);
    await v.wait(() => v.document.querySelector('[role="alert"]'));
    assert.equal(v.document.querySelector("[data-gallery-viewer]").getAttribute("aria-busy"), "false");
    assert.equal(v.requests.length, 2, "There is no retry loop or neighbour download after a failure.");
    assert.equal(v.document.querySelector('a[target="_blank"]').href, original(0));
  } finally { await v.close(); }
});

test("data saver and slow connections skip speculative downloads but still open selected photos", async () => {
  for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }]) {
    const v = await view(connection);
    try {
      v.runIdle();
      assert.equal(v.requests.length, 0);
      v.document.querySelector("#root img").click();
      await v.wait(() => v.requests.length === 1);
      await v.finish(v.requests[0]);
      await v.wait(() => v.document.querySelector("[data-gallery-viewer]").getAttribute("aria-busy") === "false");
      assert.equal(v.requests.length, 1);
    } finally { await v.close(); }
  }
});

test("the five-photo grid, see more/all, upload and delete actions remain available", async () => {
  const v = await view();
  try {
    v.button("See 10 more").click();
    await v.wait(() => v.document.querySelectorAll("#root img").length === 15);
    v.button("See all (18)").click();
    await v.wait(() => v.document.querySelectorAll("#root img").length === 18);
    v.button("Show less").click();
    await v.wait(() => v.document.querySelectorAll("#root img").length === 5);
    const first = v.document.querySelector("#root img");
    first.dispatchEvent(new v.window.Event("load"));
    await v.wait(() => first.parentElement.querySelector("button"));
    first.parentElement.querySelector("button").click();
    assert.deepEqual(v.window.fixture.deletes, ["0"]);
    const input = v.document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [new v.window.File(["photo"], "photo.jpg", { type: "image/jpeg" })] });
    input.dispatchEvent(new v.window.Event("change", { bubbles: true }));
    assert.deepEqual(v.window.fixture.uploads, [1]);
  } finally { await v.close(); }
});
