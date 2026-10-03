import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use sandbox URL for testing, change to production later
const QBO_BASE_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { action, payload, company_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Get the QBO credentials from the database
    const { data: company, error } = await supabase
      .from("companies")
      .select("qbo_access_token, qbo_realm_id, qbo_refresh_token")
      .eq("id", company_id)
      .single();

    if (error || !company?.qbo_access_token) {
      throw new Error("QuickBooks is not connected for this company.");
    }

    // (Insert Token Refresh Logic Here if needed based on expiration time)
    const accessToken = company.qbo_access_token;
    const realmId = company.qbo_realm_id;

    let qboResponse;

    // 2. Route the Action
    if (action === "create_customer") {
      
      // Example: Pushing a new client to QuickBooks
      const qboReq = await fetch(`${QBO_BASE_URL}/${realmId}/customer`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          DisplayName: payload.client_name,
          PrimaryEmailAddr: { Address: payload.email },
          PrimaryPhone: { FreeFormNumber: payload.phone }
        }),
      });
      
      qboResponse = await qboReq.json();
      if (!qboReq.ok) throw new Error(JSON.stringify(qboResponse));

    } else if (action === "get_company_info") {
      
      // Example: Reading data from QuickBooks
      const qboReq = await fetch(`${QBO_BASE_URL}/${realmId}/companyinfo/${realmId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      });
      
      qboResponse = await qboReq.json();
      if (!qboReq.ok) throw new Error(JSON.stringify(qboResponse));
      
    } else {
      throw new Error("Invalid QBO action specified.");
    }

    return new Response(JSON.stringify({ success: true, data: qboResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err: any) {
    console.error("QBO API Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});