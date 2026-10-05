import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { WORKFLOW_BUTTON, workflowDate, workflowToken } from "@/lib/documentWorkflows";

export default function WarrantyResponse() {
  const token = workflowToken(window.location.search);
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [messages, setMessages] = useState({});
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    if (!token) { setError("This warranty link is invalid or expired. Ask your contractor for a new link."); setLoading(false); return; }
    supabase.rpc("warranty_portal_details", { p_token: token }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setError(rpcError.message); else setPortal(data);
      setLoading(false);
    }).catch(() => { if (active) { setError("Warranty support could not be loaded. Please try again."); setLoading(false); } });
    return () => { active = false; };
  }, [token]);
  async function respond(action, claimId) {
    if (sending.current) return;
    const message = action === "create" ? description.trim() : messages[claimId]?.trim() || (action === "confirm" ? "I confirm the repair is complete." : "");
    if (!message || (action === "create" && !title.trim())) { setError("Please enter the claim details or an update."); return; }
    sending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: rpcError } = await supabase.rpc("respond_warranty_claim", { p_token: token, p_action: action, p_claim: claimId || null, p_title: action === "create" ? title.trim() : "", p_message: message });
      if (rpcError) throw rpcError;
      setPortal(data); setMessages(previous => ({ ...previous, [claimId]: "" }));
      if (action === "create") { setTitle(""); setDescription(""); }
      setNotice(action === "create" ? "Your warranty claim has been submitted." : action === "confirm" ? "Thank you. The repair is confirmed and your claim is resolved." : action === "reopen" ? "Your claim has been reopened." : "Your update has been sent to the team.");
    } catch (e) { setError(e.message || "Your response could not be saved. Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:py-12"><div className="mx-auto max-w-3xl space-y-5"><div className="flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-amber-600" /><div><p className="font-bold text-slate-900">{portal?.company_name || "Fuzed Flow"}</p><p className="text-sm text-slate-500">Warranty support</p></div></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">{loading ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading warranty support…</p> : portal ? <><h1 className="text-xl font-bold text-slate-900">{portal.project_name}</h1><p className="mt-2 text-sm text-slate-600">Hello {portal.customer_name}. Submit an issue or keep the team updated on an existing claim.</p><p className="mt-2 text-xs text-slate-500">Secure access expires {workflowDate(portal.expires_at, portal.timezone)}.</p></> : <h1 className="text-xl font-semibold">Warranty support unavailable</h1>}{error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}</section>
    {portal?.can_create && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"><h2 className="font-semibold text-slate-900">Submit a warranty claim</h2><form onSubmit={e => { e.preventDefault(); respond("create"); }} className="mt-4 space-y-4"><div><Label htmlFor="warranty-title">What needs attention?</Label><Input id="warranty-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Shower door needs adjustment" required disabled={busy} className="mt-1 min-h-11" /></div><div><Label htmlFor="warranty-description">Describe the issue</Label><Textarea id="warranty-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={10000} placeholder="Tell us where the issue is, when it started and any details that will help us review it." required disabled={busy} className="mt-1 min-h-28" /></div><Button type="submit" disabled={busy || !title.trim() || !description.trim()} className={`${WORKFLOW_BUTTON} w-full sm:w-auto`}>{busy ? "Sending…" : "Submit warranty claim"}</Button></form></section>}
    {portal?.claims?.map(claim => <article key={claim.id} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"><div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><h2 className="break-words font-semibold text-slate-900">{claim.title}</h2><span className="h-fit self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{claim.status}</span></div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{claim.description}</p>{claim.repair_visit_at && <p className="mt-3 text-sm text-slate-600">Repair visit: {workflowDate(claim.repair_visit_at, portal.timezone)}</p>}{claim.resolution && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Repair / resolution: {claim.resolution}</p>}{claim.updates?.length > 0 && <><h3 className="mt-4 text-sm font-semibold text-slate-700">Recent updates</h3><ol className="mt-3 space-y-3 border-l-2 border-amber-200 pl-4">{claim.updates.map((update, index) => <li key={`${update.created_at}-${index}`}><p className="text-xs font-medium text-slate-500">{update.author_name} · {workflowDate(update.created_at, portal.timezone)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.message}</p></li>)}</ol></>}<form className="mt-5 space-y-3" onSubmit={e => { e.preventDefault(); respond("update", claim.id); }}><Label htmlFor={`warranty-update-${claim.id}`}>Add information or explain why the issue needs another look</Label><Textarea id={`warranty-update-${claim.id}`} value={messages[claim.id] || ""} onChange={e => setMessages(previous => ({ ...previous, [claim.id]: e.target.value }))} maxLength={10000} disabled={busy} /><div className="flex flex-col gap-3 sm:flex-row"><Button type="submit" variant="outline" className="min-h-11" disabled={busy || !messages[claim.id]?.trim()}>Send update</Button>{claim.status === "Awaiting Customer" && <Button type="button" className={WORKFLOW_BUTTON} disabled={busy} onClick={() => respond("confirm", claim.id)}>Confirm repair complete</Button>}{["Resolved", "Closed"].includes(claim.status) && <Button type="button" className={WORKFLOW_BUTTON} disabled={busy || !messages[claim.id]?.trim()} onClick={() => respond("reopen", claim.id)}>Reopen claim</Button>}</div></form></article>)}
    <p className="text-center text-xs text-slate-500">Powered by Fuzed Flow · Keep this private link secure.</p></div></main>;
}
