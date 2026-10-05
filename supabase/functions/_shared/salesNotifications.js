export const salesUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const definitions = {
  quote: { table: 'quotes', related: 'Quote', number: 'quote_number', prefix: 'quote' },
  change_order: { table: 'change_orders', related: 'ChangeOrder', number: 'change_order_number', prefix: 'co' },
  invoice: { table: 'invoices', related: 'Invoice', number: 'invoice_number', prefix: 'invoice' },
  client_update: { table: 'client_updates', related: 'ClientUpdate', number: 'title', prefix: 'client_update' },
};

export async function savedDeliveryContext(db, companyId, body) {
  let document = null;
  let definition = null;
  let clientId = body.client_id || null;
  let leadId = body.lead_id || null;
  let contactEmail = null;
  if (body.document_type !== undefined || body.document_id !== undefined) {
    definition = definitions[body.document_type];
    if (!definition || !salesUuid.test(body.document_id || '')) throw new Error('A saved document is required.');
    const result = await db.from(definition.table).select('*').eq('id', body.document_id).eq('company_id', companyId).single();
    if (result.error || !result.data) throw new Error('The document was not found in your company.');
    document = result.data;
    clientId = document.client_id || null;
    leadId = body.document_type === 'quote' ? document.lead_id || null : null;
    if (body.document_type === 'change_order' && document.project_id) {
      const project = await db.from('projects').select('client_id').eq('id', document.project_id).eq('company_id', companyId).single();
      if (project.error || !project.data) throw new Error("The document's project was not found in your company.");
      clientId = project.data.client_id || clientId;
    }
  }
  if (clientId) {
    if (!salesUuid.test(clientId)) throw new Error('A saved client is required.');
    const client = await db.from('clients').select('id,name,email,phone').eq('id', clientId).eq('company_id', companyId).single();
    if (client.error || !client.data) throw new Error('The client was not found in your company.');
    contactEmail = client.data.email || null;
    leadId = null;
  } else if (leadId) {
    if (!salesUuid.test(leadId)) throw new Error('A saved lead is required.');
    const lead = await db.from('leads').select('id,contact_name,contact_email,contact_phone').eq('id', leadId).eq('company_id', companyId).single();
    if (lead.error || !lead.data) throw new Error('The lead was not found in your company.');
    contactEmail = lead.data.contact_email || null;
  }
  if (!document && !clientId && !leadId) return null; // Legacy generic service emails have no document context.
  const kind = ['receipt', 'followup', 'communication'].includes(body.notification_kind) ? body.notification_kind : 'document';
  if (kind === 'receipt' && definition?.related !== 'Invoice') throw new Error('A saved invoice is required for a payment receipt.');
  const replyId = body.reply_to_communication_id || null;
  if (replyId) {
    if (kind !== 'communication' || !salesUuid.test(replyId)) throw new Error('A saved incoming message is required.');
    const reply = await db.from('client_communications').select('id,direction,client_id,lead_id').eq('id', replyId).eq('company_id', companyId).single();
    if (reply.error || !reply.data || String(reply.data.direction).toLowerCase() !== 'inbound' ||
      (clientId ? reply.data.client_id !== clientId : reply.data.lead_id !== leadId)) throw new Error('The incoming message was not found in this conversation.');
  }
  return {
    companyId, document, clientId, leadId, kind, replyId, contactEmail,
    related: definition?.related || (leadId ? 'Lead' : 'Message'),
    id: document?.id || leadId || clientId, prefix: definition?.prefix,
    label: String(document?.[definition?.number] || (leadId ? 'Lead message' : 'Client message')).replace(/[\r\n]/g, ' ').slice(0, 120),
  };
}

export async function recordSalesOutcome(db, context, event, reference, actorId, message) {
  if (!context) return;
  try {
    const result = await db.rpc('record_sales_event', {
      p_company: context.companyId, p_event: event, p_related: context.related, p_id: context.id,
      p_message: message || `${context.label}: ${event.replaceAll('_', ' ')}. Open the saved record to review.`,
      p_reference: reference, p_actor: actorId || null,
    });
    if (result.error) console.warn('Sales notification could not be recorded.');
  } catch {
    console.warn('Sales notification could not be recorded.');
  }
}

export function deliveryFailureEvent(context, isCopy = false) {
  if (isCopy) return 'document_copy_failed';
  if (context?.kind === 'receipt') return 'receipt_failed';
  if (context?.kind === 'followup' && ['quote', 'co'].includes(context.prefix)) return `${context.prefix}_followup_failed`;
  return context?.prefix ? `${context.prefix}_send_failed` : 'client_send_failed';
}

export async function registerDelivery(db, context, provider, providerId, actorId, recipient, sender, isCopy = false) {
  if (!context) return;
  const result = await db.rpc('register_outbound_delivery', {
    p_provider: provider, p_provider_id: providerId, p_company: context.companyId,
    p_related: context.related, p_id: context.id, p_client: context.clientId, p_lead: context.leadId,
    p_actor: actorId || null, p_kind: context.kind, p_copy: isCopy,
    p_recipient: Array.isArray(recipient) ? recipient[0] : recipient, p_sender: sender || null,
    p_reply: isCopy ? null : context.replyId || null,
  });
  if (result.error) throw new Error('Delivery tracking could not be recorded.');
}

// Only a service client can call this RPC. Environment configuration takes precedence.
export async function providerServerConfig(db) {
  const config = {
    resend_webhook_secret: Deno.env.get('RESEND_WEBHOOK_SECRET'),
    resend_reply_domain: Deno.env.get('RESEND_REPLY_DOMAIN'),
    stripe_connect_webhook_secret: Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET'),
  };
  if (Object.values(config).every(Boolean)) return config;
  try {
    const result = await db.rpc('notification_provider_server_config');
    if (!result.error && result.data && typeof result.data === 'object') {
      for (const key of Object.keys(config)) if (!config[key] && typeof result.data[key] === 'string') config[key] = result.data[key];
    }
  } catch { /* Missing optional configuration must never expose secret values. */ }
  return config;
}

export function normalizedPhone(value) {
  const phone = String(value || '').replace(/[^0-9+]/g, '');
  if (/^\d{10}$/.test(phone)) return `+1${phone}`;
  if (/^1\d{10}$/.test(phone)) return `+${phone}`;
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  throw new Error('Enter a valid phone number including the country code.');
}

export async function stableRequestId(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  digest[6] = (digest[6] & 15) | 64;
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest.slice(0, 16)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function deliveryCallback(db, provider, providerId, eventId, status, eventTime = null) {
  const args = { p_provider: provider, p_provider_id: providerId, p_event_id: eventId, p_status: status };
  const sales = await db.rpc('record_delivery_callback', args);
  if (sales.error) throw new Error('Delivery tracking is unavailable.');
  if (sales.data === true) return true;
  const personal = await db.rpc('record_personal_notification_delivery_callback', args);
  if (personal.error) throw new Error('Personal delivery tracking is unavailable.');
  if (personal.data === true) return true;
  const timestamp = new Date(eventTime || '').getTime();
  if (Number.isFinite(timestamp) && Date.now() - timestamp > 600000) return true;
  const retry = await db.rpc('retry_unregistered_delivery', { p_provider: provider, p_provider_id: providerId });
  if (retry.error) throw new Error('Delivery tracking is unavailable.');
  return retry.data === false;
}

export async function trackedReplyAddress(db, context, domain, recipient) {
  if (!context || (!context.clientId && !context.leadId) || !domain) return null;
  const recipients = Array.isArray(recipient) ? recipient : [recipient];
  if (!context.contactEmail || !recipients.length || !recipients.every(value => typeof value === 'string' && value.trim().toLowerCase() === context.contactEmail.trim().toLowerCase())) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)) throw new Error('Reply service configuration is invalid.');
  const result = await db.rpc('create_reply_route', { p_company: context.companyId, p_client: context.clientId, p_lead: context.leadId });
  if (result.error || !salesUuid.test(result.data || '')) throw new Error('Reply tracking could not be prepared.');
  return `reply+${result.data}@${domain.toLowerCase()}`;
}
