import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { Download, CheckCircle, Building2, Calendar, MapPin, Receipt, MessageSquare, FileText, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { toast } from "sonner";
import { generateQuotePDF } from "../components/pdf/PDFGenerator";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";


const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);

export default function PublicQuoteView() {
  const params = new URLSearchParams(window.location.search);
  const quoteId = params.get("id") || window.location.pathname.split("/").pop();
  const [tracked, setTracked] = useState(false);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);
  const [changesMessage, setChangesMessage] = useState("");
  const [submittingChanges, setSubmittingChanges] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [selectedOptionalItems, setSelectedOptionalItems] = useState({});
  const [lightboxImage, setLightboxImage] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === "Escape") setLightboxImage(null); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ["public-quote", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!quoteId,
  });

  const { data: client } = useQuery({
    queryKey: ["public-client", quote?.client_id],
    queryFn: async () => {
      if (!quote?.client_id) return null;
      const { data, error } = await supabase.from("clients").select("*").eq("id", quote.client_id).maybeSingle(); // ⚡ CHANGED TO maybeSingle()
      if (error) throw error;
      return data;
    },
    enabled: !!quote?.client_id,
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["public-quote-phases", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_phases").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["public-quote-items", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("display_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["public-quote-schedule-items", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: company } = useQuery({
    queryKey: ["public-company", quote?.company_id],
    queryFn: async () => {
      if (!quote?.company_id) return null;
      const { data, error } = await supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle(); // ⚡ CHANGED TO maybeSingle()
      if (error) throw error;
      return data;
    },
    enabled: !!quote?.company_id,
  });

  // 🔒 The Lock: Prevents the double-render firing
  const notificationFired = useRef(false);

  // --- IMAGE PRELOADER ---
  useEffect(() => {
    if (items && items.length > 0) {
      // 1. Preload line item photos
      items.forEach(item => {
        if (item.photo_url) {
          const img = new Image();
          img.src = item.photo_url;
        }
      });
    }

    if (phases && phases.length > 0) {
      // 2. Preload phase photos
      phases.forEach(phase => {
        if (phase.photos && phase.photos.length > 0) {
          phase.photos.forEach(url => {
            const img = new Image();
            img.src = url;
          });
        }
      });
    }

    // 3. Preload the hero image
    if (quote?.hero_image_url) {
      const img = new Image();
      img.src = quote.hero_image_url;
    }
    
    // 4. Preload end photos (past projects)
    if (quote?.end_photos && quote.end_photos.length > 0) {
      quote.end_photos.forEach(url => {
        const img = new Image();
        img.src = url;
      });
    }
  }, [items, phases, quote]);

  useEffect(() => {
    const activeCompanyId = company?.id || quote?.company_id;
    
    // 1. Hold short if the core quote data isn't ready
    if (!quote?.id || !activeCompanyId) return;
    
    // 2. Hold short if the database is still actively fetching the client data
    if (quote?.client_id && client === undefined) return;

    // 3. If the lock is already closed, kill the execution instantly
    if (notificationFired.current) return;

    // Now we safely grab the name, knowing the database is finished loading
    const clientName = client?.name || quote?.client_name || "A client";

    const notifyTeam = async () => {
      // Snap the lock shut so React can never fire this a second time
      notificationFired.current = true; 
      
      try {
        await supabase.functions.invoke('company-notifier', {
          body: {
            event_key: "quote_viewed",
            document_uuid: quote.id,
            document_id: quote.quote_number,
            company_id: activeCompanyId, 
            message_body: `${clientName} just viewed Quote ${quote.quote_number}: ${quote.title}`
          }
        });
      } catch (error) {
        console.error("Silent notification failed:", error);
        notificationFired.current = false; // Reset on failure
      }
    };
    
    notifyTeam();
  }, [quote?.id, company?.id, quote?.company_id, client, quote?.client_id]);

  // --- UPGRADED BRANDING & DUAL TAX LOGIC ---
  const settings = company?.settings || {};
  const brandColor = settings?.pdf?.brand_color || '#f59e0b';
  const logoUrl = company?.logo_url || company?.company_logo_url;
  
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  const combinedTaxRate = primaryTaxRate + secondaryTaxRate;
  const taxLabel = settings?.tax_label || 'Tax';
  
  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

  const finalClientMessage = quote?.client_message || settings?.quote_client_message || '';
  const finalTerms = quote?.terms || settings?.default_terms || '';

  useEffect(() => {
    if (quoteId && !tracked && quote) {
      setTracked(true);
      const trackView = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const viewer_type = session?.user ? 'internal' : 'client';
          // Keep the database view tracker, but remove the broken duplicate notification!
          await supabase.from("quote_views").insert([{ company_id: quote.company_id, quote_id: quoteId, viewer_type, viewed_at: new Date().toISOString() }]);
        } catch (err) { }
      };
      trackView();
    }
  }, [quoteId, quote, tracked]);

  useEffect(() => {
    if (quote?.client_selected_items_json) {
      try {
        const savedSelections = JSON.parse(quote.client_selected_items_json);
        setSelectedOptionalItems(savedSelections);
      } catch (e) { }
    } else {
      const defaultSelections = {};
      phases.forEach(phase => { if (phase.is_optional) defaultSelections[phase.id] = phase.default_selected === true; });
      items.forEach(item => { if (item.is_optional) defaultSelections[item.id] = item.default_selected === true; });
      setSelectedOptionalItems(defaultSelections);
    }
  }, [quote, phases, items]);

  const isPhaseActive = (phase) => !phase.is_optional || selectedOptionalItems[phase.id] !== false;
  
  const isItemActive = (item) => {
    const phase = phases.find(p => p.id === item.phase_id);
    if (phase && !isPhaseActive(phase)) return false;
    return !item.is_optional || selectedOptionalItems[item.id] !== false;
  };

  const handleTogglePhase = (phaseId) => {
    if (quote.status === "Approved") return;
    setSelectedOptionalItems(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const handleToggleItem = (itemId) => {
    if (quote.status === "Approved") return;
    setSelectedOptionalItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const calculatePhaseSubtotal = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseActive(phase)) return 0;
    return items.filter(i => i.phase_id === phaseId && isItemActive(i)).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
  };

  const calculatePhaseTaxableAmount = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseActive(phase)) return 0;
    return items.filter(i => i.phase_id === phaseId && i.taxable && isItemActive(i)).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
  };

  const calculateTotals = () => {
    if (!quote || !phases || !items) return { subtotal: 0, primaryTax: 0, secondaryTax: 0, totalTax: 0, discount: 0, total: 0 };
    const selectedPhases = phases.filter(isPhaseActive);
    const subtotal = selectedPhases.reduce((sum, phase) => sum + calculatePhaseSubtotal(phase.id), 0);
    const taxableAmount = selectedPhases.reduce((sum, phase) => sum + calculatePhaseTaxableAmount(phase.id), 0);
    
    const primaryTax = taxableAmount * primaryTaxRate;
    const secondaryTax = taxableAmount * secondaryTaxRate;
    const totalTax = primaryTax + secondaryTax;

    const discount = quote.discount_type === "percentage" 
      ? ((subtotal + totalTax) * safeNum(quote.discount_percentage) / 100)
      : safeNum(quote.discount_amount);
    const total = subtotal + totalTax - discount;
    
    return { subtotal, primaryTax, secondaryTax, totalTax, discount, total };
  };

  const totals = calculateTotals();

  const downloadPDF = async () => {
    try {
      const screenQuoteOverride = { 
        ...quote, 
        hero_image_url: null, 
        subtotal: totals.subtotal, 
        tax: totals.totalTax, 
        total: totals.total, 
        client_selected_items_json: JSON.stringify(selectedOptionalItems) 
      };
      await generateQuotePDF(screenQuoteOverride, client, phases.filter(isPhaseActive), items.filter(isItemActive), company);
    } catch (error) { toast.error("Failed to generate PDF"); }
  };

  const handleAcceptQuote = async () => {
    try {
      const finalTotals = calculateTotals();
      
      const { error: updateError } = await supabase.from("quotes").update({
        status: "Approved", 
        client_selected_items_json: JSON.stringify(selectedOptionalItems),
        subtotal: finalTotals.subtotal, 
        tax: finalTotals.totalTax, 
        total: finalTotals.total
      }).eq("id", quote.id);

      // ⚡ Catch database security blocks so we don't send fake emails
      if (updateError) throw updateError;
      
      try {
        const clientName = client?.name || quote?.client_name || "A client";
        const activeCompanyId = company?.id || quote?.company_id;

        await supabase.functions.invoke('company-notifier', {
          body: { 
            event_key: "quote_approved", 
            document_uuid: quote.id,
            document_id: quote.quote_number,
            company_id: activeCompanyId, 
            message_body: `🎉 ${clientName} just APPROVED Quote ${quote.quote_number}: ${quote.title}!`
          }
        });
      } catch (emailError) {
        console.error("Approval notification failed:", emailError);
      }

      toast.success("Quote accepted! The team has been notified.");
      // ⚡ FIXED SYNTAX: Forces the page to instantly refresh the UI
      queryClient.invalidateQueries({ queryKey: ["public-quote", quoteId] });
    } catch (error) { 
      toast.error("Failed to accept quote. Please ensure database permissions allow public updates."); 
    }
  };

  const handleRequestChanges = async () => {
    if (!changesMessage.trim()) { toast.error("Please describe the changes you'd like to request"); return; }
    setSubmittingChanges(true);
    try {
      const { error } = await supabase.functions.invoke('company-notifier', {
        body: { event_key: 'quote_change_requested', document_uuid: quote.id, document_id: quote.id,
          company_id: quote.company_id, message_body: changesMessage.trim().slice(0, 2000) }
      });
      if (error) throw error;
      toast.success("Change request submitted. The team has been notified.");
      setChangesDialogOpen(false); setChangesMessage("");
    } catch (error) { toast.error("Could not submit the change request. Please retry."); }
    finally { setSubmittingChanges(false); }
  };

  const handlePayDeposit = async () => {
    if (!quote.deposit_amount || quote.deposit_amount <= 0) { toast.error("No deposit required for this quote"); return; }
    if (window.self !== window.top) { toast.error("Payment checkout can only be completed from the published app, not within a preview."); return; }

    setIsProcessingPayment(true);
    try {
      const { data, error } = await supabase.functions.invoke('createDepositCheckout', {
        body: { quote_id: quote.id, deposit_amount: quote.deposit_amount, client_email: client?.email || "", client_name: client?.name || "" }
      });
      if (error) throw error;
      if (data?.checkout_url) { window.location.href = data.checkout_url; } else { toast.error("Failed to create payment session"); }
    } catch (error) { toast.error("Failed to process payment"); } finally { setIsProcessingPayment(false); }
  };

  if (quoteLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500">Loading quote...</p>
    </div>
  );

  if (!quote) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500">Quote not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans" style={{ position: "relative" }}>
      <div className="max-w-4xl mx-auto">

        {quote?.hero_image_url && (
          <div className="rounded-t-xl overflow-hidden shadow-sm mt-6 border border-slate-200">
            <img 
              src={quote.hero_image_url} 
              alt="Quote Banner" 
              className="w-full h-64 object-cover cursor-zoom-in hover:opacity-95 transition-opacity"
              onClick={() => setLightboxImage(quote.hero_image_url)}
            />
          </div>
        )}

        <div className="py-8 px-4">
          
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

            <h2 className="text-2xl font-bold text-slate-900 mt-10 mb-2">Project Quote</h2>
            <p className="text-slate-600 font-medium">Quote #{quote.quote_number}</p>
          </div>

        <Card className={`p-4 sm:p-8 mb-6 bg-white shadow-xl border-slate-200 ${quote?.hero_image_url ? 'rounded-t-none border-t-0' : ''}`}>
          <div className="grid md:grid-cols-2 gap-6 mb-8 pb-6 border-b border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Quote For</p>
              <p className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Building2 className="h-5 w-5" style={{ color: brandColor }} />
                {client?.name || "N/A"}
              </p>
              {client?.billing_address && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Billing Address</p>
                  <p className="text-sm font-medium text-slate-600 flex items-start gap-2">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
                    {client.billing_address}
                  </p>
                </div>
              )}
              {client?.site_address && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Project / Site Location</p>
                  <p className="text-sm font-medium text-slate-600 flex items-start gap-2">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
                    {client.site_address}
                  </p>
                </div>
              )}
            </div>
            <div className="text-left md:text-right mt-4 md:mt-0">
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Date Information</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-start md:justify-end gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500 font-medium">Issued:</span>
                  <span className="font-bold text-slate-900">
                    {quote.issue_date ? format(new Date(quote.issue_date), "MMM d, yyyy") : "N/A"}
                  </span>
                </div>
                {quote.expiry_date && (
                  <div className="flex items-center justify-start md:justify-end gap-2 text-sm">
                    <span className="text-slate-500 font-medium ml-6">Expires:</span>
                    <span className="font-bold text-slate-900">
                      {format(new Date(quote.expiry_date), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xl font-black text-slate-900 mb-2 break-words">{quote.title}</h3>
            {quote.show_overall_scope && quote.overall_scope && (
              <p className="text-slate-600 text-sm whitespace-pre-wrap font-medium leading-relaxed break-words">{quote.overall_scope}</p>
            )}
          </div>

          <div className="space-y-6 mb-8">
            {phases.map(phase => {
              const phaseItems = items.filter(i => i.phase_id === phase.id);
              const phaseSubtotal = calculatePhaseSubtotal(phase.id);
              const phaseTaxable = calculatePhaseTaxableAmount(phase.id);
              const phasePrimaryTax = phaseTaxable * primaryTaxRate;
              const phaseSecondaryTax = phaseTaxable * secondaryTaxRate;
              const phaseTotal = phaseSubtotal + phasePrimaryTax + phaseSecondaryTax;
              const isPhaseSelected = isPhaseActive(phase);

              return (
                <div key={phase.id} className={`border rounded-lg p-4 sm:p-5 transition-all ${isPhaseSelected ? 'border-slate-200 bg-slate-50/50' : 'border-slate-300 bg-slate-100/30 opacity-60 grayscale-[40%]'}`} style={phase.is_optional && isPhaseSelected ? { borderColor: brandColor, backgroundColor: `${brandColor}10` } : {}}>
                  <div className="flex items-center gap-3 mb-3">
                    {phase.is_optional && quote.status !== "Approved" && (
                      <input
                        type="checkbox"
                        checked={isPhaseSelected}
                        onChange={() => handleTogglePhase(phase.id)}
                        className="h-5 w-5 rounded cursor-pointer"
                        style={{ accentColor: brandColor }}
                      />
                    )}
                    <h4 className={`text-lg font-black flex-1`} style={{ color: isPhaseSelected ? brandColor : '#94a3b8' }}>
                      {phase.phase_name}
                    </h4>
                    {phase.is_optional && (
                       <span className={`text-xs border px-2 py-0.5 rounded-full font-bold ${isPhaseSelected ? '' : 'bg-slate-200 text-slate-500 border-slate-300'}`} style={isPhaseSelected ? { backgroundColor: `${brandColor}20`, color: brandColor, borderColor: brandColor } : {}}>
                         Optional {isPhaseSelected ? '(Selected)' : '(Not Selected)'}
                       </span>
                    )}
                  </div>
                  {phase.scope_of_work && phase.show_scope_to_client !== false && (
                    <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap font-medium break-words">{phase.scope_of_work}</p>
                  )}
                  
                  {phase.photos && phase.photos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {phase.photos.map((photo, idx) => (
                        <div key={idx} className="overflow-hidden rounded border border-slate-200 h-20 w-20">
                          <img src={photo} alt="" onClick={() => setLightboxImage(photo)} className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-125" />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 mb-4">
                    {phaseItems.map((item) => {
                      const itemActive = isItemActive(item);
                      return (
                      <div key={item.id} className={`flex flex-col text-sm py-3 border-b border-slate-200 transition-opacity ${!itemActive || !isPhaseSelected ? 'opacity-50 grayscale-[50%]' : ''}`}>
                        <div className="flex items-start gap-3">
                          {item.is_optional && isPhaseSelected && quote.status !== "Approved" && (
                            <input
                              type="checkbox"
                              checked={itemActive}
                              onChange={() => handleToggleItem(item.id)}
                              className="h-4 w-4 mt-1 rounded cursor-pointer shrink-0"
                              style={{ accentColor: brandColor }}
                            />
                          )}
                          {item.photo_url && (
                            <div className="hidden sm:block shrink-0 overflow-hidden rounded border border-slate-300 h-16 w-16">
                              <img src={item.photo_url} alt={item.name} onClick={() => setLightboxImage(item.photo_url)} className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-125" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`font-bold ${itemActive && isPhaseSelected ? 'text-slate-900' : 'text-slate-400'}`}>
                              {item.name}
                              {item.is_optional && (
                                <span className={`ml-2 text-xs font-medium border px-1.5 py-0.5 rounded-full ${itemActive && isPhaseSelected ? '' : 'text-slate-400 bg-slate-100 border-slate-200'}`} style={itemActive && isPhaseSelected ? { color: brandColor, backgroundColor: `${brandColor}10`, borderColor: brandColor } : {}}>
                                  Optional{itemActive && isPhaseSelected ? ' ✓' : ' (Not Selected)'}
                                </span>
                              )}
                            </p>
                            {item.description && <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed whitespace-pre-wrap break-words">{item.description}</p>}
                          </div>
                        </div>
                        <div className="flex justify-end items-center gap-4 mt-2 pt-1 pl-7">
                          <p className={`text-xs font-medium whitespace-nowrap ${(!itemActive || !isPhaseSelected) ? 'line-through text-slate-300' : 'text-slate-500'}`}>{item.quantity} {item.unit || ''} &times; {formatCurrencyUSD(item.unit_price)}</p>
                          <p className={`font-black whitespace-nowrap ${(!itemActive || !isPhaseSelected) ? 'line-through text-slate-300' : 'text-slate-900'}`}>{formatCurrencyUSD(item.quantity * item.unit_price)}</p>
                        </div>
                      </div>
                    );
                    })}
                  </div>

                  <div className="flex justify-end">
                    <div className="space-y-1 text-right min-w-[170px]">
                      <div className="text-sm flex justify-between gap-4 text-slate-500 font-medium">
                        <span>Subtotal:</span>
                        <span className="font-bold text-slate-900">{formatCurrencyUSD(phaseSubtotal)}</span>
                      </div>
                      <div className="text-sm flex justify-between gap-4 text-slate-500 font-medium">
                        <span>{taxLabel}:</span>
                        <span className="font-bold text-slate-900">{formatCurrencyUSD(phasePrimaryTax)}</span>
                      </div>
                      {settings?.enable_secondary_tax && (
                        <div className="text-sm flex justify-between gap-4 text-slate-500 font-medium">
                          <span>{settings?.secondary_tax_label || "PST"}:</span>
                          <span className="font-bold text-slate-900">{formatCurrencyUSD(phaseSecondaryTax)}</span>
                        </div>
                      )}
                      <div className="text-base font-black pt-1 border-t flex justify-between gap-4 mt-1" style={{ color: brandColor, borderColor: `${brandColor}40` }}>
                        <span>Total:</span>
                        <span>{formatCurrencyUSD(phaseTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {quote.end_photos && quote.end_photos.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-black text-slate-900 mb-1">Similar Projects We've Completed</h4>
              <p className="text-sm font-medium text-slate-500 mb-4">Here are some examples of our past work</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {quote.end_photos.map((photo, idx) => (
                  <img key={idx} src={photo} alt="" onClick={() => setLightboxImage(photo)} className="w-full h-32 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-zoom-in" />
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl p-4 sm:p-6 border-2 shadow-sm mb-6" style={{ backgroundColor: `${brandColor}05`, borderColor: `${brandColor}30` }}>
            <div className="space-y-3">
              <div className="flex justify-between text-lg font-medium">
                <span className="text-slate-700">Subtotal:</span>
                <span className="font-bold text-slate-900">{formatCurrencyUSD(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-lg font-medium">
                <span className="text-slate-700">{taxLabel}:</span>
                <span className="font-bold text-slate-900">{formatCurrencyUSD(totals.primaryTax)}</span>
              </div>
              {settings?.enable_secondary_tax && (
                <div className="flex justify-between text-lg font-medium">
                  <span className="text-slate-700">{settings?.secondary_tax_label || "PST"}:</span>
                  <span className="font-bold text-slate-900">{formatCurrencyUSD(totals.secondaryTax)}</span>
                </div>
              )}

              {(quote.discount_amount > 0 || quote.discount_percentage > 0) && totals.discount > 0 && (
                <div className="flex justify-between text-lg text-emerald-700 pt-2 border-t border-slate-200">
                  <span className="font-medium">
                    Discount {quote.discount_type === "percentage" && `(${quote.discount_percentage}%)`}:
                  </span>
                  <span className="font-bold">
                    -{formatCurrencyUSD(totals.discount)}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t-2 mt-2" style={{ borderColor: `${brandColor}40` }}>
                <span className="text-xl font-black text-slate-900">Total:</span>
                <span className="text-3xl font-black" style={{ color: brandColor }}>{formatCurrencyUSD(totals.total)}</span>
              </div>
            </div>
          </div>

          {quote.has_payment_schedule && scheduleItems.length > 0 && (
            <div className="mb-6 rounded-lg p-5 border-2 shadow-sm" style={{ backgroundColor: `${brandColor}05`, borderColor: `${brandColor}20` }}>
              <h4 className="text-lg font-black text-slate-900 mb-2 flex items-center gap-2">
                <Receipt className="h-5 w-5" style={{ color: brandColor }} />
                Payment Schedule
              </h4>
              <p className="text-sm font-medium text-slate-600 mb-4">This project will be invoiced according to the following schedule:</p>
              <div className="space-y-2">
                {scheduleItems.map((item, idx) => {
                  const displayAmount = item.amount_type === "percentage" 
                    ? (totals.total * safeNum(item.percentage) / 100)
                    : safeNum(item.amount);
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 shadow-sm">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-slate-900">{item.payment_name}</p>
                        {item.due_event && (
                          <p className="text-xs font-medium text-slate-500 mt-0.5">Due: {item.due_event.replace(/_/g, ' ')}</p>
                        )}
                      </div>
                      <div className="text-right">
                        {item.amount_type === "percentage" ? (
                          <>
                            <p className="text-base font-black" style={{ color: brandColor }}>{formatCurrencyUSD(displayAmount)}</p>
                            <p className="text-xs font-bold text-slate-400">{item.percentage}% of total</p>
                          </>
                        ) : (
                          <p className="text-base font-black" style={{ color: brandColor }}>{formatCurrencyUSD(displayAmount)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {quote.documents && quote.documents.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-black text-slate-900 mb-3">Attached Documents</h4>
              <div className="space-y-2">
                {quote.documents.map((doc, idx) => (
                  <a
                    key={idx} href={doc.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 transition-all group"
                  >
                    <FileText className="h-5 w-5 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700">{doc.file_name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {(finalClientMessage || finalTerms) && (
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-6">
              {finalClientMessage && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Message from the Team</p>
                  <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed break-words">{finalClientMessage}</p>
                </div>
              )}
              {finalTerms && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Terms & Conditions</p>
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap leading-relaxed break-words">{finalTerms}</p>
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="flex justify-center gap-3 flex-wrap">
          <Button onClick={downloadPDF} variant="outline" className="shadow-sm bg-white font-bold h-11">
            <Download className="h-4 w-4 mr-2 text-slate-500" /> Download PDF
          </Button>
          {quote.status !== "Approved" && (
            <>
              <Button onClick={handleAcceptQuote} className="shadow-lg font-black h-11 px-8" style={{ backgroundColor: brandColor, color: '#fff' }}>
                <CheckCircle className="h-4 w-4 mr-2" /> Accept & Sign Quote
              </Button>
              <Button onClick={() => setChangesDialogOpen(true)} variant="outline" className="shadow-sm bg-white font-bold h-11">
                <MessageSquare className="h-4 w-4 mr-2 text-slate-500" /> Request Changes
              </Button>
            </>
          )}
          {quote.status === "Approved" && quote.deposit_amount > 0 && (
            <Button 
              onClick={handlePayDeposit} 
              disabled={isProcessingPayment}
              className="shadow-lg font-black h-11 px-8" style={{ backgroundColor: brandColor, color: '#fff' }}
            >
              {isProcessingPayment ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
              ) : (
                <><CreditCard className="h-4 w-4 mr-2" /> Pay Deposit Now ({formatCurrencyUSD(quote.deposit_amount)})</>
              )}
            </Button>
          )}
        </div>

        {/* ⚡ NEW GREEN APPROVED BOX / EXPIRY TEXT */}
        {quote.status === "Approved" ? (
          <div className="mt-8 mx-auto max-w-md bg-emerald-50 border-2 border-emerald-500 rounded-xl p-4 flex items-center justify-center gap-3 shadow-md animate-in fade-in zoom-in duration-300">
            <CheckCircle className="h-6 w-6 text-emerald-600" />
            <span className="text-emerald-800 font-black text-lg">Quote is Approved!</span>
          </div>
        ) : (
          <p className="text-center text-xs font-medium text-slate-400 mt-8">
            This quote is valid until {quote.expiry_date ? format(new Date(quote.expiry_date), "MMMM d, yyyy") : "the specified date"}
          </p>
        )}
        
        </div>
      </div>

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

      <Dialog open={changesDialogOpen} onOpenChange={setChangesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Describe the changes you'd like
              </label>
              <Textarea
                placeholder="Please describe any changes, adjustments, or clarifications you'd like to request..."
                value={changesMessage}
                onChange={(e) => setChangesMessage(e.target.value)}
                className="min-h-[120px] resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setChangesDialogOpen(false)} variant="outline" disabled={submittingChanges} className="flex-1 font-bold">Cancel</Button>
              <Button onClick={handleRequestChanges} disabled={submittingChanges} className="flex-1 text-white font-bold" style={{ backgroundColor: brandColor }}>
                {submittingChanges ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}