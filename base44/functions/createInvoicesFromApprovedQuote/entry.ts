import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const stripe = await import('npm:stripe@16.12.0').then(m => m.default);
const stripeInstance = new stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Support both direct call (with quote) and automation event payload
    const event = body.event;
    let quote, oldQuote;

    if (event) {
      // Called from entity automation
      if (event.type !== 'update') {
        return Response.json({ success: false, message: 'Not an update event' });
      }
      quote = body.data;
      oldQuote = body.old_data;
    } else {
      // Called directly with quote_id
      const { quote_id } = body;
      if (!quote_id) return Response.json({ success: false, message: 'quote_id required' }, { status: 400 });
      const quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
      if (!quotes.length) return Response.json({ success: false, message: 'Quote not found' }, { status: 404 });
      quote = quotes[0];
      oldQuote = { status: 'Sent' }; // treat as newly approved
    }

    // Only process if status was just changed to Approved
    if (quote.status !== 'Approved' || oldQuote?.status === 'Approved') {
      return Response.json({ success: false, message: 'Quote not newly approved' });
    }

    // Get organization, quote items, payment schedule, and client
    const [orgs, quoteItems, paymentScheduleItems, clients] = await Promise.all([
      base44.asServiceRole.entities.Organization.list(),
      base44.asServiceRole.entities.QuoteLineItem.filter({ quote_id: quote.id }),
      base44.asServiceRole.entities.QuotePaymentScheduleItem.filter({ quote_id: quote.id }, 'sort_order'),
      quote.client_id ? base44.asServiceRole.entities.Client.filter({ id: quote.client_id }) : Promise.resolve([]),
    ]);

    const org = orgs[0];
    if (!org) throw new Error('Organization not found');
    const client = clients[0] || null;

    // ── Create master invoice in our DB ──────────────────────────────────────
    const masterInvoiceNumber = `${org.invoice_number_prefix}${org.next_invoice_number}`;
    const masterInvoice = await base44.asServiceRole.entities.Invoice.create({
      invoice_number: masterInvoiceNumber,
      client_id: quote.client_id,
      quote_id: quote.id,
      status: 'Draft',
      issue_date: new Date().toISOString().split('T')[0],
      due_date: quote.expiry_date || new Date().toISOString().split('T')[0],
      subtotal: quote.subtotal,
      tax: quote.tax,
      total: quote.total,
      amount_paid: 0,
      balance_due: quote.total,
      deposit_amount: quote.deposit_amount || 0,
      has_payment_schedule: paymentScheduleItems.length > 0,
      notes: `Master invoice for Quote ${quote.quote_number}`,
    });

    let nextInvoiceNum = org.next_invoice_number + 1;

    // Copy line items to master invoice
    for (const item of quoteItems) {
      await base44.asServiceRole.entities.InvoiceLineItem.create({
        invoice_id: masterInvoice.id,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        taxable: item.taxable,
        line_total: item.line_total,
      });
    }

    // Copy payment schedule items to master invoice
    if (paymentScheduleItems.length > 0) {
      for (let i = 0; i < paymentScheduleItems.length; i++) {
        const schedItem = paymentScheduleItems[i];
        const paymentAmount = schedItem.amount_type === 'percentage'
          ? (quote.total * (schedItem.percentage || 0) / 100)
          : (schedItem.amount || 0);

        await base44.asServiceRole.entities.InvoicePaymentScheduleItem.create({
          invoice_id: masterInvoice.id,
          payment_name: schedItem.payment_name,
          amount: paymentAmount,
          amount_type: schedItem.amount_type || 'fixed',
          percentage: schedItem.percentage || 0,
          due_date: schedItem.due_event || quote.expiry_date || new Date().toISOString().split('T')[0],
          due_event: schedItem.due_event || '',
          status: 'Pending',
          amount_paid: 0,
          sort_order: i,
        });
      }
    }

    // ── Create Stripe invoice ────────────────────────────────────────────────
    let stripeInvoiceId = null;
    let stripeInvoiceUrl = null;

    try {
      // Find or create Stripe customer
      let customerId = null;
      if (client?.email) {
        const existingCustomers = await stripeInstance.customers.list({ email: client.email, limit: 1 });
        if (existingCustomers.data.length > 0) {
          customerId = existingCustomers.data[0].id;
        } else {
          const newCustomer = await stripeInstance.customers.create({
            email: client.email,
            name: client.name || undefined,
            metadata: { base44_client_id: quote.client_id, base44_app_id: Deno.env.get('BASE44_APP_ID') },
          });
          customerId = newCustomer.id;
        }
      }

      // Build line items for Stripe invoice
      const stripeLineItems = quoteItems.map(item => ({
        price_data: {
          currency: 'cad',
          product_data: {
            name: item.name,
            description: item.description || undefined,
          },
          unit_amount: Math.round((item.unit_price || 0) * 100),
        },
        quantity: item.quantity || 1,
      }));

      // If payment schedule exists, create separate Stripe invoices per milestone
      if (quote.has_payment_schedule && paymentScheduleItems.length > 0) {
        // Create a Stripe invoice per payment schedule item
        for (let i = 0; i < paymentScheduleItems.length; i++) {
          const schedItem = paymentScheduleItems[i];
          const paymentAmount = schedItem.amount_type === 'percentage'
            ? (quote.total * (schedItem.percentage || 0) / 100)
            : (schedItem.amount || 0);

          if (paymentAmount <= 0) continue;

          const stripeInv = await stripeInstance.invoices.create({
            customer: customerId || undefined,
            ...(customerId ? {} : { customer_email: client?.email }),
            collection_method: 'send_invoice',
            days_until_due: 30,
            description: `${schedItem.payment_name} – Quote #${quote.quote_number}: ${quote.title}`,
            metadata: {
              base44_app_id: Deno.env.get('BASE44_APP_ID'),
              base44_quote_id: quote.id,
              base44_invoice_id: masterInvoice.id,
              payment_schedule_item: schedItem.payment_name,
            },
          });

          // Add a single line item representing the milestone amount
          await stripeInstance.invoiceItems.create({
            customer: customerId || undefined,
            ...(customerId ? {} : {}),
            invoice: stripeInv.id,
            description: `${schedItem.payment_name} – ${schedItem.due_event || 'Due on event'}`,
            amount: Math.round(paymentAmount * 100),
            currency: 'cad',
          });

          await stripeInstance.invoices.finalizeInvoice(stripeInv.id);
          console.log(`Created Stripe invoice for schedule item "${schedItem.payment_name}": ${stripeInv.id}`);

          // Store Stripe invoice ID on the payment invoice
          const paymentInvoiceNumber = `${org.invoice_number_prefix}${nextInvoiceNum}`;
          const paymentInvoice = await base44.asServiceRole.entities.Invoice.create({
            invoice_number: paymentInvoiceNumber,
            client_id: quote.client_id,
            quote_id: quote.id,
            status: 'Draft',
            issue_date: new Date().toISOString().split('T')[0],
            due_date: schedItem.due_event || quote.expiry_date || new Date().toISOString().split('T')[0],
            subtotal: paymentAmount,
            tax: 0,
            total: paymentAmount,
            amount_paid: 0,
            balance_due: paymentAmount,
            has_payment_schedule: false,
            notes: `Payment: ${schedItem.payment_name} | Stripe: ${stripeInv.id}`,
          });

          nextInvoiceNum++;
        }
      } else if (quote.total > 0) {
        // Single Stripe invoice for the full amount
        const stripeInv = await stripeInstance.invoices.create({
          customer: customerId || undefined,
          collection_method: 'send_invoice',
          days_until_due: 30,
          description: `Quote #${quote.quote_number}: ${quote.title}`,
          metadata: {
            base44_app_id: Deno.env.get('BASE44_APP_ID'),
            base44_quote_id: quote.id,
            base44_invoice_id: masterInvoice.id,
          },
        });

        // Add line items
        for (const item of quoteItems) {
          if ((item.unit_price || 0) > 0) {
            await stripeInstance.invoiceItems.create({
              customer: customerId,
              invoice: stripeInv.id,
              description: item.name + (item.description ? ` – ${item.description}` : ''),
              amount: Math.round((item.unit_price || 0) * (item.quantity || 1) * 100),
              currency: 'cad',
            });
          }
        }

        const finalizedInvoice = await stripeInstance.invoices.finalizeInvoice(stripeInv.id);
        stripeInvoiceId = finalizedInvoice.id;
        stripeInvoiceUrl = finalizedInvoice.hosted_invoice_url;
        console.log(`Created Stripe invoice: ${stripeInvoiceId}`);
      }
    } catch (stripeError) {
      console.error('Stripe invoice creation error (non-fatal):', stripeError.message);
      // Continue – Stripe failure should not block our internal invoices
    }

    // Update organization's next invoice number
    await base44.asServiceRole.entities.Organization.update(org.id, {
      next_invoice_number: nextInvoiceNum,
    });

    return Response.json({
      success: true,
      message: `Created master invoice and ${paymentScheduleItems.length} payment invoices`,
      masterInvoiceId: masterInvoice.id,
      stripeInvoiceId,
      stripeInvoiceUrl,
    });
  } catch (error) {
    console.error('Error creating invoices:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});