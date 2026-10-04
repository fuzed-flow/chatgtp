import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBSCRIPTION_PRICES} from '../../supabase/functions/_shared/subscriptionPlans.js';
import {fixture,checkout,event,request,depositRequest,subscription,savedContext,payments,sales,updates,COMPANY,OTHER,INVOICE,QUOTE,ACCOUNT,CUSTOMER,NOW} from './stripe-handler-fixture.mjs';
for(const [label,options,account,signature] of [
  ['missing signature',{},ACCOUNT,null],['invalid signature',{},ACCOUNT,'invalid'],
  ['Connect event verified by platform secret',{verificationSecret:'synthetic-platform-secret'},ACCOUNT,'synthetic-signature'],
  ['platform event verified by Connect secret',{},null,'synthetic-signature'],
]) test('Stripe webhook rejects '+label+' before any mutation',async()=>{
  const view=fixture('stripe-webhook',options);assert.equal((await view.handler(request(event('unhandled.synthetic',{},account),signature))).status,400);assert.equal(view.writes.length,0);
});
test('Stripe Connect verification tries platform then Connect with the exact raw body and signature',async()=>{
  const view=fixture('stripe-webhook');const value=event();assert.equal((await view.handler(request(value))).status,200);
  const checks=view.stripeCalls.filter(call=>call.method==='constructEventAsync');assert.deepEqual(checks.map(call=>call.secret),['synthetic-platform-secret','synthetic-connect-secret']);
  for(const check of checks){assert.equal(check.raw,JSON.stringify(value));assert.equal(check.signature,'synthetic-signature');}
});
test('Stripe platform verification accepts only the platform destination secret',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});assert.equal((await view.handler(request(event('unhandled.synthetic',{},null)))).status,200);
  assert.deepEqual(view.stripeCalls.map(call=>call.secret),['synthetic-platform-secret']);assert.equal(view.writes.length,0);
});
test('Connect secret can load from the private server configuration RPC',async()=>{
  const view=fixture('stripe-webhook',{env:{STRIPE_CONNECT_WEBHOOK_SECRET:undefined},vault:{stripe_connect_webhook_secret:'synthetic-connect-secret'}});
  assert.equal((await view.handler(request(event()))).status,200);assert.equal(view.rpcs[0].name,'notification_provider_server_config');assert.equal(payments(view).length,1);
});
for(const type of ['checkout.session.completed','checkout.session.async_payment_succeeded']) test(type+' unpaid payment never creates a payment ledger entry',async()=>{
  const view=fixture('stripe-webhook');assert.equal((await view.handler(request(event(type,checkout({payment_status:'unpaid'}))))).status,200);
  assert.equal(view.rpcs.length,0);assert.equal(view.queries.length,0);
});
test('Async paid Checkout uses saved ledger context instead of forged metadata',async()=>{
  const view=fixture('stripe-webhook',{savedContext:savedContext('quote')});
  assert.equal((await view.handler(request(event('checkout.session.async_payment_succeeded',checkout({metadata:{company_id:OTHER,invoice_id:INVOICE}}))))).status,200);
  assert.deepEqual(payments(view),[{name:'record_stripe_payment',args:{p_company:COMPANY,p_type:'quote',p_document:QUOTE,p_account:ACCOUNT,p_session:'cs_synthetic',p_intent:'pi_synthetic',p_amount:123.45,p_paid_at:new Date(NOW).toISOString()}}]);
  assert.equal(view.queries.length,0);
});
for(const saved of [false,true]) test('Foreign connected account cannot record a payment '+(saved ? 'from ledger' : 'from metadata'),async()=>{
  const view=fixture('stripe-webhook',{savedContext:saved ? savedContext() : null});
  assert.equal((await view.handler(request(event('checkout.session.completed',checkout(),'acct_foreign')))).status,500);assert.equal(payments(view).length,0);assert.equal(sales(view).length,0);
});
test('Invoice belonging to a different company cannot record a payment',async()=>{
  const view=fixture('stripe-webhook',{rows:{invoices:[{id:INVOICE,company_id:OTHER}]}});
  assert.equal((await view.handler(request(event()))).status,200);assert.equal(payments(view).length,0);
  assert.deepEqual(view.queries.find(query=>query.table==='invoices').filters,[['id',INVOICE],['company_id',COMPANY]]);
});
test('Payment metadata fallback retrieves the intent and associated Checkout in the signed account',async()=>{
  const view=fixture('stripe-webhook',{sessions:[{metadata:{company_id:COMPANY,invoice_id:INVOICE}}]});
  assert.equal((await view.handler(request(event('checkout.session.async_payment_succeeded',checkout({metadata:{}}))))).status,200);
  assert.deepEqual(view.stripeCalls.find(call=>call.method==='paymentIntents.retrieve').args,['pi_synthetic',{}, {stripeAccount:ACCOUNT}]);
  assert.deepEqual(view.stripeCalls.find(call=>call.method==='checkout.sessions.list').args,[{payment_intent:'pi_synthetic',limit:1},{stripeAccount:ACCOUNT}]);assert.equal(payments(view).length,1);
});
test('Ledger update errors make paid Checkout retryable',async()=>{
  const view=fixture('stripe-webhook',{rpcResults:{record_stripe_payment:{data:null,error:{message:'synthetic'}}}});
  assert.equal((await view.handler(request(event()))).status,500);assert.equal(payments(view).length,1);
});
for(const [type,key] of [['charge.refunded','payment_refunded'],['charge.dispute.created','payment_disputed'],['charge.dispute.closed','payment_disputed'],['payment_intent.payment_failed','payment_failed'],['checkout.session.async_payment_failed','payment_failed']]) test(type+' resolves saved payment context and emits a company-scoped event',async()=>{
  const view=fixture('stripe-webhook',{savedContext:savedContext()});
  const object=type.startsWith('charge.dispute') ? {object:'dispute',id:'dp_synthetic',charge:'ch_synthetic'} : type.startsWith('payment_intent') ? {object:'payment_intent',id:'pi_saved'} : {object:'charge',id:'ch_synthetic',payment_intent:'pi_saved'};
  assert.equal((await view.handler(request(event(type,object)))).status,200);
  assert.equal(sales(view).length,1);const args=sales(view)[0].args;
  assert.equal(args.p_company,COMPANY);assert.equal(args.p_event,key);assert.equal(args.p_related,'Invoice');assert.equal(args.p_id,INVOICE);assert.equal(args.p_reference,'evt_synthetic');assert.equal(args.p_actor,null);
  assert.equal(payments(view).length,0);assert.equal(view.queries.length,0);
  if(type.startsWith('charge.dispute'))assert.deepEqual(view.stripeCalls.find(call=>call.method==='charges.retrieve').args,['ch_synthetic',{}, {stripeAccount:ACCOUNT}]);
});

for(const [plan,prices] of Object.entries(SUBSCRIPTION_PRICES)) for(const legacy of [false,true]) test('Subscription update recognizes '+plan+' '+(legacy ? 'legacy CAD' : 'USD')+' plan and base user limits',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  const object=subscription({items:{data:[{price:{id:legacy ? prices.legacy.annual : prices.monthly},quantity:1}]}});
  assert.equal((await view.handler(request(event('customer.subscription.updated',object,null)))).status,200);
  const change=updates(view)[0];assert.equal(change.payload.plan_id,plan);assert.equal(change.payload.subscription_status,'Active');assert.equal(change.payload.max_users,{starter:1,professional:3,business:10}[plan]);
  assert.equal(change.payload.subscription_renews_at,new Date(NOW+86400000).toISOString());assert.deepEqual(change.filters,[['id',COMPANY],['stripe_customer_id',CUSTOMER]]);
});
for(const status of ['active','trialing','past_due','unpaid']) test('Subscription '+status+' status is persisted with purchased user count',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  const object=subscription({status,items:{data:[{price:{id:SUBSCRIPTION_PRICES.business.monthly},quantity:15}]}});
  assert.equal((await view.handler(request(event('customer.subscription.updated',object,null)))).status,200);
  assert.equal(updates(view)[0].payload.subscription_status,['active','trialing'].includes(status) ? 'Active' : 'Past Due');assert.equal(updates(view)[0].payload.max_users,24);
});
test('Subscription Checkout attaches an unbound company customer and persists the retrieved subscription',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret',rows:{companies:[{id:COMPANY,stripe_customer_id:null}]}});
  assert.equal((await view.handler(request(event('checkout.session.completed',checkout({mode:'subscription',subscription:{id:'sub_synthetic'},customer:CUSTOMER,metadata:{company_id:COMPANY}}),null)))).status,200);
  assert.deepEqual(view.stripeCalls.find(call=>call.method==='subscriptions.retrieve').args,['sub_synthetic']);
  assert.equal(view.rows.companies[0].stripe_customer_id,CUSTOMER);assert.equal(view.rows.companies[0].plan_id,'professional');
});
test('Subscription metadata cannot rebind a company to an unrelated saved customer',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('customer.subscription.updated',subscription({customer:'cus_foreign'}),null)))).status,200);assert.equal(view.writes.length,0);assert.equal(view.rows.companies[0].stripe_customer_id,CUSTOMER);
});
test('Scheduled cancellation and deletion persist dates, free access and separate notifications',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('customer.subscription.updated',subscription({cancel_at_period_end:true}),null)))).status,200);
  assert.equal(updates(view)[0].payload.subscription_cancel_at,new Date(NOW+86400000).toISOString());assert.equal(sales(view)[0].args.p_event,'subscription_cancellation_scheduled');
  assert.equal((await view.handler(request(event('customer.subscription.deleted',subscription({status:'canceled'}),null)))).status,200);
  const last=updates(view).at(-1);assert.equal(last.payload.plan_id,'free');assert.equal(last.payload.max_users,1);assert.equal(last.payload.subscription_status,'Canceled');assert.equal(sales(view).at(-1).args.p_event,'subscription_cancelled');
});
test('Failed subscription invoice persists Past Due and a payment failure event',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('invoice.payment_failed',{customer:CUSTOMER},null)))).status,200);
  assert.equal(updates(view)[0].payload.subscription_status,'Past Due');assert.equal(sales(view)[0].args.p_event,'subscription_payment_failed');
});
for(const [url,receipt] of [['https://invoice.stripe.com/i/synthetic',true],['https://stripe.com/invoices/synthetic',true],['https://stripe.com.foreign.invalid/invoice',false],['http://invoice.stripe.com/i/synthetic',false]]) test('Paid subscription invoice restricts receipt URL '+url,async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('invoice.paid',{customer:CUSTOMER,hosted_invoice_url:url},null)))).status,200);
  assert.equal(updates(view)[0].payload.subscription_status,'Active');assert.equal(updates(view)[0].payload.subscription_last_receipt_url,receipt ? url : undefined);
  assert.deepEqual(sales(view).map(call=>call.args.p_event),receipt ? ['subscription_payment_received','subscription_receipt'] : ['subscription_payment_received']);
});
test('Upcoming invoice and expiring card update saved renewal and calendar expiry dates',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('invoice.upcoming',{customer:CUSTOMER,period_end:NOW/1000+86400},null)))).status,200);
  assert.equal(updates(view)[0].payload.subscription_renews_at,new Date(NOW+86400000).toISOString());assert.equal(sales(view)[0].args.p_event,'subscription_renewal_upcoming');
  assert.equal((await view.handler(request(event('customer.source.expiring',{object:'card',customer:CUSTOMER,exp_year:2028,exp_month:2},null)))).status,200);
  assert.equal(updates(view).at(-1).payload.subscription_card_expiry,'2028-02-29');assert.equal(sales(view).at(-1).args.p_event,'subscription_card_expiring');
});
test('Updated default payment method retrieves provider card details for saved customer',async()=>{
  const view=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret'});
  assert.equal((await view.handler(request(event('customer.updated',{object:'customer',id:CUSTOMER,invoice_settings:{default_payment_method:{id:'pm_synthetic'}}},null)))).status,200);
  assert.deepEqual(view.stripeCalls.find(call=>call.method==='paymentMethods.retrieve').args,['pm_synthetic']);assert.equal(updates(view)[0].payload.subscription_card_expiry,'2028-02-29');
});

test('Quote checkout ignores browser amount, currency and company and uses saved deposit/account',async()=>{
  const view=fixture('createDepositCheckout');const response=await view.handler(depositRequest({quote_id:QUOTE,amount:1,currency:'USD',company_id:OTHER,stripe_account_id:'acct_foreign'}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:'https://checkout.stripe.invalid/synthetic',checkout_url:'https://checkout.stripe.invalid/synthetic',sessionId:'cs_synthetic'});
  const [payload,account]=view.stripeCalls.find(call=>call.method==='checkout.sessions.create').args;
  assert.equal(payload.line_items[0].price_data.unit_amount,25000);assert.equal(payload.line_items[0].price_data.currency,'cad');assert.equal(account.stripeAccount,ACCOUNT);assert.ok(account.idempotencyKey);
  assert.deepEqual(payload.metadata,{company_id:COMPANY,quote_id:QUOTE,currency_factor:'100'});assert.deepEqual(payload.payment_intent_data.metadata,payload.metadata);
  assert.equal(payload.success_url,`https://app.fuzedflow.com/PublicQuoteView?id=${QUOTE}&payment=success`);assert.equal(payload.cancel_url,`https://app.fuzedflow.com/PublicQuoteView?id=${QUOTE}&payment=cancelled`);
});
test('Invoice checkout uses saved outstanding balance',async()=>{
  const view=fixture('createDepositCheckout');assert.equal((await view.handler(depositRequest({invoice_id:INVOICE}))).status,200);
  const payload=view.stripeCalls.find(call=>call.method==='checkout.sessions.create').args[0];assert.equal(payload.line_items[0].price_data.unit_amount,90000);assert.equal(payload.metadata.invoice_id,INVOICE);assert.equal(payload.success_url,`https://app.fuzedflow.com/PublicInvoiceView?id=${INVOICE}&payment=success`);
});
test('Invoice scheduled checkout pays only next unpaid saved company installment',async()=>{
  const view=fixture('createDepositCheckout',{rows:{invoices:[{id:INVOICE,company_id:COMPANY,status:'Partially Paid',total:1000,amount_paid:100,has_payment_schedule:true}],invoice_payment_schedules:[
    {invoice_id:INVOICE,company_id:COMPANY,amount:100,amount_paid:100,sort_order:1},
    {invoice_id:INVOICE,company_id:COMPANY,amount:250,amount_paid:50,sort_order:2},
    {invoice_id:INVOICE,company_id:OTHER,amount:1,amount_paid:0,sort_order:0},
  ]}});
  assert.equal((await view.handler(depositRequest({invoice_id:INVOICE}))).status,200);assert.equal(view.stripeCalls.find(call=>call.method==='checkout.sessions.create').args[0].line_items[0].price_data.unit_amount,20000);
  assert.deepEqual(view.queries.find(query=>query.table==='invoice_payment_schedules').filters,[['invoice_id',INVOICE],['company_id',COMPANY]]);
});
for(const [type,status] of [['quote','Draft'],['quote','Pending Review'],['quote','Declined'],['invoice','Draft'],['invoice','Paid'],['invoice','Declined']]) test(type+' '+status+' cannot open payment checkout',async()=>{
  const table=type==='quote' ? 'quotes' : 'invoices';const id=type==='quote' ? QUOTE : INVOICE;
  const view=fixture('createDepositCheckout',{rows:{[table]:[{id,company_id:COMPANY,status,deposit_amount:250,total:1000}]}});
  assert.equal((await view.handler(depositRequest({[`${type}_id`]:id}))).status,400);assert.equal(view.stripeCalls.length,0);
});
for(const input of [{},{quote_id:'invalid'},{invoice_id:INVOICE,success_url:'https://foreign.invalid/success'},{quote_id:QUOTE,cancel_url:'https://app.fuzedflow.com.foreign.invalid/cancel'},{quote_id:QUOTE,success_url:'http://app.fuzedflow.com/success'},{quote_id:QUOTE,success_url:'javascript:alert(1)'}]) test('Invalid document is rejected and foreign return address falls back safely '+JSON.stringify(input),async()=>{
  const view=fixture('createDepositCheckout');const response=await view.handler(depositRequest(input)); if(!input.quote_id&&!input.invoice_id || input.quote_id==='invalid'){assert.equal(response.status,400);assert.equal(view.stripeCalls.length,0);}else{assert.equal(response.status,200);const payload=view.stripeCalls.find(c=>c.method==='checkout.sessions.create').args[0];assert.equal(new URL(payload.success_url).origin,'https://app.fuzedflow.com');assert.equal(new URL(payload.cancel_url).origin,'https://app.fuzedflow.com');}
});
test('Saved quote template, missing connected account and zero due do not create Stripe Checkout',async()=>{
  for(const rows of [{quotes:[{id:QUOTE,company_id:COMPANY,status:'Approved',total:1000,deposit_amount:250,is_template:true}]},{companies:[{id:COMPANY,stripe_account_id:null}]},{quotes:[{id:QUOTE,company_id:COMPANY,status:'Approved',deposit_amount:0}]}]){
    const view=fixture('createDepositCheckout',{rows});assert.equal((await view.handler(depositRequest())).status,400);assert.equal(view.stripeCalls.length,0);
  }
});
test('Same-origin custom checkout return URLs are preserved',async()=>{
  const view=fixture('createDepositCheckout');const input={quote_id:QUOTE,success_url:'https://app.fuzedflow.com/paid?reference=synthetic',cancel_url:'https://app.fuzedflow.com/PublicQuoteView?id='+QUOTE};
  assert.equal((await view.handler(depositRequest(input))).status,200);const payload=view.stripeCalls.find(call=>call.method==='checkout.sessions.create').args[0];assert.equal(payload.success_url,input.success_url);assert.equal(payload.cancel_url,input.cancel_url);
});
test('Checkout database and provider errors return failure without a fabricated successful URL',async()=>{
  for(const options of [{queryError:query=>query.table==='quotes'},{stripeError:'checkout.sessions.create'}]){
    const view=fixture('createDepositCheckout',options);const response=await view.handler(depositRequest());assert.equal(response.status,400);assert.equal((await response.json()).url,undefined);
  }
});
