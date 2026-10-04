import { getPublicProject } from "@/lib/publicProject";
import React, { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { Download, CheckCircle, Building2, Calendar, MapPin, MessageSquare, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { toast } from "sonner";
import { generateQuotePDF } from "../components/pdf/PDFGenerator";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";

const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);

export default function PublicChangeOrderView() {
  const params = new URLSearchParams(window.location.search);
  const changeOrderId = params.get("id") || window.location.pathname.split("/").pop();
  
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);
  const [changesMessage, setChangesMessage] = useState("");
  const [submittingChanges, setSubmittingChanges] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [viewerImageUrl, setViewerImageUrl] = useState("");
  
  const [localSelections, setLocalSelections] = useState({});
  const queryClient = useQueryClient();

  const openImageViewer = (imageUrl) => {
    setViewerImageUrl(imageUrl);
    setImageViewerOpen(true);
  };

  // --- 1. DATA FETCHING ---
  const { data: changeOrder, isLoading: coLoading } = useQuery({
    queryKey: ["public-co", changeOrderId],
    queryFn: async () => {
      // ❌ Change .single() to .maybeSingle()
      const { data, error } = await supabase.from("change_orders").select("*").eq("id", changeOrderId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!changeOrderId,
  });

  const { data: client } = useQuery({
    queryKey: ["client", changeOrder?.project_id, changeOrder?.client_id],
    queryFn: async () => {
      let clientId = changeOrder?.client_id;
      
      // 1. If direct client_id is missing, fetch it from the linked project
      if (!clientId && changeOrder?.project_id) {
        const { project: proj } = await getPublicProject("change_order", changeOrderId);
        clientId = proj?.client_id;
      }

      if (!clientId) return null;

      // 2. Fetch the client using the resolved ID
      const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).single();
      if (error && error.code !== 'PGRST116') throw error;
      
      // 3. Format the name perfectly
      if (data) {
        data.formatted_name = data.name || `${data.first_name || ''} ${data.surname || ''}`.trim() || "Unknown Client";
      }
      return data;
    },
    // The query will run as long as there is either a client_id OR a project_id attached
    enabled: !!(changeOrder?.client_id || changeOrder?.project_id),
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["public-co-phases", changeOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("change_order_phases").select("*").eq("change_order_id", changeOrderId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!changeOrderId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["public-co-items", changeOrderId],
    queryFn: async () => {
      // ⚡ BUG FIXED: Now properly querying change_order_line_items
      const { data, error } = await supabase.from("change_order_line_items").select("*").eq("change_order_id", changeOrderId).order("display_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!changeOrderId,
  });

  const { data: company } = useQuery({
    queryKey: ["public-company", changeOrder?.company_id],
    queryFn: async () => {
      if (!changeOrder?.company_id) return null;
      const { data, error } = await supabase.from("companies").select("*").eq("id", changeOrder.company_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!changeOrder?.company_id,
  });

  // --- 2. BRANDING & DUAL TAX SETTINGS ---
  const settings = company?.settings || {};
  const brandColor = settings?.pdf?.brand_color || '#f59e0b';
  const logoUrl = company?.logo_url || company?.company_logo_url;
  
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  
  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

  // --- 3. INITIALIZE LOCAL SELECTIONS ---
  useEffect(() => {
    if (changeOrder && phases.length > 0 && items.length > 0) {
      let initialMap = {};
      if (changeOrder.client_selected_items_json) {
        try { initialMap = JSON.parse(changeOrder.client_selected_items_json); } catch (e) { }
      } else {
        phases.forEach(p => { if (p.is_optional) initialMap[p.id] = p.default_selected === true; });
        items.forEach(i => { if (i.is_optional) initialMap[i.id] = i.default_selected === true; });
      }
      setLocalSelections(initialMap);
    }
  }, [changeOrder, phases, items]);

  // --- 4. ⚡ VIEW TRACKER LOCK ---
  const notificationFired = useRef(false);

  useEffect(() => {
    const activeCompanyId = company?.id || changeOrder?.company_id;
    
    if (!changeOrder?.id || !activeCompanyId) return;
    if (changeOrder?.client_id && client === undefined) return;
    if (notificationFired.current) return;

    const clientName = client?.name || changeOrder?.client_name || "A client";

    const notifyTeam = async () => {
      notificationFired.current = true; 
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const viewer_type = session?.user ? 'internal' : 'client';
        
        // ⚡ TEMPORARILY REMOVED THE IF STATEMENT SO IT ALWAYS FIRES
        await supabase.functions.invoke('company-notifier', {
          body: {
            event_key: "co_viewed",
            document_uuid: changeOrder.id,
            document_id: changeOrder.change_order_number || "CO",
            company_id: activeCompanyId, 
            message_body: `${clientName} just viewed Change Order ${changeOrder.change_order_number || ''}`
          }
        });
        
      } catch (error) {
        console.error("Silent notification failed:", error);
        notificationFired.current = false; 
      }
    };
    
    notifyTeam();
  }, [changeOrder?.id, company?.id, changeOrder?.company_id, client, changeOrder?.client_id]);

  // --- 5. MATH & TOGGLES ---
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

  const handleTogglePhase = (phaseId) => setLocalSelections(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  const handleToggleItem = (itemId) => setLocalSelections(prev => ({ ...prev, [itemId]: !prev[itemId] }));

  const calculatePhaseSubtotal = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseIncluded(phase)) return 0; 
    return items.filter(i => i.phase_id === phaseId && isItemIncluded(i)).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
  };

  const calculatePhaseTaxableAmount = (phaseId) => {
    const phase = phases.find(p => p.id === phaseId);
    if (phase && !isPhaseIncluded(phase)) return 0; 
    return items.filter(i => i.phase_id === phaseId && i.taxable && isItemIncluded(i)).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0);
  };

  const dynamicSubtotal = phases.reduce((sum, p) => sum + calculatePhaseSubtotal(p.id), 0);
  const dynamicTaxable = phases.reduce((sum, p) => sum + calculatePhaseTaxableAmount(p.id), 0);
  const dynamicPrimaryTax = dynamicTaxable * primaryTaxRate;
  const dynamicSecondaryTax = dynamicTaxable * secondaryTaxRate;
  const dynamicTotalTax = dynamicPrimaryTax + dynamicSecondaryTax;
  const dynamicTotal = dynamicSubtotal + dynamicTotalTax;

  // --- 6. ACTIONS ---
  const downloadPDF = async () => {
    try {
      const screenOverride = { 
        ...changeOrder, 
        hero_image_url: null, 
        subtotal: dynamicSubtotal, 
        tax: dynamicTotalTax, 
        total: dynamicTotal, 
        client_selected_items_json: JSON.stringify(localSelections) 
      };
      await generateQuotePDF(screenOverride, client, phases.filter(isPhaseIncluded), items.filter(isItemIncluded), company);
    } catch (error) { toast.error("Failed to generate PDF"); }
  };

  const handleAcceptChangeOrder = async () => {
    setIsApproving(true);
    try {
      // 1. Properly capture the 'error' object from Supabase
      const { error: updateError } = await supabase.from("change_orders").update({ 
        status: "Approved", 
        subtotal: dynamicSubtotal, 
        tax: dynamicTotalTax, 
        total: dynamicTotal, 
        client_selected_items_json: JSON.stringify(localSelections),
      }).eq("id", changeOrder.id);

      // 2. If Supabase rejects it (400 Bad Request), throw it so we can see why
      if (updateError) {
        console.error("SUPABASE UPDATE ERROR:", updateError);
        throw updateError;
      }

      // Trigger Edge Function Email/SMS for Approvals
      try {
        const clientName = client?.name || changeOrder?.client_name || "A client";
        const activeCompanyId = company?.id || changeOrder?.company_id;

        await supabase.functions.invoke('company-notifier', {
          body: { 
            event_key: "co_approved", 
            document_uuid: changeOrder.id,
            document_id: changeOrder.change_order_number,
            company_id: activeCompanyId, 
            message_body: `🎉 ${clientName} just APPROVED Change Order ${changeOrder.change_order_number}!`
          }
        });
      } catch (emailError) {
        console.error("Approval notification failed:", emailError);
      }

      toast.success("Change Order accepted! The team has been notified.");
      queryClient.invalidateQueries(["public-co", changeOrderId]);
    } catch (error) { 
      // 3. Show the exact database message in the toast for easy debugging
      toast.error(`Failed to accept: ${error.message || "Database error"}`); 
    } finally {
      setIsApproving(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!changesMessage.trim()) { toast.error("Please describe the changes you'd like to request"); return; }
    setSubmittingChanges(true);
    try {
      const { error } = await supabase.functions.invoke('company-notifier', {
        body: { event_key: 'change_order_requested', document_uuid: changeOrder.id, document_id: changeOrder.id,
          company_id: changeOrder.company_id, message_body: changesMessage.trim().slice(0, 2000) }
      });
      if (error) throw error;
      toast.success("Change request submitted. The team has been notified.");
      setChangesDialogOpen(false); setChangesMessage("");
    } catch (error) { toast.error("Could not submit the change request. Please retry."); }
    finally { setSubmittingChanges(false); }
  };

  // --- 7. RENDER ---
  if (coLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500">Loading Change Order...</p>
    </div>
  );
  
  if (!changeOrder) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500">Change Order not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* Hero Image */}
        {changeOrder?.hero_image_url && (
          <div className="rounded-t-xl overflow-hidden mb-6 mt-6">
            <img 
              src={changeOrder.hero_image_url} 
              alt="Change Order Hero" 
              className="w-full h-64 object-cover cursor-zoom-in hover:opacity-90 transition-opacity shadow-sm" 
              onClick={() => openImageViewer(changeOrder.hero_image_url)}
            />
          </div>
        )}

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

          <h2 className="text-2xl font-bold text-slate-900 mt-10 mb-2">Change Order</h2>
          <p className="text-slate-600 font-medium">CO #{changeOrder.change_order_number}</p>
        </div>

        {/* Info Card */}
        <Card className="p-4 sm:p-8 mb-6 bg-white shadow-xl border-slate-200">
          <div className="grid md:grid-cols-2 gap-6 mb-8 pb-6 border-b border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Change Order For</p>
              <p className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Building2 className="h-5 w-5" style={{ color: brandColor }} />
                {client?.formatted_name || "Client Name Not Provided"}
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
                    {changeOrder.issue_date ? format(new Date(changeOrder.issue_date), "MMM d, yyyy") : "N/A"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xl font-black text-slate-900 mb-2 break-words">{changeOrder.title}</h3>
            {changeOrder.show_overall_scope && changeOrder.overall_scope && (
              <p className="text-slate-600 text-sm whitespace-pre-wrap font-medium leading-relaxed break-words">{changeOrder.overall_scope}</p>
            )}
          </div>

          {/* Phases */}
          <div className="space-y-6 mb-8">
            {phases.map(phase => {
              const phaseItems = items.filter(i => i.phase_id === phase.id);
              const phaseIncluded = isPhaseIncluded(phase);
              
              const phaseSubtotal = calculatePhaseSubtotal(phase.id);
              const phaseTaxable = calculatePhaseTaxableAmount(phase.id);
              const phasePrimaryTax = phaseTaxable * primaryTaxRate;
              const phaseSecondaryTax = phaseTaxable * secondaryTaxRate;
              const phaseTotal = phaseSubtotal + phasePrimaryTax + phaseSecondaryTax;

              return (
                <div key={phase.id} className={`border rounded-lg p-4 sm:p-5 transition-all ${!phaseIncluded ? 'opacity-40 bg-slate-100/50 grayscale-[40%]' : 'border-slate-200 bg-slate-50/50'}`} style={phase.is_optional && phaseIncluded ? { borderColor: brandColor, backgroundColor: `${brandColor}10` } : {}}>
                  <div className="flex items-center gap-3 mb-3">
                    {phase.is_optional && changeOrder.status !== "Approved" && changeOrder.status !== "Invoiced" && (
                      <input 
                        type="checkbox"
                        checked={phaseIncluded}
                        onChange={() => handleTogglePhase(phase.id)}
                        className="h-5 w-5 rounded cursor-pointer"
                        style={{ accentColor: brandColor }}
                      />
                    )}
                    <h4 className={`text-lg font-black flex-1`} style={{ color: phaseIncluded ? brandColor : '#94a3b8' }}>
                      {phase.phase_name}
                    </h4>
                    {phase.is_optional && (
                      <span className={`text-xs border px-2 py-0.5 rounded-full font-bold ${phaseIncluded ? '' : 'bg-slate-200 text-slate-500 border-slate-300'}`} style={phaseIncluded ? { backgroundColor: `${brandColor}20`, color: brandColor, borderColor: brandColor } : {}}>
                        Optional {phaseIncluded ? '(Selected)' : '(Not Selected)'}
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
                          <img src={photo} alt="" onClick={() => openImageViewer(photo)} className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-125" />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 mb-4">
                    {phaseItems.map((item, index) => {
                      const itemIncluded = isItemIncluded(item);
                      return (
                        <div key={item.id} className={`flex flex-col text-sm py-3 border-b border-slate-200 transition-all ${(!itemIncluded || !phaseIncluded) ? 'opacity-40 grayscale-[50%]' : ''}`}>
                            <div className="flex items-start gap-3">
                            {item.is_optional && phaseIncluded && changeOrder.status !== "Approved" && changeOrder.status !== "Invoiced" && (
                              <input 
                                type="checkbox"
                                checked={itemIncluded}
                                onChange={() => handleToggleItem(item.id)}
                                className="h-4 w-4 mt-1 rounded cursor-pointer shrink-0"
                                style={{ accentColor: brandColor }}
                              />
                            )}
                            {item.photo_url && (
                              <div className="hidden sm:block shrink-0 overflow-hidden rounded border border-slate-300 h-16 w-16">
                                <img src={item.photo_url} alt={item.name} onClick={() => openImageViewer(item.photo_url)} className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-125" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`font-bold ${itemIncluded && phaseIncluded ? 'text-slate-900' : 'text-slate-400'}`}>
                                {item.name}
                                {item.is_optional && (
                                  <span className={`ml-2 text-xs font-medium border px-1.5 py-0.5 rounded-full ${itemIncluded && phaseIncluded ? '' : 'text-slate-400 bg-slate-100 border-slate-200'}`} style={itemIncluded && phaseIncluded ? { color: brandColor, backgroundColor: `${brandColor}10`, borderColor: brandColor } : {}}>
                                    Optional{itemIncluded && phaseIncluded ? ' ✓' : ' (Not Selected)'}
                                  </span>
                                )}
                              </p>
                              {item.description && <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed whitespace-pre-wrap break-words">{item.description}</p>}
                            </div>
                            </div>
                            <div className="flex justify-end items-center gap-4 mt-2 pt-1 pl-7">
                              <p className={`text-xs font-medium whitespace-nowrap ${(!itemIncluded || !phaseIncluded) ? 'line-through text-slate-300' : 'text-slate-500'}`}>{item.quantity} {item.unit || ''} × {formatCurrencyUSD(item.unit_price)}</p>
                              <p className={`font-black whitespace-nowrap ${(!itemIncluded || !phaseIncluded) ? 'line-through text-slate-300' : 'text-slate-900'}`}>{formatCurrencyUSD(item.quantity * item.unit_price)}</p>
                            </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex justify-end">
                    <div className="space-y-1 text-right min-w-[170px]">
                      <div className="text-sm flex justify-between gap-4 text-slate-500 font-medium">
                        <span>Subtotal:</span>
                        <span className="font-bold text-slate-900">{formatCurrencyUSD(phaseSubtotal)}</span>
                      </div>
                      <div className="text-sm flex justify-between gap-4 text-slate-500 font-medium">
                        <span>{settings?.tax_label || "Tax"}:</span>
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

          {/* Past Project Photos */}
          {changeOrder.end_photos && changeOrder.end_photos.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-black text-slate-900 mb-1">Reference Photos</h4>
              <p className="text-sm font-medium text-slate-500 mb-4">Here are some examples of our past work</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {changeOrder.end_photos.map((photo, idx) => (
                  <img key={idx} src={photo} alt="" onClick={() => openImageViewer(photo)} className="w-full h-32 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-zoom-in" />
                ))}
              </div>
            </div>
          )}

          {/* Grand Total Breakdown */}
          <div className="rounded-xl p-4 sm:p-6 border-2 shadow-sm mb-6" style={{ backgroundColor: `${brandColor}05`, borderColor: `${brandColor}30` }}>
            <div className="space-y-3">
              <div className="flex justify-between text-lg font-medium">
                <span className="text-slate-700">Subtotal:</span>
                <span className="font-bold text-slate-900">{formatCurrencyUSD(dynamicSubtotal)}</span>
              </div>
              <div className="flex justify-between text-lg font-medium">
                <span className="text-slate-700">{settings?.tax_label || "Tax"}:</span>
                <span className="font-bold text-slate-900">{formatCurrencyUSD(dynamicPrimaryTax)}</span>
              </div>
              {settings?.enable_secondary_tax && (
                <div className="flex justify-between text-lg font-medium">
                  <span className="text-slate-700">{settings?.secondary_tax_label || "PST"}:</span>
                  <span className="font-bold text-slate-900">{formatCurrencyUSD(dynamicSecondaryTax)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-4 border-t-2 mt-2" style={{ borderColor: `${brandColor}40` }}>
                <span className="text-xl font-black text-slate-900">Total Change:</span>
                <span className="text-3xl font-black" style={{ color: brandColor }}>{formatCurrencyUSD(dynamicTotal)}</span>
              </div>
            </div>
          </div>

          {/* Attached Documents */}
          {changeOrder.documents && changeOrder.documents.length > 0 && (
            <div className="mb-8">
              <h4 className="text-lg font-black text-slate-900 mb-3">Attached Documents</h4>
              <div className="space-y-2">
                {changeOrder.documents.map((doc, idx) => (
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

          {/* Client Message & Terms */}
          {(changeOrder.client_message || changeOrder.terms) && (
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-6">
              {changeOrder.client_message && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Message from the Team</p>
                  <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed break-words">{changeOrder.client_message}</p>
                </div>
              )}
              {changeOrder.terms && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Terms & Conditions</p>
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap leading-relaxed break-words">{changeOrder.terms}</p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex justify-center gap-3 flex-wrap">
          <Button onClick={downloadPDF} variant="outline" className="shadow-sm bg-white font-bold h-11">
            <Download className="h-4 w-4 mr-2 text-slate-500" /> Download PDF
          </Button>
          
          {changeOrder.status !== "Approved" && changeOrder.status !== "Invoiced" && (
            <>
              <Button onClick={handleAcceptChangeOrder} disabled={isApproving} className="shadow-lg font-black h-11 px-8" style={{ backgroundColor: brandColor, color: '#fff' }}>
                {isApproving ? "Processing..." : <><CheckCircle className="h-4 w-4 mr-2" /> Accept Change Order</>}
              </Button>
              <Button onClick={() => setChangesDialogOpen(true)} variant="outline" className="shadow-sm bg-white font-bold h-11">
                <MessageSquare className="h-4 w-4 mr-2 text-slate-500" /> Request Changes
              </Button>
            </>
          )}
        </div>

        {/* ⚡ NEW GREEN APPROVED BOX */}
        {(changeOrder.status === "Approved" || changeOrder.status === "Invoiced") && (
          <div className="mt-8 mx-auto max-w-md bg-emerald-50 border-2 border-emerald-500 rounded-xl p-4 flex items-center justify-center gap-3 shadow-md animate-in fade-in zoom-in duration-300">
            <CheckCircle className="h-6 w-6 text-emerald-600" />
            <span className="text-emerald-800 font-black text-lg">Change Order Approved!</span>
          </div>
        )}

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
                <Button onClick={() => setChangesDialogOpen(false)} variant="outline" disabled={submittingChanges} className="flex-1 font-bold">Cancel</Button>
                <Button onClick={handleRequestChanges} disabled={submittingChanges} className="flex-1 text-white font-bold" style={{ backgroundColor: brandColor }}>
                  {submittingChanges ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Image Viewer Dialog */}
      <Dialog open={imageViewerOpen} onOpenChange={setImageViewerOpen}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden border-none bg-black/95">
          <div className="relative">
            <button onClick={() => setImageViewerOpen(false)} className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 backdrop-blur-sm transition-all">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img src={viewerImageUrl} alt="Full size view" className="w-full h-auto max-h-[90vh] object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}