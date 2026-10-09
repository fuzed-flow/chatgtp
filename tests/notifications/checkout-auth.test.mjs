import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {SUBSCRIPTION_PRICES} from '../../supabase/functions/_shared/subscriptionPlans.js';

// Execute the actual Edge handler and price mapping. Only remote dependencies
// and external I/O are synthetic; no customer data or Stripe calls are used.
const bundle=await build({
  entryPoints:[fileURLToPath(new URL('../../supabase/functions/create-checkout/index.ts',import.meta.url))],
  bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
  plugins:[{name:'synthetic-dependencies',setup(builder) {
    builder.onResolve({filter:/^(?:https:\/\/|npm:)/},args=>({path:args.path,namespace:'synthetic'}));
    builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:
      args.path.includes('supabase-js') ? 'export const createClient=(...args)=>globalThis.testClient(...args);' :
      args.path.startsWith('npm:stripe') ? 'export default globalThis.TestStripe;' :
      args.path.includes('/http/server.ts') ? 'export const serve=handler=>globalThis.captureHandler(handler);' :
      (()=>{throw new Error('Unexpected remote dependency: '+args.path);})()}));
  }}],
});
const COMPANY='00000000-0000-4000-8000-000000000001';
const USER='00000000-0000-4000-8000-000000000002';
const FOREIGN='00000000-0000-4000-8000-000000000003';
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(options={}) {
  const calls=[],stripeCalls=[];
  let handler;
  const profile=options.profile===undefined ? {id:USER,company_id:COMPANY,is_active:true,role:'admin'} : options.profile;
  const db={auth:{async getUser() {calls.push({name:'getUser'});return options.authResult || {data:{user:{id:USER}},error:null};}},from(table) {
    assert.ok(['profiles','companies'].includes(table));
    const query={table,filters:[]};calls.push(query);
    const chain={select(fields){query.fields=fields;return chain;},eq(key,value){query.filters.push([key,value]);return chain;},async single(){return {data:table==='profiles'?profile:{stripe_customer_id:'cus_synthetic',name:'Synthetic'},error:options.profileError || null};}};
    return chain;
  }};
  class TestStripe {
    static createFetchHttpClient(){return {};}
    constructor(key,config) {assert.equal(key,'synthetic-stripe-key');assert.equal(config.apiVersion,'2026-08-26.dahlia');
      this.checkout={sessions:{create:async payload=>{stripeCalls.push(plain(payload));return {url:'https://checkout.stripe.invalid/synthetic'};}}};}
  }
  const env={STRIPE_SECRET_KEY:'synthetic-stripe-key',SUPABASE_URL:'https://synthetic.supabase.invalid',SUPABASE_ANON_KEY:'synthetic-anon',APP_URL:'https://app.fuzedflow.com'};
  vm.runInNewContext(bundle.outputFiles[0].text,{Request,Response,Headers,URL,TestStripe,crypto,Deno:{env:{get:key=>env[key]}},
    testClient:(url,key,options)=>{calls.push({name:'createClient',url,key,options:options?plain(options):null});return db;},captureHandler:value=>{handler=value;},
    fetch:()=>{throw new Error('Network access is forbidden in this fixture.');},
  },{timeout:1000});
  return {handler,calls,stripeCalls};
}
function request(input={},authorization='Bearer synthetic-user-token') {
  return new Request('https://synthetic.supabase.invalid/functions/v1/create-checkout',{method:'POST',headers:{'Content-Type':'application/json',...(authorization ? {Authorization:authorization} : {})},body:JSON.stringify({price_id:SUBSCRIPTION_PRICES.professional.monthly,company_id:COMPANY,...input})});
}

for (const authorization of [null,'','Basic synthetic','Bearer']) test('Subscription checkout requires a bearer token '+JSON.stringify(authorization),async()=>{
  const view=fixture();assert.equal((await view.handler(request({},authorization))).status,401);
  assert.equal(view.stripeCalls.length,0);assert.equal(view.calls.length,0);
});
for (const authResult of [{data:{user:null},error:null},{data:{user:null},error:{message:'expired'}},{data:{user:{id:USER}},error:{message:'invalid'}}]) test('Subscription checkout rejects unverified users before Stripe '+JSON.stringify(authResult),async()=>{
  const view=fixture({authResult});assert.equal((await view.handler(request())).status,401);
  assert.equal(view.stripeCalls.length,0);assert.equal(view.calls.some(call=>call.table==='profiles'),false);
});
for (const [label,options,input] of [
  ['inactive profile',{profile:{id:USER,company_id:COMPANY,is_active:false}},{}],
  ['missing profile',{profile:null},{}],
  ['profile read failure',{profileError:{message:'synthetic'}},{}],
  ['foreign requested company',{}, {company_id:FOREIGN}],
  ['missing requested company',{}, {company_id:null}],
  ['profile without company',{profile:{id:USER,company_id:null,is_active:true}},{}],
]) test('Subscription checkout rejects '+label+' before Stripe',async()=>{
  const view=fixture(options);assert.equal((await view.handler(request(input))).status,403);assert.equal(view.stripeCalls.length,0);
  const profile=view.calls.find(call=>call.table==='profiles');assert.deepEqual(profile.filters,[['id',USER]]);
});

for (const [plan,prices] of Object.entries(SUBSCRIPTION_PRICES)) for (const cycle of ['monthly','annual']) for (const legacy of [false,true]) {
  test(`Authorized ${plan} ${cycle} ${legacy ? 'legacy CAD' : 'current USD'} checkout uses current USD price and monthly promotion gate`,async()=>{
    const view=fixture();const price=legacy ? prices.legacy[cycle] : prices[cycle];
    const response=await view.handler(request({price_id:price}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:'https://checkout.stripe.invalid/synthetic'});
    assert.equal(view.stripeCalls.length,1);
    const payload=view.stripeCalls[0];assert.deepEqual(payload.line_items,[{price:prices[cycle],quantity:1}]);
    assert.equal(payload.mode,'subscription');assert.equal(payload.allow_promotion_codes,cycle==='monthly');
    assert.equal(payload.subscription_data.trial_period_days,14);
    assert.deepEqual(payload.subscription_data.metadata,{plan_id:plan,company_id:COMPANY});
    assert.deepEqual(payload.metadata,{plan_id:plan,user_id:USER,company_id:COMPANY});
    assert.equal(payload.client_reference_id,COMPANY);
    assert.equal(payload.success_url,'https://app.fuzedflow.com/dashboard?success=true');
    assert.equal(payload.cancel_url,'https://app.fuzedflow.com/pricing?canceled=true');
    const client=view.calls.find(call=>call.name==='createClient');assert.equal(client.key,'synthetic-anon');
    assert.equal(client.options.global.headers.Authorization,'Bearer synthetic-user-token');
  });
}

test('Invalid subscription price never reaches authentication or Stripe',async()=>{
  const view=fixture();assert.equal((await view.handler(request({price_id:'price_foreign'}))).status,400);assert.equal(view.calls.length,0);assert.equal(view.stripeCalls.length,0);
});
test('FUZED25 applies directly to an annual checkout and never enables unrestricted annual codes',async()=>{
  const view=fixture();const response=await view.handler(request({price_id:SUBSCRIPTION_PRICES.professional.annual,promotion_code:' fuzed25 '}));
  assert.equal(response.status,200);assert.equal(view.stripeCalls.length,1);
  const payload=view.stripeCalls[0];assert.equal(payload.allow_promotion_codes,false);
  assert.deepEqual(payload.discounts,[{coupon:'1tJn26tf'}]);
  assert.equal(payload.subscription_data.metadata.promotion_code,'FUZED25');
  assert.equal(payload.metadata.promotion_code,'FUZED25');
});
for (const [label,input] of [
  ['a monthly plan',{price_id:SUBSCRIPTION_PRICES.professional.monthly,promotion_code:'FUZED25'}],
  ['an unknown code',{price_id:SUBSCRIPTION_PRICES.professional.annual,promotion_code:'NOTVALID'}],
]) test(`Promotion validation rejects ${label} before authentication or Stripe`,async()=>{
  const view=fixture();assert.equal((await view.handler(request(input))).status,400);
  assert.equal(view.calls.length,0);assert.equal(view.stripeCalls.length,0);
});
test('Subscription CORS preflight succeeds without auth or Stripe',async()=>{
  const view=fixture();const response=await view.handler(new Request('https://synthetic.supabase.invalid/functions/v1/create-checkout',{method:'OPTIONS'}));
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(view.calls.length,0);assert.equal(view.stripeCalls.length,0);
});
