import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundlePromise = build({
  stdin: {
    contents: `import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import LineItemRow from ${JSON.stringify(local('../../src/components/quotes/LineItemRow.jsx'))};
      const initial={id:'fixture-line',name:'Fixture item',description:'',quantity:1,unit:'ea',
        material_cost:10,labor_cost:10,unit_cost:20,unit_price:25,taxable:true,is_material:true,supplier:'Original supplier'};
      window.lineUpdates=[];
      function Fixture(){const [item,setItem]=useState(initial);return <LineItemRow item={item} itemIdx={0} phaseIdx={0}
        phases={[{phase_name:'Fixture phase'}]} onUpdate={(phase,index,field,value)=>{
          window.lineUpdates.push({field,value});setItem(previous=>({...previous,[field]:value}));
        }} onDuplicate={()=>{}} onMove={()=>{}} onRemove={()=>{}} onPhotoUpload={()=>{}}/>;}
      createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: local('../../'), loader: 'jsx', sourcefile: 'line-item-state-fixture.jsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': local('../../src') },
  plugins: [{ name: 'isolated-line-item-context', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/AuthContext$|^\.\/ProductSearch(?:OrCreate|Dialog)$/ }, args => ({
      path: args.path.includes('AuthContext') ? 'auth' : args.path.includes('Dialog') ? 'dialog' : 'product',
      namespace: 'line-item-test',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'line-item-test' }, args => ({ loader: 'jsx', resolveDir: local('../../'),
      contents: args.path === 'auth' ? `export const useAuth=()=>({settings:{default_margin:20}});`
        : args.path === 'dialog' ? `export default function ProductSearchDialog(){return null;}`
          : `import React from 'react';export default function ProductSearchOrCreate({onSelect}){
              return <button onClick={()=>onSelect('Fixture product',{id:'fixture-product',name:'Fixture product',
                description:'Product description',unit:'sqft',material_cost:40,labor_cost:20,cost:60,price:75,
                image_url:'fixture-photo',supplier:'Product supplier',is_material:true})}>Choose fixture product</button>;}`,
    }));
  } }],
});

async function lineItemView() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://fixture.example/QuoteBuilder', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const wait = async predicate => {
    for (let attempt = 0; attempt < 150; attempt++) { if (predicate()) return; await pause(10); }
    throw new Error(`Expected line-item UI state: ${document.body.textContent}`);
  };
  const input = (element, value) => {
    assert.ok(element, 'The requested line-item field exists.');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const cost = () => [...document.querySelectorAll('label')]
    .find(element => element.textContent.trim() === 'Unit Cost')?.parentElement.parentElement.querySelector('input');
  const last = field => window.lineUpdates.filter(update => update.field === field).at(-1)?.value;
  window.eval((await bundlePromise).outputFiles[0].text);
  await wait(() => document.querySelector('[placeholder="Supplier Name..."]'));
  return { dom, window, document, wait, input, button, cost, last, errors };
}

test('supplier edits reach the document before blur or browser navigation', async () => {
  const view = await lineItemView();
  try {
    const supplier = view.document.querySelector('[placeholder="Supplier Name..."]');
    supplier.focus();
    view.input(supplier, 'Updated supplier');
    assert.equal(view.document.activeElement, supplier, 'No blur is needed to commit the edited supplier.');
    assert.equal(view.last('supplier'), 'Updated supplier', 'Dirty tracking and Save and exit can see the focused edit.');
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('total-cost edits synchronously commit cost, recalculated price, and cleared cost breakdown', async () => {
  const view = await lineItemView();
  try {
    view.input(view.cost(), '50');
    assert.equal(view.last('unit_cost'), 50);
    assert.equal(view.last('unit_price'), 62.5, 'The existing 20% margin is preserved.');
    assert.equal(view.last('material_cost'), 0);
    assert.equal(view.last('labor_cost'), 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('material-cost edits synchronously commit the combined cost and matching price', async () => {
  const view = await lineItemView();
  try {
    view.button('Split M/L').click();
    await view.wait(() => view.button('Hide M/L'));
    const material = [...view.document.querySelectorAll('span')]
      .find(element => element.textContent === 'M:')?.parentElement.querySelector('input');
    view.input(material, '30');
    assert.equal(view.last('material_cost'), 30);
    assert.equal(view.last('unit_cost'), 40, 'The other labor cost remains part of total cost.');
    assert.equal(view.last('unit_price'), 50);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('selecting a product commits the entire selection before an immediate save can run', async () => {
  const view = await lineItemView();
  try {
    view.button('Choose fixture product').click();
    for (const [field, expected] of Object.entries({
      name: 'Fixture product', description: 'Product description', unit: 'sqft', material_cost: 40,
      labor_cost: 20, unit_cost: 60, unit_price: 75, product_id: 'fixture-product',
      photo_url: 'fixture-photo', supplier: 'Product supplier', is_material: true,
    })) assert.equal(view.last(field), expected, `${field} is available without a deferred timer.`);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});
