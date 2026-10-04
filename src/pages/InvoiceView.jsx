import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { 
  Download, CheckCircle, Building2, Calendar, MapPin, 
  DollarSign, Clock, FileText, ClipboardList, Tag, Receipt 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { generateInvoicePDF } from "../components/pdf/PDFGenerator";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";

export default function InvoiceView() {
  const params = new URLSearchParams(window.location.search);
  const invoiceId = params.get("id");
  const [tracked, setTracked] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // --- QUERIES ---
  const { data: invoice, error: invoiceError, isLoading: isInvoiceLoading } = useQuery({
    queryKey: ["invoice_client_view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { 
      const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).single(); 
      if (error) throw error;
      return data; 
    }
  });

  const { data: client } = useQuery({
    queryKey: ["client_view", invoice?.client_id],
    enabled: !!invoice?.client_id,
    queryFn: async () => { const { data } = await supabase.from("clients").select("*").eq("id", invoice.client_id).single(); return data; }
  });

  const { data: project } = useQuery({
    queryKey: ["project_view", invoice?.project_id],
    enabled: !!invoice?.project_id,
    queryFn: async () => { const { data } = await supabase.from("projects").select("*").eq("id", invoice.project_id).single(); return data; }
  });

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["invoice-schedule-items-view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { const { data } = await supabase.from("invoice_payment_schedules").select("*").eq("invoice_id", invoiceId).order("sort_order", { ascending: true }); return data || []; }
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["invoice-payments-view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { const { data } = await supabase.from("payments").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: false }); return data || []; }
  });

  const { data: invoicePhases = [] } = useQuery({
    queryKey: ["invoice_phases_view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { const { data } = await supabase.from("invoice_phases").select("*").eq("invoice_id", invoiceId).order("sort_order"); return data || []; }
  });

  const { data: invoiceItems = [] } = useQuery({
    queryKey: ["invoice_line_items_view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { const { data } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).not("phase_id", "is", null).order("display_order"); return data || []; }
  });

  const { data: manualItems = [] } = useQuery({
    queryKey: ["invoice-manual-items-view", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => { const { data } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).is("phase_id", null).order("display_order"); return data || []; }
  });

  const { data: company } = useQuery({
    queryKey: ["company_view", invoice?.company_id],
    enabled: !!invoice?.company_id,
    queryFn: async () => { const { data } = await supabase.from("companies").select("*").eq("id", invoice.company_id).single(); return data; }
  });

  // --- DYNAMIC SETTINGS & BRANDING ---
  const settings = company?.settings || {};
  const brandColor = settings?.pdf?.brand_color || '#f59e0b';
  const logoUrl = company?.logo_url || company?.company_logo_url;
  
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  
  const primaryTaxAmount = (invoice?.subtotal || 0) * primaryTaxRate;
  const secondaryTaxAmount = (invoice?.subtotal || 0) * secondaryTaxRate;

  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

 useEffect(() => {
    if (invoiceId && invoice && !tracked) {
      setTracked(true);
      console.log("Client viewed invoice:", invoiceId);
    }
  }, [invoiceId, invoice, tracked]);

  if (isInvoiceLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500 font-medium animate-pulse">Loading secure invoice...</p>
    </div>
  );

  if (invoiceError) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to load invoice</h2>
      <p className="text-slate-500 mb-4">{invoiceError.message}</p>
      <p className="text-sm text-slate-400">If you are the owner, check your Supabase RLS policies for the "invoices" table.</p>
    </div>
  );

 if (!invoice) return null;

  const discountValue = invoice?.discount_type === 'percentage'
    ? ((invoice.subtotal / (1 - (invoice.discount_amount / 100))) * (invoice.discount_amount / 100))
    : (invoice?.discount_amount || 0);

  const rawSubtotal = (invoice?.subtotal || 0) + discountValue;

  const handleStripeCheckout = async () => {
    setIsProcessingPayment(true);
    try {
      // We invoke your Supabase Edge Function
      const { data, error } = await supabase.functions.invoke("createDepositCheckout", {
        body: {
          amount: invoice.balance_due, // Paying the remaining balance
          invoice_id: invoiceId,
          success_url: window.location.href, // Redirects right back to the invoice on success
          cancel_url: window.location.href,
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url; // Redirects the client to Stripe Checkout
      } else {
        throw new Error(data?.error || "Failed to generate checkout link.");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Payment system is currently unavailable. Please try again later.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const downloadPDF = async () => {
    const blindInvoicePayload = { ...invoice, hero_image_url: null };
    await generateInvoicePDF({
      invoice: blindInvoicePayload,
      client,
      project,
      quotePhases: invoicePhases, 
      quoteItems: invoiceItems,   
      manualItems,
      scheduleItems,
      payments,
      organization: company
    });
  };

  if (!invoice) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500 font-medium animate-pulse">Loading secure invoice...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {invoice?.hero_image_url && (
          <div className="rounded-t-2xl overflow-hidden shadow-md border border-b-0 border-slate-200 w-full mb-6 mt-6">
            <img 
              src={invoice.hero_image_url} 
              alt="Invoice Banner" 
              className="w-full h-64 object-cover cursor-zoom-in hover:opacity-95 transition-opacity"
              onClick={() => setLightboxImage(invoice.hero_image_url)}
            />
          </div>
        )}

        {/* Header Stack */}
        <div className="text-center mb-10 flex flex-col items-center">
          {logoUrl && (
            <div className="h-20 w-48 mb-6 flex justify-center">
              <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
            </div>
          )}
          {!logoUrl && (
              <h1 className="text-3xl font-black text-slate-900" style={{ color: brandColor }}>{company?.name || "Fuzed Flow"}</h1>
          )}
          
          <div className="text-sm text-slate-500 mt-3 space-y-1 max-w-md">
            {companyAddress && <p>{companyAddress}</p>}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
              {companyPhone && <p>Phone: {companyPhone}</p>}
              {companyEmail && <p>Email: {companyEmail}</p>}
              {companyWebsite && <p>{companyWebsite}</p>}
            </div>
            {taxId && <p className="mt-1">Tax ID: {taxId}</p>}
          </div>
        </div>

        {/* HEADER RIBBON */}
        <div className={`bg-slate-900 p-8 text-white flex flex-col sm:flex-row sm:items-end justify-between gap-6 shadow-xl border-b-4 ${invoice?.hero_image_url ? 'rounded-none' : 'rounded-t-2xl'}`} style={{ borderColor: brandColor }}>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-1" style={{ color: brandColor }}>Invoice Details</h2>
            <h1 className="text-4xl font-black">{invoice.invoice_number}</h1>
            <div className="flex gap-4 mt-3">
              <p className="text-slate-400 flex items-center gap-1.5 text-sm"><Calendar className="h-4 w-4"/> Issued: {format(new Date(invoice.issue_date), "MMM d, yyyy")}</p>
              {invoice.due_date && (
                <p className="text-slate-400 flex items-center gap-1.5 text-sm"><Clock className="h-4 w-4"/> Due: {format(new Date(invoice.due_date), "MMM d, yyyy")}</p>
              )}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm text-slate-400 font-medium mb-1">Remaining Balance</p>
            <p className="text-4xl font-black text-white">{formatCurrencyUSD(invoice.balance_due || 0)}</p>
          </div>
        </div>

        <Card className="p-4 sm:p-8 bg-white shadow-xl rounded-t-none border-0 space-y-10">
          
          {/* CLIENT & PROJECT INFO */}
          <div className="grid md:grid-cols-2 gap-6 pb-8 border-b border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Billed To</p>
              <p className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="h-5 w-5" style={{ color: brandColor }} /> {client?.name || "N/A"}
              </p>
              {invoice.billing_address && <p className="text-sm text-slate-600 mt-1">{invoice.billing_address}</p>}
              
              {(invoice.site_address || project?.name) && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Project / Site Location</p>
                  {project?.name && <p className="text-base font-bold text-slate-900">{project.name}</p>}
                  {invoice.site_address && <p className="text-sm text-slate-600 mt-1 flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" /> {invoice.site_address}</p>}
                </div>
              )}
            </div>
          </div>

          {/* SCOPE OF WORK */}
          {invoicePhases.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <ClipboardList className="h-4 w-4" style={{ color: brandColor }} /> Scope of Work Included
              </h3>
              <div className="space-y-4">
                {invoicePhases.map((phase) => {
                  const items = invoiceItems.filter(i => i.phase_id === phase.id);
                  return (
                    <div key={phase.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                        <h4 className="font-bold text-slate-800 text-sm">{phase.phase_name}</h4>
                      </div>
                      {items.length > 0 && (
                        <div className="p-0">
                          {items.map((item, idx) => (
                            <div key={item.id} className={`flex justify-between px-4 py-3 text-sm ${idx !== items.length -1 ? 'border-b border-slate-100' : ''}`}>
                              {/* ⚡ UPDATED: Display Description */}
                              <div className="flex flex-col pr-4">
                                <span className="text-slate-700 font-medium">
                                  {item.name} <span className="text-slate-400 font-normal">({item.quantity} {item.unit})</span>
                                </span>
                                {item.description && (
                                  <span className="text-slate-500 text-xs mt-1 whitespace-pre-wrap">{item.description}</span>
                                )}
                              </div>
                              <span className="font-semibold text-slate-900 shrink-0">{formatCurrencyUSD(item.quantity * item.unit_price)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* MANUAL / ADDITIONAL CHARGES */}
              {manualItems.length > 0 && (
                <div className="bg-white border rounded-lg overflow-hidden mt-4 shadow-sm" style={{ borderColor: `${brandColor}40` }}>
                  <div className="px-4 py-2 border-b" style={{ backgroundColor: `${brandColor}10`, borderColor: `${brandColor}30` }}>
                    <h4 className="font-bold text-sm" style={{ color: brandColor }}>Additional Charges</h4>
                  </div>
                  <div className="p-0">
                    {manualItems.map((item, idx) => (
                      <div key={item.id} className={`flex justify-between px-4 py-2 text-sm ${idx !== manualItems.length -1 ? 'border-b border-slate-100' : ''}`}>
                        <span className="text-slate-700 font-medium">{item.name}</span>
                        <span className="font-semibold text-slate-900">{formatCurrencyUSD(Number(item.unit_price || item.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PAYMENT MILESTONES */}
          {scheduleItems.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Receipt className="h-4 w-4" style={{ color: brandColor }} /> Payment Milestones
              </h3>
              <div className="space-y-3">
                {scheduleItems.map((item) => {
                  const isPaid = item.status === "Paid";
                  return (
                    <div key={item.id} className={`p-4 rounded-xl border ${isPaid ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-200'} flex items-center justify-between`}>
                      <div>
                        <p className={`font-bold ${isPaid ? 'text-emerald-900' : 'text-slate-900'}`}>{item.payment_name}</p>
                        <p className="text-xs font-medium text-slate-500 mt-0.5">Milestone Requirement: {item.due_event || "Standard"}</p>
                      </div>
                      <div className="text-right flex items-center gap-4">
                        <div className="text-right">
                          <p className={`text-lg font-black ${isPaid ? 'text-emerald-700' : 'text-slate-900'}`}>{formatCurrencyUSD(item.amount)}</p>
                          <p className={`text-xs font-bold uppercase tracking-wider ${isPaid ? 'text-emerald-600' : 'text-slate-400'}`} style={!isPaid ? { color: brandColor } : {}}>{item.status}</p>
                        </div>
                        {isPaid ? <CheckCircle className="h-6 w-6 text-emerald-500" /> : <Clock className="h-6 w-6 text-slate-300" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/*LEDGER & TOTALS */}
          <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Invoice Ledger</h3>
            <div className="space-y-3 max-w-sm ml-auto">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Contract Sum:</span>
                <span className="font-semibold text-slate-900">{formatCurrencyUSD(rawSubtotal)}</span>
              </div>
              
              {discountValue > 0 && (
                <div className="flex justify-between text-sm text-red-500">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3"/> Discount:</span>
                  <span className="font-semibold">-{formatCurrencyUSD(discountValue)}</span>
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{settings?.tax_label || "Tax"}:</span>
                <span className="font-semibold text-slate-900">{formatCurrencyUSD(primaryTaxAmount)}</span>
              </div>
              {settings?.enable_secondary_tax && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{settings?.secondary_tax_label || "PST"}:</span>
                  <span className="font-semibold text-slate-900">{formatCurrencyUSD(secondaryTaxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base border-t border-slate-200 pt-3">
                <span className="text-slate-700 font-bold">Total Contract:</span>
                <span className="font-bold text-slate-900">{formatCurrencyUSD(invoice.total || 0)}</span>
              </div>
              <div className="flex justify-between text-base border-t border-slate-200 pt-3 text-emerald-600">
                <span className="font-bold">Total Received:</span>
                <span className="font-bold">-{formatCurrencyUSD(invoice.amount_paid || 0)}</span>
              </div>
              <div className="flex justify-between text-2xl font-black border-t-2 border-slate-300 pt-4">
                <span className="text-slate-900">Balance Due:</span>
                <span className="text-red-600">{formatCurrencyUSD(invoice.balance_due || 0)}</span>
              </div>
            </div>
          </div>

          {/* PAYMENT HISTORY */}
          {payments.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" /> Payment History
              </h3>
              <div className="space-y-2">
                {payments.map(payment => {
                  const scheduleItem = scheduleItems.find(item => item.id === payment.schedule_item_id);
                  return (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{formatCurrencyUSD(payment.amount)} — {payment.payment_method}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {format(new Date(payment.payment_date || payment.created_at), "MMM d, yyyy")}
                          {payment.notes && ` • Ref: ${payment.notes}`}
                          {scheduleItem && ` • Applied to: ${scheduleItem.payment_name}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* NOTES TO CLIENT */}
          {(invoice.show_notes && invoice.notes) && (
            <div className="pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" style={{ color: brandColor }} /> Notes & Terms
              </h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{invoice.notes}</p>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex flex-col sm:flex-row justify-center gap-4 pt-8 border-t border-slate-100">
            <Button 
              onClick={downloadPDF} 
              variant="outline"
              className="font-bold h-12 px-8 rounded-full shadow-sm transition-transform hover:scale-105" 
            >
              <Download className="h-4 w-4 mr-2" /> Download PDF Record
            </Button>

            {(invoice.balance_due || 0) > 0 && (
              <Button 
                onClick={handleStripeCheckout} 
                disabled={isProcessingPayment}
                className="text-white font-bold h-12 px-10 rounded-full shadow-lg transition-transform hover:scale-105" 
                style={{ backgroundColor: brandColor }}
              >
                <DollarSign className="h-5 w-5 mr-1.5" /> 
                {isProcessingPayment ? "Connecting to secure checkout..." : `Pay ${formatCurrencyUSD(invoice.balance_due)}`}
              </Button>
            )}
          </div>

        </Card> {/* <--- THIS CLOSES THE CARD COMPONENT */}
      </div> {/* <--- THIS CLOSES THE max-w-4xl CONTAINER */}

      {/* LIGHTBOX PORTAL MUST SIT OUTSIDE THE CARD */}
      {lightboxImage && ReactDOM.createPortal(
        <div
          style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 999999, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setLightboxImage(null)}
        >
          <img
            src={lightboxImage}
            alt="Full size"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, display: "block", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxImage(null)}
            style={{ position: "fixed", top: 16, right: 16, background: "rgba(255,255,255,0.2)", border: "2px solid white", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", color: "white", fontSize: 28, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            ×
          </button>
        </div>,
        document.body
      )}

    </div> // <--- THIS CLOSES THE MAIN PAGE WRAPPER (min-h-screen)
  );
}