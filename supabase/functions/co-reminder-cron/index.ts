import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const APP_URL = Deno.env.get("APP_URL") || "https://fuzedflow.com";

serve(async (req) => {
  try {
    // FIX: Properly fetching the variables by their NAMES, not pasting the raw keys!
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Wake up! Fetching pending Change Orders...");

    // 1. Fetch all pending Change Orders across all companies
    const { data: changeOrders, error: fetchError } = await supabaseAdmin
      .from("change_orders")
      .select(`
        id, 
        change_order_number,
        title,
        status,
        created_at,
        automation_stage, 
        client_id, 
        company_id,
        companies ( id, name, settings ),
        clients ( name, email, phone )
      `)
      .in("status", ["Sent", "Viewed", "Pending"]);

    if (fetchError) throw fetchError;
    
    if (!changeOrders || changeOrders.length === 0) {
      console.log("Result: Zero pending change orders found.");
      return new Response(JSON.stringify({ message: "No pending change orders found." }), { status: 200 });
    }

    console.log(`Found ${changeOrders.length} pending change order(s). Evaluating...`);
    let emailsTriggered = 0;
    let smsTriggered = 0;

    for (const co of changeOrders) {
      console.log(`\n--- Checking Change Order #${co.change_order_number} ---`);
      
      const company = co.companies;
      const client = co.clients;
      const automations = company?.settings?.automations;

      // SAFETY CHECKS
      if (!automations || automations.co_enabled === false) continue;
      if (!client?.email && !client?.phone) continue;

      const stage = co.automation_stage || 0;
      
      // Calculate days old
      const startDate = new Date(co.created_at);
      const today = new Date();
      startDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);

      const diffTime = today.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      const followUp1Days = automations.co_followup_1 || 2; // Default tight turnaround (2 days)

      let triggerNotification = false;
      let newStage = stage;
      let subject = "";
      let htmlBody = "";
      let smsBody = "";

      const portalLink = `${APP_URL}/PublicChangeOrderView?id=${co.id}`; // Adjust if your route is named differently!
      
      // Urgent Amber Button
      const buttonHtml = `<table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="left"><a href="${portalLink}" style="background-color: #f59e0b; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-family: sans-serif; display: inline-block; font-size: 16px;">Review & Approve Change Order</a></td></tr></table>`;
      
      const coTitle = co.title ? ` for ${co.title}` : "";
      const companyName = company.name || "us";
      const clientFirstName = client.name ? client.name.split(' ')[0] : 'there';

      // ==========================================
      // STAGE 1: URGENT CHECK-IN
      // ==========================================
      if (stage === 0 && diffDays >= followUp1Days) {
        triggerNotification = true;
        newStage = 1;
        
        subject = `Urgent: Action Required on Change Order #${co.change_order_number} from ${companyName}`;
        htmlBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; line-height: 1.6; font-size: 16px; max-width: 600px;">
            <p>Hi ${clientFirstName},</p>
            <p>We are reaching out because Change Order #${co.change_order_number}${coTitle} is currently awaiting your review.</p>
            <p>Because these adjustments directly impact the timeline and progression of your project, we cannot proceed with this work until we receive your digital signature.</p>
            <p>To keep everything on schedule, please review and approve the change order securely online using the link below:</p>
            <br>
            ${buttonHtml}
            <br><br>
            <p>If you have any questions or concerns regarding this change order, please let us know immediately.</p>
            <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Best regards,<br>The team at ${companyName}</p>
          </div>
        `;
        
        smsBody = `Hi ${clientFirstName}. This is an urgent reminder from ${companyName}. Change Order #${co.change_order_number} requires your approval to keep your project moving forward. Please review and approve it here: ${portalLink}`;
      }

      // FIRE THE AUTOMATIONS
      if (triggerNotification) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        
        const fetchHeaders = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey
        };

        const notifications = [];

        // Queue Email via your unified Notification Engine
        if (client.email) {
          notifications.push(
            fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: fetchHeaders,
              body: JSON.stringify({
                to_email: client.email, 
                subject: subject, 
                html_body: htmlBody, 
                client_id: co.client_id,
                company_id: company.id
              })
            }).then(res => {
              if (res.ok) emailsTriggered++;
              else res.text().then(t => console.error("Email failed:", t));
            })
          );
        }

        // Queue SMS via your unified Notification Engine
        if (client.phone) {
          notifications.push(
            fetch(`${supabaseUrl}/functions/v1/send-sms`, {
              method: "POST",
              headers: fetchHeaders,
              body: JSON.stringify({
                phone_number: client.phone,
                message_body: smsBody,
                client_id: co.client_id,
                company_id: company.id
              })
            }).then(res => {
              if (res.ok) smsTriggered++;
              else res.text().then(t => console.error("SMS failed:", t));
            })
          );
        }

        // Wait for sending to finish
        await Promise.all(notifications);
        
        // Advance the automation stage
        await supabaseAdmin.from("change_orders").update({ automation_stage: newStage }).eq("id", co.id);
        console.log(`🎉 SUCCESS: Notifications sent and CO moved to stage ${newStage}.`);
      }
    }

    return new Response(JSON.stringify({ success: true, emails: emailsTriggered, sms: smsTriggered }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Cron Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});