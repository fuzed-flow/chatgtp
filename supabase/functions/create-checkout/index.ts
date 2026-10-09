import { getBillingCycleFromPrice, getPlanIdFromPrice, getUsdPriceId } from "../_shared/subscriptionPlans.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 👇 1. Define the CORS handshake headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2026-08-26.dahlia',
  httpClient: Stripe.createFetchHttpClient(),
});

const ANNUAL_COUPON_CODE = 'FUZED25';
const ANNUAL_COUPON_ID = 'q7ZuyPnp';

serve(async (req) => {
  // 👇 2. Intercept the browser's preflight check
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 👇 FIX 1: Catch the company_id sent from Dashboard.jsx
    const { price_id, company_id, promotion_code } = await req.json();
    const usdPriceId = getUsdPriceId(price_id);
    if (!usdPriceId) {
      return new Response(JSON.stringify({ error: "Invalid subscription price" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const plan_id = getPlanIdFromPrice(usdPriceId);
    const billingCycle = getBillingCycleFromPrice(usdPriceId);
    const promotionCode = typeof promotion_code === 'string'
      ? promotion_code.trim().toUpperCase()
      : '';
    if (promotionCode && promotionCode !== ANNUAL_COUPON_CODE) {
      return new Response(JSON.stringify({ error: "Invalid promotion code" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (promotionCode === ANNUAL_COUPON_CODE && billingCycle !== 'annual') {
      return new Response(JSON.stringify({ error: "FUZED25 is available on annual plans only" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const annualCoupon = promotionCode === ANNUAL_COUPON_CODE ? ANNUAL_COUPON_CODE : '';

    const authHeader = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authHeader)) return Response.json({error:'Sign in to manage billing.'},{status:401,headers:corsHeaders});
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return Response.json({error:'Sign in to manage billing.'},{status:401,headers:corsHeaders});
    const {data:profile,error:profileError}=await supabaseClient.from('profiles').select('company_id,role,is_active').eq('id',user.id).single();
    if(profileError||!profile?.company_id||profile.company_id!==company_id||profile.is_active===false||!['admin','owner'].includes(profile.role)) return Response.json({error:'Only your company administrator can manage billing.'},{status:403,headers:corsHeaders});
    const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:company,error:companyError}=await service.from('companies').select('stripe_customer_id,name').eq('id',company_id).single();
    if(companyError||!company)throw new Error('Company unavailable.');
    let customerId=company.stripe_customer_id;
    if(!customerId){
      const customer=await stripe.customers.create({email:user.email,name:company.name,metadata:{company_id}},{idempotencyKey:`company-customer:${company_id}`});
      customerId=customer.id;
      const {error}=await service.from('companies').update({stripe_customer_id:customerId}).eq('id',company_id);if(error)throw error;
    }


    const session = await stripe.checkout.sessions.create({
      integration_identifier: `fuzedflow_subscription_${[...crypto.getRandomValues(new Uint8Array(8))].map(n=>String.fromCharCode(97+n%26)).join('')}`,
      customer: customerId,
      line_items: [
        {
          price: usdPriceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      // Keep Stripe's unrestricted promotion-code box on monthly plans only.
      // Annual discounts are allowlisted above and applied directly so a
      // free-month coupon cannot waive an entire annual invoice.
      allow_promotion_codes: billingCycle === 'monthly',
      ...(annualCoupon ? { discounts: [{ coupon: ANNUAL_COUPON_ID }] } : {}),
      subscription_data: {
        trial_period_days: 14, 
        metadata: {
          plan_id: plan_id,
          company_id: company_id, // Attach to the recurring subscription
          ...(annualCoupon ? { promotion_code: annualCoupon } : {})
        }
      },
      metadata: {
        plan_id: plan_id,
        user_id: user?.id || '',
        company_id: company_id, // 👇 FIX 2: Attach to the checkout session
        ...(annualCoupon ? { promotion_code: annualCoupon } : {})
      },
      success_url: `${Deno.env.get('APP_URL')}/dashboard?success=true`,
      cancel_url: `${Deno.env.get('APP_URL')}/pricing?canceled=true`,
      // 👇 FIX 3: Use company_id as the primary reference for the webhook
      client_reference_id: company_id, 
    });

    // 👇 3. Attach the CORS headers to the successful response
    return new Response(
      JSON.stringify({ url: session.url }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      },
    )
  } catch (err) {
    // 👇 4. Attach the CORS headers to the error response
    return new Response(String(err), { 
      headers: corsHeaders,
      status: 500 
    })
  }
})
