import { supabase } from '@/api/supabaseClient';

export async function issueClientPortalToken(clientId) {
  const { data, error } = await supabase.rpc('issue_client_portal_token', { p_client: clientId });
  if (error || !data) throw error || new Error('A secure client portal link could not be created.');
  return data;
}

export async function loadClientPortal(clientId, tokens) {
  // Older links use document-specific parameter names. Any valid credential
  // now opens the same client-scoped bundle; a stale token cannot hide a valid one.
  let lastError;
  for (const token of [...new Set(tokens.filter(Boolean))]) {
    const { data, error } = await supabase.rpc('get_client_portal_bundle', { p_client: clientId, p_token: token });
    if (!error && data?.client) return { ...data, token };
    lastError = error;
  }
  throw lastError || new Error('Open the secure portal link from your contractor.');
}

export async function clientPortalDocumentToken(clientId, token, kind, documentId) {
  const { data, error } = await supabase.rpc('get_client_portal_document_link', {
    p_client: clientId, p_token: token, p_kind: kind, p_document: documentId,
  });
  if (error || !data) throw error || new Error('This document is unavailable.');
  return data;
}
