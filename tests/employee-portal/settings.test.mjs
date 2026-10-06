import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const labels = ["Clock In & Out", "Timesheets", "My Pay", "Time Off"];

const bundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import Settings from "./src/components/settings/EmployeePortalSettings.jsx";
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      window.portalSettingsRoot = createRoot(document.getElementById("root"));
      window.portalSettingsRoot.render(<QueryClientProvider client={client}><Settings /></QueryClientProvider>);
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
  alias: { "@": local("../../src") },
  plugins: [{
    name: "portal-settings-fixture",
    setup(builder) {
      builder.onResolve({ filter: /(?:AuthContext|supabaseClient|sonner|components\/ui\/(?:card|label|switch|button))$/ }, args => ({ path: args.path, namespace: "portal-settings-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "portal-settings-fixture" }, args => {
        let contents;
        if (args.path.includes("AuthContext")) {
          contents = "export const useAuth = () => window.portalSettingsFixture.auth;";
        } else if (args.path.includes("supabaseClient")) {
          contents = `
            export const supabase = { from(table) {
              const write = { table };
              const chain = {
                update(payload) { write.payload = payload; window.portalSettingsFixture.writes.push(write); return chain; },
                eq(key, value) { write.filter = [key, value]; return chain; },
                select(value) { write.select = value; return chain; },
                maybeSingle: async () => ({ data: { id: window.portalSettingsFixture.auth.company.id }, error: null }),
              };
              return chain;
            } };
          `;
        } else if (args.path === "sonner") {
          contents = "export const toast = { success: message => window.portalSettingsFixture.toasts.push(['success', message]), error: message => window.portalSettingsFixture.toasts.push(['error', message]) };";
        } else if (args.path.endsWith("/switch")) {
          contents = `
            import React from "react";
            export function Switch({ checked, onCheckedChange, ...props }) {
              return <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} {...props} />;
            }
          `;
        } else if (args.path.endsWith("/button")) {
          contents = "export function Button({ children, ...props }) { return <button {...props}>{children}</button>; }";
        } else if (args.path.endsWith("/card")) {
          contents = "export function Card({ children, ...props }) { return <section {...props}>{children}</section>; }";
        } else {
          contents = "export function Label({ children, ...props }) { return <label {...props}>{children}</label>; }";
        }
        return { contents, loader: "jsx", resolveDir: local("../..") };
      });
    },
  }],
});

async function settingsView(features) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', { url: "https://fixture.example/AdminSettings", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole });
  const company = { id: "10000000-0000-4000-8000-000000000001" };
  dom.window.portalSettingsFixture = { auth: { company, settings: { locale: "en", features } }, writes: [], toasts: [] };
  dom.window.eval((await bundlePromise).outputFiles[0].text);
  const { document } = dom.window;
  for (let attempt = 0; attempt < 100 && document.querySelectorAll('input[type="checkbox"]').length < 4; attempt++) await pause(10);
  const checkbox = label => document.querySelector(`input[aria-label="Allow employee access to ${label}"]`);
  const save = () => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Save Module Settings"));
  return { dom, window: dom.window, document, errors, checkbox, save };
}

test("settings initializes each time feature from the legacy switch when separate values do not exist", async () => {
  for (const legacy of [true, false]) {
    const view = await settingsView({ time_clock: legacy });
    try {
      for (const label of labels) assert.equal(view.checkbox(label).checked, legacy, `${label} inherits time_clock=${legacy}`);
      assert.deepEqual(view.errors, []);
    } finally {
      view.window.portalSettingsRoot.unmount();
      view.dom.window.close();
    }
  }
});

test("settings persists independent time controls while retaining a compatible legacy master value", async () => {
  const view = await settingsView({
    time_clock: false,
    employee_time_clock: true,
    employee_timesheets: false,
    employee_payroll: true,
    employee_time_off: false,
  });
  try {
    assert.deepEqual(labels.map(label => view.checkbox(label).checked), [true, false, true, false]);
    view.save().click();
    for (let attempt = 0; attempt < 100 && view.window.portalSettingsFixture.writes.length === 0; attempt++) await pause(10);
    assert.equal(view.window.portalSettingsFixture.writes.length, 1);
    const write = view.window.portalSettingsFixture.writes[0];
    assert.equal(write.table, "companies");
    assert.deepEqual(JSON.parse(JSON.stringify(write.filter)), ["id", "10000000-0000-4000-8000-000000000001"]);
    assert.deepEqual(JSON.parse(JSON.stringify(write.payload.settings.features)), {
      time_clock: true,
      employee_time_clock: true,
      employee_timesheets: false,
      employee_payroll: true,
      employee_time_off: false,
      expenses: true,
      inventory: true,
      daily_logs: true,
      tasks: true,
    });
    assert.equal(view.window.portalSettingsFixture.toasts[0][0], "success");
    assert.deepEqual(view.errors, []);
  } finally {
    view.window.portalSettingsRoot.unmount();
    view.dom.window.close();
  }
});
