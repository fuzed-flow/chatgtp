import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const employeePanel = name => `
  import React from "react";
  export default function Panel({ mode }) {
    return <section data-portal-panel=${JSON.stringify(name)}><h3>${name}{mode ? ":" + mode : ""}</h3></section>;
  }
`;

const fixturePlugin = {
  name: "employee-portal-menu-fixture",
  setup(builder) {
    builder.onResolve({
      filter: /(?:AuthContext|supabaseClient|planConfig|useRouteScrollReset|components\/ui\/(?:button|dropdown-menu|dialog)|components\/shared\/(?:UpgradeWall|GlobalSearch|OnboardingTour|AccessibilityEnhancer|EnhancedNotificationCenter|HelpMenu)|components\/employee\/EP(?:Timesheets|Expenses|Tasks|DailyLogs|Payroll|Profile|VacationTracker|TimeClock|Inventory|AssignedWork))$/,
    }, args => ({ path: args.path, namespace: "portal-menu-fixture" }));

    builder.onLoad({ filter: /.*/, namespace: "portal-menu-fixture" }, args => {
      let contents;
      if (args.path.includes("AuthContext")) {
        contents = "export const useAuth = () => window.employeePortalFixture.auth;";
      } else if (args.path.includes("supabaseClient")) {
        contents = `
          const result = () => Promise.resolve({ data: window.employeePortalFixture.user, error: null });
          const chain = {
            select() { return this; }, eq() { return this; }, maybeSingle: result,
            single: result, then(resolve, reject) { return result().then(resolve, reject); }
          };
          export const supabase = { from() { return Object.create(chain); } };
        `;
      } else if (args.path.includes("planConfig")) {
        contents = "export const checkAccess = (plan, feature) => feature !== 'hasHR' || plan !== 'starter';";
      } else if (args.path.includes("useRouteScrollReset")) {
        contents = "import { useRef } from 'react'; export const useRouteScrollReset = () => useRef(null);";
      } else if (args.path.endsWith("/button")) {
        contents = `
          import React from "react";
          export const Button = React.forwardRef(function Button({ children, ...props }, ref) {
            return <button ref={ref} {...props}>{children}</button>;
          });
        `;
      } else if (args.path.endsWith("/dropdown-menu")) {
        contents = `
          import React from "react";
          export const DropdownMenu = ({ children }) => <>{children}</>;
          export const DropdownMenuTrigger = ({ children }) => children;
          export const DropdownMenuContent = ({ children }) => <div>{children}</div>;
          export const DropdownMenuItem = ({ asChild, children, ...props }) => asChild ? children : <div {...props}>{children}</div>;
        `;
      } else if (args.path.endsWith("/dialog")) {
        contents = `
          import React from "react";
          export const Dialog = ({ open, children }) => open ? <div role="dialog">{children}</div> : null;
          export const DialogContent = ({ children, ...props }) => <div {...props}>{children}</div>;
          export const DialogHeader = ({ children, ...props }) => <div {...props}>{children}</div>;
          export const DialogTitle = ({ children, ...props }) => <h2 {...props}>{children}</h2>;
          export const DialogDescription = ({ children, ...props }) => <p {...props}>{children}</p>;
        `;
      } else if (args.path.includes("UpgradeWall")) {
        contents = "export default function UpgradeWall({ featureName }) { return <section data-upgrade-wall>{featureName}</section>; }";
      } else if (/GlobalSearch|OnboardingTour|AccessibilityEnhancer|EnhancedNotificationCenter|HelpMenu/.test(args.path)) {
        contents = "export default function FixtureGlobalComponent() { return null; }";
      } else {
        const match = args.path.match(/EP([A-Za-z]+)$/);
        contents = employeePanel(match?.[1] || "Unknown");
      }
      return { contents, loader: "jsx", resolveDir: local("../..") };
    });
  },
};

const bundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
      import Layout from "./src/Layout.jsx";
      import EmployeePortal from "./src/pages/EmployeePortal.jsx";

      function RouteProbe() {
        const location = useLocation();
        const navigate = useNavigate();
        window.employeePortalRoute = {
          navigate,
          pathname: location.pathname,
          search: location.search,
        };
        return null;
      }

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      window.employeePortalQueryClient = queryClient;
      window.employeePortalRoot = createRoot(document.getElementById("root"));
      window.employeePortalRoot.render(
        <MemoryRouter initialEntries={[window.employeePortalFixture.path]}>
          <RouteProbe />
          <QueryClientProvider client={queryClient}>
            <Layout currentPageName="EmployeePortal"><EmployeePortal /></Layout>
          </QueryClientProvider>
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
  plugins: [fixturePlugin],
});

const timesheetRedirectBundlePromise = build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
      import Layout from "./src/Layout.jsx";
      import Timesheet from "./src/pages/Timesheet.jsx";

      function RouteProbe() {
        const location = useLocation();
        window.employeePortalRoute = { pathname: location.pathname, search: location.search };
        return null;
      }

      window.employeePortalRoot = createRoot(document.getElementById("root"));
      window.employeePortalRoot.render(
        <MemoryRouter initialEntries={["/Timesheet"]}>
          <RouteProbe />
          <Routes>
            <Route path="/Timesheet" element={<Layout currentPageName="Timesheet"><Timesheet /></Layout>} />
            <Route path="/EmployeePortal" element={<main data-timesheet-destination>Timesheets</main>} />
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
  plugins: [fixturePlugin],
});

async function portalView({
  role = "employee",
  device = "desktop",
  path = "/EmployeePortal?tab=projects",
  plan = "professional",
  settings = {},
  permissions = [],
  profileOverrides = {},
  legacyUser,
} = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://fixture.example${path}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const width = device === "mobile" ? 390 : 1440;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = query => ({
    matches: /min-width:\s*1024px/.test(query) ? width >= 1024 : /max-width:\s*1023px/.test(query) ? width < 1024 : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.employeePortalScrollCalls = [];
  window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
    if (this.matches?.("[data-employee-portal-content]")) window.employeePortalScrollCalls.push(options);
  };
  const profile = {
    id: "10000000-0000-4000-8000-000000000010",
    company_id: "10000000-0000-4000-8000-000000000001",
    full_name: role === "employee" ? "Field Employee" : `${role[0].toUpperCase()}${role.slice(1)} User`,
    email: `${role}@example.invalid`,
    role,
    is_active: true,
    permissions,
    ...profileOverrides,
  };
  window.employeePortalFixture = {
    path,
    user: legacyUser || profile,
    auth: {
      profile,
      company: { id: profile.company_id, plan_id: plan },
      settings,
      signOut: async () => {},
    },
  };
  window.eval((await bundlePromise).outputFiles[0].text);
  const { document } = window;
  const wait = async predicate => {
    for (let attempt = 0; attempt < 180; attempt++) {
      if (predicate()) return;
      await pause(10);
    }
    throw new Error(`Timed out waiting for Employee Portal UI: ${document.body.textContent}; errors: ${errors.join("; ")}`);
  };
  await wait(() => document.querySelector("h1") && window.employeePortalRoute);
  const button = (container, label) => container ? [...container.querySelectorAll("button")].find(node =>
    node.textContent.trim() === label || node.getAttribute("aria-label") === label
  ) : undefined;
  const close = () => {
    window.employeePortalRoot.unmount();
    window.employeePortalQueryClient.clear();
    dom.window.close();
    assert.deepEqual(errors, []);
  };
  return { dom, window, document, wait, button, close, role, device };
}

function visibleAt(element, device) {
  const classes = new Set((element.getAttribute("class") || "").split(/\s+/));
  if (device === "mobile") return !classes.has("hidden") || classes.has("lg:hidden");
  if (classes.has("lg:hidden")) return false;
  return !classes.has("hidden") || classes.has("lg:flex") || classes.has("lg:block");
}

function fixedBottomNavigations(view) {
  return [...view.document.querySelectorAll("nav")].filter(element => {
    const classes = new Set((element.getAttribute("class") || "").split(/\s+/));
    return classes.has("fixed") && (classes.has("bottom-0") || classes.has("inset-x-0")) && visibleAt(element, view.device);
  });
}

test("Employee Portal renders the canonical authenticated profile instead of a stale legacy user mirror", async () => {
  const view = await portalView({
    role: "employee",
    profileOverrides: { full_name: "Canonical Employee" },
    legacyUser: {
      id: "10000000-0000-4000-8000-000000000010",
      company_id: "10000000-0000-4000-8000-000000000001",
      full_name: "Stale Legacy User",
      email: "stale@example.invalid",
      role: "employee",
    },
  });
  try {
    const navigation = view.document.querySelector('aside[aria-label="Employee portal navigation"]');
    assert.match(navigation.textContent, /Canonical Employee/);
    assert.doesNotMatch(view.document.body.textContent, /Stale Legacy User/);
  } finally {
    view.close();
  }
});

test("legacy Timesheet route preserves the canonical timesheets tab redirect for field users", async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.example/Timesheet",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const profile = {
    id: "10000000-0000-4000-8000-000000000010",
    company_id: "10000000-0000-4000-8000-000000000001",
    full_name: "Field Employee",
    email: "employee@example.invalid",
    role: "employee",
    is_active: true,
    permissions: [],
  };
  dom.window.employeePortalFixture = {
    user: profile,
    auth: {
      profile,
      company: { id: profile.company_id, plan_id: "professional" },
      settings: {},
      signOut: async () => {},
    },
  };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.eval((await timesheetRedirectBundlePromise).outputFiles[0].text);
  try {
    for (let attempt = 0; attempt < 160 && !dom.window.document.querySelector("[data-timesheet-destination]"); attempt++) await pause(10);
    await pause(20);
    assert.ok(dom.window.document.querySelector("[data-timesheet-destination]"));
    assert.equal(dom.window.employeePortalRoute.pathname, "/EmployeePortal");
    assert.equal(dom.window.employeePortalRoute.search, "?tab=timesheets");
    assert.deepEqual(errors, []);
  } finally {
    dom.window.employeePortalRoot.unmount();
    dom.window.close();
  }
});

for (const role of ["employee", "subcontractor", "office", "manager", "admin"]) {
  for (const device of ["mobile", "desktop"]) {
    test(`${role} ${device} has one navigation owner per viewport`, async () => {
      const view = await portalView({ role, device });
      try {
        const fieldView = ["employee", "subcontractor"].includes(role);
        const workspaceSidebar = view.document.querySelector("#workspace-navigation");
        const portalSidebar = view.document.querySelector('aside[aria-label="Employee portal navigation"]');
        const workspaceMobile = view.document.querySelector('nav[aria-label="Primary mobile navigation"]');
        const portalMobile = view.document.querySelector('nav[aria-label="Employee portal mobile navigation"]');
        const portalSections = view.document.querySelector('nav[aria-label="Employee portal sections"]');

        assert.equal(Boolean(workspaceSidebar), !fieldView, "Only office roles retain the workspace sidebar in their personal portal.");
        assert.equal(Boolean(portalSidebar), fieldView, "Only field roles use the full Employee Portal sidebar.");
        assert.equal(Boolean(workspaceMobile), !fieldView, "Only office roles retain workspace mobile navigation.");
        assert.equal(Boolean(portalMobile), fieldView, "Only field roles use the fixed portal mobile navigation.");
        assert.equal(Boolean(portalSections), !fieldView, "Office roles use non-fixed portal section navigation.");

        const fullSidebars = [workspaceSidebar, portalSidebar].filter(element => element && visibleAt(element, device));
        assert.equal(fullSidebars.length, device === "desktop" ? 1 : 0, "The viewport must never render two effective full sidebars.");
        assert.equal(fixedBottomNavigations(view).length, device === "mobile" ? 1 : 0, "The viewport must never render two effective fixed bottom bars.");
        if (portalSections) assert.equal((portalSections.getAttribute("class") || "").split(/\s+/).includes("fixed"), false);
      } finally {
        view.close();
      }
    });
  }
}

test("Profile is an explicit reachable destination for field and office portal menus", async () => {
  for (const role of ["employee", "subcontractor"]) {
    const field = await portalView({ role, device: "mobile" });
    try {
      const desktopNavigation = field.document.querySelector('aside[aria-label="Employee portal navigation"]');
      assert.ok(field.button(desktopNavigation, "Profile"), `${role} desktop navigation exposes Profile as a real button.`);
      const mobileNavigation = field.document.querySelector('nav[aria-label="Employee portal mobile navigation"]');
      const more = field.button(mobileNavigation, "More");
      assert.ok(more, `${role} mobile navigation exposes More.`);
      more.click();
      await field.wait(() => field.document.querySelector('[role="dialog"]'));
      assert.ok(field.button(field.document.querySelector('[role="dialog"]'), "Profile"), `${role} mobile menu exposes Profile as a real button.`);
    } finally {
      field.close();
    }
  }

  for (const role of ["office", "manager", "admin"]) {
    const office = await portalView({ role, device: "desktop" });
    try {
      const sections = office.document.querySelector('nav[aria-label="Employee portal sections"]');
      assert.ok(sections, `${role} has portal section navigation.`);
      const profileButton = office.button(sections, "Profile");
      const profileOption = sections.querySelector('option[value="profile"]');
      assert.ok(profileButton || profileOption, `${role} can reach Profile through an explicit control.`);
    } finally {
      office.close();
    }
  }
});

test("office, manager, and admin workspace menus mirror their direct-route access", async () => {
  const scenarios = [
    {
      role: "office", permissions: [], plan: "business",
      present: ["/Invoices", "/HumanResources"], absent: ["/AdminSettings"],
    },
    {
      role: "office", permissions: ["tasks"], plan: "business",
      present: ["/Tasks"], absent: ["/Invoices", "/HumanResources", "/AdminSettings"],
    },
    {
      role: "manager", permissions: [], plan: "business",
      present: ["/AdminSettings"], absent: ["/Invoices", "/HumanResources"],
    },
    {
      role: "manager", permissions: ["projects"], plan: "business",
      present: ["/PMProjects"], absent: ["/AdminSettings", "/Invoices", "/HumanResources"],
    },
    {
      role: "admin", permissions: ["tasks"], plan: "business",
      present: ["/Invoices", "/HumanResources", "/AdminSettings"], absent: [],
    },
    {
      role: "office", permissions: ["tasks"], plan: "professional",
      present: ["/Tasks", "/Invoices", "/HumanResources"], absent: ["/AdminSettings"],
    },
    {
      role: "manager", permissions: ["projects"], plan: "starter",
      present: ["/PMProjects", "/AdminSettings"], absent: ["/Invoices", "/HumanResources"],
    },
  ];

  for (const scenario of scenarios) {
    const view = await portalView({ role: scenario.role, permissions: scenario.permissions, plan: scenario.plan, device: "desktop" });
    try {
      const sidebar = view.document.querySelector("#workspace-navigation");
      const hrefs = new Set([...sidebar.querySelectorAll("a")].map(link => link.getAttribute("href")));
      for (const href of scenario.present) assert.ok(hrefs.has(href), `${scenario.plan} ${scenario.role} ${JSON.stringify(scenario.permissions)} shows ${href}`);
      for (const href of scenario.absent) assert.equal(hrefs.has(href), false, `${scenario.plan} ${scenario.role} ${JSON.stringify(scenario.permissions)} hides ${href}`);
    } finally {
      view.close();
    }
  }
});

test("portal tab changes update browser state and support Back, Forward, and refresh", async () => {
  const view = await portalView({
    role: "employee",
    path: "/EmployeePortal?tab=projects&notificationProject=project-one&notificationPhase=phase-one&notificationTask=task-one&keep=preserved",
  });
  let refreshedPath;
  try {
    const navigation = view.document.querySelector('aside[aria-label="Employee portal navigation"]');
    const tasks = view.button(navigation, "My Tasks");
    assert.ok(tasks);
    tasks.click();
    await view.wait(() => new URLSearchParams(view.window.employeePortalRoute.search).get("tab") === "tasks" && view.document.querySelector("h1")?.textContent.trim() === "My Tasks");
    const changedParams = new URLSearchParams(view.window.employeePortalRoute.search);
    assert.equal(changedParams.get("keep"), "preserved", "Unrelated portal context is preserved.");
    assert.deepEqual([...changedParams.keys()].filter(key => key.startsWith("notification")), [], "Manual section changes clear stale notification context.");
    refreshedPath = `${view.window.employeePortalRoute.pathname}${view.window.employeePortalRoute.search}`;

    const scrollOwner = view.document.querySelector("[data-employee-portal-content]");
    scrollOwner.scrollTop = 480;
    const callsBeforeBack = view.window.employeePortalScrollCalls.length;
    view.window.employeePortalRoute.navigate(-1);
    await view.wait(() => new URLSearchParams(view.window.employeePortalRoute.search).get("tab") === "projects"
      && view.document.querySelector("h1")?.textContent.trim() === "My Projects"
      && view.window.employeePortalScrollCalls.length > callsBeforeBack);
    assert.equal(view.window.employeePortalScrollCalls.at(-1).top, 0);
    assert.equal(view.window.employeePortalScrollCalls.at(-1).behavior, "auto");
    assert.equal(new URLSearchParams(view.window.employeePortalRoute.search).get("notificationProject"), "project-one");
    scrollOwner.scrollTop = 360;
    const callsBeforeForward = view.window.employeePortalScrollCalls.length;
    view.window.employeePortalRoute.navigate(1);
    await view.wait(() => new URLSearchParams(view.window.employeePortalRoute.search).get("tab") === "tasks"
      && view.document.querySelector("h1")?.textContent.trim() === "My Tasks"
      && view.window.employeePortalScrollCalls.length > callsBeforeForward);
    assert.equal(view.window.employeePortalScrollCalls.at(-1).top, 0);
    assert.equal(view.window.employeePortalScrollCalls.at(-1).behavior, "auto");
  } finally {
    view.close();
  }

  const refreshed = await portalView({ role: "employee", path: refreshedPath });
  try {
    const refreshedParams = new URLSearchParams(refreshed.window.employeePortalRoute.search);
    assert.equal(refreshedParams.get("tab"), "tasks");
    assert.equal(refreshedParams.get("keep"), "preserved");
    assert.deepEqual([...refreshedParams.keys()].filter(key => key.startsWith("notification")), []);
    assert.equal(refreshed.document.querySelector("h1")?.textContent.trim(), "My Tasks");
    assert.ok(refreshed.document.querySelector('[data-portal-panel="Tasks"]'));
  } finally {
    refreshed.close();
  }
});

test("separate employee time settings override the legacy combined switch", async () => {
  const view = await portalView({
    role: "employee",
    settings: {
      features: {
        time_clock: false,
        employee_time_clock: true,
        employee_timesheets: false,
        employee_payroll: true,
        employee_time_off: false,
      },
    },
  });
  try {
    const navigation = view.document.querySelector('aside[aria-label="Employee portal navigation"]');
    assert.ok(view.button(navigation, "Clock In"));
    assert.ok(view.button(navigation, "My Pay"));
    assert.equal(view.button(navigation, "My Timesheets"), undefined);
    assert.equal(view.button(navigation, "My Time Off"), undefined);
  } finally {
    view.close();
  }
});

test("companies without separate employee time settings retain the legacy switch behavior", async () => {
  for (const enabled of [true, false]) {
    const view = await portalView({ role: "employee", settings: { features: { time_clock: enabled } } });
    try {
      const navigation = view.document.querySelector('aside[aria-label="Employee portal navigation"]');
      for (const label of ["Clock In", "My Timesheets", "My Pay", "My Time Off"]) {
        assert.equal(Boolean(view.button(navigation, label)), enabled, `${label} follows the legacy time_clock=${enabled} setting.`);
      }
    } finally {
      view.close();
    }
  }
});

test("a disabled deep link keeps the requested section heading without mounting its panel", async () => {
  const view = await portalView({
    role: "employee",
    path: "/EmployeePortal?tab=tasks",
    settings: { features: { tasks: false } },
  });
  try {
    assert.equal(view.document.querySelector("h1")?.textContent.trim(), "My Tasks");
    assert.match(view.document.body.textContent, /This section is disabled in your company's settings/);
    assert.equal(view.document.querySelector('[data-portal-panel="Tasks"]'), null);
  } finally {
    view.close();
  }
});
