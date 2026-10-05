import { stableRequestId } from "../_shared/salesNotifications.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const APP_URL = Deno.env.get("APP_URL") || "https://app.fuzedflow.com";

serve(async (req) => {
  try {
    const serviceAuth = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceAuth || req.headers.get("Authorization") !== `Bearer ${serviceAuth}`) return new Response("Authentication required", { status: 401 });
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Wake up! Fetching pending invoices...");

    // 1. Fetch pending invoices (Ignoring Paid, Draft, and Void)
    const { data: invoices, error: fetchError } = await supabaseAdmin
      .from("invoices")
      .select(`
        id, 
        invoice_number,
        status,
        due_date,
        automation_stage, 
        client_id, 
        company_id,
        companies ( id, name, settings ),
        clients ( name, email, phone )
      `)
      .in("status", ["Sent", "Viewed", "Overdue", "Partial", "Partially Paid"]);

    if (fetchError) throw fetchError;
    
    if (!invoices || invoices.length === 0) {
      console.log("Result: Zero pending invoices found.");
      return new Response(JSON.stringify({ message: "No pending invoices found." }), { status: 200 });
    }

    console.log(`Found ${invoices.length} pending invoice(s). Evaluating...`);
    let emailsTriggered = 0;
    let smsTriggered = 0;

    for (const invoice of invoices) {
      console.log(`\n--- Checking Invoice #${invoice.invoice_number} ---`);
      
      const company = invoice.companies;
      const client = invoice.clients;
      const automations = company?.settings?.automations;

      // SAFETY CHECKS
      if (!automations || automations.invoice_enabled === false) continue;
      if (!client?.email && !client?.phone) continue;
      if (!invoice.due_date) {
        console.log(`⏭️ SKIPPED: Invoice has no due date.`);
        continue;
      }

      const stage = invoice.automation_stage || 0;
      
      // Calculate days relative to Due Date (Negative = Upcoming, Positive = Overdue)
      const dueDate = new Date(invoice.due_date);
      const today = new Date();
      
      // Normalize to midnight to prevent timezone/time-of-day math errors
      dueDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);

      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 

      const preDueDays = automations.invoice_predue || 3;
      const overdue1Days = automations.invoice_overdue_1 || 3;
      const overdue2Days = automations.invoice_overdue_2 || 14;

      let triggerNotification = false;
      let newStage = stage;
      let subject = "";
      let htmlBody = "";
      let smsBody = "";

      // Format Due Date for the email copy
      const formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      const portalLink = `${APP_URL}/PublicInvoiceView?id=${invoice.id}`;
      // Clean, professional SaaS-style button (Green for payments)
      const buttonHtml = `<table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="left"><a href="${portalLink}" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-family: sans-serif; display: inline-block; font-size: 16px;">View & Pay Invoice</a></td></tr></table>`;
      
      const invoiceTitle = invoice.title ? ` for ${invoice.title}` : "";
      const companyName = company.name || "us";
      const clientFirstName = client.name ? client.name.split(' ')[0] : 'there';

      // ==========================================
      // STAGE 0 -> 1: PRE-DUE REMINDER
      // Trigger: If today is within the pre-due window, but NOT past the due date yet.
      // ==========================================
      if (stage === 0 && diffDays >= -preDueDays && diffDays <= 0) {
        triggerNotification = true;
        newStage = 1;
        
        subject = `Upcoming Reminder: Invoice #${invoice.invoice_number} from ${companyName}`;
        htmlBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; line-height: 1.6; font-size: 16px; max-width: 600px;">
            <p>Hi ${clientFirstName},</p>
            <p>This is a polite reminder that Invoice #${invoice.invoice_number}${invoiceTitle} is due on <strong>${formattedDueDate}</strong>.</p>
            <p>You can view your invoice details and securely complete your payment online using the link below.</p>
            <br>
            ${buttonHtml}
            <br><br>
            <p>If you have already submitted your payment, please disregard this message. Thank you for your business!</p>
            <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Best regards,<br>The team at ${companyName}</p>
          </div>
        `;
        
        smsBody = `Hi ${clientFirstName}. This is a polite reminder from ${companyName} that Invoice #${invoice.invoice_number} is due on ${formattedDueDate}. You can view and pay it securely here: ${portalLink}`;
      } 
      // ==========================================
      // STAGE 0/1 -> 2: LATE NOTICE #1
      // Trigger: If invoice is overdue by X days.
      // ==========================================
      else if (stage <= 1 && diffDays >= overdue1Days && diffDays < overdue2Days) {
        triggerNotification = true;
        newStage = 2;
        
        subject = `Overdue Notice: Invoice #${invoice.invoice_number} from ${companyName}`;
        htmlBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; line-height: 1.6; font-size: 16px; max-width: 600px;">
            <p>Hi ${clientFirstName},</p>
            <p>This is a friendly follow-up to let you know that Invoice #${invoice.invoice_number}${invoiceTitle} is currently past due.</p>
            <p>We understand that things can occasionally slip through the cracks. Please take a moment to review the invoice and complete your payment online using the link below.</p>
            <br>
            ${buttonHtml}
            <br><br>
            <p>If you recently mailed a check or submitted payment, please let us know so we can update your account. Thank you!</p>
            <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Best regards,<br>The team at ${companyName}</p>
          </div>
        `;
        
        smsBody = `Hi ${clientFirstName}. A friendly reminder from ${companyName} that Invoice #${invoice.invoice_number} is currently past due. You can easily view and pay your balance here: ${portalLink}`;
      }
      // ==========================================
      // STAGE 0/1/2 -> 3: LATE NOTICE #2
      // Trigger: If invoice is heavily overdue by Y days.
      // ==========================================
      else if (stage <= 2 && diffDays >= overdue2Days) {
        triggerNotification = true;
        newStage = 3;
        
        subject = `Urgent: Invoice #${invoice.invoice_number} is significantly past due`;
        htmlBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; line-height: 1.6; font-size: 16px; max-width: 600px;">
            <p>Hi ${clientFirstName},</p>
            <p>This is an urgent notice regarding Invoice #${invoice.invoice_number}${invoiceTitle}, which was due on <strong>${formattedDueDate}</strong> and is now significantly past due.</p>
            <p>Please remit payment immediately to bring your account current. You can pay securely online using the link below.</p>
            <br>
            ${buttonHtml}
            <br><br>
            <p>If there is an issue preventing payment, please reply to this email immediately so we can assist you.</p>
            <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Best regards,<br>The team at ${companyName}</p>
          </div>
        `;
        
        smsBody = `Hi ${clientFirstName}. This is an urgent notice from ${companyName}. Invoice #${invoice.invoice_number} is significantly past due. Please remit payment immediately via this link: ${portalLink}`;
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
        let deliveriesSucceeded = true;

        // Queue Email
        if (client.email) {
          notifications.push(
            fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: fetchHeaders,
              body: JSON.stringify({
                to_email: client.email, 
                subject: subject, 
                html_body: htmlBody, 
                client_id: invoice.client_id,
                company_id: company.id, document_type: "invoice", document_id: invoice.id, notification_kind: "followup", track_replies: true,
                request_id: await stableRequestId(`invoice:${invoice.id}:followup:${newStage}:email`)
              })
            }).then(async res => {
              const result = await res.json();
              if (res.ok && result.success === true) emailsTriggered++;
              else deliveriesSucceeded = false;
            }).catch(() => { deliveriesSucceeded = false; })
          );
        }

        // Queue SMS
        if (client.phone) {
          notifications.push(
            fetch(`${supabaseUrl}/functions/v1/send-sms`, {
              method: "POST",
              headers: fetchHeaders,
              body: JSON.stringify({
                phone_number: client.phone,
                message_body: smsBody,
                client_id: invoice.client_id,
                company_id: company.id, document_type: "invoice", document_id: invoice.id, notification_kind: "followup",
                request_id: await stableRequestId(`invoice:${invoice.id}:followup:${newStage}:sms`)
              })
            }).then(async res => {
              const result = await res.json();
              if (res.ok && result.success === true) smsTriggered++;
              else deliveriesSucceeded = false;
            }).catch(() => { deliveriesSucceeded = false; })
          );
        }

        await Promise.all(notifications);
        if (!deliveriesSucceeded) continue;
        
        // Update the invoice to the new stage and ensure status flips to Overdue if it wasn't already
        const updatePayload: any = { automation_stage: newStage };
        if (diffDays > 0 && !["Partial", "Partially Paid"].includes(invoice.status)) {
          updatePayload.status = "Overdue";
        }
        
        await supabaseAdmin.from("invoices").update(updatePayload).eq("id", invoice.id).eq("company_id", invoice.company_id).eq("status", invoice.status);
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