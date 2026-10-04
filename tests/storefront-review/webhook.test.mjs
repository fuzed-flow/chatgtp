import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,checkout,event,request,subscription,payments,updates,COMPANY,ACCOUNT,CUSTOMER} from '../sales-notifications/stripe-handler-fixture.mjs';
import {SUBSCRIPTION_PRICES} from '../../supabase/functions/_shared/subscriptionPlans.js';
test('unpaid delayed checkout cannot record a payment; successful delayed payment can',async()=>{
 const h=fixture('stripe-webhook');await h.handler(request(event('checkout.session.completed',checkout({payment_status:'unpaid'}))));assert.equal(payments(h).length,0);
 await h.handler(request(event('checkout.session.async_payment_succeeded',checkout({amount_total:20000,currency:'usd'}))));assert.equal(payments(h).length,1);assert.equal(payments(h)[0].args.p_amount,200);
});
test('database failure is retryable and signature is required',async()=>{
 const h=fixture('stripe-webhook',{rpcResults:{record_stripe_payment:{data:null,error:{message:'unavailable'}}}});assert.equal((await h.handler(request(event()))).status,500);assert.equal((await h.handler(request(event(),null))).status,400);
});
test('subscription checkout and invoice lifecycle synchronize purchased seats',async()=>{
 const sub=subscription({items:{data:[{price:{id:SUBSCRIPTION_PRICES.professional.monthly},quantity:2}]}});
 const h=fixture('stripe-webhook',{verificationSecret:'synthetic-platform-secret',subscription:sub});
 await h.handler(request(event('checkout.session.completed',{mode:'subscription',subscription:'sub_synthetic',customer:CUSTOMER},null)));assert.equal(updates(h)[0].payload.max_users,4);
 await h.handler(request(event('invoice.paid',{customer:CUSTOMER,parent:{subscription_details:{subscription:'sub_synthetic'}}},null)));assert.equal(updates(h).findLast(q=>q.payload.max_users)?.payload.max_users,4);
});
test('a connected account cannot credit another company or alter platform subscriptions',async()=>{
 const h=fixture('stripe-webhook');assert.equal((await h.handler(request(event('checkout.session.completed',checkout(),'acct_other')))).status,500);assert.equal(payments(h).length,0);
 await h.handler(request(event('checkout.session.completed',{mode:'subscription',subscription:'sub_synthetic',customer:CUSTOMER})));assert.equal(updates(h).length,0);
});
test('connected onboarding updates payment readiness for that Stripe account',async()=>{
 const h=fixture('stripe-webhook');assert.equal((await h.handler(request(event('account.updated',{id:ACCOUNT,charges_enabled:true})))).status,200);assert.equal(updates(h)[0].payload.stripe_charges_enabled,true);assert.deepEqual(updates(h)[0].filters,[['stripe_account_id',ACCOUNT]]);
});
