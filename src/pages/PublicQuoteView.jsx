import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CreditCard, Download, Loader2, MessageSquare, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import QuotePresentation, { calculateQuoteTotals, documentDate, readableBrandText } from "@/components/quotes/QuotePresentation";
import { generateQuotePDF } from "@/components/pdf/PDFGenerator";
import { formatCurrencyForCompany } from "@/components/utils/formatCurrency";
import { getPublicQuoteBundle, publicQuoteErrorMessage, respondToPublicQuote, trackPublicQuoteView } from "@/lib/quoteSharing";
import { notifyDocumentActivity } from "@/lib/documentActivity";
import { toast } from "sonner";

const CLOSED_STATUSES = new Set(["Approved", "Accepted", "Paid", "Invoiced", "Declined", "Rejected", "Pending"]);

function initialSelections(quote, phases, items) {
  if (quote?.client_selected_items_json) {
    try { return JSON.parse(quote.client_selected_items_json); } catch { /* Use defaults. */ }
  }
  const result = {};
  for (const phase of phases || []) if (phase.is_optional) result[phase.id] = phase.default_selected === true;
  for (const item of items || []) if (item.is_optional) result[item.id] = item.default_selected === true;
  return result;
}

export default function PublicQuoteView() {
  const params = new URLSearchParams(window.location.search);
  const quoteId = params.get("id");
  const token = params.get("token");
  const queryClient = useQueryClient();
  const initializedQuote = useRef(null);
  const trackedQuote = useRef(null);
  const decisionLock = useRef(false);
  const [selections, setSelections] = useState({});
  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [changesMessage, setChangesMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);

  const bundleQuery = useQuery({
    queryKey: ["public-quote-bundle", quoteId, token],
    queryFn: () => getPublicQuoteBundle(quoteId, token),
    enabled: Boolean(quoteId && token),
    retry: false,
  });

  const bundle = bundleQuery.data;
  const quote = bundle?.quote;
  const client = bundle?.client;
  const company = bundle?.company;
  const phases = bundle?.phases || [];
  const items = bundle?.items || [];
  const scheduleItems = bundle?.schedule_items || [];
  const expired = bundle?.is_expired === true;

  useEffect(() => {
    if (!quote?.id || initializedQuote.current === quote.id) return;
    initializedQuote.current = quote.id;
    setSelections(initialSelections(quote, phases, items));
  }, [quote, phases, items]);

  useEffect(() => {
    if (!quote?.id || !token || trackedQuote.current === quote.id) return;
    trackedQuote.current = quote.id;
    trackPublicQuoteView(quote.id, token).catch(() => { trackedQuote.current = null; });
  }, [quote?.id, token]);

  const totals = quote ? calculateQuoteTotals({ quote, phases, items, selections, company }) : null;
  const brandColor = company?.settings?.pdf?.brand_color || "#f59e0b";
  const brandText = readableBrandText(brandColor);
  const signerEmailValid = !signerEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim());
  const closed = quote ? CLOSED_STATUSES.has(quote.status) : true;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["public-quote-bundle", quoteId, token] });

  const submitDecision = async ({ action, message = null }) => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    setSubmitting(true);
    try {
      await respondToPublicQuote({ quoteId, token, action, selections, signerName, signerEmail, termsAccepted, message });
      await refresh();
      setApproveOpen(false);
      setDeclineOpen(false);
      setChangesOpen(false);
      if (action === "approve") toast.success("Quote approved. The team has been notified.");
      if (action === "decline") toast.success("Quote declined. The team has been notified.");
      if (action === "request_changes") {
        toast.success("Your change request was sent to the team.");
        notifyDocumentActivity({ body: {
          event_key: "quote_change_requested",
          document_uuid: quote.id,
          document_id: quote.quote_number,
          company_id: quote.company_id,
          message_body: message,
        }}).catch(() => {});
      }
    } catch (error) {
      toast.error(publicQuoteErrorMessage(error));
    } finally {
      decisionLock.current = false;
      setSubmitting(false);
    }
  };

  const downloadPDF = async () => {
    try {
      await generateQuotePDF({ ...quote, subtotal: totals.subtotal, tax: totals.totalTax, total: totals.total, client_selected_items_json: JSON.stringify(selections) }, client, phases.filter(totals.phaseActive), items.filter(totals.itemActive), company);
    } catch {
      toast.error("The quote PDF could not be generated.");
    }
  };

  const payDeposit = async () => {
    if (window.self !== window.top) {
      toast.error("Open the published quote link to complete payment.");
      return;
    }
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke("createDepositCheckout", { body: { quote_id: quote.id } });
      if (error || !data?.checkout_url) throw error || new Error("Checkout unavailable");
      window.location.assign(data.checkout_url);
    } catch {
      toast.error("Secure checkout could not be opened. Please try again.");
      setPaying(false);
    }
  };

  if (!quoteId || !token) return <QuoteUnavailable title="Incomplete quote link" message="Ask your contractor to resend the secure quote link." />;
  if (bundleQuery.isLoading) return <LoadingQuote />;
  if (bundleQuery.isError || !quote) return <QuoteUnavailable title="Quote unavailable" message="This secure link is invalid, expired, or has been replaced. Ask your contractor for a new link." />;

  const actions = (
    <div className="sticky bottom-0 z-20 -mx-3 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_25px_rgba(15,23,42,0.12)] backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:shadow-sm">
      {expired && !closed ? <div role="alert" className="mb-3 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />This quote expired on {documentDate(quote.expiry_date, "MMMM d, yyyy")}. Contact the contractor for an updated quote.</div> : null}
      {quote.status === "Pending" ? <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Changes requested — the team is reviewing your request.</p> : null}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-center">
        <Button type="button" onClick={downloadPDF} variant="outline" className="min-h-11 bg-white font-bold"><Download className="mr-2 h-4 w-4" />Download PDF</Button>
        {!closed && !expired ? <>
          <Button type="button" onClick={() => setApproveOpen(true)} disabled={submitting} className="min-h-11 px-8 font-black shadow-md" style={{ backgroundColor: brandColor, color: brandText }}><CheckCircle className="mr-2 h-4 w-4" />Approve Quote</Button>
          <Button type="button" onClick={() => setChangesOpen(true)} disabled={submitting} variant="outline" className="min-h-11 bg-white font-bold"><MessageSquare className="mr-2 h-4 w-4" />Request Changes</Button>
          <Button type="button" onClick={() => setDeclineOpen(true)} disabled={submitting} variant="outline" className="min-h-11 border-red-200 bg-white font-bold text-red-700 hover:bg-red-50"><XCircle className="mr-2 h-4 w-4" />Decline</Button>
        </> : null}
        {quote.status === "Approved" && Number(quote.deposit_amount) > Number(quote.deposit_paid_amount || 0) ? <Button type="button" onClick={payDeposit} disabled={paying} className="min-h-11 px-8 font-black shadow-md" style={{ backgroundColor: brandColor, color: brandText }}>{paying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening checkout…</> : <><CreditCard className="mr-2 h-4 w-4" />Pay Deposit ({formatCurrencyForCompany(Number(quote.deposit_amount) - Number(quote.deposit_paid_amount || 0), company)})</>}</Button> : null}
      </div>
      {quote.status === "Approved" ? <p role="status" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-center font-bold text-emerald-900">Approved by {quote.signed_by || bundle.approval?.signer_name || "the client"}</p> : null}
      {["Declined", "Rejected"].includes(quote.status) ? <p role="status" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-center font-semibold text-red-800">This quote has been declined.</p> : null}
    </div>
  );

  return <>
    <QuotePresentation quote={quote} client={client} company={company} phases={phases} items={items} scheduleItems={scheduleItems} selections={selections} onTogglePhase={id => setSelections(current => ({ ...current, [id]: !(current[id] ?? (phases.find(phase => phase.id === id)?.default_selected === true)) }))} onToggleItem={id => setSelections(current => ({ ...current, [id]: !(current[id] ?? (items.find(item => item.id === id)?.default_selected === true)) }))} allowSelections={!closed && !expired} actions={actions} />

    <Dialog open={approveOpen} onOpenChange={open => { if (!submitting) setApproveOpen(open); }}>
      <DialogContent className="w-[calc(100vw-2rem)] bg-white sm:max-w-lg">
        <DialogHeader><DialogTitle>Approve this quote</DialogTitle><DialogDescription>Confirm who is approving and acknowledge the displayed scope, selections, price, and terms.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm font-bold text-slate-700" htmlFor="quote-signer-name">Full name *</label>
          <Input id="quote-signer-name" value={signerName} onChange={event => setSignerName(event.target.value)} maxLength={120} autoComplete="name" disabled={submitting} />
          <label className="block text-sm font-bold text-slate-700" htmlFor="quote-signer-email">Email (optional)</label>
          <Input id="quote-signer-email" type="email" value={signerEmail} onChange={event => setSignerEmail(event.target.value)} maxLength={254} autoComplete="email" disabled={submitting} aria-invalid={!signerEmailValid} aria-describedby={!signerEmailValid ? "quote-signer-email-error" : undefined} />
          {!signerEmailValid ? <p id="quote-signer-email-error" role="alert" className="text-sm font-medium text-red-700">Enter a valid email address or leave this blank.</p> : null}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 accent-amber-500" />I approve the selected scope and total of {formatCurrencyForCompany(totals.total, company)} and accept the terms shown in this quote.</label>
          <div className="flex flex-col-reverse gap-3 sm:flex-row"><Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setApproveOpen(false)} disabled={submitting}>Cancel</Button><Button type="button" className="min-h-11 flex-1 font-black" style={{ backgroundColor: brandColor, color: brandText }} disabled={submitting || signerName.trim().length < 2 || !signerEmailValid || !termsAccepted} onClick={() => submitDecision({ action: "approve" })}>{submitting ? "Approving…" : "Confirm Approval"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>

    <DecisionDialog open={changesOpen} onOpenChange={setChangesOpen} title="Request changes" description="Describe what should be adjusted. Approval will pause while the team reviews your request." label="Requested changes" value={changesMessage} onChange={setChangesMessage} placeholder="Describe the changes or clarification you need…" submitLabel="Send Request" submitting={submitting} onSubmit={() => submitDecision({ action: "request_changes", message: changesMessage.trim() })} submitDisabled={!changesMessage.trim()} />
    <DecisionDialog open={declineOpen} onOpenChange={setDeclineOpen} title="Decline this quote?" description="This records that you do not want to proceed with the current quote." label="Reason (optional)" value={declineReason} onChange={setDeclineReason} placeholder="Let the contractor know why you are declining…" submitLabel="Confirm Decline" submitting={submitting} danger onSubmit={() => submitDecision({ action: "decline", message: declineReason.trim() || null })} />
  </>;
}

function LoadingQuote() {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /><p role="status" className="font-medium text-slate-600">Loading secure quote…</p></div>;
}

function QuoteUnavailable({ title, message }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg"><ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" /><h1 className="text-xl font-black text-slate-950">{title}</h1><p className="mt-2 text-sm text-slate-600">{message}</p></div></div>;
}

function DecisionDialog({ open, onOpenChange, title, description, label, value, onChange, placeholder, submitLabel, submitting, onSubmit, submitDisabled = false, danger = false }) {
  const id = `${submitLabel.toLowerCase().replace(/\s+/g, "-")}-message`;
  return <Dialog open={open} onOpenChange={next => { if (!submitting) onOpenChange(next); }}><DialogContent className="w-[calc(100vw-2rem)] bg-white sm:max-w-lg"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-4"><label className="block text-sm font-bold text-slate-700" htmlFor={id}>{label}</label><Textarea id={id} value={value} onChange={event => onChange(event.target.value)} maxLength={2000} disabled={submitting} placeholder={placeholder} className="min-h-32 resize-y" /><p className="text-right text-xs text-slate-400">{value.length}/2000</p><div className="flex flex-col-reverse gap-3 sm:flex-row"><Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button><Button type="button" className={`min-h-11 flex-1 font-bold ${danger ? "bg-red-600 text-white hover:bg-red-700" : "bg-amber-500 text-slate-950 hover:bg-amber-600"}`} disabled={submitting || submitDisabled} onClick={onSubmit}>{submitting ? "Submitting…" : submitLabel}</Button></div></div></DialogContent></Dialog>;
}
