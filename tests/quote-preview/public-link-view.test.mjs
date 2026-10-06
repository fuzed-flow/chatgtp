import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildPublicQuoteUrl } from '../../src/lib/publicQuoteLinks.js';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const ID = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(64);
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import PublicQuoteView from './src/pages/PublicQuoteView.jsx';
    window.quoteClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    window.quoteRoot=createRoot(document.getElementById('root'));
    window.quoteRoot.render(React.createElement(QueryClientProvider,{client:window.quoteClient},React.createElement(PublicQuoteView)));
  `, resolveDir: local('../..'), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') },
  plugins: [{ name: 'synthetic-quote-services', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/supabaseClient$|PDFGenerator/ }, args => ({ path: args.path.includes('PDFGenerator') ? 'pdf' : 'db', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'pdf'
      ? 'export const generateQuotePDF=async()=>{};'
      : 'export const supabase={rpc:(name,args)=>window.quoteFixture.rpc(name,args),functions:{invoke:()=>{throw new Error("Unexpected invoke");}}};' }));
  } }],
});

async function quoteView(url) {
  const errors = [], calls = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  window.fetch = () => { throw new Error('No live requests are allowed.'); };
  window.quoteFixture = { rpc: async (name, args) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (name === 'track_public_quote_view') return { data: true, error: null };
    assert.equal(name, 'get_public_quote_bundle');
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_quote: ID, p_token: TOKEN });
    return { error: null, data: {
      quote: { id: ID, quote_number: 'Q-SYNTHETIC', title: 'Synthetic Quote', status: 'Sent', subtotal: 100, total: 100 },
      recipient: { name: 'Synthetic Client' }, company: { name: 'Synthetic Builder', settings: { currency: 'CAD' } },
      phases: [], items: [], schedule_items: [], is_expired: false,
    } };
  } };
  window.eval(bundle.outputFiles[0].text);
  const wait = async predicate => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Quote did not render: ${window.document.body.textContent}; ${errors.join('; ')}`);
  };
  return { window, calls, errors, wait, close() { window.quoteRoot.unmount(); window.quoteClient.clear(); dom.window.close(); } };
}

for (const url of [buildPublicQuoteUrl('https://app.fuzedflow.com', ID, TOKEN), `https://app.fuzedflow.com/PublicQuoteView?id=${ID}&token=${TOKEN}`]) {
  test('the real public quote page loads and offers client responses: ' + (new URL(url).search ? 'existing link' : 'new link'), async () => {
    const view = await quoteView(url);
    try {
      await view.wait(() => view.window.document.body.textContent.includes('Synthetic Client'));
      assert.ok(view.window.document.body.textContent.includes('Approve Quote'));
      await view.wait(() => view.calls.some(call => call.name === 'track_public_quote_view'));
      assert.deepEqual(view.errors, []);
    } finally { view.close(); }
  });
}

test('an incomplete link shows recovery instructions without requesting private quote data', async () => {
  const view = await quoteView(`https://app.fuzedflow.com/PublicQuoteView?id=${ID}`);
  try {
    await view.wait(() => view.window.document.body.textContent.includes('Incomplete quote link'));
    assert.ok(view.window.document.body.textContent.includes('Open the original quote email'));
    assert.equal(view.calls.length, 0);
  } finally { view.close(); }
});
