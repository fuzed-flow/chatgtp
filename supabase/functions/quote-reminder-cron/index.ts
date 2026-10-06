import { stableRequestId } from "../_shared/salesNotifications.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const configuredAppUrl = Deno.env.get("APP_URL");
const APP_URL = configuredAppUrl && !/^https?:\/\/(?:app\.)?pro-trades\.(?:com|ca)(?:\/|$)/i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, "")
  : "https://app.fuzedflow.com";

serve(async (req) => {
  try {
    const serviceAuth = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceAuth || req.headers.get("Authorization") !== `Bearer ${serviceAuth}`) return new Response("Authentication required", { status: 401 });
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Wake up! Fetching Sent/Viewed quotes...");

    const { data: quotes, error: fetchError } = await supabaseAdmin
      .from("quotes")
      .select(`
        id, 
        quote_number,
        title,
        status,
        created_at,
        automation_stage, 
        client_id, lead_id,
        company_id,
        companies ( id, name, settings ),
        clients ( name, email, phone ), leads ( contact_name, contact_email, contact_phone )
      `)
      .in("status", ["Sent", "Viewed"]);

    if (fetchError) throw fetchError;
    
    if (!quotes || quotes.length === 0) {
      console.log("Result: Zero quotes found in the database with status 'Sent' or 'Viewed'.");
      return new Response(JSON.stringify({ message: "No pending quotes found." }), { status: 200 });
    }

    console.log(`Found ${quotes.length} pending quote(s). Evaluating...`);
    let emailsTriggered = 0;

    for (const quote of quotes) {
      console.log(`\n--- Checking Quote #${quote.quote_number} ---`);
      
      const company = quote.companies;
      const client = quote.clients || (quote.leads ? { name: quote.leads.contact_name, email: quote.leads.contact_email, phone: quote.leads.contact_phone } : null);
      const automations = company?.settings?.automations;

      // SAFETY CHECKS
      if (!automations) {
        console.log(`⏭️ SKIPPED: Company has no 'automations' object in their settings JSON. (Did you click Save on the Automation UI?)`);
        continue;
      }
      if (automations.quote_enabled === false) {
        console.log(`⏭️ SKIPPED: Quote automations are toggled OFF for this company.`);
        continue;
      }
      if (!client?.email) {
        console.log(`⏭️ SKIPPED: The client attached to this quote does not have an email address.`);
        continue;
      }

      const stage = quote.automation_stage || 0;
      const startDate = new Date(quote.created_at);
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - startDate.getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      const followUp1Days = automations.quote_followup_1 || 3;
      const followUp2Days = automations.quote_followup_2 || 7;

      console.log(`Data: Stage=${stage}, Days Old=${diffDays}, Needs=${followUp1Days} days for Stage 1`);

      let triggerEmail = false;
      let newStage = stage;
      let subject = "";
      let htmlBody = "";

      const quoteTitle = quote.title ? ` for ${quote.title}` : "";

      if (stage === 0 && diffDays >= followUp1Days) {
        console.log(`✅ TRIGGER: Quote is ${diffDays} days old. Sending First Check-in!`);
        triggerEmail = true;
        newStage = 1;
        subject = `Checking in: Quote #${quote.quote_number}${quoteTitle}`;
        htmlBody = `<p>Hi ${client.name || 'there'},</p><p>Just following up...</p>`;
      } else if (stage === 1 && diffDays >= followUp2Days) {
        console.log(`✅ TRIGGER: Quote is ${diffDays} days old. Sending Final Push!`);
        triggerEmail = true;
        newStage = 2;
        subject = `Following up: Quote #${quote.quote_number}${quoteTitle}`;
        htmlBody = `<p>Hi ${client.name || 'there'},</p><p>Checking in one last time...</p>`;
      } else {
        console.log(`⏭️ SKIPPED: Not old enough yet, or stage is already completed.`);
      }

      if (triggerEmail) {
        // Reuse the same active access token as manual sends. The staff-only
        // issue_quote_share_token RPC cannot be called by this scheduled job.
        const { data: approval, error: approvalError } = await supabaseAdmin
          .from("quote_approvals")
          .select("approval_token")
          .eq("quote_id", quote.id)
          .eq("company_id", quote.company_id)
          .or("approval_status.is.null,approval_status.neq.Revoked")
          .order("created_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        const token = approval?.approval_token;
        if (approvalError || typeof token !== "string" || token.length < 32 || token.length > 256) {
          console.error(`Quote #${quote.quote_number} reminder skipped: secure link unavailable.`);
          continue;
        }
        const portalLink = new URL(`/PublicQuoteView/${encodeURIComponent(quote.id)}/${encodeURIComponent(token)}`, APP_URL).toString();
        htmlBody += `<br><br><a href="${portalLink}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Review Your Quote</a><br><br>`;

        const payload = {
          to_email: client.email, 
          to: client.email,
          subject: subject, 
          html_body: htmlBody, 
          html: htmlBody,
          client_id: quote.client_id,
          company_id: company.id, document_type: "quote", document_id: quote.id, notification_kind: "followup", track_replies: true,
          request_id: await stableRequestId(`quote:${quote.id}:followup:${newStage}:email`)
        };

        console.log(`Sending payload to send-email...`);
        
        // ⚡ THE FIX: Use the Service Role (Admin) Key instead of the Anon Key!
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        
        const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || result.success !== true) {
          const errorText = "Customer reminder delivery was not confirmed";
          console.error(`❌ ERROR: send-email rejected the request. HTTP ${response.status}. Reason: ${errorText}`);
        } else {
          await supabaseAdmin.from("quotes").update({ automation_stage: newStage }).eq("id", quote.id).eq("company_id", quote.company_id).eq("status", quote.status);
          console.log(`🎉 SUCCESS: Email sent and quote moved to stage ${newStage}.`);
          emailsTriggered++;
        }
      }
    }

    console.log(`\nFinished! Total emails processed: ${emailsTriggered}`);
    return new Response(JSON.stringify({ success: true, processed: emailsTriggered }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Cron Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
