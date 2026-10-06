import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {SUBSCRIPTION_PRICES} from '../../supabase/functions/_shared/subscriptionPlans.js';

// Run both full production handlers and their actual shared modules. SDK
// boundaries, saved records and provider responses are strictly synthetic.
const root=new URL('../../',import.meta.url);
const bundles=Object.fromEntries(await Promise.all(['stripe-webhook','createDepositCheckout'].map(async name=>{
  const result=await build({entryPoints:[fileURLToPath(new URL(`supabase/functions/${name}/index.ts`,root))],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
    plugins:[{name:'synthetic-providers',setup(builder){
      builder.onResolve({filter:/^(?:https:\/\/|npm:)/},args=>({path:args.path,namespace:'synthetic'}));
      builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:
        args.path.includes('supabase-js') ? 'export const createClient=(...args)=>globalThis.testClient(...args);' :
        args.path.startsWith('npm:stripe') ? 'export default globalThis.TestStripe;' :
        args.path.includes('/http/server.ts') ? 'export const serve=handler=>globalThis.captureHandler(handler);' :
        (()=>{throw new Error('Unexpected remote import: '+args.path);})()}));
    }}],
  });return [name,result.outputFiles[0].text];
})));
const COMPANY='00000000-0000-4000-8000-000000000001';
const OTHER='00000000-0000-4000-8000-000000000002';
const INVOICE='00000000-0000-4000-8000-000000000011';
const QUOTE='00000000-0000-4000-8000-000000000012';
const USER='00000000-0000-4000-8000-000000000013';
const INVOICE_TOKEN='a'.repeat(64);
const QUOTE_TOKEN='b'.repeat(64);
const ACCOUNT='acct_synthetic';
const CUSTOMER='cus_synthetic';
const NOW=Date.UTC(2026,9,4,18,30);
const plain=value=>JSON.parse(JSON.stringify(value));
class FixedDate extends Date {constructor(...args){super(...(args.length ? args : [NOW]));}static now(){return NOW;}}

function fixture(name,options={}) {
  const queries=[],rpcs=[],stripeCalls=[],errors=[];
  let handler;
  const rows={companies:[{id:COMPANY,stripe_account_id:ACCOUNT,stripe_customer_id:CUSTOMER,settings:{currency:'CAD'},subscription_cancel_at:null,plan_id:'professional'}],
    profiles:[{id:USER,company_id:COMPANY,is_active:true,role:'admin',permissions:null}],
    invoices:[{id:INVOICE,company_id:COMPANY,status:'Sent',total:1000,amount_paid:100,invoice_number:'INV-SYNTHETIC',has_payment_schedule:false}],
    invoice_share_links:[{id:'00000000-0000-4000-8000-000000000021',invoice_id:INVOICE,company_id:COMPANY,token_hash:createHash('sha256').update(INVOICE_TOKEN).digest('hex'),status:'Active',revoked_at:null,expires_at:null}],
    quote_approvals:[{id:'00000000-0000-4000-8000-000000000022',quote_id:QUOTE,company_id:COMPANY,approval_token:QUOTE_TOKEN,approval_status:'Approved'}],
    quotes:[{id:QUOTE,company_id:COMPANY,status:'Approved',total:1000,deposit_amount:250,quote_number:'Q-SYNTHETIC'}],invoice_payment_schedules:[],...plain(options.rows || {})};
  const db={auth:{async getUser(token){return options.authResult || (token==='synthetic-user-token' ? {data:{user:{id:USER}},error:null} : {data:{user:null},error:{message:'invalid'}});}},from(table) {
    assert.ok(Object.hasOwn(rows,table),'Unexpected table '+table);
    const query={table,operation:'select',filters:[]};
    let evaluated;
    const evaluate=()=>{if(evaluated)return evaluated;queries.push(plain(query));
      if(options.queryError?.(query)) return evaluated={data:null,error:{message:'synthetic database failure'}};
      let found=rows[table].filter(row=>query.filters.every(([key,value])=>row[key]===value));
      if(query.operation==='update') for(const row of found) Object.assign(row,plain(query.payload));
      if(query.order) found=[...found].sort((a,b)=>a[query.order]-b[query.order]);
      return evaluated={data:query.single ? found[0] ? plain(found[0]) : null : plain(found),error:null};
    };
    const chain={select(fields){query.fields=fields;return chain;},update(payload){query.operation='update';query.payload=plain(payload);return chain;},eq(key,value){query.filters.push([key,value]);return chain;},order(key){query.order=key;return chain;},single(){query.single=true;return Promise.resolve(evaluate());},maybeSingle(){query.single=true;return Promise.resolve(evaluate());},then(resolve,reject){return Promise.resolve(evaluate()).then(resolve,reject);}};
    return chain;
  },async rpc(name,args) {
    rpcs.push({name,args:args ? plain(args) : undefined});
    if(options.rpcResults && Object.hasOwn(options.rpcResults,name)) return options.rpcResults[name];
    if(name==='notification_provider_server_config') return {data:options.vault || {},error:null};
    if(name==='stripe_payment_context') return {data:options.savedContext || null,error:null};
    assert.ok(['record_stripe_payment','record_sales_event'].includes(name),'Unexpected RPC '+name);
    return {data:true,error:null};
  }};
  const sdk=async (method,args,result)=>{stripeCalls.push({method,args:plain(args)});if(options.stripeError===method)throw new Error('synthetic provider failure');return plain(result);};
  class TestStripe {
    static createFetchHttpClient(){return {};}
    static createSubtleCryptoProvider(){return {};}
    constructor(key) {assert.equal(key,'synthetic-stripe-key');
      this.webhooks={constructEventAsync:async(raw,signature,secret)=>{stripeCalls.push({method:'constructEventAsync',raw,signature,secret});
        if(signature!=='synthetic-signature' || secret!==(options.verificationSecret || 'synthetic-connect-secret'))throw new Error('signature invalid');return JSON.parse(raw);}};
      this.checkout={sessions:{
        create:(...args)=>sdk('checkout.sessions.create',args,{url:'https://checkout.stripe.invalid/synthetic',id:'cs_synthetic'}),
        list:(...args)=>sdk('checkout.sessions.list',args,{data:options.sessions || []}),
      }};
      this.paymentIntents={retrieve:(...args)=>sdk('paymentIntents.retrieve',args,options.paymentIntent || {metadata:{}})};
      this.charges={retrieve:(...args)=>sdk('charges.retrieve',args,options.charge || {object:'charge',id:'ch_synthetic',payment_intent:'pi_saved',metadata:{}})};
      this.subscriptions={retrieve:(...args)=>sdk('subscriptions.retrieve',args,options.subscription || subscription())};
      this.paymentMethods={retrieve:(...args)=>sdk('paymentMethods.retrieve',args,options.paymentMethod || {card:{exp_year:2028,exp_month:2}})};
    }
  }
  const env={SUPABASE_URL:'https://synthetic.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',STRIPE_SECRET_KEY:'synthetic-stripe-key',STRIPE_WEBHOOK_SECRET:'synthetic-platform-secret',STRIPE_CONNECT_WEBHOOK_SECRET:'synthetic-connect-secret',RESEND_WEBHOOK_SECRET:'synthetic-resend-secret',RESEND_REPLY_DOMAIN:'reply.fuzedflow.com',APP_URL:'https://app.fuzedflow.com',...options.env};
  vm.runInNewContext(bundles[name],{Request,Response,Headers,URL,crypto:webcrypto,TextEncoder,Uint8Array,Date:FixedDate,TestStripe,Deno:{serve:value=>{handler=value;},env:{get:key=>env[key]}},
    captureHandler:value=>{handler=value;},testClient:()=>db,console:{error:message=>errors.push(message)},
    fetch:()=>{throw new Error('No network is permitted.');},
  },{timeout:1000});
  return {handler,queries,rpcs,stripeCalls,rows,errors,get writes(){return [...rpcs.filter(call=>['record_stripe_payment','record_sales_event'].includes(call.name)),...queries.filter(query=>query.operation==='update')];}};
}
function checkout(overrides={}) {return {object:'checkout.session',id:'cs_synthetic',mode:'payment',payment_status:'paid',payment_intent:'pi_synthetic',amount_total:12345,created:NOW/1000,metadata:{company_id:COMPANY,invoice_id:INVOICE},...overrides};}
function event(type='checkout.session.completed',object=checkout(),account=ACCOUNT){return {id:'evt_synthetic',type,...(account ? {account} : {}),data:{object}};}
function request(value,signature='synthetic-signature') {return new Request('https://synthetic.supabase.invalid/functions/v1/stripe-webhook',{method:'POST',headers:{'Content-Type':'application/json',...(signature ? {'Stripe-Signature':signature} : {})},body:JSON.stringify(value)});}
function depositRequest(input={quote_id:QUOTE,token:QUOTE_TOKEN},authorization=null) {return new Request('https://synthetic.supabase.invalid/functions/v1/createDepositCheckout',{method:'POST',headers:{'Content-Type':'application/json',...(authorization ? {Authorization:`Bearer ${authorization}`} : {})},body:JSON.stringify(input)});}
function subscription(overrides={}) {return {id:'sub_synthetic',customer:CUSTOMER,status:'active',items:{data:[{price:{id:SUBSCRIPTION_PRICES.professional.monthly},quantity:1}]},current_period_end:NOW/1000+86400,metadata:{company_id:COMPANY},...overrides};}
function savedContext(type='invoice') {return {company_id:COMPANY,stripe_account_id:ACCOUNT,document_type:type,document_id:type==='invoice' ? INVOICE : QUOTE};}
const payments=view=>view.rpcs.filter(call=>call.name==='record_stripe_payment');
const sales=view=>view.rpcs.filter(call=>call.name==='record_sales_event');
const updates=view=>view.queries.filter(query=>query.operation==='update');


export {fixture,checkout,event,request,depositRequest,subscription,savedContext,payments,sales,updates,COMPANY,OTHER,INVOICE,QUOTE,USER,INVOICE_TOKEN,QUOTE_TOKEN,ACCOUNT,CUSTOMER,NOW};
