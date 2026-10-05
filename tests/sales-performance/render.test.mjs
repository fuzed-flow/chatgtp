import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const root = fileURLToPath(new URL("../../", import.meta.url));

const report = {
  currentLeads: [{ id: "lead-1", contact_name: "Casey Homeowner", pipeline_stage: "Quoted", source: "Referral", value_estimate: 18000 }],
  kpis: [
    ["leads", "Total leads", 12], ["conversion", "Conversion rate", 25, "%"], ["pipeline", "Pipeline value", 86000], ["won", "Revenue won", 42000],
    ["appointments", "Appointments booked", 8], ["average", "Average deal value", 14000], ["velocity", "Sales velocity", 11, " days"], ["close", "Close rate", 50, "%"],
  ].map(([id, label, value, suffix]) => ({ id, label, value, suffix, currency: ["pipeline", "won", "average"].includes(id), change: 10 })),
  funnelStages: ["New", "Contacted", "Qualified", "Booked Visit", "Quoted", "Negotiation", "Won", "Lost"].map((stage, index) => ({ stage, count: Math.max(1, 12 - index), value: 80000 - index * 7000, percent: 100 - index * 10, records: [] })),
  conversions: [{ from: "New", to: "Contacted", rate: 75, fromCount: 12, toCount: 9 }],
  bottleneck: { from: "New", to: "Contacted", rate: 75, fromCount: 12, toCount: 9 },
  flow: [{ key: "2026-10-05", label: "Oct 5", leads: 12, qualified: 7, appointments: 5, quotes: 4, won: 2, revenue: 42000 }],
  activity: [{ id: "activity-1", lead_id: "lead-1", activity_type: "proposal_viewed", title: "Quote viewed", occurred_at: new Date().toISOString() }],
  sourceBreakdown: [{ source: "Referral", leads: 12, conversion: 25 }],
  pipelineByStage: [{ stage: "Quoted", count: 4, value: 86000 }],
  repPerformance: [{ id: "rep-1", name: "Jordan Lee", leads: 12, appointments: 8, quotes: 5, won: 3, revenue: 42000, closeRate: 50 }],
  forecast: { currentPipeline: 86000, weightedPipeline: 54000, bestCase: 86000, mostLikely: 54000, worstCase: 30000 },
  target: { current: 42000, amount: 100000, remaining: 58000, progress: 42, daysRemaining: 26, requiredDaily: 2231 },
  followUp: { overdue: 2, awaiting: 6, today: 1, completed: 4, reminders: 3 },
  hotLeads: [{ id: "lead-1", contact_name: "Casey Homeowner", service_type: "Renovation", pipeline_stage: "Quoted", assignee: "Jordan Lee", score: 86, value: 18000 }],
  lostReasons: [{ reason: "Budget", count: 2, value: 16000 }],
  insights: [{ tone: "warning", text: "Two leads require follow-up.", action: "Review follow-ups" }],
  filterOptions: { sources: ["Referral"], reps: [{ id: "rep-1", full_name: "Jordan Lee" }] },
};

const bundle = await build({
  stdin: {
    resolveDir: root,
    sourcefile: "sales-performance-render-fixture.jsx",
    loader: "jsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {BrowserRouter} from 'react-router-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import SalesPerformanceDashboard from './src/components/reports/SalesPerformanceDashboard.jsx';
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><BrowserRouter><SalesPerformanceDashboard /></BrowserRouter></QueryClientProvider>);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"test"' },
  alias: { "@": `${root}/src` },
  plugins: [{
    name: "sales-performance-mocks",
    setup(builder) {
      builder.onResolve({ filter: /^@\/(?:lib\/AuthContext|hooks\/useSalesPerformance|api\/supabaseClient)$/ }, args => ({ path: args.path, namespace: "sales-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "sales-mock" }, args => {
        if (args.path.endsWith("AuthContext")) return { loader: "js", contents: `export const useAuth=()=>({profile:{id:'rep-1',company_id:'company-1',role:'owner'}});` };
        if (args.path.endsWith("useSalesPerformance")) return { loader: "js", contents: `export const useSalesPerformance=()=>({report:${JSON.stringify(report)},isLoading:false,isError:false,isFetching:false,dataUpdatedAt:Date.now(),data:{target:{id:'target-1',revenue_target:100000}},monthStart:'2026-10-01',refetch:()=>Promise.resolve()});` };
        return { loader: "js", contents: `const chain={eq(){return this},update(){return this},insert(){return Promise.resolve({error:null})},then(resolve){return Promise.resolve({error:null}).then(resolve)}};export const supabase={from:()=>chain};` };
      });
    },
  }],
});

const layoutBundle = await build({
  stdin: {
    resolveDir: root,
    sourcefile: "mobile-layout-render-fixture.jsx",
    loader: "jsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {BrowserRouter} from 'react-router-dom';
      import Layout from './src/Layout.jsx';
      createRoot(document.getElementById('root')).render(<BrowserRouter><Layout currentPageName="Dashboard"><p>Workspace content</p></Layout></BrowserRouter>);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"test"' },
  alias: { "@": `${root}/src` },
  plugins: [{
    name: "mobile-layout-mocks",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/AuthContext$/ }, args => ({ path: args.path, namespace: "layout-mock" }));
      builder.onResolve({ filter: /^\.\/components\/shared\/(?:GlobalSearch|OnboardingTour|AccessibilityEnhancer|EnhancedNotificationCenter|HelpMenu)$/ }, args => ({ path: args.path, namespace: "layout-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "layout-mock" }, args => {
        if (args.path.endsWith("AuthContext")) return { loader: "js", contents: `export const useAuth=()=>({profile:{id:'owner-1',company_id:'company-1',role:'owner',full_name:'Owner User',email:'owner@example.test'},signOut:()=>{}});` };
        const label = args.path.includes("GlobalSearch") ? "Search" : args.path.includes("EnhancedNotificationCenter") ? "Notifications" : args.path.includes("HelpMenu") ? "Help" : null;
        return { loader: "jsx", resolveDir: root, contents: label ? `import React from 'react';export default function Mock(){return <button type="button" aria-label="${label}">${label}</button>}` : `export default function Mock(){return null}` };
      });
    },
  }],
});

test("the real Sales Performance component renders its responsive dashboard shell", async () => {
  const messages = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => messages.push(String(error)));
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/SalesPerformance", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole });
  try {
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    dom.window.eval(bundle.outputFiles[0].text);
    await new Promise(resolve => setTimeout(resolve, 150));
    const text = dom.window.document.body.textContent;
    for (const expected of ["Sales Performance", "Total leads", "Sales funnel", "Lead flow over time", "Sales rep performance", "Monthly sales target", "Casey Homeowner", "Website visitor analytics are not connected"]) assert.match(text, new RegExp(expected));
    assert.equal(dom.window.document.querySelectorAll("button").length > 10, true);
    assert.deepEqual(messages, []);
  } finally {
    dom.window.close();
  }
});

test("the real mobile layout opens More without a hamburger drawer", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/Dashboard", runScripts: "dangerously", pretendToBeVisual: true });
  try {
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 390 });
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    dom.window.eval(layoutBundle.outputFiles[0].text);
    await new Promise(resolve => setTimeout(resolve, 80));
    const mobileNav = dom.window.document.querySelector('[aria-label="Primary mobile navigation"]');
    assert.ok(mobileNav);
    assert.match(mobileNav.textContent, /Dashboard.*Leads.*Projects.*Tasks.*More/s);
    assert.equal(dom.window.document.querySelector('[aria-label="Open navigation menu"]'), null);
    [...mobileNav.querySelectorAll("button")].find(button => button.textContent.includes("More")).click();
    await new Promise(resolve => setTimeout(resolve, 80));
    const dialog = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /Sales Performance/);
    assert.match(dialog.textContent, /Quotes/);
    assert.match(dialog.textContent, /Reports/);
  } finally {
    dom.window.close();
  }
});
