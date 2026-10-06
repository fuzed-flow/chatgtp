import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const bundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import { AuthProvider, useAuth } from "./src/lib/AuthContext.jsx";

      function Probe() {
        const auth = useAuth();
        window.authContextSnapshot = auth;
        return <main data-loading={String(auth.loading)} data-user={auth.user?.id || "signed-out"} data-access-error={auth.accessError?.code || ""}>{auth.profile?.is_active === false ? "Inactive" : "Active"}</main>;
      }

      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const clear = client.clear.bind(client);
      client.clear = () => { window.authContextFixture.cacheClears += 1; clear(); };
      window.authContextRoot = createRoot(document.getElementById("root"));
      window.authContextRoot.render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
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
    name: "inactive-auth-fixture",
    setup(builder) {
      builder.onResolve({ filter: /(?:supabaseClient|notificationPush)$/ }, args => ({ path: args.path, namespace: "inactive-auth-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "inactive-auth-fixture" }, args => {
        if (args.path.includes("notificationPush")) {
          return { contents: "export async function clearNotificationPushOnSignOut() { window.authContextFixture.pushClears += 1; }", loader: "js" };
        }
        return {
          contents: `
            const fixture = () => window.authContextFixture;
            const result = table => {
              fixture().requests ||= {};
              fixture().requests[table] = (fixture().requests[table] || 0) + 1;
              const isProfile = table === "profiles";
              return Promise.resolve({
                data: isProfile ? fixture().profile : fixture().company,
                error: isProfile ? fixture().profileError || null : fixture().companyError || null,
              });
            };
            export const supabase = {
              auth: {
                getSession: async () => ({ data: { session: { user: fixture().sessionUser } } }),
                onAuthStateChange: callback => {
                  fixture().authCallback = callback;
                  return { data: { subscription: { unsubscribe() { fixture().unsubscribed += 1; } } } };
                },
                signOut: async () => { fixture().signOuts += 1; return { error: null }; },
              },
              from(table) {
                const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle() { return result(table); } };
                return chain;
              },
            };
          `,
          loader: "js",
        };
      });
    },
  }],
});

test("AuthProvider clears and signs out an inactive account before protected children can treat it as authenticated", async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/EmployeePortal",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const id = "10000000-0000-4000-8000-000000000010";
  dom.window.authContextFixture = {
    sessionUser: { id },
    profile: { id, company_id: "10000000-0000-4000-8000-000000000001", role: "employee", is_active: false },
    company: { id: "10000000-0000-4000-8000-000000000001", settings: {} },
    cacheClears: 0,
    pushClears: 0,
    signOuts: 0,
    unsubscribed: 0,
  };
  dom.window.eval((await bundlePromise).outputFiles[0].text);
  try {
    for (let attempt = 0; attempt < 160 && dom.window.authContextFixture.signOuts !== 1; attempt++) await pause(10);
    const output = dom.window.document.querySelector("main");
    assert.ok(output);
    assert.equal(output.dataset.loading, "false");
    assert.equal(output.dataset.user, "signed-out");
    assert.equal(dom.window.authContextSnapshot.user, null);
    assert.equal(dom.window.authContextFixture.signOuts, 1);
    assert.equal(dom.window.authContextFixture.pushClears, 1);
    assert.ok(dom.window.authContextFixture.cacheClears >= 1);
    assert.deepEqual(errors, []);
  } finally {
    dom.window.authContextRoot.unmount();
    dom.window.close();
  }
});

async function settledAuthView(overrides = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/EmployeePortal",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const id = "10000000-0000-4000-8000-000000000010";
  const companyId = "10000000-0000-4000-8000-000000000001";
  dom.window.authContextFixture = {
    sessionUser: { id },
    profile: { id, company_id: companyId, role: "employee", is_active: true },
    company: { id: companyId, settings: {} },
    profileError: null,
    companyError: null,
    requests: {},
    cacheClears: 0,
    pushClears: 0,
    signOuts: 0,
    unsubscribed: 0,
    ...overrides,
  };
  dom.window.eval((await bundlePromise).outputFiles[0].text);
  const wait = async predicate => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (predicate()) return;
      await pause(10);
    }
    throw new Error(`Auth context did not settle: ${dom.window.document.body.innerHTML}; errors: ${errors.join("; ")}`);
  };
  await wait(() => dom.window.document.querySelector("main")?.dataset.loading === "false");
  return {
    dom,
    wait,
    get output() { return dom.window.document.querySelector("main"); },
    get auth() { return dom.window.authContextSnapshot; },
    close() {
      dom.window.authContextRoot.unmount();
      dom.window.close();
      assert.deepEqual(errors, []);
    },
  };
}

test("AuthProvider settles with a recoverable access error instead of spinning on missing or failed records", async () => {
  const scenarios = [
    { overrides: { profile: null }, code: "profile_not_found" },
    { overrides: { profile: null, profileError: { message: "profile unavailable" } }, code: "profile_load_failed" },
    { overrides: { company: null }, code: "company_not_found" },
    { overrides: { company: null, companyError: { message: "company unavailable" } }, code: "company_load_failed" },
    {
      overrides: { profile: { id: "10000000-0000-4000-8000-000000000010", company_id: null, role: "employee", is_active: true } },
      code: "company_not_assigned",
    },
  ];

  for (const scenario of scenarios) {
    const view = await settledAuthView(scenario.overrides);
    try {
      assert.equal(view.output.dataset.loading, "false");
      assert.equal(view.output.dataset.user, "10000000-0000-4000-8000-000000000010");
      assert.equal(view.output.dataset.accessError, scenario.code);
      assert.equal(view.auth.accessError.code, scenario.code);
    } finally {
      view.close();
    }
  }
});

test("AuthProvider retry recovers when a missing canonical profile becomes available", async () => {
  const view = await settledAuthView({ profile: null });
  try {
    assert.equal(view.auth.accessError.code, "profile_not_found");
    view.dom.window.authContextFixture.profile = {
      id: "10000000-0000-4000-8000-000000000010",
      company_id: "10000000-0000-4000-8000-000000000001",
      full_name: "Recovered Employee",
      role: "employee",
      is_active: true,
    };
    await view.auth.refreshAccess();
    await view.wait(() => view.auth.accessError === null && view.auth.company?.id === "10000000-0000-4000-8000-000000000001");
    assert.equal(view.auth.profile.full_name, "Recovered Employee");
    assert.ok(view.dom.window.authContextFixture.requests.profiles >= 2);
  } finally {
    view.close();
  }
});

test("AuthProvider keeps a settled workspace usable when a background access refresh fails", async () => {
  const view = await settledAuthView();
  try {
    assert.equal(view.auth.accessError, null);
    view.dom.window.authContextFixture.profileError = { message: "temporary profile refresh failure" };
    await view.auth.refreshAccess();
    await view.wait(() => view.dom.window.authContextFixture.requests.profiles >= 2);
    assert.equal(view.auth.accessError, null);
    assert.equal(view.auth.profile.id, "10000000-0000-4000-8000-000000000010");

    view.dom.window.authContextFixture.profileError = null;
    view.dom.window.authContextFixture.companyError = { message: "temporary company refresh failure" };
    await view.auth.refreshAccess();
    await view.wait(() => view.dom.window.authContextFixture.requests.companies >= 2);
    assert.equal(view.auth.accessError, null);
    assert.equal(view.auth.company.id, "10000000-0000-4000-8000-000000000001");
  } finally {
    view.close();
  }
});
