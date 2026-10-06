Warning: truncated output (original token count: 32494)
Total output lines: 2269

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Save, Send, CheckCircle, FolderKanban, Image, Upload, Eye, Mail, Download, Copy, UserPlus, FileText, Settings, Menu, Zap, Receipt, BookOpen, Search, Smartphone, Archive, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import CreateClientDialog from "../components/quotes/CreateClientDialog";
import PhaseCard from "../components/quotes/PhaseCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatusBadge from "../components/shared/StatusBadge";
import QuoteBuilderSidebar from "../components/quotes/QuoteBuilderSidebar";
import { format } from "date-fns";
import { toast } from "sonner";
import { usePhaseFunctions } from "../components/quotes/usePhaseManagement";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import AddressAutocomplete from "../components/shared/AddressAutocomplete";
import SendQuoteEmailDialog from "../components/quotes/SendQuoteEmailDialog";
import SendQuoteTextDialog from "../components/quotes/SendQuoteTextDialog";
import { useDocumentChanges, useDocumentState } from "@/hooks/useDocumentChanges";
import UnsavedChangesGuard from "@/components/shared/UnsavedChangesGuard";
import { issueQuoteShareToken } from "@/lib/quoteSharing";

const safeNum = (val) => {
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

export default function QuoteBuilder() {
  const navigate = useNavigate();

  const { isDirty, markDirty, markSaved, getRevision, hasUnsavedChanges } = useDocumentChanges();

  const handleSafeNavigate = (pathOrDelta) => navigate(pathOrDelta);

  // 1. PULL IN CUSTOM SETTINGS
  const { profile, settings } = useAuth();
  const companyId = profile?.company_id;

  const params = new URLSearchParams(window.location.search);
  const [quoteId, setQuoteId] = useState(params.get("id"));
  const leadId = params.get("lead_id");
  const clientId = params.get("client_id");
  const templateId = params.get("templateId");
  const isTemplate = params.get("is_template") === "true";
  const queryClient = useQueryClient();

  const [form, setForm, hydrateForm] = useDocumentState({
    title: "", client_id: clientId || "", lead_id: leadId || "",
    status: "Draft", issue_date: format(new Date(), "yyyy-MM-dd"),
    expiry_date: "", next_follow_up_date: "", notes: "",
    internal_review_status: null, internal_reviewed_at: null, internal_reviewed_by: null,
    client_message: settings?.quote_client_message || "", 
    terms: settings?.default_terms || "",                 
    overall_scope: settings?.quote_intro || "",           
    show_overall_scope: true, 
    deposit_amount: 0, discount_amount: 0, discount_type: "fixed", discount_percentage: 0, show_discount_amount: false, has_payment_schedule: false, hero_image_url: "", end_photos: [], documents: [],
    margin: 0, margin_adjustment_type: "none", site_address: "", quote_number: "", is_archived: false
  }, markDirty);
  
  const [localTitle, setLocalTitle, hydrateLocalTitle] = useDocumentState("", markDirty);
  const [localOverallScope, setLocalOverallScope, hydrateLocalOverallScope] = useDocumentState(settings?.quote_intro || "", markDirty);
  const [localClientMessage, setLocalClientMessage, hydrateLocalClientMessage] = useDocumentState(settings?.quote_client_message || "", markDirty);
  const [localTerms, setLocalTerms, hydrateLocalTerms] = useDocumentState(settings?.default_terms || "", markDirty);
  const [localNotes, setLocalNotes, hydrateLocalNotes] = useDocumentState("", markDirty);

  const [phases, setPhases, hydratePhases] = useDocumentState([], markDirty);
  const [paymentScheduleItems, setPaymentScheduleItems, hydratePaymentScheduleItems] = useDocumentState([], markDirty);
  const [saving, setSaving] = useState(false);
  const hasLoadedPhases = useRef(false);
  const hydratedQuoteId = useRef(null);
  const hydratedTemplateId = useRef(null);
  const hasLoadedSchedule = useRef(false);
  const saveInFlight = useRef(false);
  const pendingCounterUpdate = useRef(null);
  
  // 2. TRACK MANUAL DEPOSIT EDITS
  const [manualDeposit, setManualDeposit] = useState(false);

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showImportQuoteTemplateDialog, setShowImportQuoteTemplateDialog] = useState(false);
  
  const [showSavePhaseTemplateDialog, setShowSavePhaseTemplateDialog] = useState(false);
  const [phaseIndexToSave, setPhaseIndexToSave] = useState(null); 
  const [phaseTemplateForm, setPhaseTemplateForm] = useState({ template_name: "", description: "" });

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [emailDialog, setEmailDialog] = useState(false);
  const [sendMethod, setSendMethod] = useState("email");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ payment_name: "", due_event: "", amount: 0, amount_type: "fixed", percentage: 0 });
  const [editingPaymentIndex, setEditingPaymentIndex] = useState(null);
  
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  
  const [pdfSettings, , hydratePdfSettings] = useDocumentState({
    template: "professional", primary_color: "#0f172a", accent_color: "#f59e0b", header_background_color: "#0f172a",
    header_text_color: "#ffffff", footer_text: "", footer_color: "#64748b", show_logo: true, show_company_info: true,
    show_payment_terms: true, font_family: "sans-serif", font_size_base: 11, page_layout: "single-column",
    page_margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 }, line_spacing: 1.5, show_line_item_images: false,
    highlight_totals: true, item_border_style: "light"
  }, markDirty);

  const [showResourceDialog, setShowResourceDialog] = useState(false);
  const [resourceSearch, setResourceSearch] = useState("");

  useEffect(() => {
    const closeMenus = (e) => {
      if (!e.target.closest('.actions-menu-container')) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  // --- QUERIES ---
  const { data: company } = useQuery({ 
    queryKey: ["company", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("companies").select("*").eq("id", companyId).single(); return data || null; } 
  });
  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("clients").select("*").eq("company_id", companyId); return data || []; } 
  });
  const { data: products = [] } = useQuery({ 
    queryKey: ["products", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("products").select("*").eq("company_id", companyId); return data || []; } 
  });
  const { data: phaseTemplates = [] } = useQuery({ 
    queryKey: ["phase-templates", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("phase_templates").select("*").eq("company_id", companyId).eq("is_active", true); return data || []; } 
  });
  const { data: quoteTemplates = [], isFetched: quoteTemplatesFetched, error: quoteTemplatesLoadError } = useQuery({
    queryKey: ["quote-templates-list", companyId], enabled: !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quotes").select("*").eq("company_id", companyId).eq("is_template", true); if (error) throw error; return data || []; }
  });
  const { data: companyResources = [], isLoading: loadingResources } = useQuery({ 
    queryKey: ["company_resources", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("company_resources").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error; return data || [];
    } 
  });
  const { data: existingQuote, error: quoteLoadError } = useQuery({
    queryKey: ["quote", quoteId], enabled: !!quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).eq("company_id", companyId).single(); if (error) throw error; return data; },
  });
  const { data: existingPhases = [], isFetched: phasesFetched, error: phasesLoadError } = useQuery({
    queryKey: ["quote-phases", quoteId], enabled: !!quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_phases").select("*").eq("quote_id", quoteId).eq("company_id", companyId).order("sort_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: existingItems = [], isFetched: itemsFetched, error: itemsLoadError } = useQuery({
    queryKey: ["quote-items", quoteId], enabled: !!quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).eq("company_id", companyId).order("display_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: existingScheduleItems = [], isFetched: scheduleFetched, error: scheduleLoadError } = useQuery({
    queryKey: ["quote-schedule-items", quoteId], enabled: !!quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", quoteId).eq("company_id", companyId).order("sort_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: templatePhases = [], isFetched: templatePhasesFetched, error: templatePhasesLoadError } = useQuery({
    queryKey: ["template-phases", templateId], enabled: !!templateId && !quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_phases").select("*").eq("quote_id", templateId).eq("company_id", companyId).order("sort_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: templateItems = [], isFetched: templateItemsFetched, error: templateItemsLoadError } = useQuery({
    queryKey: ["template-items", templateId], enabled: !!templateId && !quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_line_items").select("*").eq("quote_id", templateId).eq("company_id", companyId).order("display_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: templateScheduleItems = [], isFetched: templateScheduleFetched, error: templateScheduleLoadError } = useQuery({
    queryKey: ["template-schedule-items", templateId], enabled: !!templateId && !quoteId && !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", templateId).eq("company_id", companyId).order("sort_order", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: clientAttachments = [] } = useQuery({
    queryKey: ["client-attachments", form.client_id], enabled: !!form.client_id,
    queryFn: async () => { const { data } = await supabase.from("attachments").select("*").eq("related_type", "Client").eq("related_id", form.client_id); return data || []; },
  });
  const { data: creatorProfile } = useQuery({
    queryKey: ["creatorProfile", existingQuote?.user_id],
    enabled: !!existingQuote?.user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", existingQuote.user_id)
        .single();
      return data;
    }
  });

  const { data: leads = [] } = useQuery({ 
    queryKey: ["leads", companyId], enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("leads").select("*").eq("company_id", companyId); 
      return data || []; 
    } 
  });

  const savePhaseTemplateMutation = useMutation({
    mutationFn: async (data) => {
      // 1. Check if a template with this exact name already exists for this company
      const { data: existingTemplate, error: searchError } = await supabase
        .from("phase_templates")
        .select("id")
        .eq("company_id", companyId)
        .eq("template_name", data.template_name)
        .maybeSingle(); // maybeSingle prevents C error from being thrown if no rows are found

      if (searchError) throw searchError;

      if (existingTemplate) {
        // 2. If it exists, UPDATE the existing record
        const { error: updateError } = await supabase
          .from("phase_templates")
          .update(data)
          .eq("id", existingTemplate.id);
        
        if (updateError) throw updateError;
      } else {
        // 3. If it does not exist, INSERT a new record
        const { error: insertError } = await supabase
          .from("phase_templates")
          .insert([{ ...data, company_id: companyId }]);
          
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phase-templates"] });
      setShowSavePhaseTemplateDialog(false);
      setPhaseIndexToSave(null);
      toast.success("Phase template saved successfully!");
    }
  });

  const handleSavePhaseAsTemplate = () => {
    if (!phaseTemplateForm.template_name || phaseIndexToSave === null) return;
    const phaseToSave = phases[phaseIndexToSave];
    if (!phaseToSave) return;
    
    const cleanItems = (phaseToSave.items || []).map((item, idx) => ({
      name: item.name || "", description: item.description || "",
      quantity: item.quantity || 1, unit: item.unit || "ea",
      unit_cost: item.unit_cost || 0, unit_price: item.unit_price || 0,
      material_cost: item.material_cost || 0, labor_cost: item.labor_cost || 0, // ⚡ Added
      taxable: item.taxable !== false, product_id: item.product_id || "",
      photo_url: item.photo_url || "", is_optional: item.is_optional === true,
      default_selected: item.default_selected === true, 
      is_material: item.is_material === true,
      supplier: item.supplier || null,
      display_order: idx
    }));

    savePhaseTemplateMutation.mutate({
      template_name: phaseTemplateForm.template_name,
      description: phaseTemplateForm.description || "",
      phase_name: phaseToSave.phase_name,
      scope_of_work: phaseToSave.scope_of_work || "",
      line_items_json: JSON.stringify(cleanItems),
      is_active: true
    });
  };

  useEffect(() => {
    if (existingQuote && hydratedQuoteId.current !== existingQuote.id) {
      hydratedQuoteId.current = existingQuote.id;
      hydrateLocalTitle(existingQuote.title || "");
      hydrateLocalOverallScope(existingQuote.overall_scope || "");
      hydrateLocalClientMessage(existingQuote.client_message || "");
      hydrateLocalTerms(existingQuote.terms || "");
      hydrateLocalNotes(existingQuote.notes || "");
      setManualDeposit(true); // Don't auto-override an existing quote's deposit
      hydrateForm({
        title: existingQuote.title || "", client_id: existingQuote.client_id || "", lead_id: existingQuote.lead_id || "", 
        status: existingQuote.status || (isTemplate ? "Template" : "Draft"),
        issue_date: existingQuote.issue_date || format(new Date(), "yyyy-MM-dd"), 
        expiry_date: existingQuote.expiry_date || "",
        next_follow_up_date: existingQuote.next_follow_up_date || "",
        internal_review_status: existingQuote.internal_review_status || null,
        internal_reviewed_at: existingQuote.internal_reviewed_at || null,
        internal_reviewed_by: existingQuote.internal_reviewed_by || null,
        notes: existingQuote.notes || "", client_message: existingQuote.client_message || "", terms: existingQuote.terms || "", 
        overall_scope: existingQuote.overall_scope || "", show_overall_scope: existingQuote.show_overall_scope !== false,
        deposit_amount: existingQuote.deposit_amount || 0, discount_amount: existingQuote.discount_amount || 0,
        discount_type: existingQuote.discount_type || "fixed", discount_percentage: existingQuote.discount_percentage || 0,
        has_payment_schedule: existingQuote.has_payment_schedule || false,
        show_discount_amount: Boolean(existingQuote.show_discount_amount),
        hero_image_url: existingQuote.hero_image_url || "", end_photos: existingQuote.end_photos || [], documents: existingQuote.documents || [],
        
        // 👇 ADD IT AT THE END OF THIS LIST 👇
        margin: existingQuote.margin ?? 0, margin_adjustment_type: existingQuote.margin_adjustment_type || "none",
        site_address: existingQuote.site_address || "", quote_number: existingQuote.quote_number || "",
        is_archived: Boolean(existingQuote.is_archived) 
      });
      if (existingQuote.pdf_customization_settings_json) {
        try { hydratePdfSettings(JSON.parse(existingQuote.pdf_customization_settings_json)); } catch (e) {}
      }
    } else if (templateId && !quoteId && hydratedTemplateId.current !== templateId) {
      const template = quoteTemplates.find(t => t.id === templateId);
      if (template) {
        hydratedTemplateId.current = templateId;
        hydrateLocalTitle(template.title || ""); hydrateLocalOverallScope(template.overall_scope || "");
        hydrateLocalClientMessage(template.client_message || ""); hydrateLocalTerms(template.terms || "");
        hydrateForm(prev => ({
          ...prev, title: template.title || "", issue_date: format(new Date(), "yyyy-MM-dd"),
          overall_scope: template.overall_scope || "", client_message: template.client_message || "", terms: template.terms || "",
          show_overall_scope: template.show_overall_scope !== false, deposit_amount: template.deposit_amount || 0,
          discount_amount: template.discount_amount || 0, discount_type: template.discount_type || "fixed",
          discount_percentage: template.discount_percentage || 0, has_payment_schedule: template.has_payment_schedule || false,
          hero_image_url: template.hero_image_url || "", end_photos: template.end_photos || [], documents: template.documents || [],
          margin: template.margin ?? 0, margin_adjustment_type: template.margin_adjustment_type || "none"
        }));
        if (template.pdf_customization_settings_json) {
          try { hydratePdfSettings(JSON.parse(template.pdf_customization_settings_json)); } catch (e) {}
        }
      }
    }
  }, [existingQuote, templateId, quoteTemplates]);

  useEffect(() => {
    if (quoteId && scheduleFetched && !scheduleLoadError && !hasLoadedSchedule.current) {
      hasLoadedSchedule.current = true;
      hydratePaymentScheduleItems(existingScheduleItems);
    }
  }, [quoteId, existingScheduleItems, scheduleFetched, scheduleLoadError]);

  useEffect(() => {
    if (!quoteId && (form.client_id || form.lead_id)) {
      hydrateForm(prev => {
        // If an address is already typed in, DO NOT overwrite it
        if (prev.site_address) return prev;
        
        if (prev.client_id && clients.length > 0) {
          const selectedClient = clients.find(c => c.id === prev.client_id);
          if (selectedClient && (selectedClient.site_address || selectedClient.billing_address)) {
            return { ...prev, site_address: selectedClient.site_address || selectedClient.billing_address };
          }
        }
        
        if (prev.lead_id && leads.length > 0) {
          const selectedLead = leads.find(l => l.id === prev.lead_id);
          if (selectedLead && selectedLead.site_address) {
            return { ...prev, site_address: selectedLead.site_address };
          }
        }
        
        return prev;
      });
    }
  }, [quoteId, form.client_id, form.lead_id, clients, leads]);

  useEffect(() => {
    if (quoteId && phasesFetched && itemsFetched && !phasesLoadError && !itemsLoadError && !hasLoadedPhases.current) {
      hasLoadedPhases.current = true;
      const phasesWithItems = existingPhases.map(phase => ({
        ...phase,
        items: existingItems.filter(item => item.phase_id === phase.id).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      }));
      hydratePhases(phasesWithItems);
    }
  }, [quoteId, existingPhases, existingItems, phasesFetched, itemsFetched, phasesLoadError, itemsLoadError]);

  useEffect(() => {
    if (templateId && !quoteId && templatePhasesFetched && templateItemsFetched && !templatePhasesLoadError && !templateItemsLoadError && !hasLoadedPhases.current) {
      hasLoadedPhases.current = true;
      const phasesWithItems = templatePhases.map(phase => ({
        id: `temp-phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        phase_name: phase.phase_name, scope_of_work: phase.scope_of_work || "", show_scope_to_client: phase.show_scope_to_client !== false,
        internal_notes: phase.internal_notes || "", photos: phase.photos || [], sort_order: phase.sort_order,
        is_optional: phase.is_optional === true, default_selected: phase.default_selected === true,
        items: templateItems.filter(item => item.phase_id === phase.id).map(item => ({
          id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name, description: item.description || "", quantity: item.quantity || 1, unit: item.unit || "ea",
          unit_cost: item.unit_cost || 0, unit_price: item.unit_price || 0, taxable: item.taxable !== false,
          product_id: item.product_id || "", photo_url: item.photo_url || "", is_optional: item.is_optional === true,
          default_selected: item.default_selected === true, is_material: item.is_material === true, supplier: item.supplier || null
        }))
      }));
      hydratePhases(phasesWithItems);
    }
  }, [templateId, quoteId, templatePhases, templateItems, templatePhasesFetched, templateItemsFetched, templatePhasesLoadError, templateItemsLoadError]);

  useEffect(() => {
    if (templateId && !quoteId && templateScheduleFetched && !templateScheduleLoadError && !hasLoadedSchedule.current) {
      hasLoadedSchedule.current = true;
      hydratePaymentScheduleItems(templateScheduleItems.map(item => ({ ...item, id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })));
    }
  }, [templateId, quoteId, templateScheduleItems, templateScheduleFetched, templateScheduleLoadError]);

  const addPhase = () => {
    setPhases([...phases, {
      id: `temp-phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      phase_name: `Phase ${phases.length + 1}`, scope_of_work: "", show_scope_to_client: true, internal_notes: "",
      photos: [], sort_order: phases.length, is_optional: false, items: []
    }]);
  };

  const addPhaseFromTemplate = (template) => {
    let lineItems = [];
    try { lineItems = JSON.parse(template.line_items_json || "[]"); } catch (e) {}
    setPhases([...phases, {
      phase_name: template.phase_name, scope_of_work: template.scope_of_work || "", show_scope_to_client: true,
      internal_notes: "", photos: [], sort_order: phases.length, is_optional: false,
      items: lineItems.map((item, idx) => {
        const matchedProduct = products.find(p => p.name === item.name);
        return {
          id: `temp-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name || "", description: item.description || "", quantity: Number(item.quantity) || 1, unit: item.unit || "ea",
          unit_cost: Number(matchedProduct?.cost ?? item.unit_cost ?? 0), 
          unit_price: Number(matchedProduct?.price ?? item.unit_price ?? 0),
          material_cost: Number(matchedProduct?.material_cost ?? item.material_cost ?? 0), // ⚡ Added
          labor_cost: Number(matchedProduct?.labor_cost ?? item.labor_cost ?? 0), // ⚡ Added
          taxable: item.taxable !== false, product_id: matchedProduct?.id || item.product_id || "",
          photo_url: matchedProduct?.image_url || item.photo_url || "", is_optional: item.is_optional || false, default_selected: item.default_selected || false,
          is_material: item.is_material || matchedProduct?.is_material || false, supplier: item.supplier || matchedProduct?.supplier || null
        };
      })
    }]);
    toast.success(`Added ${template.phase_name} from template`);
  };

  const updatePhase = (idx, field, value) => { const updated = [...phases]; updated[idx] = { ...updated[idx], [field]: value }; setPhases(updated); };
  const removePhase = (idx) => setPhases(phases.filter((_, i) => i !== idx));

  const { duplicatePhase, reorderLineItems, reorderPhases } = usePhaseFunctions(phases, setPhases);

  const movePhaseUp = (idx) => { if (idx > 0) reorderPhases(idx, idx - 1); };
  const movePhaseDown = (idx) => { if (idx < phases.length - 1) reorderPhases(idx, idx + 1); };

  const addLineItem = (phaseIdx, product = null) => {
    const updated = [...phases];
    const uniqueId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newItem = product ? {
      id: uniqueId, name: product.name, description: product.description || "", quantity: 1, unit: product.unit || "ea",
      unit_cost: product.cost || 0, unit_price: product.price || 0, taxable: product.taxable !== false, product_id: product.id,
      photo_url: product.image_url || "", is_optional: false, is_material: product.is_material || false, supplier: product.supplier || null
    } : {
      id: uniqueId, name: "", description: "", quantity: 1, unit: "ea", unit_cost: 0, unit_price: 0, taxable: true,
      product_id: "", photo_url: "", is_optional: false, is_material: false, supplier: null
    };
    updated[phaseIdx].items = [...(updated[phaseIdx].items || []), newItem];
    setPhases(updated);
  };

  const updateLineItem = (phaseIdx, itemIdx, field, value) => {
    const updated = [...phases];
    updated[phaseIdx].items[itemIdx] = { ...updated[phaseIdx].items[itemIdx], [field]: value };
    setPhases(updated);
  };

  const removeLineItem = (phaseIdx, itemIdx) => {
    const updated = [...phases];
    updated[phaseIdx].items = updated[phaseIdx].items.filter((_, i) => i !== itemIdx);
    setPhases(updated);
  };

  const duplicateLineItem = (phaseIdx, itemIdx) => {
    const updated = [...phases];
    const itemToDuplicate = updated[phaseIdx].items[itemIdx];
    const duplicatedItem = { ...itemToDuplicate, id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
    updated[phaseIdx].items.splice(itemIdx + 1, 0, duplicatedItem);
    setPhases(updated);
    toast.success("Item duplicated");
  };

  const handleSplitLineItem = (phaseIdx, itemIdx) => {
    setPhases(prev => {
      const updated = [...prev];
      const phaseItems = [...updated[phaseIdx].items];
      const itemToSplit = phaseItems[itemIdx];

      const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);
      const halfCost = safeNum(itemToSplit.unit_cost) / 2;
      const halfPrice = safeNum(itemToSplit.unit_price) / 2;

      const matItem = {
        ...itemToSplit,
        id: `temp-${Date.now()}-mat`,
        name: `${itemToSplit.name} (Material)`,
        is_material: true,
        unit_cost: halfCost,
        unit_price: halfPrice,
        material_cost: halfCost, // ⚡ Locks the cost into the Material box
        labor_cost: 0            // ⚡ Empties the Labor box
      };

      const labItem = {
        ...itemToSplit,
        id: `temp-${Date.now()}-lab`,
        name: `${itemToSplit.name} (Labor)`,
        is_material: false,
        supplier: "",
        unit_cost: halfCost,
        unit_price: halfPrice,
        material_cost: 0,        // ⚡ Empties the Material box
        labor_cost: halfCost     // ⚡ Locks the cost into the Labor box
      };

      // Replace the original item with the two new split items
      phaseItems.splice(itemIdx, 1, matItem, labItem);
      updated[phaseIdx] = { ...updated[phaseIdx], items: phaseItems };
      return updated;
    });
    toast.success("Item split into material and labor");
  };

  const moveLineItem = (fromPhaseIdx, itemIdx, toPhaseIdx) => {
    const updated = [...phases];
    const [itemToMove] = updated[fromPhaseIdx].items.splice(itemIdx, 1);
    updated[toPhaseIdx].items = [...(updated[toPhaseIdx].items || []), itemToMove];
    setPhases(updated);
    toast.success("Item moved");
  };

  const refreshPricingFromProducts = () => {
    const updated = phases.map(phase => ({
      ...phase,
      items: phase.items?.map(item => {
        const matchedProduct = products.find(p => p.name?.toLowerCase() === item.name?.toLowerCase());
        if (matchedProduct) {
          return { ...item, unit_cost: matchedProduct.cost || item.unit_cost, unit_price: matchedProduct.price || item.unit_price, product_id: matchedProduct.id, photo_url: matchedProduct.image_url || item.photo_url, is_material: matchedProduct.is_material || item.is_material, supplier: matchedProduct.supplier || item.supplier };
        }
        return item;
      }) || []
    }));
    setPhases(updated);
    toast.success("Pricing refreshed from products");
  };

  const handlePhotoUpload = async (phaseIdx, files) => {
    markDirty();
    setUploadingPhoto(true);
    try {
      // Ensure files is iterable (it might be a FileList object)
      const filesArray = Array.from(files);
      const urls = [];

      for (const file of filesArray) {
        const fileName = `${companyId}/${quoteId || 'new'}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('quotes').upload(fileName, file);
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
        urls.push(publicUrl);
      }
      
      const updated = [...phases];
      updated[phaseIdx].photos = [...(updated[phaseIdx].photos || []), ...urls];
      setPhases(updated);
      toast.success(`${urls.length} phase photo(s) uploaded`);
    } catch (error) { 
      toast.error("Upload failed: " + error.message); 
    }
    setUploadingPhoto(false);
  };

  const handleEndPhotoUpload = async (file) => {
    markDirty();
    setUploadingPhoto(true);
    try {
      const fileName = `${companyId}/${quoteId || 'new'}/hero/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('quotes').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
      
      if (!form.hero_image_url) {
        setForm({ ...form, hero_image_url: publicUrl });
        toast.success("Hero image uploaded");
      } else {
        setForm({ ...form, end_photos: [...form.end_photos, publicUrl] });
        toast.success("Project photo uploaded");
      }
    } catch (error) { toast.error("Upload failed"); }
    setUploadingPhoto(false);
  };

  const handleMultiplePhotosUpload = async (files) => {
    markDirty();
    setUploadingPhoto(true);
    try {
      const urls = [];
      for (const file of Array.from(files)) {
        const fileName = `${companyId}/${quoteId || 'new'}/gallery/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('quotes').upload(fileName, file);
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
        urls.push(publicUrl);
      }
      setForm({ ...form, end_photos: [...form.end_photos, ...urls] });
      toast.success(`${urls.length} photos uploaded`);
    } catch (error) { toast.error("Upload failed"); }
    setUploadingPhoto(false);
  };

  const handleDocumentUpload = async (file) => {
    markDirty();
    setUploadingPhoto(true);
    try {
      const fileName = `${companyId}/${quoteId || 'new'}/documents/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('quotes').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
      setForm({ ...form, documents: [...form.documents, { file_url: publicUrl, file_name: file.name }] });
      toast.success("Document uploaded");
    } catch (error) { toast.error("Upload failed"); }
    setUploadingPhoto(false);
  };

  const handleDocumentDelete = async (idx) => {
    const updatedDocs = form.documents.filter((_, i) => i !== idx);
    setForm({ ...form, documents: updatedDocs });
    toast.success("Document removed");
  };

  const handleLineItemPhotoUpload = async (phaseIdx, itemIdx, file) => {
    markDirty();
    setUploadingPhoto(true);
    try {
      const fileName = `${companyId}/${quoteId || 'new'}/items/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('quotes').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
      
      const updatedPhases = [...phases];
      updatedPhases[phaseIdx].items[itemIdx].photo_url = publicUrl;
      setPhases(updatedPhases);
      toast.success("Line item photo uploaded");
    } catch (error) { toast.error("Upload failed"); }
    setUploadingPhoto(false);
  };

  // --- 3. DUAL-TAX MATH ENGINE ---
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  const combinedTaxRate = primaryTaxRate + secondaryTaxRate;

  const isItemActive = (item) => !item.is_optional || item.default_selected === true;
  const isPhaseActive = (phase) => !phase.is_optional || phase.default_selected === true;

  const calculatePhaseSubtotal = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(isItemActive).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0) || 0;
  };
  const calculatePhaseCost = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(isItemActive).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_cost)), 0) || 0;
  };
  const calculatePhaseMargin = (phase) => calculatePhaseSubtotal(phase) - calculatePhaseCost(phase);

  // Phase Tax (Visual Only for the Phase Card)
  const calculatePhaseTaxableAmount = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(i => isItemActive(i) && i.taxable).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0) || 0;
  };
  const calculatePhaseTax = (phase) => calculatePhaseTaxableAmount(phase) * combinedTaxRate;
  const calculatePhaseTotal = (phase) => calculatePhaseSubtotal(phase) + calculatePhaseTax(phase);
  
  const calculatePhaseMarginAmount = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(isItemActive).reduce((sum, item) => sum + ((safeNum(item.unit_price) - safeNum(item.unit_cost)) * safeNum(item.quantity)), 0) || 0;
  };
  const calculatePhaseMarginPercent = (phase) => {
    const revenue = calculatePhaseSubtotal(phase);
    const margin = calculatePhaseMarginAmount(phase);
    return revenue > 0 ? (margin / revenue) * 100 : 0;
  };

  const grandSubtotal = phases.reduce((sum, phase) => sum + calculatePhaseSubtotal(phase), 0);
  const grandCost = phases.reduce((sum, phase) => sum + calculatePhaseCost(phase), 0);
  const baseMargin = grandSubtotal - grandCost;
  const baseMarginPercent = grandSubtotal > 0 ? (baseMargin / grandSubtotal) * 100 : 0;
  
  let effectiveSubtotal = grandSubtotal;
  let currentMarginAmount = baseMargin;
  let currentMarginPercent = baseMarginPercent;

  if (form.margin_adjustment_type === "fixed" && safeNum(form.margin) !== 0) {
    currentMarginAmount = safeNum(form.margin);
    effectiveSubtotal = grandCost + currentMarginAmount;
    currentMarginPercent = effectiveSubtotal > 0 ? (currentMarginAmount / effectiveSubtotal) * 100 : 0;
  } else if (form.margin_adjustment_type === "percentage" && safeNum(form.margin) > 0) {
    const safeMarginPercent = Math.min(safeNum(form.margin), 99.99);
    currentMarginPercent = safeMarginPercent;
    effectiveSubtotal = grandCost / (1 - safeMarginPercent / 100);
    currentMarginAmount = effectiveSubtotal - grandCost;
  }

  // Grand Tax Calcs
  const grandTaxableAmount = phases.reduce((sum, phase) => sum + calculatePhaseTaxableAmount(phase), 0);
  const grandPrimaryTax = grandTaxableAmount * primaryTaxRate;
  const grandSecondaryTax = grandTaxableAmount * secondaryTaxRate;
  const grandTax = grandPrimaryTax + grandSecondaryTax;

  const subtotalBeforeDiscount = effectiveSubtotal + grandTax;
  const discountAmount = form.discount_type === "percentage" ? (effectiveSubtotal * safeNum(form.discount_percentage) / 100) : safeNum(form.discount_amount);
  const grandTotal = subtotalBeforeDiscount - discountAmount;

  // 4. AUTO DEPOSIT EFFECT
  useEffect(() => {
    // If it's a new quote and they haven't manually locked the deposit, auto-calc it!
    if (!manualDeposit && grandTotal > 0 && !existingQuote) {
       const defaultDepPct = settings?.default_deposit ?? 0;
       const autoDeposit = parseFloat((grandTotal * (defaultDepPct / 100)).toFixed(2));
       hydrateForm(prev => ({ ...prev, deposit_amount: autoDeposit }));
    }
  }, [grandTotal, manualDeposit, settings?.default_deposit, existingQuote]);

  const paymentScheduleTotal = paymentScheduleItems.reduce((sum, item) => {
    if (item.amount_type === "percentage") return sum + (grandTotal * safeNum(item.percentage) / 100);
    return sum + safeNum(item.amount);
  }, 0);
  const remainingAmount = grandTotal - paymentScheduleTotal;

  const handleContactChange = (newId) => {
    const selectedClient = clients.find(c => c.id === newId);
    const selectedLead = leads.find(l => l.id === newId);

    if (selectedClient) {
      setForm(prev => ({ 
        ...prev, 
        client_id: newId, 
        lead_id: null, 
        site_address: selectedClient.site_address || selectedClient.billing_address || prev.site_address || "" 
      }));
    } else if (selectedLead) {
      setForm(prev => ({ 
        ...prev, 
        lead_id: newId, 
        client_id: null, 
        site_address: selectedLead.address || selectedLead.project_address || prev.site_address || "" 
      }));
    } else {
      setForm(prev => ({ ...prev, client_id: null, lead_id: null }));
    }
  };

  const handleToggleArchive = async () => {
    if (!quoteId) return;
    try {
      const newArchivedState = !form.is_archived;
      const { error } = await supabase.from("quotes").update({ is_archived: newArchivedState }).eq("id", quoteId);
      if (error) throw error;
      hydrateForm(prev => ({ ...prev, is_archived: newArchivedState }));
      toast.success(newArchivedState ? "Quote archived successfully" : "Quote unarchived successfully");
    } catch (err) {
      toast.error("Failed to update archive status");
    }
  };

  const isDocumentLoading = Boolean(
    (quoteId && (hydratedQuoteId.current !== quoteId || !hasLoadedPhases.current || !hasLoadedSchedule.current)) ||
    (templateId && !quoteId && (hydratedTemplateId.current !== templateId || !hasLoadedPhases.current || !hasLoadedSchedule.current))
  );

  const handleSave = async (newStatus = null, forceSaveAsTemplate = false, skipToast = false, stayInBuilder = false, expectedStatus = null) => {
    if (saveInFlight.current) return null;
    if (isDocumentLoading) { toast.error("Please wait for the quote to finish loading before saving."); return null; }
    const activeTitle = localTitle;
    if (!activeTitle || !activeTitle.trim()) { toast.error("Enter a title for this quote before saving."); return null; }
    if (!companyId) { toast.error("Your company profile is unavailable. Refresh the page and try again."); return null; }

    const saveRevision = getRevision();
    saveInFlight.current = true;
    setSaving(true);
    if(!skipToast) toast.loading("Saving quote...");
    
    let finalStatus = form.status;

    try {
      const latestForm = { ...form, title: activeTitle, overall_scope: localOverallScope, client_message: localClientMessage, terms: localTerms, notes: localNotes };
      finalStatus = newStatus !== null ? newStatus : latestForm.status;
      
      let quoteNumber = latestForm.quote_number;
      let shouldIncrementCounter = false;

      if (!quoteNumber) {
        if (forceSaveAsTemplate || isTemplate || latestForm.status === "Template") {
          quoteNumber = `TMP-${Date.now().toString().slice(-4)}`;
        } else {
          const prefix = company?.quote_number_prefix || "QT-";
          const nextNum = company?.next_quote_number || 1001;
          quoteNumber = `${prefix}${nextNum}`;
          shouldIncrementCounter = true;
        }
      }
      
      const cleanClientId = (latestForm.client_id && typeof latestForm.client_id === 'string' && latestForm.client_id.length > 10) ? latestForm.client_id : null;
      const cleanLeadId = (latestForm.lead_id && typeof latestForm.lead_id === 'string' && latestForm.lead_id.length > 10) ? latestForm.lead_id : null;

      const quoteData = {
        company_id: companyId,
        client_id: cleanClientId,
        lead_id: cleanLeadId,
        title: latestForm.title,
        quote_number: quoteNumber,
        status: finalStatus,
        issue_date: latestForm.issue_date || null,
        expiry_date: latestForm.expiry_date || null,
        next_follow_up_date: forceSaveAsTemplate || isTemplate || existingQuote?.is_template ? null : latestForm.next_follow_up_date || null,
        notes: latestForm.notes || "",
        client_message: latestForm.client_message || "",
        terms: latestForm.terms || "",
        overall_scope: latestForm.overall_scope || "",
        show_overall_scope: Boolean(latestForm.show_overall_scope),
        deposit_amount: safeNum(latestForm.deposit_amount),
        discount_amount: safeNum(latestForm.discount_amount),
        discount_type: latestForm.discount_type || 'fixed',
        discount_percentage: safeNum(latestForm.discount_percentage),
        show_discount_amount: Boolean(latestForm.show_discount_amount),
        has_payment_schedule: Boolean(latestForm.has_payment_schedule),
        hero_image_url: latestForm.hero_image_url || null,
        end_photos: Array.isArray(latestForm.end_photos) ? latestForm.end_photos : [],
        documents: Array.isArray(latestForm.documents) ? latestForm.documents : [],
        margin: safeNum(currentMarginAmount),
        margin_adjustment_type: latestForm.margin_adjustment_type || 'none',
        subtotal: safeNum(effectiveSubtotal),
        tax: safeNum(grandTax), 
        total: safeNum(grandTotal),
        site_address: latestForm.site_address || "",
        pdf_customization_settings_json: JSON.stringify(pdfSettings),
        is_template: Boolean(forceSaveAsTemplate || isTemplate || existingQuote?.is_template),
        is_archived: Boolean(latestForm.is_archived)
      };

      let savedQuoteId = quoteId;

      if (!quoteId || forceSaveAsTemplate) {
        const { data: newQuote, error: quoteError } = await supabase.from("quotes").insert([quoteData]).select().single();
        if (quoteError) throw new Error(`Quotes Table: ${quoteError.message}`);
        if (!newQuote?.id) throw new Error("The quote could not be saved. Please try again.");
        savedQuoteId = newQuote.id;

        // Keep a newly created ID even if a later child write fails, so retry updates this quote.
        if (!forceSaveAsTemplate) {
          hydratedQuoteId.current = savedQuoteId;
          hasLoadedPhases.current = true;
          hasLoadedSchedule.current = true;
          setQuoteId(savedQuoteId);
          hydrateForm(prev => ({ ...prev, quote_number: quoteNumber }));
        }
        if (shouldIncrementCounter) {
          const currentCounter = company?.next_quote_number ? Number(company.next_quote_number) : 1001;
          pendingCounterUpdate.current = currentCounter + 1;
        }
      } else {
        let quoteUpdate = supabase.from("quotes").update(quoteData).eq("id", quoteId).eq("company_id", companyId);
        if (expectedStatus !== null) quoteUpdate = quoteUpdate.eq("status", expectedStatus);
        const { data: updatedQuote, error: quoteUpdateError } = await quoteUpdate.select("id").single();
        if (quoteUpdateError) throw new Error(`Quotes Update: ${quoteUpdateError.message}`);
        if (!updatedQuote?.id) throw new Error("The quote status has changed. Refresh before saving.");
      }

      if (pendingCounterUpdate.current !== null) {
        const { error: companyUpdateErr } = await supabase.from("companies").update({ next_quote_number: pendingCounterUpdate.current }).eq("id", companyId).select("id").single();
        if (companyUpdateErr) throw new Error(`Companies Counter Sync Error: ${companyUpdateErr.message}`);
        pendingCounterUpdate.current = null;
      }

      if (quoteId && !forceSaveAsTemplate) {
        const { error: deleteItemsError } = await supabase.from("quote_line_items").delete().eq("quote_id", savedQuoteId).eq("company_id", companyId);
        if (deleteItemsError) throw new Error(`Line Items Delete: ${deleteItemsError.message}`);
        const { error: deletePhasesError } = await supabase.from("quote_phases").delete().eq("quote_id", savedQuoteId).eq("company_id", companyId);
        if (deletePhasesError) throw new Error(`Phases Delete: ${deletePhasesError.message}`);
        const { error: deleteScheduleError } = await supabase.from("quote_payment_schedules").delete().eq("quote_id", savedQuoteId).eq("company_id", companyId);
        if (deleteScheduleError) throw new Error(`Payment Schedule Delete: ${deleteScheduleError.message}`);
      }

      for (const phase of phases) {
        const { data: insertedPhase, error: phaseError } = await supabase.from("quote_phases").insert([{
          company_id: companyId, quote_id: savedQuoteId, phase_name: phase.phase_name || "Unnamed Phase",
          scope_of_work: phase.scope_of_work || "", show_scope_to_client: Boolean(phase.show_scope_to_client),
          internal_notes: phase.internal_notes || "", photos: Array.isArray(phase.photos) ? phase.photos : [],
          sort_order: safeNum(phase.sort_order), is_optional: Boolean(phase.is_optional), default_selected: Boolean(phase.default_selected)
        }]).select().single();
        if (phaseError) throw new Error(`Phase Table: ${phaseError.message}`);

        if (phase.items?.length > 0) {
          const itemsToInsert = phase.items.map((item, idx) => ({
            company_id: companyId, quote_id: savedQuoteId, phase_id: insertedPhase.id, name: item.name || "Unnamed Item",
            description: item.description || "", quantity: safeNum(item.quantity) || 1, unit: item.unit || "ea",
            unit_cost: safeNum(item.unit_cost), unit_price: safeNum(item.unit_price), 
            material_cost: safeNum(item.material_cost), labor_cost: safeNum(item.labor_cost), 
            taxable: Boolean(item.taxable), product_id: (item.product_id && typeof item.product_id === 'string' && item.product_id.length > 10) ? item.product_id : null,
            photo_url: item.photo_url || null, is_optional: Boolean(item.is_optional), default_selected: Boolean(item.default_selected),
            is_material: Boolean(item.is_material), supplier: item.supplier || null, display_order: idx 
          }));
          const { error: itemsError } = await supabase.from("quote_line_items").insert(itemsToInsert);
          if (itemsError) throw new Error(`Line Items Table: ${itemsError.message}`);
        }
      }

      if (latestForm.has_payment_schedule && paymentScheduleItems.length > 0) {
        const schedulesToInsert = paymentScheduleItems.map((item, idx) => ({
          company_id: companyId, quote_id: savedQuoteId, payment_name: item.payment_name || "Payment", due_event: item.due_event || "",
          amount: safeNum(item.amount), amount_type: item.amount_type || 'fixed', percentage: safeNum(item.percentage), sort_order: idx
        }));
        const { error: scheduleError } = await supabase.from("quote_payment_schedules").insert(schedulesToInsert);
        if (scheduleError) throw new Error(`Payment Schedule Table: ${scheduleError.message}`);
      }

      await queryClient.invalidateQueries({ queryKey: ["company", companyId] }); 
      await queryClient.invalidateQueries({ queryKey: ["quotes"] });
      await queryClient.invalidateQueries({ queryKey: ["quote", savedQuoteId] });
      await queryClient.invalidateQueries({ queryKey: ["quotes_lookup", companyId] });
      await queryClient.invalidateQueries({ queryKey: ["quote-templates-list"] });
      await queryClient.invalidateQueries({ queryKey: ["quote-phases", savedQuoteId] });
      await queryClient.invalidateQueries({ queryKey: ["quote-items", savedQuoteId] });

      toast.dismiss();
      if (forceSaveAsTemplate) {
        toast.success("Success! Quote saved into your Templates library.");
        return savedQuoteId;
      }

      if (getRevision() === saveRevision) {
        hydrateForm(prev => ({ ...prev, status: finalStatus, quote_number: quoteNumber }));
      }
      const savedCurrentRevision = markSaved(saveRevision);
      if (!quoteId && !stayInBuilder) {
        window.history.replaceState(window.history.state, "", `/QuoteBuilder?id=${savedQuoteId}`);
      }
      if (!skipToast) { toast.success((isTemplate || existingQuote?.is_template) ? "Template saved successfully" : "Quote saved successfully"); }
      if ((isTemplate || existingQuote?.is_template) && !stayInBuilder && savedCurrentRevision) {
        navigate("/Templates");
      }
      return savedQuoteId;
    } catch (error) {
      toast.dismiss();
      console.error("Quote save failed:", error);
      toast.error(`Quote was not fully saved: ${error.message || "Please try again."}`);
      return null;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleRequestInternalReview = async () => {
    if (saveInFlight.current) return null;
    if (isTemplate || existingQuote?.is_template || !["Draft", "Sent", "Pending Review"].includes(form.status)) {
      toast.error("Only draft or sent quotes can be submitted for internal review.");
      return null;
    }
    const persistedStatus = form.status;
    const requestRevision = getRevision();
    const savedId = await handleSave(null, false, true, false, persistedStatus);
    if (!savedId) return null;
    if (getRevision() !== requestRevision) {
      toast.error("Your latest edits are still unsaved. Save them before requesting review.");
      return null;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("quotes").update({
        status: "Pending Review", internal_review_status: "Pending", internal_reviewed_at: null, internal_reviewed_by: null,
      }).eq("id", savedId).eq("company_id", companyId).eq("status", persistedStatus).select("id").single();
      if (error || !data?.id) throw error || new Error("The quote status has changed.");
      hydrateForm(prev => ({ ...prev, status: "Pending Review", internal_review_status: "Pending", internal_reviewed_at: null, internal_reviewed_by: null }));
      for (const queryKey of [["quote", savedId], ["quotes"], ["quotes_lookup", companyId]]) await queryClient.invalidateQueries({ queryKey });
      toast.success("Quote submitted for internal review.");
      return savedId;
    } catch {
      toast.error("The quote was saved, but review could not be requested. Refresh its status and try again.");
      return null;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    let idToPreview = quoteId;
    if (!idToPreview) {
       idToPreview = await handleSave(null, false, true); 
       if (!idToPreview) return; 
    }
    window.open(`/QuoteView?id=${idToPreview}`, '_blank');
  };

  const handleSendEmail = async () => {
    try {
      const savedQuoteId = await handleSave("Sent", false, true);
      if (!savedQuoteId) throw new Error("Could not save the base quote.");

      await issueQuoteShareToken(savedQuoteId);
      
      toast.success("Quote dispatched! It is now tracking in your Approvals Hub.");
      setEmailDialog(false);
    } catch (error) {
      alert(`Dispatch Failed: ${error.message}`); 
    }
  };
  
  // ⚡ FIXED: Mapping materials exactly
  const convertToProject = async (activeQuoteId) => {
    if (!activeQuoteId || !companyId) throw new Error("Missing quote or company data");
    const projectNumber = `${company?.project_number_prefix || "PRJ-"}${company?.next_project_number || Date.now().toString().slice(-4)}`;
    const cleanClientId = (form.client_id && typeof form.client_id === 'string' && form.client_id.length > 10) ? form.client_id : null;

    const { data: projectRef, error: projectError } = await supabase.from("projects").insert([{
      company_id: companyId, client_id: cleanClientId, quote_id: activeQuoteId, name: form.title || "Untitled Project",
      project_number: projectNumber, status: "Planning", start_date: new Date().toISOString().split("T")[0],
      budget: safeNum(grandTotal), budget_revenue: safeNum(grandTotal), budget_cost: safeNum(grandCost), site_address: form.site_address || ""
    }]).select().single();
    if (projectError) throw projectError;

    await supabase.from("companies").update({ next_project_number: safeNum(company?.next_project_number || 1001) + 1 }).eq("id", companyId);

    for (const phase of phases) {
      if (!isPhaseActive(phase)) continue;

      const { data: insertedProjPhase } = await supabase.from("project_phases").insert([{
        company_id: companyId,
        project_id: projectRef.id,
        phase_name: phase.phase_name,
        description: phase.scope_of_work,
        status: "Not Started"
      }]).select().single();

      if (insertedProjPhase && phase.items?.length > 0) {
        const tasksToInsert = [];
        const materialsToInsert = [];

        phase.items.forEach((item, idx) => {
          if (!isItemActive(item)) return;

          tasksToInsert.push({
            company_id: companyId,
            project_id: projectRef.id,
            phase_id: insertedProjPhase.id,
            task_name: item.name,
            description: item.description || "",
            status: "Not Started",
            display_order: idx
          });

          // ⚡ PUSH TO MATERIALS TRACKER
          if (item.is_material) {
            materialsToInsert.push({
              company_id: companyId,
              project_id: projectRef.id,
              phase_id: insertedProjPhase.id,
              custom_material_name: item.name,
              quantity: safeNum(item.quantity) || 1,
              unit: item.unit || "ea",
              cost_estimated: safeNum(item.unit_cost) * (safeNum(item.quantity) || 1),
              supplier: item.supplier || null, // Pulling the supplier straight from quote items
              status: "Planned",
              notes: item.description || ""
            });
          }
        });

        if (tasksToInsert.length > 0) {
          await supabase.from("project_tasks").insert(tasksToInsert);
        }
        if (materialsToInsert.length > 0) {
          const { error: matErr } = await supabase.from("project_materials").insert(materialsToInsert);
          if (matErr) {
            console.error("Material Sync Failed:", matErr);
            toast.error(`Materials failed to port: ${matErr.message}`);
          }
        }
      }
    }
    return projectRef;
  };

  const convertToInvoice = async (projectId = null, activeQuoteId) => {
    if (!activeQuoteId || !companyId) throw new Error("Missing quote or company data");
    const invoiceNumber = `${company?.invoice_number_prefix || "INV-"}${company?.next_invoice_number || Date.now().toString().slice(-4)}`;
    const cleanClientId = (form.client_id && typeof form.client_id === 'string' && form.client_id.length > 10) ? form.client_id : null;

    const { data: invoiceRef, error: invoiceError } = await supabase.from("invoices").insert([{
      company_id: companyId, client_id: cleanClientId, project_id: projectId, quote_id: activeQuoteId, invoice_number: invoiceNumber,
      status: "Draft", issue_date: new Date().toISOString().split("T")[0],
      subtotal: safeNum(effectiveSubtotal), tax: safeNum(grandTax), total: safeNum(grandTotal), balance_due: safeNum(grandTotal),
      deposit_amount: safeNum(form.deposit_amount), has_payment_schedule: Boolean(form.has_payment_schedule)
    }]).select().single();
    if (invoiceError) throw invoiceError;

    await supabase.from("companies").update({ next_invoice_number: safeNum(company?.next_invoice_number || 1001) + 1 }).eq("id", companyId);

    const invoicePhasesMap = {};
    for (const phase of phases) {
      if (!isPhaseActive(phase)) continue;
      const { data: newPhase } = await supabase.from("invoice_phases").insert([{
        company_id: companyId, invoice_id: invoiceRef.id, phase_name: phase.phase_name, scope_of_work: phase.scope_of_work || "", sort_order: phase.sort_order || 0,
      }]).select().single();
      if (newPhase) invoicePhasesMap[phase.id] = newPhase.id;
    }

    const itemsToInsert = [];
    for (const phase of phases) {
      if (!isPhaseActive(phase) || !invoicePhasesMap[phase.id]) continue;
      if (phase.items && phase.items.length > 0) {
        for (const item of phase.items) {
           if (!isItemActive(item)) continue;
           itemsToInsert.push({
              company_id: companyId, invoice_id: invoiceRef.id, phase_id: invoicePhasesMap[phase.id], name: item.name,
              description: item.description || "", quantity: safeNum(item.quantity) || 1, unit: item.unit || "ea",
              unit_price: safeNum(item.unit_price) || 0, taxable: Boolean(item.taxable), line_total: safeNum(item.quantity) * safeNum(item.unit_price),
           });
        }
      }
    }
    if (itemsToInsert.length > 0) await supabase.from("invoice_line_items").insert(itemsToInsert);

    if (form.has_payment_schedule && paymentScheduleItems.length > 0) {
      const schedulesToInsert = paymentScheduleItems.map((schedItem, idx) => ({
        company_id: companyId, invoice_id: invoiceRef.id, payment_name: schedItem.payment_name,
        amount: schedItem.amount_type === "percentage" ? (grandTotal * safeNum(schedItem.percentage) / 100) : safeNum(schedItem.amount),
        due_event: schedItem.due_event || "", due_date: new Date().toISOString().split("T")[0], amount_paid: 0, status: "Pending", sort_order: schedItem.sort_order || idx,
      }));
      await supabase.from("invoice_payment_schedules").insert(schedulesToInsert);
    }
    return invoiceRef;
  };

  const handleConvertQuoteAction = async (type) => {
    // 👇 1. THE PROJECT LIMIT GATEKEEPER 👇
    if (type === "project" || type === "both") {
      const currentPlan = company?.plan_id || 'starter';
      
      if (currentPlan === 'starter') {
        // Count how many ACTIVE projects they currently have
        const { count, error: countError } = await supabase
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', comp…2494 tokens truncated…Convert Quote...
            </button>

            <div className="h-px bg-slate-100 my-1.5"></div>
            
            <button 
              onClick={() => { setActionsMenuOpen(false); handleSave(null, true); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Copy className="h-4 w-4 mr-3 text-slate-400" /> Save as Template
            </button>
          </div>
        )}
      </div>
    );
  };

  const missingTemplate = templateId && !quoteId && quoteTemplatesFetched && !quoteTemplates.some(template => template.id === templateId);
  const initialLoadError = quoteLoadError || phasesLoadError || itemsLoadError || scheduleLoadError ||
    (templateId && !quoteId && (quoteTemplatesLoadError || templatePhasesLoadError || templateItemsLoadError || templateScheduleLoadError || missingTemplate));
  if ((quoteId || templateId) && (isDocumentLoading || initialLoadError) && !saveInFlight.current && !isDirty) {
    return (
      <div className="min-h-full bg-slate-50 p-6" role="status">
        <p className="text-slate-700">{initialLoadError ? "This quote could not be loaded. Please refresh the page and try again." : "Loading quote..."}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/Quotes")}>Back to quotes</Button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      <UnsavedChangesGuard
        isDirty={isDirty}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving || uploadingPhoto || converting}
        documentName="quote"
        onSave={async () => {
          const revision = getRevision();
          const savedId = await handleSave(null, false, false, true);
          return Boolean(savedId) && getRevision() === revision;
        }}
      />
      <fieldset disabled={saving || uploadingPhoto || converting} className="min-w-0 border-0 p-0 m-0">
      <div className="max-w-7xl mx-auto flex flex-col xl:flex-row gap-6">
        <div className="flex-1 min-w-0">
          
          {/* ⚡ THE RESTORED BACK BUTTON */}
          <button 
            onClick={() => handleSafeNavigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4 font-medium transition-colors bg-transparent border-none p-0 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm -mx-4 px-4 sm:-mx-6 sm:px-6 py-3 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2 truncate">
                  <span className="truncate">{quoteId ? (existingQuote?.is_template ? "Edit Template" : "Edit Quote") : (isTemplate ? "New Template" : "New Quote")}</span>
                  {existingQuote && !existingQuote?.is_template && <StatusBadge status={existingQuote.status} />}
                  {form.internal_review_status && <span className="text-xs font-medium text-amber-800">Internal review: {form.internal_review_status === "Approved" ? "Approved for sending" : form.internal_review_status === "Changes Required" ? "Changes required" : "Awaiting review"}</span>}
                </h1>
                {existingQuote?.quote_number && !existingQuote?.is_template && <p className="text-xs text-slate-500 mt-0.5">{existingQuote.quote_number}</p>}
              </div>
              
              <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                {isTemplate || existingQuote?.is_template ? (
                  <Button size="sm" onClick={() => handleSave("Template")} disabled={saving} className="bg-slate-900 text-white h-8 px-2 text-xs">
                    <Save className="h-3 w-3 mr-1" /> Save
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 text-white h-8 px-2 text-xs">
                      <Save className="h-3 w-3 mr-1" /> Save
                    </Button>
                    {quoteId && renderActionsMenu('top')}
                  </>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {isTemplate || existingQuote?.is_template ? (
                  <Button size="sm" onClick={() => handleSave("Template")} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white">
                    <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Template"}
                  </Button>
                ) : (
                  <>
                    {quoteId && phases.length > 0 && (
                      <Button onClick={refreshPricingFromProducts} variant="ghost" size="sm" className="text-slate-600">
                        <Download className="h-4 w-4 mr-2" /> Refresh Pricing
                      </Button>
                    )}
                    
                    {/* ⚡ THE ACTUAL CANCEL BUTTON */}
                    <Button onClick={() => handleSafeNavigate(isTemplate || existingQuote?.is_template ? "/Templates" : "/Quotes")} variant="outline" size="sm" className="bg-white w-full sm:w-auto">
                      Cancel
                    </Button>
                    
                    <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                      <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Draft"}
                    </Button>
                    {quoteId && renderActionsMenu('top')}
                  </>
                )}
              </div>
            </div>
          </div>

          <Card className="p-5 mb-4 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 shadow-lg">
            <div className="mb-3">
              <Label className="block text-slate-900 font-medium">Hero Banner Image</Label>
              <p className="text-xs text-slate-900 mt-1">Display image at the top of the quote (shown in digital view and PDF)</p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {form.hero_image_url ? (
                <div className="relative w-full">
                  <img src={form.hero_image_url} alt="Hero" className="w-full h-48 object-cover rounded border shadow-md" />
                  <button
                    onClick={() => setForm({ ...form, hero_image_url: "" })}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center"
                  >×</button>
                </div>
              ) : (
                <label className="flex-1 min-h-[120px] border-2 border-dashed border-slate-300 rounded flex items-center justify-center cursor-pointer hover:border-amber-600 transition-colors bg-white/50">
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleEndPhotoUpload(e.target.files[0])} />
                  <Image className="h-8 w-8 text-slate-400" />
                </label>
              )}
            </div>
          </Card>

          <Card className="p-5 mb-4 bg-slate-50 border-2 border-amber-400 shadow-sm">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-900 font-medium">{isTemplate || existingQuote?.is_template ? "Template Name *" : "Title *"}</Label>
                <Input value={localTitle} onChange={e => { setLocalTitle(e.target.value); setForm(f => ({...f, title: e.target.value})); }} placeholder="Kitchen Renovation" className="bg-white text-slate-900" />
              </div>
              
              {!(isTemplate || existingQuote?.is_template) && (
                <>
                  {quoteId && (
                    <div>
                      <Label className="text-slate-900 font-medium">Quote Number</Label>
                      <Input value={form.quote_number || ""} placeholder="e.g. QT-1001" className="bg-white text-slate-900" disabled />
                    </div>
                  )}
                  <div>
                    <Label className="text-slate-900 font-medium">Client/Lead</Label>
                    <div className="flex gap-2">
                      <Select value={form.client_id || form.lead_id || ""} onValueChange={handleContactChange}>
                        <SelectTrigger className="bg-white"><SelectValue placeholder="Select contact..." /></SelectTrigger>
                        <SelectContent>
                          
                          {leads.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">Active Leads</SelectLabel>
                              {leads.map(l => <SelectItem key={l.id} value={l.id}>
  {l.contact_name || "Unnamed Lead"}
</SelectItem>)}
                            </SelectGroup>
                          )}

                          {clients.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">Clients</SelectLabel>
                              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectGroup>
                          )}

                        </SelectContent>
                      </Select>
                      <CreateClientDialog onClientCreated={handleContactChange}>
                        <Button type="button" variant="outline" size="icon" title="Create New Client" className="bg-white">
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      </CreateClientDialog>
                    </div>
                  </div>
                  <div>
                    <Label className="text-slate-900 font-medium">Site Address</Label>
                    <AddressAutocomplete value={form.site_address || ""} onChange={v => setForm({...form, site_address: v})} placeholder="Start typing an address..." className="bg-white text-slate-900" />
                  </div>
                  <div>
                    <Label className="text-slate-900 font-medium">Issue Date</Label>
                    <Input type="date" value={form.issue_date} onChange={e => setForm({...form, issue_date: e.target.value})} className="bg-white text-slate-900" />
                  </div>
                  <div>
                    <Label className="text-slate-900 font-medium">Expiry Date</Label>
                    <Input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} className="bg-white text-slate-900" />
                  </div>
                  <div>
                    <Label htmlFor="quote-next-follow-up-date" className="text-slate-900 font-medium">Next Follow-up Date</Label>
                    <Input id="quote-next-follow-up-date" type="date" value={form.next_follow_up_date} onChange={e => setForm(f => ({...f, next_follow_up_date: e.target.value}))} aria-describedby="quote-follow-up-hint" className="h-11 bg-white text-slate-900" />
                    <p id="quote-follow-up-hint" className="mt-1 text-xs text-slate-500">Optional date to remind your team to follow up.</p>
                  </div>
                </>
              )}

              <div className={isTemplate || existingQuote?.is_template ? "md:col-span-1" : "md:col-span-2"}>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-slate-900 font-medium">Introduction</Label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={form.show_overall_scope} onChange={e => setForm({...form, show_overall_scope: e.target.checked})} className="rounded border-slate-300" />
                    Show to client
                  </label>
                </div>
                <Textarea value={localOverallScope} onChange={e => { setLocalOverallScope(e.target.value); setForm(f => ({...f, overall_scope: e.target.value})); }} rows={3} placeholder="Describe the overall project scope..." className="bg-white" />
              </div>
            </div>
          </Card>

          <div className="space-y-4 mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Phases / Rooms</h3>
              <div className="flex gap-2">
                <Button onClick={() => setShowImportQuoteTemplateDialog(true)} variant="outline" size="sm" className="text-slate-900 bg-white">
                  <Copy className="h-4 w-4 mr-2" /> Import Template
                </Button>
                <Button onClick={() => setShowTemplateDialog(true)} className="bg-gradient-to-br from-amber-500 to-amber-600 text-slate-900 shadow-sm">
                  <Plus className="h-4 w-4 mr-2" /> Add Phase
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {phases.map((phase, phaseIdx) => (
                <React.Fragment key={phase.id || `phase-${phaseIdx}`}>
                  <PhaseCard
                    phase={phase} phaseIdx={phaseIdx} phases={phases} products={products}
                    onUpdatePhase={updatePhase} onRemovePhase={removePhase} onDuplicatePhase={duplicatePhase}
                    onAddLineItem={addLineItem} onUpdateLineItem={updateLineItem} onDuplicateLineItem={duplicateLineItem}
                    onMoveLineItem={moveLineItem} onReorderLineItems={reorderLineItems} onRemoveLineItem={removeLineItem}
                    onPhotoUpload={handlePhotoUpload} onLineItemPhotoUpload={handleLineItemPhotoUpload}
                    onSplitLineItem={handleSplitLineItem} // ⚡ ADD THIS LINE HERE
                    calculatePhaseSubtotal={calculatePhaseSubtotal} calculatePhaseCost={calculatePhaseCost} calculatePhaseMargin={calculatePhaseMargin} calculatePhaseMarginPercent={calculatePhaseMarginPercent} calculatePhaseTax={calculatePhaseTax} calculatePhaseTotal={calculatePhaseTotal}
                    clientSelections={existingQuote?.client_selected_items_json ? JSON.parse(existingQuote.client_selected_items_json) : null}
                    onMovePhaseUp={() => movePhaseUp(phaseIdx)} onMovePhaseDown={() => movePhaseDown(phaseIdx)}
                    isFirst={phaseIdx === 0} isLast={phaseIdx === phases.length - 1}
                  />
                  
                  <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-2 mb-6 bg-slate-50 p-2 sm:p-3 rounded-lg border border-slate-200 border-dashed">
  
  <Button 
    onClick={() => {
      setPhaseIndexToSave(phaseIdx); 
      setPhaseTemplateForm({ template_name: `${phase.phase_name} Template`, description: "" });
      setShowSavePhaseTemplateDialog(true);
    }} 
    variant="outline" 
    size="sm" 
    className="w-full sm:w-auto text-slate-900 bg-white order-3 sm:order-1"
  >
    <Save className="h-4 w-4 mr-2 shrink-0" /> Save Phase as Template
  </Button>
  
  <Button 
    onClick={() => setShowImportQuoteTemplateDialog(true)} 
    variant="outline" 
    size="sm" 
    className="w-full sm:w-auto text-slate-900 bg-white order-2 sm:order-2"
  >
    <Copy className="h-4 w-4 mr-2 shrink-0" /> Import Template Here
  </Button>
  
  <Button 
    onClick={() => setShowTemplateDialog(true)} 
    className="w-full sm:w-auto bg-amber-400 hover:bg-amber-500 text-slate-900 shadow-sm order-1 sm:order-3 h-9 sm:h-8" 
    size="sm"
  >
    <Plus className="h-4 w-4 mr-2 shrink-0" /> Add Next Phase
  </Button>
  
</div>
                </React.Fragment>
              ))}
            </div>

            {phases.length === 0 && (
              <Card className="p-8 text-center bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 border-dashed shadow-lg">
                <p className="text-slate-900 mb-3 font-medium">No phases added yet</p>
                <Button onClick={addPhase} variant="outline" className="bg-white text-slate-900 border-slate-300">
                  <Plus className="h-4 w-4 mr-2" /> Add First Phase
                </Button>
              </Card>
            )}
          </div>

          <Card className="p-4 sm:p-5 mb-4 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 shadow-lg">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 sm:gap-6">
              <div className="flex-1 w-full">
                {form.has_payment_schedule && paymentScheduleItems.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-3 text-sm">Payment Schedule</h4>
                    <div className="space-y-2">
                      {paymentScheduleItems.map((item, idx) => {
                        const displayAmount = item.amount_type === "percentage" ? (grandTotal * safeNum(item.percentage) / 100) : safeNum(item.amount);
                        return (
                          <div key={idx} className="flex justify-between items-center text-sm py-1 border-b border-slate-300/30">
                            <div className="flex-1">
                              <div className="text-slate-900 font-medium">{item.payment_name}</div>
                              <div className="text-xs text-slate-700">{item.due_event}</div>
                            </div>
                            <div className="text-slate-900 font-semibold">
                              {item.amount_type === "percentage" ? <span>{item.percentage}% ({formatCurrencyUSD(displayAmount)})</span> : <span>{formatCurrencyUSD(displayAmount)}</span>}
                            </div>
                            <div className="flex gap-1 ml-2">
                              <Button size="sm" variant="ghost" onClick={() => { setPaymentForm({ payment_name: item.payment_name, due_event: item.due_event, amount: item.amount || 0, amount_type: item.amount_type || "fixed", percentage: item.percentage || 0 }); setEditingPaymentIndex(idx); setShowPaymentDialog(true); }} className="text-blue-600 hover:text-blue-700 h-6 w-6 p-0">
                                <Settings className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => removePaymentScheduleItem(idx)} className="text-red-600 hover:text-red-700 h-6 w-6 p-0">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 text-right w-full sm:w-auto">
                <div className="text-base sm:text-lg"><span className="text-slate-900">Subtotal:</span> <span className="font-bold text-slate-900">{formatCurrencyUSD(effectiveSubtotal)}</span></div>
                
                {/* 5. DUAL-TAX UI UPGRADE */}
                <div className="text-base sm:text-lg">
                  <span className="text-slate-900">{settings?.tax_label || "Tax"}:</span> 
                  <span className="font-bold text-slate-900 ml-2">{formatCurrencyUSD(grandPrimaryTax)}</span>
                </div>
                {settings?.enable_secondary_tax && (
                  <div className="text-base sm:text-lg">
                    <span className="text-slate-900">{settings?.secondary_tax_label || "PST"}:</span> 
                    <span className="font-bold text-slate-900 ml-2">{formatCurrencyUSD(grandSecondaryTax)}</span>
                  </div>
                )}

                {discountAmount > 0 && (
                  <div className="text-lg text-red-600">
                    <span>Discount:</span>
                    <span className="font-bold ml-2">-{form.discount_type === "percentage" ? `${form.discount_percentage}% ` : ""}{formatCurrencyUSD(discountAmount).slice(1)}</span>
                  </div>
                )}
                <div className="text-xl sm:text-2xl font-bold text-slate-900 border-t-2 border-slate-300 pt-2 mb-4">Total: {formatCurrencyUSD(grandTotal)}</div>
                
                <div className="space-y-2 border-t-2 border-slate-300 pt-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-slate-900 font-medium">Discount</Label>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant={form.discount_type === "fixed" ? "default" : "outline"} onClick={() => setForm({...form, discount_type: "fixed"})} className={`h-6 px-2 text-xs ${form.discount_type === "fixed" ? "" : "bg-white text-slate-600"}`}>$</Button>
                        <Button type="button" size="sm" variant={form.discount_type === "percentage" ? "default" : "outline"} onClick={() => setForm({...form, discount_type: "percentage"})} className={`h-6 px-2 text-xs ${form.discount_type === "percentage" ? "" : "bg-white text-slate-600"}`}>%</Button>
                      </div>
                    </div>
                    {form.discount_type === "fixed" ? (
                      <Input type="number" step="0.01" value={form.discount_amount} onChange={e => setForm({...form, discount_amount: Number(e.target.value)})} placeholder="0.00" className="bg-white text-slate-900 text-right min-w-[120px]" />
                    ) : (
                      <Input type="number" step="0.01" value={form.discount_percentage} onChange={e => setForm({...form, discount_percentage: Number(e.target.value)})} placeholder="0.00" className="bg-white text-slate-900 text-right min-w-[120px]" />
                    )}
                  </div>
                  
                  {/* 6. DEPOSIT REQUIRED OVERRIDE */}
                  <div className="pt-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-slate-900 font-medium">Deposit Required</Label>
                      <span className="text-[10px] font-bold text-slate-600 bg-white/50 px-1.5 py-0.5 rounded">{settings?.default_deposit ?? 0}% Default</span>
                    </div>
                    <Input 
                      type="number" 
                      step="0.01" 
                      value={form.deposit_amount} 
                      onChange={e => {
                        setManualDeposit(true);
                        setForm({...form, deposit_amount: Number(e.target.value)});
                      }} 
                      placeholder="0.00" 
                      className="bg-white text-slate-900 text-right min-w-[120px]" 
                    />
                  </div>
                </div>

              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 mb-4 bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-300 shadow-sm">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-slate-900 font-bold text-base">Total Cost vs Revenue</Label>
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-2">
                    <div>
                      <p className="text-xs text-slate-600">Total Cost</p>
                      <p className="text-sm sm:text-lg font-semibold text-slate-900">{formatCurrencyUSD(grandCost)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">Revenue</p>
                      <p className="text-sm sm:text-lg font-semibold text-slate-900">{formatCurrencyUSD(effectiveSubtotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">Margin</p>
                      <p className="text-sm sm:text-lg font-semibold text-green-700">{formatCurrencyUSD(baseMargin)}</p>
                      <p className="text-xs text-green-600">{baseMarginPercent.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
                <div className="text-right bg-white px-3 py-2 sm:px-4 sm:py-3 rounded-lg border-2 border-green-200 shrink-0 min-w-[160px]">
                  <p className="text-sm text-green-700 font-medium">Final Margin</p>
                  <p className="text-xl sm:text-2xl font-bold text-green-700">{formatCurrencyUSD(currentMarginAmount)}</p>
                  <p className="text-sm text-green-600">{currentMarginPercent.toFixed(1)}%</p>
                </div>
              </div>
              <div className="border-t border-green-200 pt-4">
                <Label className="text-slate-900 font-medium block mb-2">Adjust Margin (Optional)</Label>
                <p className="text-xs text-slate-600 mb-3">Override calculated margin with fixed amount or percentage</p>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs text-slate-700">Margin</Label>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant={form.margin_adjustment_type === "fixed" ? "default" : "outline"} onClick={() => setForm({...form, margin_adjustment_type: "fixed", margin: currentMarginAmount})} className={`h-6 px-2 text-xs ${form.margin_adjustment_type === "fixed" ? "" : "bg-white text-slate-600"}`}>$</Button>
                        <Button type="button" size="sm" variant={form.margin_adjustment_type === "percentage" ? "default" : "outline"} onClick={() => setForm({...form, margin_adjustment_type: "percentage", margin: currentMarginPercent})} className={`h-6 px-2 text-xs ${form.margin_adjustment_type === "percentage" ? "" : "bg-white text-slate-600"}`}>%</Button>
                      </div>
                    </div>
                    {form.margin_adjustment_type === "fixed" ? (
                      <Input type="number" step="0.01" value={form.margin} onChange={e => setForm({...form, margin: Number(e.target.value)})} placeholder="0.00" className="bg-white text-slate-900 min-w-[120px]" />
                    ) : (
                      <Input type="number" step="0.1" value={form.margin} onChange={e => setForm({...form, margin: Number(e.target.value)})} placeholder="0.0" className="bg-white text-slate-900 min-w-[120px]" />
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({...form, margin_adjustment_type: "none", margin: 0})} className="h-8 bg-white">Reset</Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 mb-4 bg-slate-50 border-2 border-amber-400 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={form.has_payment_schedule} onChange={e => setForm({...form, has_payment_schedule: e.target.checked})} className="rounded border-slate-300 cursor-pointer" />
                <Label className="cursor-pointer text-slate-900 font-medium">Use Payment Schedule</Label>
              </div>
              {form.has_payment_schedule && (
                <Button size="sm" onClick={() => setShowPaymentDialog(true)} variant="outline" className="bg-white">
                  <Plus className="h-4 w-4 mr-1" /> Add Payment
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-5 mb-4 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 shadow-lg">
            <div className="mb-3">
              <Label className="block text-slate-900 font-medium">Past Project Photos</Label>
              <p className="text-xs text-slate-900 mt-1">Showcase similar completed projects to the client</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.end_photos.map((photo, idx) => (
                <div key={photo} className="relative">
                  <img src={photo} alt="" className="h-24 w-24 object-cover rounded border" />
                  <button onClick={() => setForm({ ...form, end_photos: form.end_photos.filter((_, i) => i !== idx) })} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center">×</button>
                </div>
              ))}
              <label className="h-24 w-24 border-2 border-dashed border-slate-300 rounded flex items-center justify-center cursor-pointer hover:border-amber-400 transition-colors bg-white/50">
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && e.target.files.length > 0 && handleMultiplePhotosUpload(e.target.files)} />
                <Image className="h-8 w-8 text-slate-400" />
              </label>
            </div>
          </Card>

          <Card className="p-5 mb-4 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 shadow-lg">
            <div className="mb-3">
              <Label className="block text-slate-900 font-medium">Attached Documents</Label>
              <p className="text-xs text-slate-900 mt-1">Upload documents to share with the client (PDFs, contracts, specifications, etc.)</p>
            </div>
            
            {form.documents.length > 0 && (
              <div className="space-y-2 mb-4">
                {form.documents.map((doc, idx) => (
                  <div key={doc.file_url || idx} className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-amber-50 flex items-center justify-center border border-amber-100">
                        <FileText className="h-4 w-4 text-amber-600" />
                      </div>
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-slate-700 hover:text-amber-600">{doc.file_name}</a>
                    </div>
                    <button onClick={() => handleDocumentDelete(idx)} className="text-red-500 hover:text-red-700 p-2"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-amber-500 hover:bg-amber-50/50 transition-colors bg-white/60 group shadow-sm">
                <div className="h-10 w-10 bg-white shadow-sm rounded-full flex items-center justify-center border border-slate-200 group-hover:border-amber-300 transition-colors">
                  <Upload className="h-5 w-5 text-slate-500 group-hover:text-amber-600" />
                </div>
                <div className="text-center mt-1">
                  <span className="text-sm font-bold text-slate-800 block group-hover:text-amber-700">Device</span>
                  <span className="text-xs text-slate-600 mt-0.5 block">Upload from computer/phone</span>
                </div>
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleDocumentUpload(e.target.files[0])} />
              </label>

              <button type="button" onClick={() => setShowResourceDialog(true)} className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-slate-200 border-dashed rounded-xl cursor-pointer hover:border-amber-500 hover:bg-amber-50/50 transition-colors bg-white/60 shadow-sm group">
                <div className="h-10 w-10 bg-white rounded-full shadow-sm flex items-center justify-center border border-slate-200 group-hover:border-amber-300 transition-colors">
                  <BookOpen className="h-5 w-5 text-slate-500 group-hover:text-amber-600" />
                </div>
                <div className="text-center mt-1">
                  <span className="text-sm font-bold text-slate-800 block group-hover:text-amber-700">Resources</span>
                  <span className="text-xs text-slate-600 mt-0.5 block">Attach flyers, WCB, forms</span>
                </div>
              </button>
            </div>
          </Card>

          <Card className="p-5 mb-6 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-600 border-yellow-500/30 shadow-lg">
            <div className="grid md:grid-cols-2 gap-4 items-start">
              <div>
                <Label className="text-slate-900 font-medium block">Client Message</Label>
                <p className="text-xs text-slate-900 mb-2">Personal message shown to the client on their quote</p>
                <Textarea value={localClientMessage} onChange={e => { setLocalClientMessage(e.target.value); setForm(f => ({...f, client_message: e.target.value})); }} rows={3} placeholder="Thank you for choosing us for your project..." className="bg-white" />
              </div>
              <div>
                <Label className="text-slate-900 font-medium block">Terms & Conditions</Label>
                <p className="text-xs text-slate-900 mb-2">Of this quote.</p>
                <Textarea value={localTerms} onChange={e => { setLocalTerms(e.target.value); setForm(f => ({...f, terms: e.target.value})); }} rows={3} className="bg-white text-slate-900" />
              </div>
            </div>
            <div className="mt-4">
              <Label className="text-slate-900 font-medium flex items-center gap-2">
                Internal Notes
                <span className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-900">Not shown to client</span>
              </Label>
              <Textarea value={localNotes} onChange={e => { setLocalNotes(e.target.value); setForm(f => ({...f, notes: e.target.value})); }} rows={2} placeholder="Internal notes about this quote..." className="bg-white/80" />
            </div>
          </Card>

          {/* SIMPLE CREATION LOG */}
          {existingQuote?.created_at && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-6 flex justify-center items-center text-xs text-slate-500 font-medium shadow-sm">
              Created by {creatorProfile?.full_name || "Unknown User"} on {new Date(existingQuote.created_at).toLocaleDateString()} at {new Date(existingQuote.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm mt-6">
            <Link to={isTemplate || existingQuote?.is_template ? "/Templates" : "/Quotes"} className="w-full sm:w-auto">
              <Button variant="outline" size="sm" className="bg-white w-full sm:w-auto">
  Cancel
</Button>
            </Link>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              {isTemplate || existingQuote?.is_template ? (
                <Button size="sm" onClick={() => handleSave("Template")} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white w-full sm:w-auto">
                  <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Template"}
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm w-full sm:w-auto">
                    <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Draft"}
                  </Button>
                  {quoteId && renderActionsMenu('bottom')}
                </>
              )}
            </div>
          </div>
        </div>

        {quoteId && (
          <QuoteBuilderSidebar allDocuments={allDocuments} allPhotos={allPhotos} notes={[]} className="xl:w-80 w-full" />
        )}
      </div>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Phase/Room</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Choose how to add a new phase:</p>
            <Button variant="outline" className="w-full justify-start h-auto py-3 px-4" onClick={() => { addPhase(); setShowTemplateDialog(false); }}>
              <div className="text-left">
                <p className="font-semibold">Blank Phase</p>
                <p className="text-xs text-slate-500">Start from scratch</p>
              </div>
            </Button>
            {phaseTemplates.length > 0 ? (
              <>
                <div className="text-xs text-slate-500 uppercase font-semibold">Or select a template:</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {phaseTemplates.map(template => (
                    <Button key={template.id} variant="outline" className="w-full justify-start h-auto py-3 px-4 hover:border-amber-400 hover:bg-amber-50" onClick={() => { addPhaseFromTemplate(template); setShowTemplateDialog(false); }}>
                      <div className="text-left">
                        <p className="font-semibold">{template.template_name}</p>
                        <p className="text-xs text-slate-500">{template.phase_name}</p>
                        {template.description && <p className="text-xs text-slate-400 mt-1">{template.description}</p>}
                      </div>
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400 text-center py-2">No templates available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSavePhaseTemplateDialog} onOpenChange={setShowSavePhaseTemplateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save Phase as Template</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template Name *</Label>
              <Input 
                value={phaseTemplateForm.template_name} 
                onChange={e => setPhaseTemplateForm({...phaseTemplateForm, template_name: e.target.value})} 
                placeholder="e.g. Standard Rough-in Plumbing"
              />
            </div>
            <div>
              <Label>Description (Optional)</Label>
              <Textarea 
                value={phaseTemplateForm.description} 
                onChange={e => setPhaseTemplateForm({...phaseTemplateForm, description: e.target.value})} 
                placeholder="What does this template include?"
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSavePhaseTemplateDialog(false)}>Cancel</Button>
              <Button 
                onClick={handleSavePhaseAsTemplate} 
                className="bg-slate-900 hover:bg-slate-800 text-white"
                disabled={!phaseTemplateForm.template_name || savePhaseTemplateMutation.isPending}
              >
                {savePhaseTemplateMutation.isPending ? "Saving..." : "Save Template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportQuoteTemplateDialog} onOpenChange={setShowImportQuoteTemplateDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Full Quote Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Import all phases, line items, and settings from a saved quote template:</p>
            {quoteTemplates.length > 0 ? (
              <div className="space-y-2">
                {quoteTemplates.map(template => (
                  <Button 
                    key={template.id} 
                    variant="outline" 
                    className="w-full justify-start h-auto py-4 px-4 hover:border-amber-400 hover:bg-amber-50" 
                    onClick={async () => {
                      try {
                        const { data: templatePhasesData } = await supabase.from("quote_phases").select("*").eq("quote_id", template.id).order("sort_order", { ascending: true });
                        const { data: templateItemsData } = await supabase.from("quote_line_items").select("*").eq("quote_id", template.id).order("display_order", { ascending: true });
                        const { data: templateScheduleData } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", template.id).order("sort_order", { ascending: true });

                        const importedPhases = (templatePhasesData || []).map(phase => ({
                          items: (templateItemsData || []).filter(item => item.phase_id === phase.id).map(item => ({
                            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            name: item.name, description: item.description || "", quantity: Number(item.quantity) || 1, unit: item.unit || "ea",
                            unit_cost: Number(item.unit_cost) || 0, unit_price: Number(item.unit_price) || 0, 
                            material_cost: Number(item.material_cost) || 0, labor_cost: Number(item.labor_cost) || 0, // ⚡ THIS IS CRITICAL
                            taxable: item.taxable !== false, product_id: item.product_id || "", photo_url: item.photo_url || "", 
                            is_optional: item.is_optional === true, default_selected: item.default_selected === true,
                            is_material: item.is_material === true, supplier: item.supplier || null
                          }))
                        }));

                        setPhases([...phases, ...importedPhases]);

                        if (templateScheduleData?.length > 0) {
                          const importedSchedule = templateScheduleData.map(item => ({
                            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            payment_name: item.payment_name, due_event: item.due_event || "",
                            amount: item.amount || 0, amount_type: item.amount_type || "fixed", percentage: item.percentage || 0
                          }));
                          setPaymentScheduleItems([...paymentScheduleItems, ...importedSchedule]);
                        }

                        if (!form.overall_scope && template.overall_scope) { setForm(prev => ({ ...prev, overall_scope: template.overall_scope })); setLocalOverallScope(template.overall_scope); }
                        if (!form.client_message && template.client_message) { setForm(prev => ({ ...prev, client_message: template.client_message })); setLocalClientMessage(template.client_message); }
                        if (!form.terms && template.terms) { setForm(prev => ({ ...prev, terms: template.terms })); setLocalTerms(template.terms); }
                        if (template.hero_image_url) { setForm(prev => ({ ...prev, hero_image_url: template.hero_image_url })); }
                        if (template.end_photos && template.end_photos.length > 0) { setForm(prev => ({ ...prev, end_photos: [...prev.end_photos, ...template.end_photos] })); }
                        if (template.documents && template.documents.length > 0) { setForm(prev => ({ ...prev, documents: [...prev.documents, ...template.documents] })); }

                        setShowImportQuoteTemplateDialog(false);
                        toast.success(`Imported ${importedPhases.length} phases from template`);
                      } catch (error) { toast.error("Failed to import template"); }
                    }}
                  >
                    <div className="text-left flex-1">
                      <p className="font-semibold text-base">{template.title}</p>
                      {template.overall_scope && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{template.overall_scope}</p>}
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500 mb-3">No quote templates available</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* NEW: RESOURCE LIBRARY DIALOG */}
      <Dialog open={showResourceDialog} onOpenChange={setShowResourceDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-black text-xl flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber-500" /> Company Resources</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search flyers, WCB, warranties..." 
                value={resourceSearch} 
                onChange={e => setResourceSearch(e.target.value)} 
                className="pl-9"
              />
            </div>
            
            {loadingResources ? (
               <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full"></div></div>
            ) : (
               <div className="space-y-2">
                 {companyResources.filter(r => r.name.toLowerCase().includes(resourceSearch.toLowerCase()) || r.file_name.toLowerCase().includes(resourceSearch.toLowerCase())).map(res => (
                   <div key={res.id} className="flex items-center justify-between p-3 bg-slate-50 hover:bg-amber-50/50 rounded-xl border border-slate-200 transition-colors group">
                     <div className="flex items-center gap-3">
                       <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center border border-slate-200 shadow-sm group-hover:border-amber-300">
                         <FileText className="h-5 w-5 text-slate-500 group-hover:text-amber-600" />
                       </div>
                       <div>
                         <p className="font-bold text-sm text-slate-900 group-hover:text-amber-800 transition-colors">{res.name}</p>
                         <p className="text-xs font-medium text-slate-500">{res.file_name}</p>
                       </div>
                     </div>
                     <Button size="sm" onClick={() => {
                       // Attach it to the quote's documents array
                       setForm(prev => ({ ...prev, documents: [...prev.documents, { file_url: res.file_url, file_name: res.file_name }] }));
                       setShowResourceDialog(false);
                       toast.success("Document attached to quote!");
                     }} className="bg-white border-2 border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white font-bold shadow-sm transition-all">
                       Attach
                     </Button>
                   </div>
                 ))}
                 
                 {companyResources.length === 0 && (
                   <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                      <BookOpen className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-600">No resources found.</p>
                      <p className="text-xs text-slate-500 mt-1">Upload files in the Resource Library tab first.</p>
                   </div>
                 )}
               </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog} onOpenChange={(open) => { setShowPaymentDialog(open); if (!open) { setEditingPaymentIndex(null); setPaymentForm({ payment_name: "", due_event: "", amount: 0, amount_type: "fixed", percentage: 0 }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payment Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-medium text-slate-900">Quote Total: <span className="text-amber-600">{formatCurrencyUSD(grandTotal)}</span></p>
              <p className="text-sm text-slate-600">Scheduled: <span className="font-semibold">{formatCurrencyUSD(paymentScheduleTotal)}</span></p>
              <p className="text-sm text-slate-600">Remaining: <span className="font-semibold">{formatCurrencyUSD(remainingAmount)}</span></p>
            </div>

            {paymentScheduleItems.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm font-semibold text-slate-900">Current Schedule ({paymentScheduleItems.length})</Label>
                {paymentScheduleItems.map((item, idx) => {
                  const displayAmount = item.amount_type === "percentage" ? (grandTotal * safeNum(item.percentage) / 100) : safeNum(item.amount);
                  return (
                    <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-900">{item.payment_name}</div>
                        <div className="text-xs text-slate-600">{item.due_event}</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mr-3">
                        {item.amount_type === "percentage" ? <span>{item.percentage}% ({formatCurrencyUSD(displayAmount)})</span> : <span>{formatCurrencyUSD(displayAmount)}</span>}
                      </div>
                      <div className="flex gap-1 ml-2">
                        <Button size="sm" variant="ghost" onClick={() => { setPaymentForm({ payment_name: item.payment_name, due_event: item.due_event, amount: item.amount || 0, amount_type: item.amount_type || "fixed", percentage: item.percentage || 0 }); setEditingPaymentIndex(idx); setShowPaymentDialog(true); }} className="text-blue-600 hover:text-blue-700 h-6 w-6 p-0">
                          <Settings className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removePaymentScheduleItem(idx)} className="text-red-600 hover:text-red-700 h-6 w-6 p-0">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-semibold text-slate-900">{editingPaymentIndex !== null ? "Edit Payment" : "Add New Payment"}</Label>
              <div>
                <Label>Payment Name *</Label>
                <Input value={paymentForm.payment_name} onChange={e => setPaymentForm({...paymentForm, payment_name: e.target.value})} placeholder="e.g., Deposit, First Payment, Final Payment" />
              </div>
              <div>
                <Label>Due Event / Milestone</Label>
                <div className="flex gap-2">
                  <Select onValueChange={(v) => setPaymentForm({...paymentForm, due_event: v})}>
                    <SelectTrigger className="w-[180px] bg-white"><SelectValue placeholder="Presets..." /></SelectTrigger>
                    <SelectContent>
                      {["Upon Approval", "Start of Project", "Materials Delivered", "50% Complete", "Rough-ins Complete", "Substantial Completion", "Upon Completion", "Final Sign-off"].map(e => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input 
                    value={paymentForm.due_event} 
                    onChange={(e) => setPaymentForm({...paymentForm, due_event: e.target.value})} 
                    placeholder="Type or select a milestone..."
                    className="bg-white flex-1"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Amount *</Label>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={paymentForm.amount_type === "fixed" ? "default" : "outline"} onClick={() => setPaymentForm({...paymentForm, amount_type: "fixed"})} className={`h-6 px-2 text-xs ${paymentForm.amount_type === "fixed" ? "" : "bg-white text-slate-600"}`}>$</Button>
                    <Button type="button" size="sm" variant={paymentForm.amount_type === "percentage" ? "default" : "outline"} onClick={() => setPaymentForm({...paymentForm, amount_type: "percentage"})} className={`h-6 px-2 text-xs ${paymentForm.amount_type === "percentage" ? "" : "bg-white text-slate-600"}`}>%</Button>
                  </div>
                </div>
                {paymentForm.amount_type === "fixed" ? (
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-900 font-medium">$</span>
                    <Input type="number" value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: parseFloat(e.target.value) || 0})} placeholder="0.00" className="pl-7" step="0.01" min="0" />
                  </div>
                ) : (
                  <div className="relative">
                    <Input type="number" value={paymentForm.percentage} onChange={e => setPaymentForm({...paymentForm, percentage: parseFloat(e.target.value) || 0})} placeholder="0.00" className="pr-7" step="0.01" min="0" max="100" />
                    <span className="absolute right-3 top-2.5 text-slate-900 font-medium">%</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                {editingPaymentIndex !== null && (
                  <Button variant="outline" size="sm" onClick={() => { setPaymentForm({ payment_name: "", due_event: "", amount: 0, amount_type: "fixed", percentage: 0 }); setEditingPaymentIndex(null); }}>Cancel Edit</Button>
                )}
                <Button size="sm" onClick={addPaymentScheduleItem} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-medium">
                  {editingPaymentIndex !== null ? <><Save className="h-4 w-4 mr-2" /> Update</> : <><Plus className="h-4 w-4 mr-2" /> Add Payment</>}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button onClick={() => setShowPaymentDialog(false)} className="bg-blue-600 hover:bg-blue-700">Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Quote to...</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-4">
            <Button
              onClick={() => handleConvertQuoteAction("project")}
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
              onClick={() => handleConvertQuoteAction("invoice")}
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
              onClick={() => handleConvertQuoteAction("both")}
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

      {/* 📧 EMAIL DIALOG */}
      <SendQuoteEmailDialog 
        open={emailDialog && sendMethod === "email"} 
        onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
        quoteId={quoteId} 
        quoteName={form.title}
        clientName={clients.find(c => c.id === form.client_id)?.name}
        clientEmail={clients.find(c => c.id === form.client_id)?.email}
        onSuccess={() => {
          hydrateForm(prev => ({ ...prev, status: "Sent" }));
          queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
          queryClient.invalidateQueries({ queryKey: ["quotes"] });
        }} 
      />

      {/* 📱 TEXT MESSAGE (SMS) DIALOG */}
      <SendQuoteTextDialog 
        open={emailDialog && sendMethod === "sms"} 
        onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
        quoteId={quoteId} 
        quoteName={form.title}
        clientName={clients.find(c => c.id === form.client_id)?.name}
        clientPhone={clients.find(c => c.id === form.client_id)?.phone}
        onSuccess={() => {
          hydrateForm(prev => ({ ...prev, status: "Sent" }));
          queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
          queryClient.invalidateQueries({ queryKey: ["quotes"] });
        }} 
      />
      </fieldset>
    </div>
  );
}
