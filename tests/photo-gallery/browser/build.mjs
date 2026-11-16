import { build } from 'esbuild';
import { mkdir, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
const out = resolve(process.argv[2]);
await mkdir(`${out}/assets`, { recursive: true });
await build({
  entryPoints: ['tests/photo-gallery/browser/main.jsx'], bundle: true, splitting: true, format: 'esm', platform: 'browser', outdir: `${out}/assets`,
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_SUPABASE_URL': '"https://fixture.supabase.co"' },
  alias: { '@/api/supabaseClient': `${root}/tests/photo-gallery/browser/mockDb.js`, '@': `${root}/src` },
  plugins: [{ name: 'isolated-help', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/shared\/AIHelpContext$/ }, () => ({ path: 'help', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useAIHelp=()=>({isAvailable:false,registerModalDialog:()=>()=>{}});' }));
  } }],
});
const css = (await readdir('dist/assets')).find(name => /^index-.*\.css$/.test(name));
await copyFile(`dist/assets/${css}`, `${out}/app.css`);
await writeFile(`${out}/index.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Photo upload QA</title><link rel="stylesheet" href="/app.css"></head><body class="bg-slate-100"><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>');
await writeFile(`${out}/mobile.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile photo upload QA</title></head><body style="margin:0;background:#e2e8f0;display:flex;justify-content:center"><iframe title="Mobile photo uploads" src="/" style="width:390px;max-width:100%;height:100vh;border:0"></iframe></body></html>');
