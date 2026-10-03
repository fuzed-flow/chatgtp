import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { quote_id, client_email, client_name, custom_message } = body;

    if (!quote_id || !client_email) {
      return Response.json({ error: 'quote_id and client_email are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Get the sending user
    const user = await base44.auth.me();
    
    // Fetch the quote
    const quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
    if (!quotes || quotes.length === 0) {
      return Response.json({ error: 'Quote not found' }, { status: 404 });
    }
    const quote = quotes[0];

    // Fetch organization for company info
    const orgs = await base44.asServiceRole.entities.Organization.list();
    const org = orgs[0];

    // Generate viewing link - use public page that doesn't require authentication
    const appDomain = Deno.env.get('APP_DOMAIN') || 'https://app.base44.com';
    const viewQuoteLink = `${appDomain}/PublicQuoteView?id=${quote_id}`;

    // Get organization name for email
    const companyName = org?.name || 'Pro-Trades';

    // Compose email subject
    const subject = `Your Quote from ${companyName}`;

    // Compose email body as HTML
    let htmlBody = '';
    
    if (client_name) {
      htmlBody += `<p>Hi ${client_name},</p>`;
    } else {
      htmlBody += `<p>Hello,</p>`;
    }

    htmlBody += `<p>We're excited to share the quote for your project.</p>`;

    if (custom_message) {
      htmlBody += `<p>${custom_message}</p>`;
    }

    // Add quote summary
    htmlBody += `<hr><h3>QUOTE SUMMARY</h3>`;
    htmlBody += `<p>`;
    htmlBody += `<strong>Quote #:</strong> ${quote.quote_number}<br>`;
    htmlBody += `<strong>Project:</strong> ${quote.title}<br>`;
    htmlBody += `<strong>Subtotal:</strong> $${(quote.subtotal || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Tax:</strong> $${(quote.tax || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Total:</strong> $${(quote.total || 0).toFixed(2)}<br>`;
    
    if (quote.expiry_date) {
      htmlBody += `<strong>Valid until:</strong> ${quote.expiry_date}<br>`;
    }

    htmlBody += `</p>`;

    htmlBody += `<hr><h3>VIEW QUOTE</h3>`;
    htmlBody += `<p>To view the complete quote with all details, photos, and payment information, click the link below:</p>`;
    htmlBody += `<p><a href="${viewQuoteLink}">View Your Quote</a></p>`;

    htmlBody += `<p>If you have any questions or would like to discuss the quote further, please don't hesitate to reach out.</p>`;
    htmlBody += `<p>Thank you for considering us!</p>`;

    htmlBody += `<br><p>Best Regards,<br>`;
    htmlBody += `<strong>${user?.full_name || ''}</strong><br>`;
    htmlBody += `${org?.name || ''}<br>`;
    if (org?.phone) htmlBody += `${org.phone}<br>`;
    if (org?.website) htmlBody += `<a href="${org.website}">${org.website}</a><br>`;
    htmlBody += `</p>`;

    // Get Gmail access token
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');

    // Get the sender's Gmail address
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const profile = await profileRes.json();
    const senderEmail = profile.emailAddress;

    // Create proper RFC 2822 email message
    const emailMessage = [
      `To: ${client_email}`,
      `Subject: ${subject}`,
      `From: ${user?.full_name ? `${user.full_name} <${senderEmail}>` : senderEmail}`,
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
    
    // Log the sent quote
    const sentQuote = await base44.asServiceRole.entities.SentQuote.create({
      quote_id: quote_id.trim(),
      client_email: client_email.trim(),
      client_name: client_name ? client_name.trim() : '',
      sent_at: sentAt,
      status: 'sent',
      message_id: gmailResponse.id || '',
      custom_message: custom_message || ''
    });

    // Update quote status to Sent
    await base44.asServiceRole.entities.Quote.update(quote_id, { status: 'Sent' });

    return Response.json({
      success: true,
      sent_at: sentAt,
      quote_id: quote_id,
      sent_quote_id: sentQuote.id
    });

  } catch (error) {
    console.error('Error sending quote email:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});