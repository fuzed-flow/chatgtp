import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const APP_URL = Deno.env.get("APP_URL") || "https://app.pro-trades.com";

serve(async (req) => {
  try {
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
        client_id, 
        company_id,
        companies ( id, name, settings ),
        clients ( name, email, phone )
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
      const client = quote.clients;
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

      const portalLink = `${APP_URL}/PublicQuoteView?id=${quote.id}`;
      const buttonHtml = `<br><br><a href="${portalLink}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Review Your Quote</a><br><br>`;
      const quoteTitle = quote.title ? ` for ${quote.title}` : "";

      if (stage === 0 && diffDays >= followUp1Days) {
        console.log(`✅ TRIGGER: Quote is ${diffDays} days old. Sending First Check-in!`);
        triggerEmail = true;
        newStage = 1;
        subject = `Checking in: Quote #${quote.quote_number}${quoteTitle}`;
        htmlBody = `<p>Hi ${client.name || 'there'},</p><p>Just following up...</p>${buttonHtml}`; // Shortened for logs
      } else if (stage === 1 && diffDays >= followUp2Days) {
        console.log(`✅ TRIGGER: Quote is ${diffDays} days old. Sending Final Push!`);
        triggerEmail = true;
        newStage = 2;
        subject = `Following up: Quote #${quote.quote_number}${quoteTitle}`;
        htmlBody = `<p>Hi ${client.name || 'there'},</p><p>Checking in one last time...</p>${buttonHtml}`;
      } else {
        console.log(`⏭️ SKIPPED: Not old enough yet, or stage is already completed.`);
      }

      if (triggerEmail) {
        const payload = {
          to_email: client.email, 
          to: client.email,
          subject: subject, 
          html_body: htmlBody, 
          html: htmlBody,
          client_id: quote.client_id,
          company_id: company.id
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

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ ERROR: send-email rejected the request. HTTP ${response.status}. Reason: ${errorText}`);
        } else {
          await supabaseAdmin.from("quotes").update({ automation_stage: newStage }).eq("id", quote.id);
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