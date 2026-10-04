import { getPlanIdFromPrice, getUserLimitFromQuantity, getUsdPriceId } from "../_shared/subscriptionPlans.js";
import { currencyFactor } from "../_shared/checkout.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import Stripe from "npm:stripe@22.6.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2026-08-26.dahlia", httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
let connectSecretCache: {value:string|null,until:number}|null=null;
const connectSecret=async()=>{
 const configured=Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');if(configured)return configured;
 if(connectSecretCache&&connectSecretCache.until>Date.now())return connectSecretCache.value;
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {data,error}=await service.rpc('review_connect_webhook_secret');if(error)throw error;
 connectSecretCache={value:typeof data==='string'?data:null,until:Date.now()+60000};return connectSecretCache.value;
};
Deno.serve(async (req) => {
 const signature=req.headers.get("Stripe-Signature"), secret=Deno.env.get("STRIPE_WEBHOOK_SECRET");
 if (!signature || !secret) return new Response("Missing signature",{status:400});
 let event: Stripe.Event,fromConnect=false;
 const payload=await req.text();
 try { event=await stripe.webhooks.constructEventAsync(payload,signature,secret,undefined,cryptoProvider); }
 catch {
  let alternate:string|null;
  try{alternate=await connectSecret();}catch{return Response.json({error:'Signing configuration unavailable; retry this event.'},{status:503});}
  if(!alternate)return new Response('Invalid webhook signature',{status:400});
  try{event=await stripe.webhooks.constructEventAsync(payload,signature,alternate,undefined,cryptoProvider);fromConnect=true;}catch{return new Response('Invalid webhook signature',{status:400});}
 }
 if(Boolean(event.account)!==fromConnect)return new Response('Invalid webhook account scope',{status:400});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const syncSubscription=async (sub: Stripe.Subscription) => {
  const item=sub.items.data[0];
  const plan=getPlanIdFromPrice(item?.price.id);
  if (!getUsdPriceId(item?.price.id)) throw new Error("Unrecognized subscription price");
  const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;
  const values={plan_id:sub.status==='canceled'?'free':plan,subscription_status:sub.status==='canceled'?'Canceled':['active','trialing'].includes(sub.status)?'Active':'Past Due',max_users:getUserLimitFromQuantity(plan,item?.quantity||1)};
  const {error}=await db.from('companies').update(values).eq('stripe_customer_id',customer);
  if(error) throw error;
 };
 try {
  if(fromConnect&&event.type==='account.updated'){
   const account=event.data.object as Stripe.Account;
   if(account.id!==event.account)return new Response('Invalid connected account',{status:400});
   const {error}=await db.from('companies').update({stripe_charges_enabled:account.charges_enabled===true}).eq('stripe_account_id',account.id);if(error)throw error;
  }
  else if (!fromConnect&&['customer.subscription.created','customer.subscription.updated'].includes(event.type)) await syncSubscription(event.data.object as Stripe.Subscription);
  else if(!fromConnect&&event.type==='customer.subscription.deleted') {
   const sub=event.data.object as Stripe.Subscription;
   const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;
   const {error}=await db.from('companies').update({plan_id:'free',subscription_status:'Canceled'}).eq('stripe_customer_id',customer);if(error)throw error;
  } else if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
   const session=event.data.object as Stripe.Checkout.Session;
   if(!fromConnect&&session.mode==='subscription' && session.subscription) {
    const id=typeof session.subscription==='string'?session.subscription:session.subscription.id;
    await syncSubscription(await stripe.subscriptions.retrieve(id));
   } else if(fromConnect&&session.mode==='payment' && session.payment_status==='paid') {
    const meta=session.metadata||{};
    if(meta.company_id&&(meta.invoice_id||meta.quote_id)) {
     const {data:company,error:companyError}=await db.from('companies').select('stripe_account_id').eq('id',meta.company_id).maybeSingle();if(companyError)throw companyError;
     if(!company||company.stripe_account_id!==event.account)return Response.json({received:true,ignored:true});
     const amount=(session.amount_total||0)/currencyFactor(session.currency||'usd');
     const {error}=await db.rpc('record_checkout_payment',{p_session:session.id,p_company:meta.company_id,p_invoice:meta.invoice_id||null,p_quote:meta.quote_id||null,p_amount:amount,p_date:new Date(event.created*1000).toISOString().slice(0,10)});
     if(error)throw error;
    }
   }
  } else if(!fromConnect&&['invoice.paid','invoice.payment_failed'].includes(event.type)) {
   const invoice=event.data.object as Stripe.Invoice;
   const subId=invoice.parent?.subscription_details?.subscription || (invoice as any).subscription;
   if(subId) await syncSubscription(await stripe.subscriptions.retrieve(typeof subId==='string'?subId:subId.id));
  }
  return Response.json({received:true});
 } catch(error) {
  console.error('Stripe webhook processing failed',error instanceof Error?error.message:'Database error');
  return Response.json({error:'Processing failed; retry this event.'},{status:500});
 }
});
