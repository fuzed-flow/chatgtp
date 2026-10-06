import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { 
  Download, CheckCircle, Building2, Calendar, MapPin, 
  Tag, Clock, FileText, ClipboardList, CreditCard, Loader2, Receipt
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { toast } from "sonner";
import { generateInvoicePDF } from "../components/pdf/PDFGenerator";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import { buildPublicInvoiceUrl, getPublicInvoiceBundle, trackPublicInvoiceView } from "@/lib/invoiceSharing";

const EMPTY_INVOICE_DATA = {
  invoice: null, client: null, project: null, company: null,
  scheduleItems: [], payments: [], invoicePhases: [], invoiceItems: [], manualItems: []
};

const safeBrandColor = value => /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value || ""))
  ? String(value)
  : "#f59e0b";

const readableBrandText = value => {
  const compact = value.slice(1);
  const hex = compact.length === 3 ? compact.split("").map(character => character.repeat(2)).join("") : compact;
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const slateContrast = (luminance + 0.05) / 0.0586;
  return whiteContrast >= slateContrast ? "#ffffff" : "#0f172a";
};

export default function PublicInvoiceView() {
  const params = new URLSearchParams(window.location.search);
  const invoiceId = params.get("id");
  const token = params.get("token");

  // ==========================================
  // 1. ALL HOOKS MUST GO AT THE TOP LEVEL
  // ==========================================
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [dbData, setDbData] = useState(EMPTY_INVOICE_DATA);
  const notificationFired = useRef(false);

  // --- SUCCESS TOAST CATCHER ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("payment") === "success" && invoiceId && token) {
      toast.success("Payment submitted. Your balance updates after payment confirmation.", { duration: 8000 });
      const secureInvoiceUrl = new URL(buildPublicInvoiceUrl(window.location.origin, invoiceId, token));
      window.history.replaceState(null, "", `${secureInvoiceUrl.pathname}${secureInvoiceUrl.search}`);
    }
  }, [invoiceId, token]);

  // --- BULLETPROOF VANILLA DATA FETCHING ---
  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setIsError(false);
    setDbData(EMPTY_INVOICE_DATA);

    const fetchInvoiceData = async () => {
      if (!invoiceId || !token) {
        if (active) setIsLoading(false);
        return;
      }
      
      try {
        const bundle = await getPublicInvoiceBundle(invoiceId, token);
        if (!active) return;
        const allItems = bundle.items || bundle.invoice_items || [];

        setDbData({
          invoice: bundle.invoice,
          client: bundle.recipient || bundle.client || null,
          company: bundle.company || null,
          project: bundle.project || null,
          scheduleItems: bundle.schedule_items || [],
          payments: bundle.payments || [],
          invoicePhases: bundle.phases || [],
          invoiceItems: allItems.filter(item => item.phase_id),
          manualItems: allItems.filter(item => !item.phase_id)
        });

      } catch (error) {
        if (!active) return;
        console.error("Failed to load invoice payload:", error);
        setIsError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchInvoiceData();
    return () => { active = false; };
  }, [invoiceId, token]);

  const { invoice, client, project, company, scheduleItems, payments, invoicePhases, invoiceItems, manualItems } = dbData;

  // Record a valid secure-link view without exposing direct table access.
  useEffect(() => {
    const viewKey = invoice?.id && token ? `${invoice.id}:${token}` : null;
    if (!viewKey || notificationFired.current === viewKey) return;
    notificationFired.current = viewKey;
    trackPublicInvoiceView(invoice.id, token).catch(() => {
      if (notificationFired.current === viewKey) notificationFired.current = null;
    });
  }, [invoice?.id, token]);


  // ==========================================
  // 2. SAFE EARLY RETURNS GO HERE
  // ==========================================
  if (!invoiceId || !token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Invalid Invoice Link</h2>
        <p className="text-slate-500">Ask your contractor to resend the secure invoice link.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Loading invoice details...</p>
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <h2 className="text-xl font-bold text-red-600 mb-2">Failed to Load Invoice</h2>
        <p className="text-slate-500">This secure link is invalid or no longer available. Ask your contractor for a new link.</p>
      </div>
    );
  }

  // ==========================================
  // 3. UI RENDER VARIABLES
  // ==========================================
  const settings = company?.settings || {};
  const brandColor = safeBrandColor(settings?.pdf?.brand_color);
  const brandTextColor = readableBrandText(brandColor);
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

  const discountValue = invoice?.discount_type === 'percentage' 
    ? ((invoice.subtotal / (1 - (invoice.discount_amount / 100))) * (invoice.discount_amount / 100))
    : (invoice?.discount_amount || 0);

  const rawSubtotal = (invoice?.subtotal || 0) + discountValue;

  const downloadPDF = async () => {
    try {
      const blindInvoicePayload = { ...invoice, hero_image_url: null };
      await generateInvoicePDF({
        invoice: blindInvoicePayload, client, project, quotePhases: invoicePhases, quoteItems: invoiceItems, manualItems, scheduleItems, payments, organization: company
      });
    } catch { toast.error("Failed to generate PDF"); }
  };

  const handlePayInvoice = async () => {
  try {
    setIsProcessingPayment(true);

    const successUrl = new URL(buildPublicInvoiceUrl(window.location.origin, invoice.id, token));
    successUrl.searchParams.set("payment", "success");
    const cancelUrl = new URL(buildPublicInvoiceUrl(window.location.origin, invoice.id, token));
    cancelUrl.searchParams.set("payment", "canceled");

    // The server validates the token and derives the payable amount from the invoice.
    const { data, error } = await supabase.functions.invoke("createDepositCheckout", {
      body: {
        invoice_id: invoice.id,
        token,
        success_url: successUrl.toString(),
        cancel_url: cancelUrl.toString()
      }
    });

    if (error) throw error;

    // 3. Redirect the client to the secure Stripe Checkout URL
    const checkoutUrl = data?.checkout_url || data?.url;
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    } else {
      throw new Error("Failed to generate payment link.");
    }

  } catch (err) {
    console.error("Payment Error:", err);
    toast.error(err.message || "Could not connect to payment processor.");
    setIsProcessingPayment(false);
  }
};

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto">
        
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

        {invoice?.hero_image_url && (
          <div className="rounded-t-2xl overflow-hidden shadow-md border border-b-0 border-slate-200 w-full">
            <img 
              src={invoice.hero_image_url} 
              alt="Invoice Banner" 
              className="w-full h-48 object-cover"
            />
          </div>
        )}

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

          {scheduleItems.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Receipt className="h-4 w-4" style={{ color: brandColor }} /> Payment Milestones
              </h3>
              <div className="space-y-3">
                {scheduleItems.map((item, idx) => {
                  const isPaid = item.status === "Paid";
                  // Finds the first item in the array that is NOT paid
                  const nextPaymentIndex = scheduleItems.findIndex(i => i.status !== "Paid");
                  const isNext = idx === nextPaymentIndex;

                  return (
                    <div 
                      key={item.id} 
                      className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                        isPaid ? "bg-emerald-50 border-emerald-200 opacity-70" : 
                        isNext ? "bg-amber-50 border-amber-400 shadow-md ring-1 ring-amber-400" : 
                        "bg-white border-slate-200"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className={`font-bold ${
                            isPaid ? "text-emerald-800 line-through" : 
                            isNext ? "text-amber-900" : 
                            "text-slate-900"
                          }`}>
                            {item.payment_name}
                          </h4>
                          
                          {/* ⚡ STATUS BADGES */}
                          {isPaid && (
                            <span className="text-[10px] uppercase font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                              Paid
                            </span>
                          )}
                          {isNext && (
                            <span className="text-[10px] uppercase font-black bg-amber-500 text-amber-50 px-2 py-0.5 rounded-full shadow-sm">
                              Next Due
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-medium">Requirement: {item.due_event}</p>
                      </div>
                      
                      <div className="text-right">
                        <p className={`text-lg font-black ${
                          isPaid ? "text-emerald-700" : 
                          isNext ? "text-amber-700" : 
                          "text-slate-700"
                        }`}>
                          ${Number(item.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                          {payment.notes && ` • Ref: ${payment.notes.includes('Stripe Checkout Session') ? 'Online Payment via Stripe' : payment.notes}`}
                          {scheduleItem && ` • Applied to: ${scheduleItem.payment_name}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(invoice.show_notes && invoice.notes) && (
            <div className="pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" style={{ color: brandColor }} /> Notes & Terms
              </h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{invoice.notes}</p>
            </div>
          )}

          <div className="flex justify-center gap-4 pt-8 border-t border-slate-100 flex-wrap">
            <Button onClick={downloadPDF} variant="outline" className="shadow-sm bg-white font-bold h-12 px-6">
              <Download className="h-4 w-4 mr-2" /> Download PDF Record
            </Button>
            
            {invoice.balance_due > 0 && (
              <Button 
                onClick={handlePayInvoice} 
                disabled={isProcessingPayment}
                className="shadow-lg font-black h-12 px-8 transition-transform hover:scale-105"
                style={{ backgroundColor: brandColor, color: brandTextColor }}
              >
                {isProcessingPayment ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
                ) : (
                  <><CreditCard className="h-4 w-4 mr-2" /> Pay {scheduleItems?.find(i => i.status !== "Paid") ? "Next Milestone" : "Balance Now"}</>
                )}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
