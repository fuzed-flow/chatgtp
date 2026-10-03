import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "npm:stripe@^14.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Get the payload sent from your React frontend
    const { amount, invoice_id, invoice_number, success_url, cancel_url } = await req.json();

    if (!amount || !invoice_id) {
      throw new Error("Missing required checkout fields (amount or invoice_id).");
    }

    // 2. Use the SERVICE ROLE KEY to bypass RLS so the server can read the Stripe Account ID safely
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 3. Fetch the invoice to find out which company it belongs to
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("company_id")
      .eq("id", invoice_id)
      .single();

    if (invoiceError || !invoice) {
      throw new Error("Invoice not found in the database.");
    }

    // ⚡ UPDATED: Now we also fetch the "settings" column to get their regional currency
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("stripe_account_id, settings")
      .eq("id", invoice.company_id)
      .single();

    if (companyError || !company || !company.stripe_account_id) {
      throw new Error("This company has not fully connected their Stripe account yet.");
    }

    // ⚡ NEW: Safely extract the regional currency from their settings. 
    // Fallback to "cad" if they haven't saved their regional settings yet.
    const regionalCurrency = (company.settings?.currency || "cad").toLowerCase();

    // 4. Initialize Stripe securely using your environment variables
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new Error("Missing Stripe Secret Key in environment variables.");
    
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 5. Create the Stripe Checkout Session
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: regionalCurrency, // ⚡ UPDATED: Now strictly uses their regional currency
              product_data: {
                name: `Invoice #${invoice_number || invoice_id}`, 
              },
              unit_amount: Math.round(amount * 100), 
            },
            quantity: 1,
          },
        ],
        // ADDED METADATA: Stripe will echo this back to your webhook when payment succeeds
        metadata: {
          invoice_id: invoice_id,
          invoice_number: invoice_number || "",
          company_id: invoice.company_id
        },
        success_url: success_url || `${Deno.env.get("APP_URL")}/success`,
        cancel_url: cancel_url || `${Deno.env.get("APP_URL")}/cancel`,
      },
      {
        stripeAccount: company.stripe_account_id, 
      }
    );

    // 6. Return the Checkout URL to the frontend so it can redirect the user
    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("Stripe Checkout Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});