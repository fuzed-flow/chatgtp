import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { client_id, subject, message, to_email } = await req.json();

    if (!client_id || !subject || !message || !to_email) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Send email using Core integration
    // Reply-to is set to the user's email so all replies go to them
    await base44.integrations.Core.SendEmail({
      from_name: user.full_name || 'Pro-Trades',
      to: to_email,
      subject: subject,
      body: `${message}\n\n---\nPlease reply directly to this email to reach ${user.full_name} at ${user.email}`
    });

    // Log the communication
    await base44.entities.ClientCommunication.create({
      client_id,
      type: 'Email',
      subject,
      message,
      direction: 'Outbound',
      status: 'Sent',
      sent_to: to_email,
      sent_by: user.full_name
    });

    return Response.json({ 
      success: true, 
      message: 'Email sent successfully',
      reply_to: user.email 
    });

  } catch (error) {
    console.error('Error sending email:', error);
    
    // Log failed communication if we have the data
    try {
      const base44 = createClientFromRequest(req);
      const body = await req.json();
      if (body.client_id) {
        await base44.entities.ClientCommunication.create({
          client_id: body.client_id,
          type: 'Email',
          subject: body.subject || 'Email',
          message: body.message || '',
          direction: 'Outbound',
          status: 'Failed',
          sent_to: body.to_email || '',
          sent_by: (await base44.auth.me())?.full_name || 'Unknown'
        });
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return Response.json({ 
      error: 'Failed to send email', 
      details: error.message 
    }, { status: 500 });
  }
});