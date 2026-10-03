import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Expected payload from your React frontend
    const { phone_number, message_body, client_id } = await req.json();

    if (!phone_number || !message_body) {
      throw new Error("Missing required SMS fields.");
    }

    // 1. Authenticate the User & Get their Company
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("DEBUG: Missing Authorization header from frontend.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { headers: { Authorization: authHeader } }
});

    // Extract the raw token and FORCE it into getUser()
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError) {
      throw new Error(`DEBUG Auth Error: ${authError.message}`);
    }
    if (!user) {
      throw new Error("DEBUG: No user found for this token.");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile) throw new Error("DEBUG: User profile not found");

    // 2. Send the SMS via Twilio API
    // ⚡ FIXED: Fetching by variable NAMES
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

    if (!twilioSid || !twilioAuthToken || !twilioFromNumber) {
      throw new Error("Twilio environment variables are missing.");
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    
    // Twilio expects URL-encoded form data, not JSON!
    const twilioBody = new URLSearchParams({
      To: phone_number,
      From: twilioFromNumber,
      Body: message_body,
    });

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuthToken}`)}`,
      },
      body: twilioBody,
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      throw new Error(`Twilio Error: ${twilioData.message}`);
    }

    // 3. Log the communication in your database
    const { error: logError } = await supabase
      .from("client_communications")
      .insert({
        company_id: profile.company_id,
        client_id: client_id || null,
        type: "SMS",
        direction: "outbound",
        subject: "Text Message Sent", 
        message: message_body,
        status: "sent",
        sent_by: user.id,
      });

    if (logError) {
      console.error("Failed to log SMS communication:", logError);
    }

    return new Response(
      JSON.stringify({ success: true, message_sid: twilioData.sid }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});