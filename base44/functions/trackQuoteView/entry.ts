import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { quote_id, viewer_type } = body;

    if (!quote_id || !viewer_type) {
      return Response.json({ error: 'quote_id and viewer_type are required' }, { status: 400 });
    }

    // Extract IP address from request headers
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('cf-connecting-ip') ||
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Extract user agent from request headers
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Get current timestamp
    const viewedAt = new Date().toISOString();

    // Create client — use service role for all DB ops since caller may be unauthenticated
    const base44 = createClientFromRequest(req);
    const viewRecord = await base44.asServiceRole.entities.QuoteView.create({
      quote_id: quote_id.trim(),
      viewed_at: viewedAt,
      viewer_type: viewer_type.trim(),
      ip_address: ipAddress.trim(),
      user_agent: userAgent,
    });

    // Send email notification immediately if client viewed
    if (viewer_type === 'client') {
      try {
        const quote = await base44.asServiceRole.entities.Quote.get(quote_id.trim());
        const client = await base44.asServiceRole.entities.Client.get(quote.client_id);
        const user = await base44.asServiceRole.entities.User.list();
        const adminUser = user.find(u => u.role === 'admin');
        
        if (adminUser?.email) {
          const viewTimestamp = new Date(viewedAt).toLocaleString('en-US', { 
            timeZone: 'America/Edmonton',
            dateStyle: 'medium',
            timeStyle: 'short'
          });

          // Also create an in-app notification
          await base44.asServiceRole.entities.Notification.create({
            user_id: adminUser.id,
            type: "QuoteOpened",
            title: `Quote Opened – ${client.name}`,
            body: `${client.name} opened quote ${quote.quote_number} at ${viewTimestamp}`,
            related_type: "Quote",
            related_id: quote_id.trim(),
            is_read: false
          });

          await base44.asServiceRole.integrations.Core.SendEmail({
            to: adminUser.email,
            subject: `🔔 ${client.name} opened Quote ${quote.quote_number}`,
            body: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #0f172a;">Quote Opened</h2>
                <p>Your client has just viewed their quote:</p>
                
                <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p><strong>Quote:</strong> ${quote.quote_number} - ${quote.title}</p>
                  <p><strong>Client:</strong> ${client.name}</p>
                  <p><strong>Time:</strong> ${viewTimestamp}</p>
                  <p><strong>Location:</strong> ${ipAddress}</p>
                </div>
                
                <p style="color: #64748b; font-size: 14px;">This is an automated notification from your Quote Builder app.</p>
              </div>
            `
          });
        }
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        // Don't fail the entire request if email fails
      }
    }

    return Response.json({ 
      success: true, 
      view_id: viewRecord.id,
      viewed_at: viewedAt 
    });
  } catch (error) {
    console.error('Error tracking quote view:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});