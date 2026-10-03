import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { quote_id, quote_number, client_name, created_by } = body;

    if (!quote_id || !created_by) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get user email
    const users = await base44.asServiceRole.entities.User.filter({ id: created_by });
    const user = users[0];

    if (!user || !user.email) {
      console.error('User not found or no email:', created_by);
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Get organization info
    const orgs = await base44.asServiceRole.entities.Organization.list();
    const organization = orgs[0];

    const appDomain = Deno.env.get("APP_DOMAIN");
    const quoteUrl = `${appDomain}/QuoteView?id=${quote_id}`;

    // Get Gmail access token
    const accessToken = await base44.asServiceRole.connectors.getAccessToken("gmail");

    // Compose email
    const emailContent = [
      `From: ${organization?.name || 'Pro-Trades'} <${user.email}>`,
      `To: ${user.email}`,
      `Subject: Quote ${quote_number} Accepted by Client`,
      `Content-Type: text/html; charset=utf-8`,
      '',
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
      `  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center;">`,
      `    <h1 style="color: white; margin: 0;">✓ Quote Accepted</h1>`,
      `  </div>`,
      `  <div style="padding: 30px; background: #f8fafc;">`,
      `    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">`,
      `      <p style="font-size: 16px; color: #334155; margin-bottom: 20px;">`,
      `        Great news! <strong>${client_name}</strong> has accepted <strong>Quote ${quote_number}</strong>`,
      `      </p>`,
      `      <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px;">`,
      `        <p style="color: #065f46; font-weight: 600; margin: 0;">The client has approved the quote and is ready to proceed.</p>`,
      `      </div>`,
      `      <a href="${quoteUrl}" style="display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px;">`,
      `        View Quote`,
      `      </a>`,
      `    </div>`,
      `  </div>`,
      `  <div style="padding: 20px; text-align: center; color: #64748b; font-size: 12px;">`,
      `    <p>${organization?.name || 'Pro-Trades'} • ${organization?.city || 'Calgary'}</p>`,
      `  </div>`,
      `</div>`
    ].join('\n');

    const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedEmail })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Gmail API error:', errorData);
      return Response.json({ error: 'Failed to send email', details: errorData }, { status: 500 });
    }

    const result = await response.json();
    return Response.json({ 
      success: true,
      message_id: result.id
    });

  } catch (error) {
    console.error('Error in sendQuoteAcceptedNotification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});