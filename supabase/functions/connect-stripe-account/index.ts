import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173"; // Use localhost for testing, change to live URL later

    if (!stripeSecretKey) throw new Error("Stripe Secret Key is missing from Supabase environment variables.");

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Authenticate user session
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized user access.");

    // 2. Fetch the company profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) throw new Error("User profile or company mapping not found.");

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, stripe_account_id")
      .eq("id", profile.company_id)
      .single();

    if (companyError || !company) throw new Error("Company record not found.");

    let stripeAccountId = company.stripe_account_id;

    // 3. If they don't have a Stripe account yet, create an Express Connected Account
    if (!stripeAccountId) {
      console.log(`Creating new Stripe Express Account for company: ${company.name}`);
      
      const accountParams = new URLSearchParams({
        type: "express",
        country: "CA", // Or "CA" if you are operating out of Canada
        email: user.email || "",
        "business_profile[name]": company.name,
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
      });

      const createRes = await fetch("https://api.stripe.com/v1/accounts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: accountParams.toString(),
      });

      const accountData = await createRes.json();
      if (!createRes.ok) throw new Error(`Stripe Account Creation Error: ${accountData.error?.message}`);

      stripeAccountId = accountData.id;

      // Save the newly minted account ID to the database immediately
      await supabase
        .from("companies")
        .update({ stripe_account_id: stripeAccountId })
        .eq("id", company.id);
    }

    // 4. Generate the co-branded Stripe Express Onboarding Link
    console.log(`Generating Onboarding Link for Stripe Account: ${stripeAccountId}`);
    
    const linkParams = new URLSearchParams({
  account: stripeAccountId,
  refresh_url: `https://www.fuzedflow.com/AdminSettings?stripe=failed`,
  return_url: `https://www.fuzedflow.com/AdminSettings?stripe=success`,
  type: "account_onboarding",
});

    const linkRes = await fetch("https://api.stripe.com/v1/account_links", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: linkParams.toString(),
    });

    const linkData = await linkRes.json();
    if (!linkRes.ok) throw new Error(`Stripe Link Generation Error: ${linkData.error?.message}`);

    return new Response(
      JSON.stringify({ url: linkData.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err: any) {
    console.error("Connect Stripe Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});