import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import QuotePresentation, { calculateQuoteTotals } from "@/components/quotes/QuotePresentation";
import { generateQuotePDF } from "@/components/pdf/PDFGenerator";
import { toast } from "sonner";

function initialSelections(quote, phases, items) {
  if (quote?.client_selected_items_json) {
    try { return JSON.parse(quote.client_selected_items_json); } catch { /* Use defaults. */ }
  }
  const result = {};
  for (const phase of phases || []) if (phase.is_optional) result[phase.id] = phase.default_selected === true;
  for (const item of items || []) if (item.is_optional) result[item.id] = item.default_selected === true;
  return result;
}

async function loadQuotePreview(quoteId) {
  const { data: quote, error: quoteError } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
  if (quoteError || !quote) throw quoteError || new Error("Quote not found");

  const [clientResult, companyResult, phasesResult, itemsResult, scheduleResult] = await Promise.all([
    quote.client_id ? supabase.from("clients").select("id,name,first_name,surname,billing_address,site_address").eq("id", quote.client_id).eq("company_id", quote.company_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("companies").select("id,name,logo_url,company_logo_url,settings").eq("id", quote.company_id).single(),
    supabase.from("quote_phases").select("id,quote_id,phase_name,scope_of_work,show_scope_to_client,photos,sort_order,is_optional,default_selected").eq("quote_id", quote.id).eq("company_id", quote.company_id).order("sort_order"),
    supabase.from("quote_line_items").select("id,quote_id,phase_id,name,description,quantity,unit,unit_price,taxable,photo_url,is_optional,default_selected,display_order").eq("quote_id", quote.id).eq("company_id", quote.company_id).order("display_order"),
    supabase.from("quote_payment_schedules").select("id,quote_id,payment_name,due_event,amount,amount_type,percentage,sort_order").eq("quote_id", quote.id).eq("company_id", quote.company_id).order("sort_order"),
  ]);

  const firstError = [clientResult, companyResult, phasesResult, itemsResult, scheduleResult].find(result => result.error)?.error;
  if (firstError) throw firstError;
  return {
    quote,
    client: clientResult.data,
    company: companyResult.data,
    phases: phasesResult.data || [],
    items: itemsResult.data || [],
    scheduleItems: scheduleResult.data || [],
  };
}

export default function QuoteView() {
  const quoteId = new URLSearchParams(window.location.search).get("id");
  const initializedQuote = useRef(null);
  const [selections, setSelections] = useState({});
  const previewQuery = useQuery({
    queryKey: ["quote-client-preview", quoteId],
    queryFn: () => loadQuotePreview(quoteId),
    enabled: Boolean(quoteId),
    retry: false,
  });
  const data = previewQuery.data;

  useEffect(() => {
    if (!data?.quote?.id || initializedQuote.current === data.quote.id) return;
    initializedQuote.current = data.quote.id;
    setSelections(initialSelections(data.quote, data.phases, data.items));
  }, [data]);

  if (!quoteId) return <PreviewError message="Choose a saved quote to preview." />;
  if (previewQuery.isLoading) return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /><p role="status" className="font-medium text-slate-600">Loading client preview…</p></div>;
  if (previewQuery.isError || !data?.quote) return <PreviewError message="This quote could not be loaded. Return to the builder and try again." />;

  const { quote, client, company, phases, items, scheduleItems } = data;
  const totals = calculateQuoteTotals({ quote, phases, items, selections, company });
  const closed = ["Approved", "Accepted", "Paid", "Invoiced", "Declined", "Rejected", "Pending"].includes(quote.status);
  const expired = quote.expiry_date ? new Date(`${quote.expiry_date}T00:00:00`).getTime() < new Date(new Date().toDateString()).getTime() : false;

  const downloadPDF = async () => {
    try {
      await generateQuotePDF({ ...quote, subtotal: totals.subtotal, tax: totals.totalTax, total: totals.total, client_selected_items_json: JSON.stringify(selections) }, client, phases.filter(totals.phaseActive), items.filter(totals.itemActive), company);
    } catch {
      toast.error("The quote PDF could not be generated.");
    }
  };

  const actions = <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center"><Button type="button" variant="outline" className="min-h-11 bg-white font-bold" onClick={() => window.location.assign(`/QuoteBuilder?id=${quoteId}`)}><ArrowLeft className="mr-2 h-4 w-4" />Back to Builder</Button><Button type="button" variant="outline" className="min-h-11 bg-white font-bold" onClick={downloadPDF}><Download className="mr-2 h-4 w-4" />Download PDF</Button></div>;

  return <QuotePresentation quote={quote} client={client} company={company} phases={phases} items={items} scheduleItems={scheduleItems} selections={selections} onTogglePhase={id => setSelections(current => ({ ...current, [id]: !(current[id] ?? (phases.find(phase => phase.id === id)?.default_selected === true)) }))} onToggleItem={id => setSelections(current => ({ ...current, [id]: !(current[id] ?? (items.find(item => item.id === id)?.default_selected === true)) }))} allowSelections={!closed && !expired} preview actions={actions} />;
}

function PreviewError({ message }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg"><ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" /><h1 className="text-xl font-black text-slate-950">Preview unavailable</h1><p className="mt-2 text-sm text-slate-600">{message}</p><Button type="button" variant="outline" className="mt-5 min-h-11" onClick={() => window.history.back()}>Go Back</Button></div></div>;
}
