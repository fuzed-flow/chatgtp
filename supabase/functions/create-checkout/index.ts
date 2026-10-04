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

serve(async (req) => {
  // 👇 2. Intercept the browser's preflight check
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 👇 FIX 1: Catch the company_id sent from Dashboard.jsx
    const { price_id, company_id } = await req.json();
    const usdPriceId = getUsdPriceId(price_id);
    if (!usdPriceId) {
      return new Response(JSON.stringify({ error: "Invalid subscription price" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const plan_id = getPlanIdFromPrice(usdPriceId);

    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Sign in to manage billing.');
    const {data:profile,error:profileError}=await supabaseClient.from('profiles').select('company_id,role,is_active').eq('id',user.id).single();
    if(profileError||profile?.company_id!==company_id||profile.is_active===false||!['admin','owner'].includes(profile.role)) throw new Error('Only your company administrator can manage billing.');
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
      // A free-month coupon must not waive an entire annual invoice.
      allow_promotion_codes: getBillingCycleFromPrice(usdPriceId) === 'monthly',
      subscription_data: {
        trial_period_days: 14, 
        metadata: {
          plan_id: plan_id,
          company_id: company_id // Attach to the recurring subscription
        }
      },
      metadata: {
        plan_id: plan_id,
        user_id: user?.id || '',
        company_id: company_id // 👇 FIX 2: Attach to the checkout session
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
