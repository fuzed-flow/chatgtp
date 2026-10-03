import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all quotes with follow-ups enabled, not Draft status
    const quotes = await base44.asServiceRole.entities.Quote.filter({});
    
    const now = new Date();
    const followUpsToSend = [];

    for (const quote of quotes) {
      // Skip if follow-ups disabled, still in Draft, or already approved/declined
      if (!quote.enable_follow_ups || quote.status === 'Draft' || quote.status === 'Approved' || quote.status === 'Declined') {
        continue;
      }

      // Get follow-up history for this quote
      const history = await base44.asServiceRole.entities.QuoteFollowUpHistory.filter({ quote_id: quote.id });
      const sentCount = history.filter(h => h.status === 'sent').length;

      // Check if we've already sent max reminders
      if (sentCount >= (quote.follow_up_max_reminders || 3)) {
        continue;
      }

      // Determine if we should send a follow-up
      let shouldSend = false;
      let daysSinceSent = null;

      if (quote.created_date) {
        const createdDate = new Date(quote.created_date);
        daysSinceSent = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

        if (sentCount === 0) {
          // First follow-up: check days since quote was sent
          if (daysSinceSent >= (quote.follow_up_days || 7)) {
            shouldSend = true;
          }
        } else if (quote.last_follow_up_sent) {
          // Subsequent follow-ups: check interval since last follow-up
          const lastFollowUpDate = new Date(quote.last_follow_up_sent);
          const daysSinceLastFollowUp = Math.floor((now - lastFollowUpDate) / (1000 * 60 * 60 * 24));
          if (daysSinceLastFollowUp >= (quote.follow_up_interval_days || 3)) {
            shouldSend = true;
          }
        }
      }

      if (shouldSend) {
        followUpsToSend.push({
          quote,
          history,
          sentCount: sentCount + 1
        });
      }
    }

    // Get client data and send follow-ups
    const clients = await base44.asServiceRole.entities.Client.list();
    const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

    for (const { quote, history, sentCount } of followUpsToSend) {
      const client = clientMap[quote.client_id];
      if (!client || !client.email) continue;

      // Build email
      const subject = quote.follow_up_template?.split('\n')[0] || `Reminder: ${quote.title} Quote`;
      const body = quote.follow_up_template || 
        `Hi ${client.name},\n\nJust following up on the ${quote.title} quote we sent on ${quote.issue_date}.\n\nWould you like to discuss this further?\n\nBest regards`;

      try {
        // Send via Gmail
        const accessToken = await base44.asServiceRole.connectors.getAccessToken('gmail');
        
        const emailContent = `To: ${client.email}\nSubject: ${subject}\nFrom: noreply@pro-trades.ca\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\n\n${body}`;
        
        const encoder = new TextEncoder();
        const messageBytes = encoder.encode(emailContent);
        const base64Message = btoa(String.fromCharCode(...messageBytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');

        const result = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ raw: base64Message })
        });

        const status = result.ok ? 'sent' : 'failed';

        // Log follow-up history
        await base44.asServiceRole.entities.QuoteFollowUpHistory.create({
          quote_id: quote.id,
          follow_up_number: sentCount,
          sent_at: new Date().toISOString(),
          email_sent_to: client.email,
          subject: subject,
          body: body,
          status: status
        });

        // Update quote's last_follow_up_sent
        await base44.asServiceRole.entities.Quote.update(quote.id, {
          last_follow_up_sent: new Date().toISOString()
        });

        console.log(`Follow-up #${sentCount} sent for quote ${quote.id}`);
      } catch (error) {
        console.error(`Error sending follow-up for quote ${quote.id}:`, error);
        
        // Log failed attempt
        await base44.asServiceRole.entities.QuoteFollowUpHistory.create({
          quote_id: quote.id,
          follow_up_number: sentCount,
          sent_at: new Date().toISOString(),
          email_sent_to: client.email,
          subject: subject,
          body: body,
          status: 'failed',
          notes: error.message
        });
      }
    }

    return Response.json({
      success: true,
      followUpsSent: followUpsToSend.length
    });
  } catch (error) {
    console.error('Error processing quote follow-ups:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});