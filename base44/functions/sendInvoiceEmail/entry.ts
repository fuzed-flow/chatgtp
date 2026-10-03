import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { invoice_id, client_email, client_name, custom_message } = body;

    if (!invoice_id || !client_email) {
      return Response.json({ error: 'invoice_id and client_email are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    
    // Fetch the invoice
    const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoice_id });
    if (!invoices || invoices.length === 0) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }
    const invoice = invoices[0];

    // Fetch organization for company info
    const orgs = await base44.asServiceRole.entities.Organization.list();
    const org = orgs[0];

    // Generate viewing link
    const appDomain = Deno.env.get('APP_DOMAIN') || 'https://app.base44.com';
    const viewInvoiceLink = `${appDomain}/InvoiceView?id=${invoice_id}`;

    // Get organization name for email
    const companyName = org?.name || 'Pro-Trades';

    // Compose email subject
    const subject = `Invoice ${invoice.invoice_number} from ${companyName}`;

    // Compose email body as HTML
    let htmlBody = '';
    
    if (client_name) {
      htmlBody += `<p>Hi ${client_name},</p>`;
    } else {
      htmlBody += `<p>Hello,</p>`;
    }

    htmlBody += `<p>Please find attached your invoice.</p>`;

    if (custom_message) {
      htmlBody += `<p>${custom_message}</p>`;
    }

    // Add invoice summary
    htmlBody += `<hr><h3>INVOICE SUMMARY</h3>`;
    htmlBody += `<p>`;
    htmlBody += `<strong>Invoice #:</strong> ${invoice.invoice_number}<br>`;
    htmlBody += `<strong>Total:</strong> $${(invoice.total || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Balance Due:</strong> $${(invoice.balance_due || 0).toFixed(2)}<br>`;
    
    if (invoice.due_date) {
      htmlBody += `<strong>Due:</strong> ${invoice.due_date}<br>`;
    }

    htmlBody += `</p>`;

    htmlBody += `<hr><h3>VIEW INVOICE</h3>`;
    htmlBody += `<p>To view the complete invoice details, click the link below:</p>`;
    htmlBody += `<p><a href="${viewInvoiceLink}">View Your Invoice</a></p>`;

    htmlBody += `<p>If you have any questions, please don't hesitate to reach out.</p>`;
    htmlBody += `<p>Thank you!</p>`;

    htmlBody += `<hr><p>`;
    if (org?.name) {
      htmlBody += `${org.name}`;
    }
    if (org?.city) {
      htmlBody += ` - ${org.city}`;
    }
    htmlBody += `</p>`;

    // Get Gmail access token
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('gmail');

    // Create proper RFC 2822 email message
    const emailMessage = [
      `To: ${client_email}`,
      `Subject: ${subject}`,
      `From: noreply@pro-trades.com`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      htmlBody
    ].join('\r\n');

    // Base64 encode for Gmail API
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(emailMessage);
    const base64Message = btoa(String.fromCharCode(...messageBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Send email via Gmail API
    const result = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: base64Message
      })
    });

    if (!result.ok) {
      const errorData = await result.json();
      console.error('Gmail API error:', errorData);
      throw new Error(`Failed to send email: ${errorData.error?.message || result.statusText}`);
    }

    const gmailResponse = await result.json();

    const sentAt = new Date().toISOString();
    
    // Update invoice status to Sent
    await base44.asServiceRole.entities.Invoice.update(invoice_id, { status: 'Sent' });

    return Response.json({
      success: true,
      sent_at: sentAt,
      invoice_id: invoice_id,
      message_id: gmailResponse.id || ''
    });

  } catch (error) {
    console.error('Error sending invoice email:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});