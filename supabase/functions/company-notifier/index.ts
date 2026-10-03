import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { event_key, document_id, message_body, company_id } = await req.json();

    if (!message_body || !event_key || !company_id) {
      throw new Error("Missing required fields: event_key, company_id, and message_body.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch company configurations (Grabbing settings, root phone, and override columns)
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("settings, name, phone, notification_emails")
      .eq("id", company_id)
      .single();

    if (companyError || !company) throw new Error("Company not found in database.");

    // 2. FETCH ALL USERS WHO SHOULD RECEIVE THIS (Role-based example)
    const { data: teamMembers } = await supabase
      .from("profiles")
      .select("id")
      .eq("company_id", company_id)
      .in("role", ["admin", "manager"]); // ⚡ Routing by Role!

    if (teamMembers && teamMembers.length > 0) {
      const notificationsToInsert = teamMembers.map(member => ({
        company_id: company_id,
        user_id: member.id,
        type: event_key,
        severity: "Action Required", // Trigger the red alert
        category: "System",          // Drop it in the correct tab
        title: "System Alert Triggered",
        body: `${message_body}\nDoc Ref: ${document_id}`
      }));

      const { error: insertError } = await supabase.from("notifications").insert(notificationsToInsert);
      if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);
    }

    // 3. Extract Notification Preferences from your UI settings
    let prefs = company?.settings?.notifications?.[event_key] || { email: false, mobile: false };

    // ⚡ NEW: If the database stored a simple 'true' instead of an object, convert it!
    if (typeof prefs === "boolean") {
      prefs = { email: prefs, mobile: prefs };
    }

    // 4. Resolve destination endpoints directly from the corporate profile
    const targetEmail = company?.notification_emails || company?.settings?.email;
    const targetPhone = company?.phone || company?.settings?.phone; // Bypasses employee table loops entirely

    // --- EXECUTE OUTBOUND TWILIO SMS ---
    if (prefs.mobile && targetPhone) {
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

      if (twilioSid && twilioAuthToken && twilioFromNumber) {
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuthToken}`)}`,
          },
          body: new URLSearchParams({
            To: targetPhone,
            From: twilioFromNumber,
            Body: `FuzedFlow Alert: ${message_body}`,
          }),
        });
      }
    }

    // --- EXECUTE OUTBOUND RESEND EMAIL ---
    if (prefs.email && targetEmail) {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "FuzedFlow Alerts <alerts@mail.fuzedflow.com>",
            to: [targetEmail],
            subject: `New Activity: ${document_id || 'Update'}`,
            html: `<p><strong>${company?.name || 'Your Company'}</strong></p><p>${message_body}</p>`,
          }),
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "Company routing completed successfully." }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});