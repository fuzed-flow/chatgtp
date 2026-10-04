import { supabase } from '@/api/supabaseClient';

export async function getPublicProject(kind, documentId, token) {
  const { data, error } = await supabase.functions.invoke('public-project', {
    body: { kind, document_id: documentId, token },
  });
  if (error || data?.error) throw new Error(data?.error || 'This project link is unavailable.');
  return data;
}

export function contractorPortalUrl(project, origin = window.location.origin) {
  const url = new URL('/ContractorPortal', origin);
  url.searchParams.set('projectId', project.id);
  if (project.contractor_share_token) url.searchParams.set('token', project.contractor_share_token);
  return url.toString();
}
