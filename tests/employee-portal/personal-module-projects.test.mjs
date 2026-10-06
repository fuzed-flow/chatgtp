import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const COMPANY = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000010";
const ASSIGNED_PROJECT = "10000000-0000-4000-8000-000000000020";
const UNASSIGNED_PROJECT = "10000000-0000-4000-8000-000000000021";
const INVENTORY_ITEM = "10000000-0000-4000-8000-000000000030";

const selectFixture = `
  import React from "react";
  export const SelectItem = () => null;
  export const SelectContent = () => null;
  export const SelectTrigger = () => null;
  export const SelectValue = () => null;
  export function Select({ value, onValueChange, disabled, children }) {
    const options = [];
    const visit = nodes => React.Children.forEach(nodes, node => {
      if (!React.isValidElement(node)) return;
      if (node.type === SelectItem) options.push(node.props);
      else visit(node.props.children);
    });
    visit(children);
    return <select value={value || ""} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.children}</option>)}
    </select>;
  }
`;

const bundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import Expenses from "./src/components/employee/EPExpenses.jsx";
      import Timesheets from "./src/components/employee/EPTimesheets.jsx";
      import Inventory from "./src/components/employee/EPInventory.jsx";

      const fixture = window.personalModuleFixture;
      const components = { expenses: Expenses, timesheets: Timesheets, inventory: Inventory };
      const Component = components[fixture.component];
      const props = fixture.component === "inventory" ? {} : { currentUser: fixture.profile, companyId: fixture.profile.company_id };
      window.personalModuleClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
      window.personalModuleRoot = createRoot(document.getElementById("root"));
      window.personalModuleRoot.render(<QueryClientProvider client={window.personalModuleClient}><Component {...props} /></QueryClientProvider>);
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
    name: "personal-module-project-fixture",
    setup(builder) {
      builder.onResolve({
        filter: /^(?:@\/api\/supabaseClient|@\/lib\/AuthContext|@\/components\/ui\/select|sonner|\.\/EPEquipmentReservations)$/,
      }, args => ({ path: args.path, namespace: "personal-module-project-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "personal-module-project-fixture" }, args => {
        let contents;
        if (args.path.includes("supabaseClient")) {
          contents = `
            export const supabase = {
              from: table => window.personalModuleFixture.from(table),
              rpc: async (name, params) => { window.personalModuleFixture.rpcs.push({ name, params }); return { data: null, error: null }; },
              storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://fixture.invalid/receipt" } }) }) },
            };
          `;
        } else if (args.path.includes("AuthContext")) {
          contents = "export const useAuth = () => window.personalModuleFixture.auth;";
        } else if (args.path.includes("ui/select")) {
          contents = selectFixture;
        } else if (args.path.includes("EPEquipmentReservations")) {
          contents = "export default function EquipmentReservationsFixture() { return null; }";
        } else {
          contents = "export const toast = { success: message => window.personalModuleFixture.toasts.push(['success', message]), error: message => window.personalModuleFixture.toasts.push(['error', message]) };";
        }
        return { contents, loader: "jsx", resolveDir: local("../..") };
      });
    },
  }],
});

const moduleCases = {
  expenses: {
    ownTable: "expenses",
    ownText: "Own diesel purchase",
    openButton: "New Claim",
  },
  timesheets: {
    ownTable: "time_entries",
    ownText: "Own recorded shift",
    openButton: "Submit Missing Hours",
  },
  inventory: {
    ownTable: "inventory_transactions",
    ownText: "Copper pipe",
    openButton: "Log Material Taken",
  },
};

async function moduleView(component, { role, permissions, inventoryFailures = 0 }) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/EmployeePortal",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.confirm = () => true;
  window.fetch = () => { throw new Error("Live requests are not permitted in employee portal tests"); };

  const profile = {
    id: USER,
    company_id: COMPANY,
    full_name: "Portal User",
    email: "portal-user@example.invalid",
    role,
    is_active: true,
    permissions,
  };
  const queries = [];
  let inventoryFailuresRemaining = inventoryFailures;
  const assignedProject = { id: ASSIGNED_PROJECT, name: "Assigned site", company_id: COMPANY };
  const unassignedProject = { id: UNASSIGNED_PROJECT, name: "Unassigned site", company_id: COMPANY };

  const rowsFor = record => {
    if (record.table === "projects") {
      const idScope = record.filters.find(filter => filter.method === "in" && filter.key === "id");
      if (!idScope) return { data: null, error: { message: "Projects module access denied" } };
      return { data: [assignedProject, unassignedProject].filter(project => idScope.value.includes(project.id)), error: null };
    }
    if (record.table === "project_staff") {
      return { data: [{ project_id: ASSIGNED_PROJECT, projects: assignedProject }], error: null };
    }
    if (record.table === "expenses") {
      return { data: [{
        id: "expense-own", company_id: COMPANY, user_id: USER, project_id: ASSIGNED_PROJECT,
        date: "2026-10-05", category: "Fuel", amount: 24.5, description: "Own diesel purchase",
        payment_method: "Personal Card", receipt_url: null, status: "Submitted", admin_notes: null,
        created_at: "2026-10-05T12:00:00Z", purchase_order_id: null, project_material_id: null,
      }], error: null };
    }
    if (record.table === "time_entries") {
      return { data: [{
        id: "shift-own", company_id: COMPANY, user_id: USER, project_id: ASSIGNED_PROJECT,
        date: "2026-10-05", total_hours: 8, clock_in: "2026-10-05T08:00:00Z",
        clock_out: "2026-10-05T16:00:00Z", entry_type: "Manual", status: "Pending",
        notes: "Own recorded shift",
      }], error: null };
    }
    if (record.table === "inventory") {
      const productionColumns = new Set(["id", "name", "item_type", "equipment_status", "quantity_on_hand", "unit"]);
      const unknownColumns = String(record.projection || "").split(",").filter(column => column && !productionColumns.has(column));
      if (unknownColumns.length) return { data: null, error: { message: `Unknown inventory columns: ${unknownColumns.join(", ")}` } };
      if (inventoryFailuresRemaining > 0) {
        inventoryFailuresRemaining -= 1;
        return { data: null, error: { message: "Temporary inventory request failure" } };
      }
      return { data: [{ id: INVENTORY_ITEM, name: "Copper pipe", item_type: "Material", equipment_status: null, quantity_on_hand: 20, unit: "ft" }], error: null };
    }
    if (record.table === "profiles") return { data: [{ id: USER }], error: null };
    if (record.table === "inventory_transactions") {
      const isLegacy = record.filters.some(filter => filter.method === "is" && filter.key === "user_id" && filter.value === null);
      return { data: isLegacy ? [] : [{
        id: "inventory-own", company_id: COMPANY, user_id: USER, inventory_id: INVENTORY_ITEM,
        quantity_changed: -2, project_name: assignedProject.name, notes: "Own material usage",
        created_at: "2026-10-05T13:00:00Z", refunded_at: null,
      }], error: null };
    }
    throw new Error(`Unexpected table read: ${record.table}`);
  };

  const fixture = {
    component,
    profile,
    auth: { profile, company: { id: COMPANY, plan_id: "business" }, settings: {} },
    queries,
    rpcs: [],
    toasts: [],
  };
  fixture.from = table => {
    const record = { table, filters: [] };
    queries.push(record);
    let result;
    const resolve = () => result ||= Promise.resolve().then(() => {
      const response = rowsFor(record);
      return { data: response.data == null ? response.data : plain(response.data), error: response.error };
    });
    const chain = {
      select(projection) { record.projection = projection; return chain; },
      eq(key, value) { record.filters.push({ method: "eq", key, value }); return chain; },
      neq(key, value) { record.filters.push({ method: "neq", key, value }); return chain; },
      in(key, value) { record.filters.push({ method: "in", key, value: plain(value) }); return chain; },
      is(key, value) { record.filters.push({ method: "is", key, value }); return chain; },
      or(value) { record.or = value; return chain; },
      order(key, options) { record.order = { key, options }; return chain; },
      limit(value) { record.limit = value; return chain; },
      maybeSingle() { record.single = true; return resolve(); },
      single() { record.single = true; return resolve(); },
      then(yes, no) { return resolve().then(yes, no); },
    };
    return chain;
  };

  window.personalModuleFixture = fixture;
  window.eval((await bundlePromise).outputFiles[0].text);
  const { document } = window;
  const wait = async condition => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition()) return;
      await pause(10);
    }
    throw new Error(`Timed out waiting for ${component}: ${document.body.textContent.slice(0, 500)}`);
  };
  const button = label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  const close = () => {
    window.personalModuleRoot.unmount();
    window.personalModuleClient.clear();
    dom.window.close();
    assert.deepEqual(errors, []);
  };
  return { window, document, fixture, wait, button, close };
}

function isBroadProjectRead(query) {
  return query.table === "projects" && !query.filters.some(filter => filter.method === "in" && filter.key === "id");
}

function assertTenantAndActorScope(query) {
  assert.ok(query, "expected a personal-record query");
  assert.ok(query.filters.some(filter => filter.method === "eq" && filter.key === "company_id" && filter.value === COMPANY));
  assert.ok(query.filters.some(filter => filter.method === "eq" && filter.key === "user_id" && filter.value === USER));
}

async function assertPersonalModule(component, role, permissions) {
  const definition = moduleCases[component];
  const view = await moduleView(component, { role, permissions });
  try {
    await view.wait(() => view.document.body.textContent.includes(definition.ownText));
    assert.equal(view.fixture.queries.filter(isBroadProjectRead).length, 0, "personal portal must not require a company-wide projects read");

    const assignment = view.fixture.queries.find(query => query.table === "project_staff");
    assertTenantAndActorScope(assignment);

    const ownQuery = view.fixture.queries.find(query => query.table === definition.ownTable
      && query.filters.some(filter => filter.method === "eq" && filter.key === "user_id" && filter.value === USER));
    assertTenantAndActorScope(ownQuery);

    if (component === "inventory") {
      const inventoryQuery = view.fixture.queries.find(query => query.table === "inventory");
      assert.equal(
        inventoryQuery?.projection,
        "id,name,item_type,equipment_status,quantity_on_hand,unit",
        "Inventory requests only columns that exist in the production schema."
      );
    }

    const open = view.button(definition.openButton);
    assert.ok(open, `missing ${definition.openButton} control`);
    open.click();
    await view.wait(() => [...view.document.querySelectorAll("option")].some(option => option.textContent.includes("Assigned site")));
    const optionLabels = [...view.document.querySelectorAll("option")].map(option => option.textContent.trim());
    assert.ok(optionLabels.includes("Assigned site"));
    assert.ok(!optionLabels.includes("Unassigned site"));
  } finally {
    view.close();
  }
}

for (const component of Object.keys(moduleCases)) {
  for (const role of ["office", "manager"]) {
    test(`${component} loads personal records and assigned projects for a Business ${role} without Projects access`, async () => {
      await assertPersonalModule(component, role, ["tasks"]);
    });
  }

  test(`${component} keeps field project choices assignment scoped`, async () => {
    await assertPersonalModule(component, "employee", []);
  });
}

test("inventory Retry refetches a failed warehouse request", async () => {
  const view = await moduleView("inventory", { role: "employee", permissions: [], inventoryFailures: 1 });
  try {
    await view.wait(() => view.document.body.textContent.includes("Inventory could not be loaded"));
    const retry = view.button("Retry");
    assert.ok(retry, "Inventory error state exposes Retry.");
    retry.click();
    await view.wait(() => view.document.body.textContent.includes("Copper pipe"));
    assert.equal(view.fixture.queries.filter(query => query.table === "inventory").length, 2);
  } finally {
    view.close();
  }
});
