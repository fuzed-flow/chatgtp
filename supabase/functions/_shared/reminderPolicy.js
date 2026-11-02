// Scheduled client reminders use the company's local business hours. Unknown
// timezones fail closed instead of falling back to the server's UTC clock.
export function reminderLocalTime(company, now = new Date()) {
  const timezone = company?.timezone || 'America/Edmonton';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return {
      allowed: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday)
        && Number(parts.hour) >= 9 && Number(parts.hour) < 17,
      date: `${parts.year}-${parts.month}-${parts.day}`,
      timezone,
    };
  } catch {
    return { allowed: false, date: null, timezone };
  }
}

export async function reminderPolicy(db, companyId, related, documentId, stage, smsRequest) {
  const { data, error } = await db.rpc('document_reminder_policy', {
    p_company: companyId, p_related: related, p_id: documentId,
    p_stage: stage, p_sms_request: smsRequest,
  });
  if (error || !data) throw new Error('Document delivery history is unavailable.');
  return {
    email: data.email === true, sms: data.sms === true,
    email_sent: data.email_sent === true, sms_sent: data.sms_sent === true,
    cycle: data.cycle || '',
  };
}

export async function recordReminderDelivery(db, companyId, related, documentId, stage, channel) {
  const { error } = await db.rpc('record_document_reminder_delivery', {
    p_company: companyId, p_related: related, p_id: documentId, p_stage: stage, p_channel: channel,
  });
  if (error) throw new Error('Reminder acceptance could not be recorded.');
}

// A cron-authenticated preview validates the actual email preflight but never
// calls an SMS provider, sends an email, issues a share token or advances stages.
export async function previewReminder(supabaseUrl, headers, company, documentType, documentId, recipient, policy, localTime) {
  let emailPreflight = null;
  if (policy.email && recipient.email && !policy.email_sent) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST', headers,
        body: JSON.stringify({
          company_id: company.id, document_type: documentType, document_id: documentId,
          notification_kind: 'followup', track_replies: true, dry_run: true,
          to_email: recipient.email, subject: 'Reminder configuration check',
          html_body: '<p>Reminder configuration check.</p>',
        }),
      });
      const result = await response.json();
      emailPreflight = { success: response.ok && result?.success === true && result?.dry_run === true,
        error: result?.error || null };
    } catch {
      emailPreflight = { success: false, error: 'Email preflight unavailable.' };
    }
  }
  return { document_id: documentId, ...policy, send_now: localTime.allowed, timezone: localTime.timezone, email_preflight: emailPreflight };
}

