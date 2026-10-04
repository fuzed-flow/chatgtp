import { getPlanIdFromPrice, getUsdPriceId } from "../_shared/subscriptionPlans.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'npm:stripe@^14.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 👇 1. Define the CORS handshake headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2022-11-15',
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: usdPriceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      allow_promotion_codes: true,
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