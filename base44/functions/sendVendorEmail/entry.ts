import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { po_id, vendor_email, vendor_name, custom_message } = body;

    if (!po_id || !vendor_email) {
      return Response.json({ error: 'po_id and vendor_email are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    
    // Fetch the purchase order
    const pos = await base44.asServiceRole.entities.PurchaseOrder.filter({ id: po_id });
    if (!pos || pos.length === 0) {
      return Response.json({ error: 'Purchase order not found' }, { status: 404 });
    }
    const po = pos[0];

    // Fetch organization for company info
    const orgs = await base44.asServiceRole.entities.Organization.list();
    const org = orgs[0];

    // Generate viewing link
    const appDomain = Deno.env.get('APP_DOMAIN') || 'https://app.base44.com';
    const viewPOLink = `${appDomain}/PurchaseOrderView?id=${po_id}`;

    // Get organization name for email
    const companyName = org?.name || 'Pro-Trades';

    // Compose email subject
    const subject = `Purchase Order ${po.po_number} from ${companyName}`;

    // Compose email body as HTML
    let htmlBody = '';
    
    if (vendor_name) {
      htmlBody += `<p>Hi ${vendor_name},</p>`;
    } else {
      htmlBody += `<p>Hello,</p>`;
    }

    htmlBody += `<p>Please find attached purchase order for your review.</p>`;

    if (custom_message) {
      htmlBody += `<p>${custom_message}</p>`;
    }

    // Add PO summary
    htmlBody += `<hr><h3>PURCHASE ORDER SUMMARY</h3>`;
    htmlBody += `<p>`;
    htmlBody += `<strong>PO #:</strong> ${po.po_number}<br>`;
    if (po.purpose) {
      htmlBody += `<strong>Purpose:</strong> ${po.purpose}<br>`;
    }
    htmlBody += `<strong>Subtotal:</strong> $${(po.subtotal || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Tax:</strong> $${(po.tax || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Total:</strong> $${(po.total || 0).toFixed(2)}<br>`;
    
    if (po.expected_delivery_date) {
      htmlBody += `<strong>Expected Delivery:</strong> ${po.expected_delivery_date}<br>`;
    }

    htmlBody += `</p>`;

    htmlBody += `<hr><h3>VIEW PURCHASE ORDER</h3>`;
    htmlBody += `<p>To view the complete purchase order with all details, click the link below:</p>`;
    htmlBody += `<p><a href="${viewPOLink}">View Purchase Order</a></p>`;

    htmlBody += `<p>If you have any questions, please don't hesitate to contact us.</p>`;
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
      `To: ${vendor_email}`,
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

    return Response.json({
      success: true,
      sent_at: new Date().toISOString(),
      po_id: po_id,
      message_id: gmailResponse.id
    });

  } catch (error) {
    console.error('Error sending vendor email:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});