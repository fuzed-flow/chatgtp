import { supabase } from '@/api/supabaseClient';

// A saved public document UUID is the existing portal capability. The server
// derives its company and recipients; browsers never call the outbound relay.
export function notifyDocumentActivity({ body }) {
  return supabase.rpc('request_document_notification', {
    p_document: body.document_uuid || body.document_id,
    p_event: body.event_key,
    p_message: String(body.message_body || '').slice(0, 2000),
  });
}
