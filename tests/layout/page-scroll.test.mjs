import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const fixtureBundle = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
      import { useRouteScrollReset } from "./src/hooks/useRouteScrollReset.js";

      function Fixture() {
        const pageScrollRef = useRouteScrollReset();
        const location = useLocation();
        const navigate = useNavigate();
        window.pageScrollFixture = { navigate, location: () => location };
        return <main ref={pageScrollRef} data-app-scroll-container><div>{location.pathname}{location.search}</div></main>;
      }

      createRoot(document.getElementById("root")).render(
        <MemoryRouter initialEntries={["/LeadTracker"]}><Fixture /></MemoryRouter>
      );
    `,
    resolveDir: local("../.."),
    loader: "jsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
});

async function scrollFixture() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/LeadTracker",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  for (const key of ["Request", "Response", "Headers", "AbortController", "AbortSignal"]) window[key] = globalThis[key];
  window.eval((await fixtureBundle).outputFiles[0].text);

  for (let attempt = 0; attempt < 80 && !window.pageScrollFixture; attempt++) await pause(10);
  assert.ok(window.pageScrollFixture, "Scroll fixture mounted");
  return { dom, window, errors, main: window.document.querySelector("main") };
}

test("the authenticated scroll region resets for page and document changes", async () => {
  const view = await scrollFixture();
  try {
    view.main.scrollTop = 900;
    view.main.scrollLeft = 35;
    view.window.pageScrollFixture.navigate("/QuoteBuilder?id=quote-a");
    for (let attempt = 0; attempt < 80 && view.window.pageScrollFixture.location().pathname !== "/QuoteBuilder"; attempt++) await pause(10);
    assert.equal(view.main.scrollTop, 0);
    assert.equal(view.main.scrollLeft, 0);

    view.main.scrollTop = 600;
    view.window.pageScrollFixture.navigate("/QuoteBuilder?id=quote-b");
    for (let attempt = 0; attempt < 80 && view.window.pageScrollFixture.location().search !== "?id=quote-b"; attempt++) await pause(10);
    assert.equal(view.main.scrollTop, 0);
    assert.deepEqual(view.errors, []);
  } finally {
    view.dom.window.close();
  }
});

test("app pages use the shell viewport instead of stacking another viewport", async () => {
  const [layout, styles, lead, client, quote, changeOrder, invoice] = await Promise.all([
    readFile(local("../../src/Layout.jsx"), "utf8"),
    readFile(local("../../src/index.css"), "utf8"),
    readFile(local("../../src/pages/LeadDetail.jsx"), "utf8"),
    readFile(local("../../src/pages/ClientDetail.jsx"), "utf8"),
    readFile(local("../../src/pages/QuoteBuilder.jsx"), "utf8"),
    readFile(local("../../src/pages/ChangeOrderBuilder.jsx"), "utf8"),
    readFile(local("../../src/pages/InvoiceBuilder.jsx"), "utf8"),
  ]);

  assert.match(layout, /h-\[100dvh\]/);
  assert.match(layout, /data-app-scroll-container/);
  assert.match(layout, /ref=\{pageScrollRef\}/);
  assert.match(styles, /\[data-app-scroll-container\] > \.min-h-screen/);
  assert.doesNotMatch(lead, /max-w-5xl mx-auto pb-20/);
  assert.doesNotMatch(client, /max-w-5xl mx-auto pb-20/);
  for (const builder of [quote, changeOrder, invoice]) {
    assert.doesNotMatch(builder, /<div className="min-h-screen[^\"]*(pb-20|pb-24)?/);
  }
});
