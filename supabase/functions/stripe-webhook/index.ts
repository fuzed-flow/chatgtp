import { getPlanIdFromPrice } from "../_shared/subscriptionPlans.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "npm:stripe@^14.0.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") as string, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature || !webhookSecret) {
    return new Response("Missing signature or secret", { status: 400 });
  }

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // =========================================================================
    // EVENT: CHECKOUT COMPLETED (Handles BOTH SaaS Subs & Client Invoices)
    // =========================================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // -----------------------------------------------------------------------
      // FLOW 2: SUBSCRIPTION UPDATES (Customer Portal Upgrades/Downgrades/Cancels)
      // -----------------------------------------------------------------------
      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        
        // Grab the metadata directly from the subscription object (as discussed earlier!)
        const companyId = subscription.metadata?.company_id;
        const planId = subscription.metadata?.plan_id || "starter";
        
        if (companyId) {
          const status = subscription.status === "active" || subscription.status === "trialing" ? "Active" : "Inactive";
          
          const baseLimits = { starter: 1, professional: 3, business: 10 };
          const maxUsers = baseLimits[planId] || 1;

          const { error } = await supabase
            .from("companies")
            .update({
              plan_id: planId,
              subscription_status: status,
              max_users: maxUsers
            })
            .eq("id", companyId);

          if (error) {
            console.error(`Database error updating company ${companyId}:`, error);
            return new Response(JSON.stringify({ error: "Database update failed" }), { status: 500 });
          }
          console.log(`Updated company ${companyId} via portal to ${planId} (${status})`);
        } else {
           console.error("Webhook failed: No company_id found in Subscription metadata.");
        }
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }

      // -----------------------------------------------------------------------
      // FLOW 2: CLIENT INVOICE & QUOTE PAYMENTS (Contractor Client Paying)
      // -----------------------------------------------------------------------
      if (session.mode === "payment") {
        const quoteId = session.metadata?.quote_id;
        const invoiceId = session.metadata?.invoice_id; 
        const invoiceNumber = session.metadata?.invoice_number; 
        const companyId = session.metadata?.company_id;
        const amountPaid = (session.amount_total || 0) / 100; 

        if (!companyId || (!quoteId && !invoiceId)) {
          console.warn("Ignoring session: Missing required invoice/quote metadata");
          return new Response("Missing metadata", { status: 200 }); 
        }

        let actionUrl = "";

        // 3a. Update Quote Status
        if (quoteId) {
          const { error: updateError } = await supabase
            .from("quotes")
            .update({ status: "Paid" }) 
            .eq("id", quoteId);

          if (updateError) throw updateError;
          actionUrl = `/QuoteBuilder?id=${quoteId}`;
        }

        // 3b. Update Invoice, Log Payment & Send Email
        if (invoiceId) {
          const { error: paymentError } = await supabase
            .from("payments")
            .insert({
              invoice_id: invoiceId,
              amount: amountPaid,
              payment_method: "Stripe",
              notes: `Stripe Checkout Session: ${session.id}`,
              payment_date: new Date(session.created * 1000).toISOString() 
            });
            
          if (paymentError) throw paymentError;

          const { data: currentInvoice, error: fetchError } = await supabase
            .from("invoices")
            .select("balance_due, amount_paid, client_id")
            .eq("id", invoiceId)
            .single();

          if (fetchError) throw fetchError;

          const newAmountPaid = (currentInvoice.amount_paid || 0) + amountPaid;
          const newBalance = Math.max(0, (currentInvoice.balance_due || 0) - amountPaid);
          const newStatus = newBalance <= 0 ? "Paid" : "Partially Paid";

          const { error: updateError } = await supabase
            .from("invoices")
            .update({ 
              amount_paid: newAmountPaid, 
              balance_due: newBalance,
              status: newStatus
            })
            .eq("id", invoiceId);

          if (updateError) throw updateError;
          
          actionUrl = `/PublicInvoiceView?id=${invoiceId}`;

          // Send Email Notification via Resend
          const { data: companyData } = await supabase
            .from("companies")
            .select("settings, name") 
            .eq("id", companyId)
            .single();

          const resendApiKey = Deno.env.get("RESEND_API_KEY");
          const companyEmail = companyData?.settings?.email; 
          const companyName = companyData?.name || "there"; 
          
          if (resendApiKey && companyEmail) {
            let clientName = "A client";
            if (currentInvoice.client_id) {
              const { data: clientData } = await supabase
                .from("clients")
                .select("name")
                .eq("id", currentInvoice.client_id)
                .single();
              if (clientData?.name) clientName = clientData.name;
            }

            const invRef = invoiceNumber || invoiceId;
            
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${resendApiKey}`
              },
              body: JSON.stringify({
                from: "alerts@mail.fuzedflow.com",
                to: companyEmail,
                subject: `Payment Received: ${clientName} paid $${amountPaid.toFixed(2)}`,
                html: `
                  <p>Hi ${companyName},</p>
                  <p>Great news!</p>
                  <p><strong>${clientName}</strong> just made a payment of <strong>$${amountPaid.toFixed(2)}</strong> towards Invoice #${invRef}.</p>
                  <p>Your database balances have been successfully updated.</p>
                `
              })
            });
          }

          // Real-time Notification
          await supabase.functions.invoke('company-notifier', {
            body: {
              company_id: companyId,
              title: "Payment Received! 💰",
              body: `A payment of $${amountPaid.toFixed(2)} was successfully processed.`,
              type: "System",
              action_url: actionUrl 
            }
          });
        }
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
    }

    // =========================================================================
    // FLOW 3: SAAS APP CANCELLATION (Downgrade to Free/Read-Only)
    // =========================================================================
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const { error } = await supabase
        .from("companies")
        .update({
          plan_id: "free",
          subscription_status: "Canceled"
        })
        .eq("stripe_customer_id", customerId);

      if (error) console.error("Failed to update canceled subscription:", error);
      else console.log(`Successfully downgraded customer ${customerId} to free.`);
      
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // =========================================================================
    // FLOW 4: SAAS APP UPGRADE / DOWNGRADE (Via Customer Portal)
    // =========================================================================
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const status = subscription.status;

      const priceId = subscription.items.data[0].price.id;
      const quantity = subscription.items.data[0].quantity || 1; 

      const newPlanId = getPlanIdFromPrice(priceId);

      const baseLimits: Record<string, number> = { starter: 1, professional: 3, business: 10 };
      const newMaxUsers = Math.max(quantity, baseLimits[newPlanId] || 1);

      const { error } = await supabase
        .from("companies")
        .update({
          plan_id: newPlanId,
          subscription_status: status === "active" || status === "trialing" ? "Active" : "Past Due",
          max_users: newMaxUsers 
        })
        .eq("stripe_customer_id", customerId);

      if (error) console.error(`Failed to update plan for customer ${customerId}:`, error);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 👇 VITAL: Catch-all to acknowledge any unhandled event types (e.g. invoice.paid)
    return new Response(JSON.stringify({ received: true, ignored: true }), { status: 200 });

  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
});