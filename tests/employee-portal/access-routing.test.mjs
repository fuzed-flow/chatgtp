import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { getRouteAccess } from "../../src/lib/roleAccess.js";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const bundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
      import RoleGuard from "./src/components/RoleGuard.jsx";

      function LocationProbe() {
        const location = useLocation();
        window.accessRoute = location.pathname;
        return null;
      }

      function Restricted() {
        return <RoleGuard allowedRoles={["owner", "admin", "manager", "office"]} requiredPermission="projects">
          <main data-restricted>Restricted projects</main>
        </RoleGuard>;
      }

      createRoot(document.getElementById("root")).render(
        <MemoryRouter initialEntries={["/restricted"]}>
          <LocationProbe />
          <Routes>
            <Route path="/restricted" element={<Restricted />} />
            <Route path="/EmployeePortal" element={<main data-portal>Employee Portal</main>} />
            <Route path="/login" element={<main data-login>Sign in</main>} />
          </Routes>
        </MemoryRouter>
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
  alias: { "@": local("../../src") },
  plugins: [{
    name: "role-guard-auth-fixture",
    setup(builder) {
      builder.onResolve({ filter: /AuthContext$/ }, args => ({ path: args.path, namespace: "role-guard-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "role-guard-fixture" }, () => ({
        contents: "export const useAuth = () => ({ profile: window.accessProfile, company: window.accessCompany });",
        loader: "js",
      }));
    },
  }],
});

async function routeFor(profile, plan = "business") {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/restricted",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  dom.window.accessProfile = profile;
  dom.window.accessCompany = { plan_id: plan };
  dom.window.eval((await bundlePromise).outputFiles[0].text);
  for (let attempt = 0; attempt < 100 && !dom.window.document.querySelector("main"); attempt++) await pause(10);
  assert.ok(dom.window.document.querySelector("main"), `Route did not settle: ${errors.join("; ")}`);
  return {
    route: dom.window.accessRoute,
    restricted: Boolean(dom.window.document.querySelector("[data-restricted]")),
    errors,
    close() { dom.window.close(); },
  };
}

test("role and module permission denials fail closed to the personal portal", async () => {
  for (const profile of [
    { role: "employee", is_active: true, permissions: ["projects"] },
    { role: "manager", is_active: true, permissions: ["tasks"] },
    { role: "office", is_active: true, permissions: ["quotes"] },
  ]) {
    const view = await routeFor(profile);
    try {
      assert.equal(view.route, "/EmployeePortal");
      assert.equal(view.restricted, false);
      assert.deepEqual(view.errors, []);
    } finally {
      view.close();
    }
  }
});

test("inactive profiles are sent to sign in even when their role would otherwise be allowed", async () => {
  const view = await routeFor({ role: "owner", is_active: false, permissions: [] });
  try {
    assert.equal(view.route, "/login");
    assert.equal(view.restricted, false);
    assert.deepEqual(view.errors, []);
  } finally {
    view.close();
  }
});

test("admins retain access and empty legacy office permissions preserve current defaults", async () => {
  for (const profile of [
    { role: "admin", is_active: true, permissions: ["quotes"] },
    { role: "manager", is_active: true, permissions: [] },
    { role: "office", is_active: true, permissions: null },
  ]) {
    const view = await routeFor(profile);
    try {
      assert.equal(view.route, "/restricted");
      assert.equal(view.restricted, true);
      assert.deepEqual(view.errors, []);
    } finally {
      view.close();
    }
  }
});

test("Starter and Professional plans ignore stale custom permission arrays", async () => {
  for (const [profile, plan] of [
    [{ role: "manager", is_active: true, permissions: ["tasks"] }, "starter"],
    [{ role: "office", is_active: true, permissions: ["quotes"] }, "professional"],
  ]) {
    const view = await routeFor(profile, plan);
    try {
      assert.equal(view.route, "/restricted");
      assert.equal(view.restricted, true);
      assert.deepEqual(view.errors, []);
    } finally {
      view.close();
    }
  }
});

test("legacy user roles normalize to the least-privileged employee role", async () => {
  const view = await routeFor({ role: "user", is_active: true, permissions: ["projects"] });
  try {
    assert.equal(view.route, "/EmployeePortal");
    assert.equal(view.restricted, false);
    assert.deepEqual(view.errors, []);
  } finally {
    view.close();
  }
});

test("an undeclared route access key fails closed", () => {
  assert.deepEqual(getRouteAccess("FutureUnregisteredPage").allowedRoles, []);
});
