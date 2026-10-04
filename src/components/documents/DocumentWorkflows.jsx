import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WORKFLOW_BUTTON, workflowDate, workflowLink, localDateTime, workflowRecordId, safeDocumentUrl } from "@/lib/documentWorkflows";
import { FileSignature, Plus, Mail, History, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const freshForm = () => ({ document_id: "", request_type: "signature", recipient_id: "", name: "", email: "", expires_at: localDateTime(new Date(Date.now() + 14 * 86400000).toISOString()), instructions: "" });
async function rpc(name, args) { const result = await supabase.rpc(name, args); if (result.error) throw result.error; return result.data; }

export default function DocumentWorkflows({ project, documents = [], inbox = false }) {
  const { profile } = useAuth();
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const selectedId = workflowRecordId(params.get(inbox ? "id" : "request"));
  const companyId = profile?.company_id;
  const manager = ["owner", "admin", "manager", "office"].includes(profile?.role);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(freshForm);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [link, setLink] = useState("");
  const [auditRequest, setAuditRequest] = useState(null);
  const sending = useRef(false);
  const { data: recentRequests = [], isLoading, error } = useQuery({ queryKey: ["document_requests", companyId, project?.id || "inbox"], enabled: !!companyId && (!!project?.id || inbox), queryFn: async () => {
    let query = supabase.from("document_requests").select("*").eq("company_id", companyId);
    if (project?.id) query = query.eq("project_id", project.id);
    const { data, error: queryError } = await query.order("created_at", { ascending: false }).limit(100);
    if (queryError) throw queryError; return data || [];
  } });
  const selectedQuery = useQuery({ queryKey: ["document_request", companyId, project?.id || "inbox", selectedId], enabled: !!companyId && !!selectedId && (!!project?.id || inbox), queryFn: async () => {
    let query = supabase.from("document_requests").select("*").eq("company_id", companyId).eq("id", selectedId);
    if (project?.id) query = query.eq("project_id", project.id);
    const { data, error: queryError } = await query.maybeSingle();
    if (queryError) throw queryError; return data;
  } });
  const requests = selectedQuery.data ? [selectedQuery.data, ...recentRequests.filter(request => request.id !== selectedId)] : recentRequests;
  const selectedAvailable = requests.some(request => request.id === selectedId);
  useEffect(() => {
    if (!selectedId || !selectedAvailable) return;
    const card = document.getElementById(`document-request-${selectedId}`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" }); card?.focus({ preventScroll: true });
  }, [selectedId, selectedAvailable]);
  const { data: staff = [] } = useQuery({ queryKey: ["document_workflow_staff", companyId], enabled: !!companyId && manager, queryFn: async () => {
    const { data, error: queryError } = await supabase.from("profiles").select("id,full_name,email,is_active").eq("company_id", companyId).or("is_active.is.null,is_active.eq.true").order("full_name");
    if (queryError) throw queryError; return data || [];
  } });
  const { data: audit = [] } = useQuery({ queryKey: ["document_request_audit", companyId, auditRequest?.id], enabled: !!companyId && !!auditRequest?.id, queryFn: async () => {
    const { data, error: queryError } = await supabase.from("document_request_audit").select("*").eq("company_id", companyId).eq("request_id", auditRequest.id).order("created_at").limit(100);
    if (queryError) throw queryError; return data || [];
  } });
  async function act(fn) {
    if (sending.current) return;
    sending.current = true; setBusy(true);
    try { await fn(); qc.invalidateQueries({ queryKey: ["document_requests", companyId] }); qc.invalidateQueries({ queryKey: ["document_request", companyId] }); }
    catch (e) { toast.error(e.message || "The document request could not be updated."); }
    finally { sending.current = false; setBusy(false); }
  }
  function begin(existing) {
    setCreated(null); setLink("");
    setForm(existing ? { ...freshForm(), document_id: existing.document_id, request_type: existing.request_type, name: existing.recipient_name, email: existing.recipient_email, recipient_id: existing.recipient_id || "", instructions: existing.instructions || "" } : freshForm());
    setOpen(true);
  }
  function selectRecipient(id) {
    const person = staff.find(s => s.id === id);
    setForm(f => ({ ...f, recipient_id: id, ...(person ? { name: person.full_name || "", email: person.email || "" } : {}) }));
  }
  async function sendRequest(e) {
    e.preventDefault();
    if (!created && (!form.document_id || !form.name.trim() || !form.email || !form.expires_at)) return;
    await act(async () => {
      const result = created || await rpc("create_document_request", { p_document: form.document_id, p_type: form.request_type, p_name: form.name.trim(), p_email: form.email.trim(), p_expires: new Date(form.expires_at).toISOString(), p_instructions: form.instructions, p_recipient: form.recipient_id || null });
      setCreated(result); setLink(workflowLink("document", result.token));
      await rpc("email_document_request", { p_request: result.request_id, p_token: result.token, p_reminder: false });
      toast.success("Document request created and email queued."); setOpen(false);
    });
  }
  async function remind(request) {
    if (!window.confirm("Renew this request link and email a reminder? Earlier links will stop working.")) return;
    await act(async () => {
      const result = await rpc("refresh_document_request_link", { p_request: request.id });
      setLink(workflowLink("document", result.token));
      await rpc("email_document_request", { p_request: request.id, p_token: result.token, p_reminder: true });
      toast.success("Reminder queued with a renewed secure link.");
    });
  }
  async function openRequest(request) {
    await act(async () => { const result = await rpc("open_document_request", { p_request: request.id }); const url = workflowLink("document", result.token); if (!url) throw new Error("The request link could not be opened."); setLink(url); navigate(`/DocumentResponse?token=${result.token}`); });
  }
  return <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-4 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="flex items-center gap-2 font-semibold text-slate-900"><FileSignature className="h-5 w-5 text-amber-600" /> Reviews & signatures</h3><p className="mt-1 text-xs text-slate-500">Request a response to a saved document and keep a record of its exact version.</p></div>{manager && !inbox && <Button className={WORKFLOW_BUTTON} onClick={() => begin()} disabled={!documents.length || busy}><Plus className="mr-2 h-4 w-4" /> Request review / signature</Button>}</div>
    {link && <div className="rounded-lg bg-amber-50 p-3"><Label htmlFor="document-share-link">Latest secure link — only share with the intended recipient</Label><Input id="document-share-link" value={link} readOnly onFocus={e => e.target.select()} className="mt-1 bg-white" /><Button type="button" variant="outline" className="mt-2 min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(link); toast.success("Link copied"); } catch { toast.error("Select the link above and copy it."); } }}>Copy link</Button></div>}
    {selectedId && selectedQuery.isPending && <p role="status" className="text-sm text-slate-500">Loading the selected request…</p>}
    {selectedId && selectedQuery.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">The selected request could not be loaded. {selectedQuery.error.message}</p>}
    {selectedId && !selectedQuery.isPending && !selectedQuery.error && !selectedQuery.data && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This request is no longer available, or you do not have access. Ask the requesting team member to check it.</p>}
    {isLoading ? <p role="status" className="text-sm text-slate-500">Loading requests…</p> : error ? <p role="alert" className="text-sm text-red-700">Requests could not be loaded. {error.message}</p> : !requests.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No review or signature requests yet.</p> : <div className="space-y-3">{requests.map(request => <article key={request.id} id={`document-request-${request.id}`} tabIndex={-1} aria-current={request.id === selectedId ? "true" : undefined} className={`scroll-mt-24 rounded-lg border p-4 outline-none ${request.id === selectedId ? "border-amber-500 ring-2 ring-amber-100" : "border-slate-200"}`}><div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><div className="min-w-0"><p className="break-words font-semibold text-slate-900">{request.title}</p><p className="mt-1 break-words text-sm text-slate-600">{request.request_type === "signature" ? "Signature" : "Review"} for {request.recipient_name}</p><p className="mt-1 text-xs text-slate-500">Expires {workflowDate(request.expires_at)}{request.signer_name ? ` · ${request.status} by ${request.signer_name}` : ""}</p></div><span className="h-fit self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{request.status}</span></div><div className="mt-3 space-y-2 text-sm text-slate-600">{request.instructions && <p className="whitespace-pre-wrap">{request.instructions}</p>}{request.responded_at && <p>Response recorded {workflowDate(request.responded_at)}{request.signer_name ? ` by ${request.signer_name}` : ""}</p>}{request.response_message && <p className="whitespace-pre-wrap">{request.response_message}</p>}</div><div className="mt-3 flex flex-wrap gap-2">{safeDocumentUrl(request.document_url) && <a href={safeDocumentUrl(request.document_url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-4 text-sm font-medium hover:bg-slate-50"><ExternalLink className="mr-2 h-4 w-4" /> View document version</a>}{request.status === "Pending" && <><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => openRequest(request)}><ExternalLink className="mr-2 h-4 w-4" /> Open request</Button>{manager && <><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => remind(request)}><Mail className="mr-2 h-4 w-4" /> Renew link & remind</Button><Button variant="outline" className="min-h-11 text-red-700" disabled={busy} onClick={() => { if (window.confirm("Cancel this request and revoke its links?")) act(async () => { await rpc("cancel_document_request", { p_request: request.id }); toast.success("Request cancelled"); }); }}>Cancel request</Button></>}</>}{manager && !inbox && request.status === "Expired" && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => begin(request)}>Request again</Button>}<Button variant="ghost" className="min-h-11" onClick={() => setAuditRequest(request)}><History className="mr-2 h-4 w-4" /> Activity record</Button></div></article>)}</div>}
    {recentRequests.length === 100 && <p className="text-xs text-slate-500">Showing the latest 100 requests.</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Request a document response</DialogTitle></DialogHeader><form onSubmit={sendRequest} className="space-y-4"><div><Label htmlFor="request-document">Saved document</Label><select id="request-document" value={form.document_id} onChange={e => setForm(f => ({ ...f, document_id: e.target.value }))} required disabled={busy || !!created} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3"><option value="">Choose a document</option>{documents.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}</select></div><div><Label htmlFor="request-kind">Response needed</Label><select id="request-kind" value={form.request_type} onChange={e => setForm(f => ({ ...f, request_type: e.target.value }))} disabled={busy || !!created} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3"><option value="signature">Electronic signature</option><option value="review">Review acknowledgement</option></select></div><div><Label htmlFor="request-staff">Recipient</Label><select id="request-staff" value={form.recipient_id} onChange={e => selectRecipient(e.target.value)} disabled={busy || !!created} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3"><option value="">Customer or external recipient</option>{staff.filter(p => p.email).map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></div><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="request-name">Recipient full name</Label><Input id="request-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required maxLength={200} disabled={busy || !!created} className="mt-1 min-h-11" /></div><div><Label htmlFor="request-email">Recipient email</Label><Input id="request-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required disabled={busy || !!created} className="mt-1 min-h-11" /></div></div><div><Label htmlFor="request-expiry">Link expires</Label><Input id="request-expiry" type="datetime-local" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} required disabled={busy || !!created} className="mt-1 min-h-11" /></div><div><Label htmlFor="request-instructions">Instructions</Label><Textarea id="request-instructions" value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} maxLength={5000} disabled={busy || !!created} className="mt-1" /></div>{created && <p role="status" className="text-sm text-amber-800">The request has been created. Retry the email below if it has not been queued.</p>}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="outline" type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-11">Close</Button><Button type="submit" className={WORKFLOW_BUTTON} disabled={busy}>{busy ? "Saving…" : created ? "Retry request email" : "Create and email request"}</Button></div></form></DialogContent></Dialog>
    <Dialog open={!!auditRequest} onOpenChange={value => { if (!value) setAuditRequest(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Document activity record</DialogTitle></DialogHeader><p className="break-words font-medium">{auditRequest?.document_name}</p>{auditRequest?.document_sha256 && <p className="break-all text-xs text-slate-500">Document checksum: {auditRequest.document_sha256}</p>}<ol className="space-y-3">{audit.map(entry => <li key={entry.id} className="rounded-lg border border-slate-200 p-3"><p className="text-sm font-medium">{entry.actor_name} · {entry.event.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{workflowDate(entry.created_at)}</p>{entry.details?.message && <p className="mt-2 whitespace-pre-wrap text-sm">{entry.details.message}</p>}</li>)}</ol><Button variant="outline" className="min-h-11" onClick={() => { const blob = new Blob([JSON.stringify({ request: auditRequest, activity: audit }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `document-response-${auditRequest.id}.json`; a.click(); URL.revokeObjectURL(url); }}>Download activity record</Button></DialogContent></Dialog>
  </section>;
}
