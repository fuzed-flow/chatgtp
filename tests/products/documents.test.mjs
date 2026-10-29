import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/components/pdf/PDFGenerator.jsx'],bundle:true,write:false,platform:'node',format:'esm',loader:{'.jsx':'jsx'}});
const {generateQuotePDF,generatePOPDF,generateInvoicePDF}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const company={name:'Sample Company',settings:{currency:'CAD'}};
const item={id:'line',phase_id:'phase',name:'Fixture',item_name:'Fixture',description:'Client item specification',finish_colour:'Matte black',quantity:1,unit:'ea',unit_price:100,unit_cost:60,taxable:true};
const phase={id:'phase',phase_name:'Bathroom'};
const doc={returnBase64:true,title:'Document',issue_date:'2026-10-29',subtotal:100,total:105,tax:5,amount_paid:0,balance_due:105};
const plain=base64=>Buffer.from(base64,'base64').toString('latin1');
for(const [name,generate]of[
 ['quote',value=>generateQuotePDF(doc,{name:'Client'},[phase],[value],company)],
 ['purchase order',value=>generatePOPDF(doc,{name:'Vendor'},[value],company)],
 ['invoice',value=>generateInvoicePDF({invoice:doc,client:{name:'Client'},quotePhases:[phase],quoteItems:[value],manualItems:[],scheduleItems:[],payments:[],organization:company})],
])test(`${name} PDF includes a populated finish and omits a blank finish`,async()=>{
 assert.match(plain(await generate(item)),/Finish \/ Colour: Matte black/);
 assert.doesNotMatch(plain(await generate({...item,finish_colour:''})),/Finish \/ Colour:/);
});
