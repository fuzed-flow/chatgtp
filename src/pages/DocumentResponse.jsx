import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WORKFLOW_BUTTON, safeDocumentUrl, workflowDate, workflowToken } from "@/lib/documentWorkflows";
import { CheckCircle2, FileSignature, ExternalLink, Loader2 } from "lucide-react";

export default function DocumentResponse() {
  const token = workflowToken(window.location.search);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!token) {
      setError("This document link is invalid or expired. Ask the sender for a new link.");
      setLoading(false);
      return;
    }
    supabase.rpc("document_request_details", { p_token: token }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setError(rpcError.message);
      else { setRequest(data); setName(data?.recipient_name || ""); }
      setLoading(false);
    }).catch(() => { if (active) { setError("The document could not be loaded. Please try again."); setLoading(false); } });
    return () => { active = false; };
  }, [token]);

  async function respond(action) {
    if (sending.current || !name.trim()) return;
    if (action === "complete" && !consent) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("respond_document_request", { p_token: token, p_action: action, p_name: name.trim(), p_message: message, p_consent: action === "complete" && consent });
      if (rpcError) throw rpcError;
      setRequest(data);
    } catch (e) { setError(e.message || "Your response could not be saved. Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }

  const signing = request?.request_type === "signature";
  const documentUrl = safeDocumentUrl(request?.document_url);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center gap-3"><FileSignature className="h-8 w-8 text-amber-600" /><div><p className="font-bold text-slate-900">{request?.company_name || "Fuzed Flow"}</p><p className="text-sm text-slate-500">Secure document {signing ? "signature" : "review"}</p></div></div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          {loading ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading document…</p> : request ? <>
            <h1 className="break-words text-xl font-bold text-slate-900">{request.title}</h1>
            <p className="mt-2 text-sm text-slate-500">For {request.recipient_name} · Expires {workflowDate(request.expires_at, request.timezone)}</p>
            {request.instructions && <p className="mt-5 whitespace-pre-wrap text-sm text-slate-700">{request.instructions}</p>}
            {documentUrl && <a className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 font-semibold text-amber-900" href={documentUrl} target="_blank" rel="noopener noreferrer">Open {request.document_name}<ExternalLink className="h-4 w-4 shrink-0" /></a>}
            {request.status !== "Pending" ? <div className="mt-6 rounded-lg bg-emerald-50 p-4 text-emerald-900" role="status"><CheckCircle2 className="mb-2 h-6 w-6" /><p className="font-semibold">Response recorded: {request.status}</p><p className="mt-1 text-sm">{request.signer_name} · {workflowDate(request.responded_at, request.timezone)}</p>{request.response_message && <p className="mt-2 whitespace-pre-wrap text-sm">{request.response_message}</p>}</div> : <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); respond("complete"); }}>
              <div><Label htmlFor="document-signer">Your full name</Label><Input id="document-signer" value={name} onChange={e => setName(e.target.value)} maxLength={200} autoComplete="name" disabled={busy} required className="mt-1 min-h-11" /></div>
              <div><Label htmlFor="document-message">Comments (optional)</Label><Textarea id="document-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={5000} disabled={busy} className="mt-1" /></div>
              <label htmlFor="document-consent" className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700"><input id="document-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} className="mt-0.5 h-5 w-5 shrink-0 accent-amber-500" /><span>{signing ? "I have reviewed this document and agree to sign it electronically using the full name entered above. My signature and the document version will be recorded." : "I confirm I have reviewed the document. My name, response and the document version will be recorded."}</span></label>
              <div className="flex flex-col gap-3 sm:flex-row"><Button type="submit" disabled={busy || !name.trim() || !consent} className={`${WORKFLOW_BUTTON} flex-1`}>{busy ? "Saving…" : signing ? "Sign document" : "Complete review"}</Button><Button type="button" variant="outline" disabled={busy || !name.trim()} onClick={() => respond("decline")} className="min-h-11">Decline request</Button></div>
            </form>}
          </> : <h1 className="text-xl font-semibold text-slate-900">Document unavailable</h1>}
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </section>
        <p className="text-center text-xs text-slate-500">Powered by Fuzed Flow · Keep this private link secure.</p>
      </div>
    </main>
  );
}
