import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { Download, CheckCircle, Building2, Calendar, MapPin, GripVertical, FolderKanban, Receipt, Zap, MessageSquare, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { toast } from "sonner";
import { createPageUrl } from "../utils";
import { generateQuotePDF } from "../components/pdf/PDFGenerator";

const GST_RATE = 0.05;

// Safety helper
const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);

export default function QuoteView() {
  const params = new URLSearchParams(window.location.search);
  const quoteId = params.get("id");
  
  const [tracked, setTracked] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);
  const [changesMessage, setChangesMessage] = useState("");
  const [submittingChanges, setSubmittingChanges] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [viewerImageUrl, setViewerImageUrl] = useState("");
  
  // NEW: Interactive Local Selections state
  const [localSelections, setLocalSelections] = useState({});
  const queryClient = useQueryClient();

  const openImageViewer = (imageUrl) => {
    setViewerImageUrl(imageUrl);
    setImageViewerOpen(true);
  };

  // 1. SUPABASE QUERIES
  const { data: quote } = useQuery({
    queryKey: ["quote", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!quoteId,
  });

  const { data: client } = useQuery({
    queryKey: ["client", quote?.client_id],
    queryFn: async () => {
      if (!quote?.client_id) return null;
      const { data, error } = await supabase.from("clients").select("*").eq("id", quote.client_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!quote?.client_id,
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["quote-phases", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_phases").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["quote-items", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("display_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["quote-schedule-items", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: quoteViews = [] } = useQuery({
    queryKey: ["quote-views", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_views").select("*").eq("quote_id", quoteId).order("viewed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteId,
  });

  const { data: company } = useQuery({
    queryKey: ["company", quote?.company_id],
    queryFn: async () => {
      if (!quote?.company_id) return null;
      const { data, error } = await supabase.from("companies").select("*").eq("id", quote.company_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!quote?.company_id,
  });

  // NEW: Initialize Interactive State from Database defaults or previous choices
  useEffect(() => {
    if (quote && phases.length > 0 && items.length > 0) {
      let initialMap = {};
      
      if (quote.client_selected_items_json) {
        try {
          initialMap = JSON.parse(quote.client_selected_items_json);
        } catch (e) {
          console.error("Failed to parse previous selections", e);
        }
      } else {
        // Fallback to builder default checkmark positions
        phases.forEach(p => {
          if (p.is_optional) initialMap[p.id] = p.default_selected === true;
        });
        items.forEach(i => {
          if (i.is_optional) initialMap[i.id] = i.default_selected === true;
        });
      }
      setLocalSelections(initialMap);
    }
  }, [quote, phases, items]);

  // 2. SUPABASE MUTATIONS
  const updateOrderMutation = useMutation({
    mutationFn: async ({ itemId, displayOrder }) => {
      const { error } = await supabase.from("quote_line_items").update({ display_order: displayOrder }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["quote-items", quoteId]);
    },
  });

  const convertToProject = async () => {
    if (!quote || !client || !company) return;
    const projectNumber = `${company.project_number_prefix || "PRJ-"}${company.next_project_number || Date.now().toString().slice(-4)}`;
    
    const { data: projectRef, error: projectError } = await supabase.from("projects").insert([{
      company_id: quote.company_id,
      client_id: quote.client_id,
      quote_id: quote.id,
      name: quote.title,
      project_number: projectNumber,
      status: "Planning",
      start_date: new Date().toISOString().split("T")[0],
      budget: safeNum(dynamicTotal), // Save custom total calculated on screen
      site_address: client.site_address || ""
    }]).select().single();
    
    if (projectError) throw projectError;

    await supabase.from("companies").update({ 
      next_project_number: safeNum(company.next_project_number) + 1 
    }).eq("id", company.id);

    await supabase.from("quotes").update({ status: "Approved" }).eq("id", quote.id);
    return projectRef;
  };

  const convertToInvoice = async (projectId = null) => {
    if (!quote || !company) return;
    const invoiceNumber = `${company.invoice_number_prefix || "INV-"}${company.next_invoice_number || Date.now().toString().slice(-4)}`;
    
    const { data: invoiceRef, error: invoiceError } = await supabase.from("invoices").insert([{
      company_id: quote.company_id,
      client_id: quote.client_id,
      project_id: projectId,
      quote_id: quote.id,
      invoice_number: invoiceNumber,
      status: "Draft",
      issue_date: new Date().toISOString().split("T")[0],
      subtotal: safeNum(dynamicSubtotal),
      tax: safeNum(dynamicTax),
      total: safeNum(dynamicTotal),
      balance_due: safeNum(dynamicTotal),
      deposit_amount: safeNum(quote.deposit_amount),
      has_payment_schedule: Boolean(quote.has_payment_schedule)
    }]).select().single();

    if (invoiceError) throw invoiceError;

    await supabase.from("companies").update({ 
      next_invoice_number: safeNum(company.next_invoice_number) + 1 
    }).eq("id", company.id);

    const invoicePhasesMap = {};
    for (const phase of phases) {
      if (!isPhaseIncluded(phase)) continue; // Don't copy dropped phases to invoice
      const { data: newPhase } = await supabase.from("invoice_phases").insert([{
        company_id: quote.company_id,
        invoice_id: invoiceRef.id,
        phase_name: phase.phase_name,
        scope_of_work: phase.scope_of_work || "",
        sort_order: phase.sort_order || 0,
      }]).select().single();
      if (newPhase) invoicePhasesMap[phase.id] = newPhase.id;
    }

    const finalItems = items.filter(item => isItemIncluded(item) && invoicePhasesMap[item.phase_id]);
    if (finalItems.length > 0) {
      const itemsToInsert = finalItems.map((item) => ({
        company_id: quote.company_id,
        invoice_id: invoiceRef.id,
        phase_id: invoicePhasesMap[item.phase_id] || null,
        name: item.name,
        description: item.description || "",
        quantity: safeNum(item.quantity) || 1,
        unit: item.unit || "ea",
        unit_price: safeNum(item.unit_price) || 0,
        taxable: Boolean(item.taxable),
        line_total: safeNum(item.quantity) * safeNum(item.unit_price),
      }));
      await supabase.from("invoice_line_items").insert(itemsToInsert);
    }

    if (quote.has_payment_schedule && scheduleItems.length > 0) {
      const schedulesToInsert = scheduleItems.map((schedItem, idx) => ({
        company_id: quote.company_id,
        invoice_id: invoiceRef.id,
        payment_name: schedItem.payment_name,
        // Schedule values scale naturally with dynamic calculated total
        amount: schedItem.amount_type === "percentage" ? (dynamicTotal * safeNum(schedItem.percentage) / 100) : safeNum(schedItem.amount),
        due_event: schedItem.due_event || "",
        due_date: new Date().toISOString().split("T")[0],
        amount_paid: 0,
        status: "Pending",
        sort_order: schedItem.sort_order || idx,
      }));
      await supabase.from("invoice_payment_schedules").insert(schedulesToInsert);
    }

    await supabase.from("quotes").update({ status: "Approved" }).eq("id", quote.id);
    return invoiceRef;
  };

  const handleConvert = async (type) => {
    setConverting(true);
    try {
      if (type === "project") {
        const project = await convertToProject();
        toast.success("Quote converted to Project!");
        window.location.href = `/ProjectDetail?id=${project.id}`;
      } else if (type === "invoice") {
        const invoice = await convertToInvoice();
        toast.success("Quote converted to Invoice!");
        window.location.href = `/InvoiceBuilder?id=${invoice.id}`;
      } else if (type === "both") {
        const project = await convertToProject();
        const invoice = await convertToInvoice(project.id);
        toast.success("Quote converted to Project & Invoice!");
        window.location.href = `/ProjectDetail?id=${project.id}`;
      }
    } catch (error) {
      console.error("Conversion error:", error);
      toast.error("Failed to convert quote. Please try again.");
    } finally {
      setConverting(false);
      setConvertDialogOpen(false);
    }
  };

  // Track quote view
  useEffect(() => {
    if (quoteId && !tracked && quote) {
      setTracked(true);
      const trackView = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const viewer_type = session?.user ? 'internal' : 'client';
          
          await supabase.from("quote_views").insert([{
            company_id: quote.company_id,
            quote_id: quoteId,
            viewer_type,
            viewed_at: new Date().toISOString()
          }]);
        } catch (err) {
          console.error('Failed to track quote view:', err);
        }
      };
      trackView();
    }
  }, [quoteId, quote, tracked]);

  // NEW: Interactive State Checkers
  const isItemIncluded = (item) => {
    if (!item.is_optional) return true;
    if (localSelections[item.id] !== undefined) return localSelections[item.id];
    return item.default_selected === true;
  };

  const isPhaseIncluded = (phase) => {
    if (!phase.is_optional) return true;
    if (localSelections[phase.id] !== undefined) return localSelections[phase.id];
    return phase.default_selected === true;
  };

  // NEW: Interactive Toggles
  const handleTogglePhase = (phaseId) => {
    setLocalSelections(prev => ({
      ...prev,
      [phaseId]: !prev[phaseId]
    }));
  };

  const handleToggleItem = (itemId) => {
    setLocalSelections(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const calculatePhaseSubtotal = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseIncluded(phase)) return 0; 
    return items
      .filter(i => i.phase_id === phaseId && isItemIncluded(i)) 
      .reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
  };

  const calculatePhaseTax = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseIncluded(phase)) return 0; 
    const taxableAmount = items
      .filter(i => i.phase_id === phaseId && i.taxable && isItemIncluded(i))
      .reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
    return taxableAmount * GST_RATE;
  };

  const dynamicSubtotal = phases.reduce((sum, p) => sum + calculatePhaseSubtotal(p.id), 0);
  const dynamicTax = phases.reduce((sum, p) => sum + calculatePhaseTax(p.id), 0);
  const dynamicDiscount = quote?.discount_type === "percentage"
    ? ((dynamicSubtotal + dynamicTax) * safeNum(quote?.discount_percentage) / 100)
    : safeNum(quote?.discount_amount);
  const dynamicTotal = dynamicSubtotal + dynamicTax - dynamicDiscount;

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const { source, destination } = result;
    const phaseId = result.type;
    if (source.index === destination.index) return;

    const phaseItems = items.filter(i => i.phase_id === phaseId);
    const reorderedItems = Array.from(phaseItems);
    const [removed] = reorderedItems.splice(source.index, 1);
    reorderedItems.splice(destination.index, 0, removed);

    for (let i = 0; i < reorderedItems.length; i++) {
      updateOrderMutation.mutate({ itemId: reorderedItems[i].id, displayOrder: i });
    }
  };

  const downloadPDF = async () => {
    try {
      // Pass the screen totals so the printed PDF matches their layout configurations perfectly
      const screenQuoteOverride = { ...quote, subtotal: dynamicSubtotal, tax: dynamicTax, total: dynamicTotal, client_selected_items_json: JSON.stringify(localSelections) };
      await generateQuotePDF(screenQuoteOverride, client, phases.filter(isPhaseIncluded), items.filter(isItemIncluded), company);
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const getViewStats = () => {
    if (!quoteViews || quoteViews.length === 0) {
      return { totalViews: 0, lastViewedAt: null };
    }
    return { totalViews: quoteViews.length, lastViewedAt: quoteViews[0]?.viewed_at };
  };

  const handleAcceptQuote = async () => {
    try {
      // LOCK IN CLIENT SELECTIONS UPON APPROVAL
      const { error: approvalError } = await supabase.from("quotes").update({
        status: "Approved",
        subtotal: dynamicSubtotal,
        tax: dynamicTax,
        total: dynamicTotal,
        client_selected_items_json: JSON.stringify(localSelections)
      }).eq("id", quote.id);
      if (approvalError) throw approvalError;

      // Approval notifications are created atomically by the database trigger.
      toast.success("Quote accepted! The team has been notified.");
      queryClient.invalidateQueries(["quote", quoteId]);
    } catch (error) {
      console.error("Error accepting quote:", error);
      toast.error("Failed to accept quote");
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

  if (!quote) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-amber-50">
      <p className="text-slate-500">Loading quote...</p>
    </div>
  );

 return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50 pt-6 pb-12">
      
      {/* ANCHORED FLOATING BUTTON */}
      <div className="fixed top-20 right-4 md:right-8 z-50">
        <Button 
          onClick={() => window.location.href = `/QuoteBuilder?id=${quoteId}`}
          variant="outline" 
          className="shadow-lg bg-white/95 hover:bg-white text-slate-800 border-slate-300 backdrop-blur-sm transition-all"
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Builder
        </Button>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        
        {/* Hero Image */}
        {quote?.hero_image_url && (
          <div className="rounded-t-xl overflow-hidden mb-6">
            <img 
              src={quote.hero_image_url} 
              alt="Quote Hero" 
              className="w-full h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity" 
              onClick={() => openImageViewer(quote.hero_image_url)}
            />
          </div>
        )}

        <div className="py-8 px-4">
         {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="h-12 w-12 rounded-xl overflow-hidden shadow-lg bg-white p-1">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9a705be60b26da0074d9/c8248c068_PRO-TRADES3.png" 
                alt="Logo" 
                className="h-full w-full object-contain"
              />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-slate-900">{company?.name || "Pro-Trades"}</h1>
              <p className="text-xs text-slate-600">{company?.city || "Calgary"}</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Project Quote</h2>
          <p className="text-slate-600">Quote #{quote.quote_number}</p>
          {(() => {
            const { totalViews, lastViewedAt } = getViewStats();
            return (
              <div className="mt-3 text-xs text-slate-500">
                {totalViews === 0 ? (
                  <p>Not yet viewed</p>
                ) : (
                  <>
                    <p>Viewed {totalViews} time{totalViews !== 1 ? 's' : ''}</p>
                    {lastViewedAt && (
                      <p>Last viewed on {format(new Date(lastViewedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Quote Card */}
        <Card className="p-8 mb-6 bg-white shadow-xl">
          <div className="grid md:grid-cols-2 gap-6 mb-8 pb-6 border-b">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Quote For</p>
              <p className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-amber-600" />
                {client?.name || "N/A"}
              </p>
              {client?.billing_address && (
                <p className="text-sm text-slate-600 mt-1 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {client.billing_address}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Date Information</p>
              <div className="space-y-1">
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-600">Issued:</span>
                  <span className="font-semibold text-slate-900">
                    {quote.issue_date ? format(new Date(quote.issue_date), "MMM d, yyyy") : "N/A"}
                  </span>
                </div>
                {quote.expiry_date && (
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-slate-600">Expires:</span>
                    <span className="font-semibold text-slate-900">
                      {format(new Date(quote.expiry_date), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xl font-bold text-slate-900 mb-2">{quote.title}</h3>
            {quote.show_overall_scope && quote.overall_scope && (
              <p className="text-slate-600 text-sm whitespace-pre-wrap">{quote.overall_scope}</p>
            )}
          </div>

          {/* Phases */}
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="space-y-6 mb-8">
              {phases.map(phase => {
                const phaseItems = items.filter(i => i.phase_id === phase.id);
                const phaseIncluded = isPhaseIncluded(phase);
                const phaseSubtotal = calculatePhaseSubtotal(phase.id);
                const phaseTax = calculatePhaseTax(phase.id);
                const phaseTotal = phaseSubtotal + phaseTax;

                return (
                  <div key={phase.id} className={`border rounded-lg p-5 transition-all ${!phaseIncluded ? 'opacity-40 bg-slate-100/50 grayscale-[40%]' : phase.is_optional ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      {/* FIX: Interactive checkmark selector for optional phases */}
                      {phase.is_optional && quote.status !== "Approved" ? (
                        <input 
                          type="checkbox"
                          checked={phaseIncluded}
                          onChange={() => handleTogglePhase(phase.id)}
                          className="h-5 w-5 rounded border-amber-300 text-amber-500 focus:ring-amber-500 cursor-pointer"
                        />
                      ) : null}
                      <h4 className={`text-lg font-bold flex-1 ${phaseIncluded ? 'text-amber-600' : 'text-slate-400'}`}>{phase.phase_name}</h4>
                      {phase.is_optional && (
                        <span className={`text-xs border px-2 py-0.5 rounded-full font-medium ${phaseIncluded ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                          Optional {phaseIncluded ? '(Selected)' : '(Not Selected)'}
                        </span>
                      )}
                    </div>
                    {phase.scope_of_work && phase.show_scope_to_client !== false && (
                      <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap">{phase.scope_of_work}</p>
                    )}
                    
                    {phase.photos && phase.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {phase.photos.map((photo, idx) => (
                          <img 
                            key={idx} 
                            src={photo} 
                            alt="" 
                            className="h-20 w-20 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity" 
                            onClick={() => openImageViewer(photo)}
                          />
                        ))}
                      </div>
                    )}

                    <Droppable droppableId={phase.id} type={phase.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="space-y-2 mb-4"
                        >
                          {phaseItems.map((item, index) => {
                            const itemIncluded = isItemIncluded(item);
                            
                            return (
                              <Draggable key={item.id} draggableId={item.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className={`flex flex-col text-sm py-3 border-b border-slate-200 transition-all ${
                                        snapshot.isDragging ? "bg-white shadow-lg rounded-lg border-amber-300" : ""
                                     } ${(!itemIncluded || !phaseIncluded) ? 'opacity-40 grayscale-[50%]' : ''}`}
                                  >
                                     <div className="flex items-start gap-3">
                                      <div
                                        {...provided.dragHandleProps}
                                        className="text-slate-400 hover:text-amber-600 cursor-grab active:cursor-grabbing shrink-0 mt-1"
                                      >
                                        <GripVertical className="h-4 w-4" />
                                      </div>
                                      {/* FIX: Interactive checkmark selector for optional line items */}
                                      {item.is_optional && phaseIncluded && quote.status !== "Approved" ? (
                                        <input 
                                          type="checkbox"
                                          checked={itemIncluded}
                                          onChange={() => handleToggleItem(item.id)}
                                          className="h-4 w-4 mt-1 rounded border-amber-300 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                        />
                                      ) : null}
                                      {item.photo_url && (
                                        <img 
                                          src={item.photo_url} 
                                          alt={item.name} 
                                          className="hidden sm:block h-16 w-16 object-cover rounded border border-slate-300 shrink-0 cursor-pointer hover:opacity-80 transition-opacity" 
                                          onClick={() => openImageViewer(item.photo_url)}
                                        />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className={`font-medium ${itemIncluded && phaseIncluded ? 'text-slate-800' : 'text-slate-400'}`}>
                                          {item.name}
                                          {item.is_optional && (
                                            <span className={`ml-2 text-xs font-normal border px-1.5 py-0.5 rounded-full ${itemIncluded && phaseIncluded ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-slate-400 bg-slate-100 border-slate-200'}`}>
                                              Optional{itemIncluded && phaseIncluded ? ' ✓' : ' (Not Selected)'}
                                            </span>
                                          )}
                                        </p>
                                        {item.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>}
                                      </div>
                                     </div>
                                     <div className="flex justify-end items-center gap-4 mt-1 pl-7">
                                       <p className={`text-xs whitespace-nowrap ${(!itemIncluded || !phaseIncluded) ? 'line-through text-slate-300' : 'text-slate-500'}`}>{item.quantity} {item.unit} × ${(item.unit_price || 0).toFixed(2)}</p>
                                       <p className={`font-semibold whitespace-nowrap ${(!itemIncluded || !phaseIncluded) ? 'line-through text-slate-300' : 'text-slate-900'}`}>${((item.quantity || 1) * (item.unit_price || 0)).toFixed(2)}</p>
                                     </div>
                                  </div>
                                )}
                              </Draggable>
                            )
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>

                    <div className="flex justify-end">
                      <div className="space-y-1 text-right min-w-[150px]">
                        <div className="text-sm flex justify-between gap-4 text-slate-500">
                          <span>Subtotal:</span>
                          <span className="font-semibold text-slate-900">${phaseSubtotal.toFixed(2)}</span>
                        </div>
                        <div className="text-sm flex justify-between gap-4 text-slate-500">
                          <span>Tax (5%):</span>
                          <span className="font-semibold text-slate-900">${phaseTax.toFixed(2)}</span>
                        </div>
                        <div className="text-base font-bold text-amber-600 pt-1 border-t border-amber-200 flex justify-between gap-4">
                          <span>Total:</span>
                          <span>${phaseTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </DragDropContext>

          {/* Past Project Photos */}
          {quote.end_photos && quote.end_photos.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-semibold text-slate-800 mb-2">Similar Projects We've Completed</h4>
              <p className="text-sm text-slate-600 mb-4">Here are some examples of our past work</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {quote.end_photos.map((photo, idx) => (
                  <img 
                    key={idx} 
                    src={photo} 
                    alt="" 
                    className="w-full h-32 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer" 
                    onClick={() => openImageViewer(photo)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Grand Total Breakdown */}
          <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg p-6 border-2 border-slate-200 mb-6">
            <div className="space-y-3">
              <div className="flex justify-between text-lg">
                <span className="text-slate-700">Subtotal:</span>
                <span className="font-semibold text-slate-900">${dynamicSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg">
                <span className="text-slate-700">Tax (5%):</span>
                <span className="font-semibold text-slate-900">${dynamicTax.toFixed(2)}</span>
              </div>
              
              {/* Show discount if exists */}
              {dynamicDiscount > 0 && (
                <div className="flex justify-between text-lg text-green-700 pt-2 border-t border-slate-200">
                  <span className="font-medium">
                    Discount {quote.discount_type === "percentage" && `(${quote.discount_percentage}%)`}:
                  </span>
                  <span className="font-bold">-${dynamicDiscount.toFixed(2)}</span>
                </div>
              )}
              
              <div className="flex justify-between items-center pt-3 border-t-2 border-slate-300">
                <span className="text-xl font-bold text-slate-900">Total:</span>
                <span className="text-3xl font-bold text-amber-600">${dynamicTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Payment Schedule */}
          {quote.has_payment_schedule && scheduleItems.length > 0 && (
            <div className="mb-6">
              <h4 className="text-lg font-semibold text-slate-800 mb-3">Payment Schedule</h4>
              <div className="space-y-2">
                {scheduleItems.map((item, idx) => {
                  // Dynamically scale milestones if the client adjusts checkboxes
                  const milestoneAmt = item.amount_type === "percentage" ? (dynamicTotal * safeNum(item.percentage) / 100) : safeNum(item.amount);
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">{item.payment_name}</p>
                        {item.due_event && (
                          <p className="text-xs text-slate-500">Due: {item.due_event}</p>
                        )}
                      </div>
                      <p className="text-base font-bold text-slate-900">${milestoneAmt.toFixed(2)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attached Documents */}
          {quote.documents && quote.documents.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-semibold text-slate-800 mb-3">Attached Documents</h4>
              <div className="space-y-2">
                {quote.documents.map((doc, idx) => (
                  <a
                    key={idx}
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition-all group"
                  >
                    <FileText className="h-5 w-5 text-slate-600 group-hover:text-amber-600" />
                    <span className="text-sm text-slate-700 group-hover:text-amber-600 font-medium">{doc.file_name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Client Message & Terms */}
          {(quote.client_message || quote.terms) && (
            <div className="mt-8 pt-6 border-t space-y-4">
              {quote.client_message && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Message from Pro-Trades</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{quote.client_message}</p>
                </div>
              )}
              {quote.terms && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Terms & Conditions</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{quote.terms}</p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex justify-center gap-3 flex-wrap">
          <Button onClick={downloadPDF} variant="outline" className="shadow-md bg-white">
            <Download className="h-4 w-4 mr-2" /> Download PDF
          </Button>
          {quote.status !== "Approved" && (
            <>
              <Button onClick={handleAcceptQuote} className="bg-green-500 hover:bg-green-600 text-white shadow-lg font-medium">
                <CheckCircle className="h-4 w-4 mr-2" /> Accept & Sign Quote
              </Button>
              <Button onClick={() => setChangesDialogOpen(true)} variant="outline" className="shadow-md bg-white">
                <MessageSquare className="h-4 w-4 mr-2" /> Request Changes
              </Button>
            </>
          )}
          {quote.status !== "Approved" && (
            <Button onClick={() => setConvertDialogOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-white shadow-lg">
              <Zap className="h-4 w-4 mr-2" /> Convert Quote
            </Button>
          )}
        </div>

        {/* Request Changes Dialog */}
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
                <Button
                  onClick={() => setChangesDialogOpen(false)}
                  variant="outline"
                  disabled={submittingChanges}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRequestChanges}
                  disabled={submittingChanges}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {submittingChanges ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Convert Dialog */}
        <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Convert Quote to...</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-4">
              <Button
                onClick={() => handleConvert("project")}
                disabled={converting}
                className="w-full justify-start bg-slate-900 hover:bg-slate-800 text-white h-auto py-4 border-none shadow"
              >
                <FolderKanban className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Project Only</div>
                  <div className="text-xs text-slate-300">Create a new project from this quote</div>
                </div>
              </Button>
              
              <Button
                onClick={() => handleConvert("invoice")}
                disabled={converting}
                variant="outline"
                className="w-full justify-start h-auto py-4 border-2 shadow"
              >
                <Receipt className="h-5 w-5 mr-3 text-emerald-600" />
                <div className="text-left">
                  <div className="font-semibold text-slate-900">Invoice Only</div>
                  <div className="text-xs text-slate-500">Create an invoice from this quote</div>
                </div>
              </Button>
              
              <Button
                onClick={() => handleConvert("both")}
                disabled={converting}
                className="w-full justify-start bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white h-auto py-4 border-none shadow"
              >
                <Zap className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Project & Invoice</div>
                  <div className="text-xs text-amber-100">Create both project and invoice together</div>
                </div>
              </Button>

              {converting && (
                <p className="text-center text-sm text-slate-500 pt-2">Converting...</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <p className="text-center text-xs text-slate-500 mt-8">
          This quote is valid until {quote.expiry_date ? format(new Date(quote.expiry_date), "MMMM d, yyyy") : "the specified date"}
        </p>
        </div>
      </div>

      {/* Image Viewer Dialog */}
      <Dialog open={imageViewerOpen} onOpenChange={setImageViewerOpen}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden border-none bg-black/95">
          <div className="relative">
            <button
              onClick={() => setImageViewerOpen(false)}
              className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 backdrop-blur-sm transition-all"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img 
              src={viewerImageUrl} 
              alt="Full size view" 
              className="w-full h-auto max-h-[90vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}