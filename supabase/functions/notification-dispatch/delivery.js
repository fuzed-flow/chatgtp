export const APP_ORIGIN = 'https://app.fuzedflow.com';
export const MAX_RETRY_AGE_MS = (24 * 60 - 5) * 60 * 1000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export function safeAppUrl(value) {
  try {
    const url = new URL(value || '/', APP_ORIGIN);
    return url.origin === APP_ORIGIN && url.protocol === 'https:' ? url.href : APP_ORIGIN + '/';
  } catch { return APP_ORIGIN + '/'; }
}
export function quietUntil(preferences, now = new Date()) {
  if (!preferences?.quiet_enabled || preferences.quiet_start === preferences.quiet_end) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone || 'America/Edmonton', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const minute = value => { const [hour, minutes] = value.split(':').map(Number); return hour * 60 + minutes; };
  const start = minute(preferences.quiet_start), end = minute(preferences.quiet_end);
  const isQuiet = date => { const current = minute(formatter.format(date)); return start < end ? current >= start && current < end : current >= start || current < end; };
  if (!isQuiet(now)) return null;
  // Minute stepping follows timezone transitions, including daylight-saving gaps/overlaps.
  for (let minutes = 1; minutes <= 26 * 60; minutes++) {
    const next = new Date(now.getTime() + minutes * 60 * 1000);
    if (!isQuiet(next)) return next;
  }
  throw new Error('Invalid quiet-hour configuration');
}
export function buildProviderPayload(job) {
  if (job.channel === 'push') return {
    id: job.id, title: job.payload.title, body: String(job.payload.body || '').slice(0, 800), url: safeAppUrl(job.payload.url),
  };
  if (job.channel === 'sms') return { to: job.recipient, body: `${job.payload.title}\n${job.payload.body || ''}\n${safeAppUrl(job.payload.url)}`.slice(0, 1600) };
  let title = job.payload.title || 'Fuzed Flow update';
  let content;
  if (job.job_kind === 'digest') {
    title = `Your ${job.payload.frequency === 'weekly' ? 'weekly' : 'daily'} Fuzed Flow summary`;
    content = (job.digest_items || job.payload.items || []).map(item => `<div style="border-bottom:1px solid #e2e8f0;padding:16px 0"><p style="font-weight:bold;margin:0">${escapeHtml(item.title)}</p><p>${escapeHtml(item.body).replace(/\n/g, '<br>')}</p><a href="${escapeHtml(safeAppUrl(item.url))}" style="color:#b45309">Open update</a></div>`).join('');
  } else content = `<p>${escapeHtml(job.payload.body).replace(/\n/g, '<br>')}</p><a href="${escapeHtml(safeAppUrl(job.payload.url))}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open in Fuzed Flow</a>`;
  return {
    from: 'Fuzed Flow <alerts@mail.fuzedflow.com>', to: job.recipient,
    subject: title.replace(/[\r\n]/g, ' ').slice(0, 250),
    html: `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:600px;margin:auto;padding:24px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${content}<p style="font-size:12px;color:#64748b;margin-top:24px">${job.job_kind === 'transactional' ? 'Sent for an explicitly requested Fuzed Flow workflow.' : 'Manage your notification preferences in Fuzed Flow.'}</p></div>`,
  };
}
export function retryOutcome(channel, error, attempts, now) {
  const status = error?.status;
  if (channel === 'push' && [404, 410].includes(status)) return { state: 'expired_push', error: 'Push subscription expired' };
  // Twilio documents that a 429 request was not processed and is safe to retry.
  // Network/5xx SMS results can be ambiguous; a second send could duplicate a text.
  if (channel === 'sms' && status !== 429) return { state: [400, 401, 403, 404, 422].includes(status) ? 'failed' : 'unconfirmed', error: 'SMS delivery could not be confirmed' };
  if (attempts >= 8 || (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status))) return { state: 'failed', error: 'Provider rejected delivery' };
  return { state: 'pending', error: 'Provider delivery will retry', availableAt: new Date(now.getTime() + Math.min(6 * 60 * 60, 30 * 2 ** Math.max(0, attempts - 1)) * 1000) };
}
const rpc = async (db, name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error('Notification delivery database operation failed');
  return data;
};
export async function runDeliveryBatch(db, providers, now = new Date()) {
  const jobs = await rpc(db, 'claim_notification_deliveries', { p_limit: 10 });
  const counts = { claimed: jobs.length, sent: 0, deferred: 0, failed: 0, retried: 0 };
  for (const job of jobs) {
    let outcome;
    try {
      const quiet = quietUntil(job.preferences, now);
      if (quiet) { outcome = { state: 'deferred', availableAt: quiet }; counts.deferred++; }
      else if (job.first_attempt_at && now.getTime() - new Date(job.first_attempt_at).getTime() >= MAX_RETRY_AGE_MS) outcome = { state: 'failed', error: 'Retry window expired' };
      else {
        const payload = await rpc(db, 'capture_notification_delivery', { p_id: job.id, p_token: job.lease_token, p_payload: buildProviderPayload(job) });
        // Frozen payload preserves provider idempotency. A changed verified contact never receives an old queued send.
        const capturedRecipient = job.channel === 'email' ? (Array.isArray(payload.to) ? payload.to[0] : payload.to) : job.channel === 'sms' ? payload.to : null;
        if (capturedRecipient && capturedRecipient !== job.recipient) outcome = { state: 'cancelled', error: 'Recipient changed' };
        else {
          const response = await providers[job.channel](payload, job);
          outcome = { state: 'sent', providerId: response?.id || null }; counts.sent++;
        }
      }
    } catch (error) { outcome = retryOutcome(job.channel, error, job.attempts, now); }
    if (outcome.state === 'pending') counts.retried++;
    else if (['failed', 'unconfirmed', 'cancelled', 'expired_push'].includes(outcome.state)) counts.failed++;
    await rpc(db, 'finish_notification_delivery', { p_id: job.id, p_token: job.lease_token, p_state: outcome.state,
      p_error: outcome.error || null, p_provider_id: outcome.providerId || null, p_available_at: (outcome.availableAt || now).toISOString() });
  }
  return counts;
}
