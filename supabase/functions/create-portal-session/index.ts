import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'npm:stripe@22.6.0'
import { checkoutReturnUrl } from '../_shared/checkout.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2026-08-26.dahlia',
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { return_url } = await req.json();

    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    
    // 1. Authenticate the user
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return Response.json({error:'Sign in to manage billing.'},{status:401,headers:corsHeaders});

    // 👇 2. NEW: Two-Step Lookup to match your schema!
    // Step A: Find their company_id from their profile
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('company_id,role,is_active')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id || profile.is_active === false || !['admin','owner'].includes(profile.role)) {
      return Response.json({error:'Only your company administrator can manage billing.'},{status:403,headers:corsHeaders});
    }

    // Step B: Get the Stripe Customer ID from their company
    const { data: companyData } = await supabaseClient
      .from('companies')
      .select('stripe_customer_id')
      .eq('id', profile.company_id)
      .single();

    if (!companyData?.stripe_customer_id) {
      throw new Error('No active Stripe customer found for this account.');
    }

    // 3. Generate the Portal Link
    const session = await stripe.billingPortal.sessions.create({
      customer: companyData.stripe_customer_id,
      return_url: checkoutReturnUrl(return_url, `${Deno.env.get('APP_URL') || 'https://app.fuzedflow.com'}/AdminSettings`, Deno.env.get('APP_URL') || 'https://app.fuzedflow.com'),
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400 
    })
  }
})
