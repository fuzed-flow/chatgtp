import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { kind, document_id, token } = await req.json();
    if (!uuid.test(document_id || '')) return json({ error: 'Invalid project link' }, 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (kind === 'contractor') {
      if (!uuid.test(token || '')) return json({ error: 'Please request a current contractor link from the project manager.' }, 403);
      const { data: project, error } = await db.from('projects').select('id,company_id,name,site_address,description').eq('id', document_id).eq('contractor_share_token', token).maybeSingle();
      if (error || !project) return json({ error: 'Project link unavailable' }, 404);
      const [{ data: files, error: filesError }, { data: company }] = await Promise.all([
        db.from('contractor_portal_files').select('id,file_name,file_url,description,created_at').eq('project_id', project.id).eq('company_id', project.company_id).order('created_at', { ascending: false }),
        db.from('companies').select('settings').eq('id', project.company_id).maybeSingle(),
      ]);
      if (filesError) throw filesError;
      const { company_id: _companyId, ...publicProject } = project;
      return json({ project: publicProject, files: files || [], contact_email: company?.settings?.email || '' });
    }
    const table = kind === 'invoice' ? 'invoices' : kind === 'change_order' ? 'change_orders' : null;
    if (!table) return json({ error: 'Invalid link type' }, 400);
    // Document UUIDs are the existing capability in these shared links. Never accept
    // an arbitrary project ID from an invoice/change-order caller.
    const { data: doc, error: docError } = await db.from(table).select('id,company_id,project_id').eq('id', document_id).maybeSingle();
    if (docError || !doc) return json({ error: 'Document unavailable' }, 404);
    if (!doc.project_id) return json({ project: null });
    const { data: project, error } = await db.from('projects').select('id,name,site_address,client_id').eq('id', doc.project_id).eq('company_id', doc.company_id).maybeSingle();
    if (error) throw error;
    return json({ project });
  } catch {
    return json({ error: 'Unable to load this project link' }, 400);
  }
});
