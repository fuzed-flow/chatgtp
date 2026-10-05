// Notification events retain current USD/CAD prices, purchased seats and connected-account isolation.
import { getPlanIdFromPrice, getUserLimitFromQuantity, getUsdPriceId } from "../_shared/subscriptionPlans.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import Stripe from "npm:stripe@22.6.0";
import { providerServerConfig, salesUuid } from "../_shared/salesNotifications.js";

import { currencyFactor } from "../_shared/checkout.js";

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', { apiVersion: '2026-08-26.dahlia', httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const identifier = value => typeof value === 'string' ? value : value?.id || null;
const epoch = value => Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : null;
const required = async operation => { const result = await operation; if (result.error) throw new Error('Saved billing data could not be updated.'); return result.data; };
const record = async (db, company, event, related, id, reference, message) => required(db.rpc('record_sales_event', { p_company: company, p_event: event, p_related: related, p_id: id, p_reference: reference, p_message: message, p_actor: null }));

async function subscriptionCompany(db, customer, metadata = {}) {
  if (!customer) return null;
  let company = await required(db.from('companies').select('*').eq('stripe_customer_id', customer).maybeSingle());
  if (!company && salesUuid.test(metadata.company_id || '')) {
    const candidate = await required(db.from('companies').select('*').eq('id', metadata.company_id).maybeSingle());
    if (candidate && (!candidate.stripe_customer_id || candidate.stripe_customer_id === customer)) {
      await required(db.from('companies').update({ stripe_customer_id: customer }).eq('id', candidate.id));
      company = { ...candidate, stripe_customer_id: customer };
    }
  }
  return company;
}

async function paymentContext(db, account, object) {
  const intent = identifier(object.payment_intent) || (object.object === 'payment_intent' ? object.id : null);
  const saved = await required(db.rpc('stripe_payment_context', { p_intent: intent, p_session: object.object === 'checkout.session' ? object.id : null }));
  let context = saved;
  if (!context) {
    let metadata = object.metadata || {};
    if (!metadata.invoice_id && !metadata.quote_id && intent) {
      const payment = await stripe.paymentIntents.retrieve(intent, {}, { stripeAccount: account });
      metadata = payment.metadata || {};
      if (!metadata.invoice_id && !metadata.quote_id) {
        const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 1 }, { stripeAccount: account });
        metadata = sessions.data[0]?.metadata || {};
      }
    }
    const type = metadata.invoice_id ? 'invoice' : metadata.quote_id ? 'quote' : null;
    const documentId = metadata.invoice_id || metadata.quote_id;
    if (!type || !salesUuid.test(documentId || '') || !salesUuid.test(metadata.company_id || '')) return null;
    const company = await required(db.from('companies').select('id,stripe_account_id').eq('id', metadata.company_id).maybeSingle());
    const document = await required(db.from(type === 'invoice' ? 'invoices' : 'quotes').select('id,company_id').eq('id', documentId).eq('company_id', company?.id || metadata.company_id).maybeSingle());
    if (!company || !document) return null;
    context = { company_id: company.id, stripe_account_id: company.stripe_account_id, document_type: type, document_id: document.id };
  }
  if (!account || context.stripe_account_id !== account) throw new Error('Connected account does not match the saved company.');
  return context;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  let event, verified = null;
  try {
    const raw = await req.text();
    const config = await providerServerConfig(db);
    const secrets = [['platform', Deno.env.get('STRIPE_WEBHOOK_SECRET')], ['connect', config.stripe_connect_webhook_secret]];
    for (const [kind, secret] of secrets) {
      if (!secret) continue;
      try { event = await stripe.webhooks.constructEventAsync(raw, signature, secret, undefined, cryptoProvider); verified = kind; break; } catch { /* Try the other configured destination. */ }
    }
    if (!event || (event.account && verified !== 'connect') || (!event.account && verified !== 'platform')) return new Response('Invalid signature', { status: 400 });
  } catch { return new Response('Invalid signature', { status: 400 }); }
  try {
    const object = event.data.object;
    const reference = event.id;
    const account = event.account || null;
    if (event.type === 'account.updated' && account) {
      if (object.id !== account) return new Response('Invalid connected account', { status: 400 });
      await required(db.from('companies').update({ stripe_charges_enabled: object.charges_enabled === true }).eq('stripe_account_id', account));
    } else if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      if (object.mode === 'payment' && object.payment_status === 'paid') {
        const context = await paymentContext(db, account, object);
        if (context) await required(db.rpc('record_stripe_payment', { p_company: context.company_id, p_type: context.document_type, p_document: context.document_id, p_account: account, p_session: object.id, p_intent: identifier(object.payment_intent), p_amount: (object.amount_total || 0) / currencyFactor(object.currency || 'usd'), p_paid_at: epoch(object.created) || new Date().toISOString() }));
      } else if (object.mode === 'subscription' && !account && identifier(object.subscription)) {
        const subscription = await stripe.subscriptions.retrieve(identifier(object.subscription));
        const company = await subscriptionCompany(db, identifier(object.customer), { ...subscription.metadata, ...object.metadata });
        if (company) await updateSubscription(db, company, subscription, false, reference);
      }
    } else if (['checkout.session.async_payment_failed', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event.type) && account) {
      let payment = object;
      if (event.type.startsWith('charge.dispute.') && identifier(object.charge)) payment = await stripe.charges.retrieve(identifier(object.charge), {}, { stripeAccount: account });
      const context = await paymentContext(db, account, payment);
      if (context) {
        const key = event.type === 'charge.refunded' ? 'payment_refunded' : event.type.startsWith('charge.dispute.') ? 'payment_disputed' : 'payment_failed';
        await record(db, context.company_id, key, context.document_type === 'invoice' ? 'Invoice' : 'Quote', context.document_id, reference, key === 'payment_refunded' ? 'Stripe recorded a refund. Review the payment in the connected Stripe account.' : key === 'payment_disputed' ? `Stripe dispute ${event.type.endsWith('closed') ? 'updated' : 'opened'}. Review the case in the connected Stripe account.` : 'Stripe payment failed. Review the saved document and contact the client.');
      }
    } else if (event.type.startsWith('customer.subscription.') && !account) {
      const company = await subscriptionCompany(db, identifier(object.customer), object.metadata);
      if (company) await updateSubscription(db, company, object, event.type === 'customer.subscription.deleted', reference);
    } else if (['invoice.paid', 'invoice.payment_failed', 'invoice.upcoming'].includes(event.type) && !account) {
      const company = await subscriptionCompany(db, identifier(object.customer));
      if (company) {
        const subscriptionId = identifier(object.parent?.subscription_details?.subscription || object.subscription);
        if (subscriptionId && event.type !== 'invoice.upcoming') await updateSubscription(db, company, await stripe.subscriptions.retrieve(subscriptionId), false, reference);
        if (event.type === 'invoice.payment_failed') {
          await required(db.from('companies').update({ subscription_status: 'Past Due' }).eq('id', company.id));
          await record(db, company.id, 'subscription_payment_failed', 'Company', company.id, reference, 'Subscription payment failed. Open billing to update the payment method.');
        } else if (event.type === 'invoice.upcoming') {
          await required(db.from('companies').update({ subscription_renews_at: epoch(object.period_end) }).eq('id', company.id));
          await record(db, company.id, 'subscription_renewal_upcoming', 'Company', company.id, reference, 'A subscription renewal is approaching. Review billing before the renewal date.');
        } else {
          const receipt = /^https:\/\/(?:[a-z0-9-]+\.)?stripe\.com\//i.test(object.hosted_invoice_url || '') ? object.hosted_invoice_url : null;
          await required(db.from('companies').update({ subscription_status: 'Active', ...(receipt ? { subscription_last_receipt_url: receipt } : {}) }).eq('id', company.id));
          await record(db, company.id, 'subscription_payment_received', 'Company', company.id, reference, 'Subscription payment received. Open billing to review the invoice.');
          if (receipt) await record(db, company.id, 'subscription_receipt', 'Company', company.id, reference, 'A subscription receipt is available in Stripe billing history.');
        }
      }
    } else if (['payment_method.attached', 'payment_method.updated', 'customer.updated', 'customer.source.expiring'].includes(event.type) && !account) {
      const customer = object.object === 'customer' ? object.id : identifier(object.customer);
      const company = await subscriptionCompany(db, customer);
      if (company) {
        let card = object.card || (object.object === 'card' ? object : null);
        const defaultMethod = identifier(object.invoice_settings?.default_payment_method);
        if (!card && defaultMethod) card = (await stripe.paymentMethods.retrieve(defaultMethod)).card;
        if (card?.exp_year && card?.exp_month) {
          const expiry = new Date(Date.UTC(card.exp_year, card.exp_month, 0)).toISOString().slice(0, 10);
          await required(db.from('companies').update({ subscription_card_expiry: expiry }).eq('id', company.id));
          if (event.type === 'customer.source.expiring') await record(db, company.id, 'subscription_card_expiring', 'Company', company.id, reference, 'The subscription card expires soon. Open billing to update it.');
        }
      }
    }
    return Response.json({ received: true });
  } catch { console.error('Signed billing event requires a retry.'); return new Response('Billing event processing failed', { status: 500 }); }
});

async function updateSubscription(db, company, subscription, deleted, reference) {
  const item = subscription.items?.data?.[0];
  if (!deleted && !getUsdPriceId(item?.price?.id)) throw new Error('Unrecognized subscription price');
  const plan = deleted ? 'free' : getPlanIdFromPrice(item?.price?.id);
  const active = ['active', 'trialing'].includes(subscription.status);
  const cancellation = epoch(subscription.cancel_at || (subscription.cancel_at_period_end ? subscription.current_period_end || item?.current_period_end : null));
  const renewal = epoch(subscription.current_period_end || item?.current_period_end);
  await required(db.from('companies').update({ plan_id: plan, subscription_status: deleted ? 'Canceled' : active ? 'Active' : 'Past Due', max_users: deleted ? 1 : getUserLimitFromQuantity(plan, item?.quantity || 1), subscription_renews_at: renewal, subscription_cancel_at: cancellation }).eq('id', company.id).eq('stripe_customer_id', identifier(subscription.customer)));
  if (deleted) await record(db, company.id, 'subscription_cancelled', 'Company', company.id, reference, 'Subscription cancelled. Open billing to review access and restart options.');
  else if (cancellation && cancellation !== company.subscription_cancel_at) await record(db, company.id, 'subscription_cancellation_scheduled', 'Company', company.id, reference, 'Subscription cancellation is scheduled. Open billing to review the cancellation date.');
}
