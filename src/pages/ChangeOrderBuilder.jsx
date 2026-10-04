import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Save, Send, CheckCircle, Eye, Mail, FolderKanban, Menu, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import PhaseCard from "../components/quotes/PhaseCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "../components/shared/StatusBadge";
import { format } from "date-fns";
import { toast } from "sonner";
import { usePhaseFunctions } from "../components/quotes/usePhaseManagement";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// ⚡ Updated to use the correct Change Order Email Dialog
import SendChangeOrderEmailDialog from "../components/change-orders/SendChangeOrderEmailDialog";
import SendChangeOrderTextDialog from "../components/change-orders/SendChangeOrderTextDialog";
import { useDocumentChanges, useDocumentState } from "@/hooks/useDocumentChanges";
import UnsavedChangesGuard from "@/components/shared/UnsavedChangesGuard";

const safeNum = (val) => {
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

export default function ChangeOrderBuilder() {
  const navigate = useNavigate();

  const { isDirty, markDirty, markSaved, getRevision, hasUnsavedChanges } = useDocumentChanges();
  const handleSafeNavigate = (pathOrDelta) => navigate(pathOrDelta);

  const { profile, settings } = useAuth();
  const companyId = profile?.company_id;

  const params = new URLSearchParams(window.location.search);
  const [coId, setCoId] = useState(params.get("id"));
  const projectId = params.get("project_id");
  const queryClient = useQueryClient();

  const [form, setForm, hydrateForm] = useDocumentState({
    title: "", project_id: projectId || "", status: "Draft", 
    issue_date: format(new Date(), "yyyy-MM-dd"), notes: "", 
    client_message: "Please review the proposed changes to the project scope and cost below.", 
    terms: "These changes will be incorporated into the main project upon approval.",
    overall_scope: "", show_overall_scope: true,
    margin: 0, margin_adjustment_type: "none", change_order_number: ""
  }, markDirty);
  
  const [localTitle, setLocalTitle, hydrateLocalTitle] = useDocumentState("", markDirty);
  const [localOverallScope, setLocalOverallScope, hydrateLocalOverallScope] = useDocumentState("", markDirty);
  const [localClientMessage, setLocalClientMessage, hydrateLocalClientMessage] = useDocumentState("Please review the proposed changes to the project scope and cost below.", markDirty);
  const [localTerms, setLocalTerms, hydrateLocalTerms] = useDocumentState("These changes will be incorporated into the main project upon approval.", markDirty);
  const [localNotes, , hydrateLocalNotes] = useDocumentState("", markDirty);

  const [phases, setPhases, hydratePhases] = useDocumentState([], markDirty);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingCounterUpdate = useRef(null);
  const hasLoadedDocument = useRef(null);
  const hasLoadedPhases = useRef(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [emailDialog, setEmailDialog] = useState(false);
  const [projectClientEmail, setProjectClientEmail] = useState("");
  const [projectClientName, setProjectClientName] = useState("");
  const [projectClientPhone, setProjectClientPhone] = useState("");
  
  // ⚡ New Menu States
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [sendMethod, setSendMethod] = useState("email");
  

  // ⚡ Click outside listener to close the actions menu
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
  
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("projects").select("id, name, project_number, client_id").eq("company_id", companyId); return data || []; } 
  });
  
  const { data: products = [] } = useQuery({ 
    queryKey: ["products", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("products").select("*").eq("company_id", companyId); return data || []; } 
  });
  
  const { data: existingCO, isFetched: documentFetched, isError: documentError, refetch: refetchDocument } = useQuery({
    queryKey: ["change-order", coId, companyId], enabled: !!coId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_orders").select("*").eq("id", coId).eq("company_id", companyId).single();
      if (error) throw error;
      return data;
    },
  });
  
  const { data: existingPhases = [], isFetched: phasesFetched, isError: phasesError, refetch: refetchPhases } = useQuery({
    queryKey: ["change-order-phases", coId, companyId], enabled: !!coId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_order_phases").select("*").eq("change_order_id", coId).eq("company_id", companyId).order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
  
  const { data: existingItems = [], isFetched: itemsFetched, isError: itemsError, refetch: refetchItems } = useQuery({
    queryKey: ["change-order-items", coId, companyId], enabled: !!coId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_order_line_items").select("*").eq("change_order_id", coId).eq("company_id", companyId).order("display_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    const fetchClientInfo = async () => {
      if (!form.project_id) return;
      const project = projects.find(p => p.id === form.project_id);
      if (!project || !project.client_id) return;
      
      const { data } = await supabase.from("clients").select("name, email").eq("id", project.client_id).single();
      if (data) {
        setProjectClientName(data.name);
        setProjectClientEmail(data.email);
        setProjectClientPhone(data.phone || "");
      }
    };
    fetchClientInfo();
  }, [form.project_id, projects]);

  useEffect(() => {
    if (existingCO && hasLoadedDocument.current !== coId) {
      hasLoadedDocument.current = coId;
      hydrateLocalTitle(existingCO.title || "");
      hydrateLocalOverallScope(existingCO.overall_scope || "");
      hydrateLocalClientMessage(existingCO.client_message || "");
      hydrateLocalTerms(existingCO.terms || "");
      hydrateLocalNotes(existingCO.notes || "");
      
      hydrateForm({
        title: existingCO.title || "", project_id: existingCO.project_id || "", 
        status: existingCO.status || "Draft", issue_date: existingCO.issue_date || format(new Date(), "yyyy-MM-dd"), 
        notes: existingCO.notes || "", client_message: existingCO.client_message || "", terms: existingCO.terms || "", 
        overall_scope: existingCO.overall_scope || "", show_overall_scope: existingCO.show_overall_scope !== false,
        margin: existingCO.margin ?? 0, margin_adjustment_type: existingCO.margin_adjustment_type || "none",
        change_order_number: existingCO.change_order_number || ""
      });
    }
  }, [existingCO, coId, hydrateForm, hydrateLocalTitle, hydrateLocalOverallScope, hydrateLocalClientMessage, hydrateLocalTerms, hydrateLocalNotes]);

  useEffect(() => {
    if (phasesFetched && itemsFetched && !phasesError && !itemsError && !hasLoadedPhases.current) {
      hasLoadedPhases.current = true;
      const phasesWithItems = existingPhases.map(phase => ({
        ...phase,
        items: existingItems.filter(item => item.phase_id === phase.id).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      }));
      hydratePhases(phasesWithItems);
    }
  }, [existingPhases, existingItems, phasesFetched, itemsFetched, phasesError, itemsError, hydratePhases]);

  const documentLoadFailed = Boolean(coId && (documentError || phasesError || itemsError));
  const documentLoading = Boolean(coId && (
    documentLoadFailed ||
    !documentFetched || !phasesFetched || !itemsFetched ||
    hasLoadedDocument.current !== coId || !hasLoadedPhases.current
  ));

  const addPhase = () => {
    setPhases([...phases, {
      id: `temp-phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      phase_name: `Change Order Items`, scope_of_work: "", show_scope_to_client: true, internal_notes: "",
      photos: [], sort_order: phases.length, is_optional: false, items: []
    }]);
  };

  const updatePhase = (idx, field, value) => { 
    setPhases(prev => {
      const updated = [...prev]; 
      updated[idx] = { ...updated[idx], [field]: value }; 
      return updated;
    });
  };

  const updateLineItem = (phaseIdx, itemIdx, field, value) => {
    setPhases(prev => {
      const updated = [...prev];
      updated[phaseIdx] = { ...updated[phaseIdx] };
      updated[phaseIdx].items = [...updated[phaseIdx].items];
      updated[phaseIdx].items[itemIdx] = { ...updated[phaseIdx].items[itemIdx], [field]: value };
      return updated;
    });
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
        material_cost: halfCost,
        labor_cost: 0
      };

      const labItem = {
        ...itemToSplit,
        id: `temp-${Date.now()}-lab`,
        name: `${itemToSplit.name} (Labor)`,
        is_material: false,
        supplier: "",
        unit_cost: halfCost,
        unit_price: halfPrice,
        material_cost: 0,
        labor_cost: halfCost
      };

      phaseItems.splice(itemIdx, 1, matItem, labItem);
      updated[phaseIdx] = { ...updated[phaseIdx], items: phaseItems };
      return updated;
    });
    toast.success("Item split into material and labor");
  };

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

  const moveLineItem = (fromPhaseIdx, itemIdx, toPhaseIdx) => {
    const updated = [...phases];
    const [itemToMove] = updated[fromPhaseIdx].items.splice(itemIdx, 1);
    updated[toPhaseIdx].items = [...(updated[toPhaseIdx].items || []), itemToMove];
    setPhases(updated);
    toast.success("Item moved");
  };

  const handlePhotoUpload = async (phaseIdx, files) => {
    setUploadingPhoto(true);
    try {
      const filesArray = Array.from(files);
      const urls = [];
      for (const file of filesArray) {
        const fileName = `${companyId}/change_orders/${coId || 'new'}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('quotes').upload(fileName, file);
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
        urls.push(publicUrl);
      }
      const updated = [...phases];
      updated[phaseIdx].photos = [...(updated[phaseIdx].photos || []), ...urls];
      setPhases(updated);
      toast.success(`${urls.length} photo(s) uploaded`);
    } catch (error) { toast.error("Upload failed"); }
    setUploadingPhoto(false);
  };

  const handleLineItemPhotoUpload = async (phaseIdx, itemIdx, file) => {
    setUploadingPhoto(true);
    try {
      const fileName = `${companyId}/change_orders/${coId || 'new'}/items/${Date.now()}_${file.name}`;
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

  // --- MATH ENGINE ---
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

  const grandTaxableAmount = phases.reduce((sum, phase) => sum + calculatePhaseTaxableAmount(phase), 0);
  const grandPrimaryTax = grandTaxableAmount * primaryTaxRate;
  const grandSecondaryTax = grandTaxableAmount * secondaryTaxRate;
  const grandTax = grandPrimaryTax + grandSecondaryTax;

  const grandTotal = effectiveSubtotal + grandTax;

  const handleSave = async (newStatus = null, skipToast = false) => {
    if (savingRef.current) return null;
    if (documentLoading) {
      if (documentLoadFailed) toast.error("The change order could not be loaded. Please retry before saving.");
      else toast.info("Please wait for the change order to finish loading before saving.");
      return null;
    }
    const saveRevision = getRevision();
    const activeTitle = localTitle;
    if (!activeTitle || !activeTitle.trim()) { toast.error("Please enter a title for this change order."); return null; }
    if (!form.project_id) { toast.error("Please link this change order to a project."); return null; }
    if (!companyId) { toast.error("Your session could not be verified. Please refresh the page."); return null; }

    savingRef.current = true;
    setSaving(true);
    if(!skipToast) toast.loading("Saving Change Order...");
    
    let finalStatus = newStatus !== null ? newStatus : form.status;

    try {
      const latestForm = { ...form, title: activeTitle, overall_scope: localOverallScope, client_message: localClientMessage, terms: localTerms, notes: localNotes };
      
      let coNumber = latestForm.change_order_number;
      let shouldIncrementCounter = false;

      if (!coNumber) {
        const prefix = company?.change_order_number_prefix || "CO-";
        const nextNum = company?.next_change_order_number || 101;
        coNumber = `${prefix}${nextNum}`;
        shouldIncrementCounter = true;
      }

      const coData = {
        company_id: companyId,
        project_id: latestForm.project_id,
        title: latestForm.title,
        change_order_number: coNumber,
        status: finalStatus,
        issue_date: latestForm.issue_date || null,
        notes: latestForm.notes || "",
        client_message: latestForm.client_message || "",
        terms: latestForm.terms || "",
        overall_scope: latestForm.overall_scope || "",
        show_overall_scope: Boolean(latestForm.show_overall_scope),
        margin: safeNum(currentMarginAmount),
        margin_adjustment_type: latestForm.margin_adjustment_type || 'none',
        subtotal: safeNum(effectiveSubtotal),
        tax: safeNum(grandTax), 
        total: safeNum(grandTotal)
      };

      let savedId = coId;

      if (!coId) {
        const { data: newCO, error: coError } = await supabase.from("change_orders").insert([coData]).select().single();
        if (coError) throw new Error(`Change Orders Table: ${coError.message}`);
        savedId = newCO.id;
        hasLoadedDocument.current = savedId;
        hasLoadedPhases.current = true;
        setCoId(savedId);
        hydrateForm(prev => ({ ...prev, change_order_number: coNumber }));
        window.history.replaceState(window.history.state, "", `/ChangeOrderBuilder?id=${savedId}`);
        
        if (shouldIncrementCounter) {
          const currentCounter = company?.next_change_order_number ? Number(company.next_change_order_number) : 101;
          pendingCounterUpdate.current = currentCounter + 1;
        }

      } else {
        const { error: coUpdateError } = await supabase.from("change_orders").update(coData).eq("id", coId).eq("company_id", companyId).select("id").single();
        if (coUpdateError) throw new Error(`Change Orders Update: ${coUpdateError.message}`);
      }

      if (pendingCounterUpdate.current !== null) {
        const { error: counterError } = await supabase.from("companies").update({ next_change_order_number: pendingCounterUpdate.current }).eq("id", companyId).select("id").single();
        if (counterError) throw new Error(`Change Order Number: ${counterError.message}`);
        pendingCounterUpdate.current = null;
      }

      if (coId) {
        const { error: deleteItemsError } = await supabase.from("change_order_line_items").delete().eq("change_order_id", savedId).eq("company_id", companyId);
        if (deleteItemsError) throw new Error(`Remove Line Items: ${deleteItemsError.message}`);
        const { error: deletePhasesError } = await supabase.from("change_order_phases").delete().eq("change_order_id", savedId).eq("company_id", companyId);
        if (deletePhasesError) throw new Error(`Remove Phases: ${deletePhasesError.message}`);
      }

      for (const phase of phases) {
        const { data: insertedPhase, error: phaseError } = await supabase.from("change_order_phases").insert([{
          company_id: companyId, change_order_id: savedId, phase_name: phase.phase_name || "Unnamed Phase",
          scope_of_work: phase.scope_of_work || "", show_scope_to_client: Boolean(phase.show_scope_to_client),
          internal_notes: phase.internal_notes || "", photos: Array.isArray(phase.photos) ? phase.photos : [],
          sort_order: safeNum(phase.sort_order), is_optional: Boolean(phase.is_optional), default_selected: Boolean(phase.default_selected)
        }]).select().single();
        if (phaseError) throw new Error(`Phase Table: ${phaseError.message}`);

        if (phase.items?.length > 0) {
          const itemsToInsert = phase.items.map((item, idx) => ({
            company_id: companyId, change_order_id: savedId, phase_id: insertedPhase.id, name: item.name || "Unnamed Item",
            description: item.description || "", quantity: safeNum(item.quantity) || 1, unit: item.unit || "ea",
            unit_cost: safeNum(item.unit_cost), unit_price: safeNum(item.unit_price), 
            material_cost: safeNum(item.material_cost), labor_cost: safeNum(item.labor_cost),
            taxable: Boolean(item.taxable), product_id: (item.product_id && typeof item.product_id === 'string' && item.product_id.length > 10) ? item.product_id : null,
            photo_url: item.photo_url || null, is_optional: Boolean(item.is_optional), default_selected: Boolean(item.default_selected),
            is_material: Boolean(item.is_material), supplier: item.supplier || null, display_order: idx 
          }));
          const { error: itemsError } = await supabase.from("change_order_line_items").insert(itemsToInsert);
          if (itemsError) throw new Error(`Line Items Table: ${itemsError.message}`);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["change-order-phases", savedId] });
      await queryClient.invalidateQueries({ queryKey: ["change-order-items", savedId] });
      await queryClient.invalidateQueries({ queryKey: ["change_orders"] });

      setCoId(savedId);
      window.history.replaceState(window.history.state, "", `/ChangeOrderBuilder?id=${savedId}`);
      hydrateForm(prev => ({ ...prev, status: finalStatus, change_order_number: coNumber }));
      
      toast.dismiss(); 
      markSaved(saveRevision);
      if (!skipToast) { toast.success("Change Order saved successfully"); }
      return savedId;
    } catch (error) {
      toast.dismiss();
      toast.error(`Change order was not saved: ${error.message || "Unknown error"}`);
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleApproveAndSync = async () => {
    if (!window.confirm("Are you sure you want to approve this Change Order? This will lock it from editing and sync it to the project budget.")) return;

    const savedId = await handleSave("Approved", true);
    if (!savedId) return;

    try {
      toast.loading("Syncing to Project...");
      
      const { data: project } = await supabase.from("projects").select("budget, budget_revenue, budget_cost").eq("id", form.project_id).single();
      
      const newBudgetRevenue = safeNum(project?.budget_revenue) + effectiveSubtotal;
      const newBudgetCost = safeNum(project?.budget_cost) + grandCost;
      const newTotalBudget = safeNum(project?.budget) + grandTotal;

      const { error: budgetError } = await supabase.from("projects").update({
        budget_revenue: newBudgetRevenue,
        budget_cost: newBudgetCost,
        budget: newTotalBudget
      }).eq("id", form.project_id);
      if (budgetError) throw budgetError;
      const { error: syncError } = await supabase.from("change_orders").update({ budget_synced_at: new Date().toISOString() }).eq("id", savedId).eq("company_id", companyId);
      if (syncError) throw syncError;

      for (const phase of phases) {
        if (!isPhaseActive(phase)) continue;

        const { data: insertedProjPhase } = await supabase.from("project_phases").insert([{
          company_id: companyId,
          project_id: form.project_id,
          phase_name: `${phase.phase_name} (CO ${form.change_order_number || "New"})`,
          description: phase.scope_of_work,
          status: "Not Started"
        }]).select().single();

        if (insertedProjPhase && phase.items?.length > 0) {
          const tasksToInsert = [];
          const materialsToInsert = [];

          phase.items.forEach((item, idx) => {
            if (!isItemActive(item)) return;

            tasksToInsert.push({
              company_id: companyId, project_id: form.project_id, phase_id: insertedProjPhase.id,
              task_name: item.name, description: item.description || "", status: "Not Started", display_order: idx
            });

            if (item.is_material) {
              materialsToInsert.push({
                company_id: companyId, project_id: form.project_id, phase_id: insertedProjPhase.id,
                custom_material_name: item.name, quantity: safeNum(item.quantity) || 1, unit: item.unit || "ea",
                cost_estimated: safeNum(item.unit_cost) * (safeNum(item.quantity) || 1),
                supplier: item.supplier || null, status: "Planned", notes: item.description || ""
              });
            }
          });

          if (tasksToInsert.length > 0) await supabase.from("project_tasks").insert(tasksToInsert);
          if (materialsToInsert.length > 0) await supabase.from("project_materials").insert(materialsToInsert);
        }
      }

      toast.dismiss();
      toast.success("Change Order Approved & Project Updated!");
      navigate(`/PMProjectWorkspace?id=${form.project_id}`);
      
    } catch (err) {
      toast.dismiss();
      toast.error("Failed to sync to project: " + err.message);
    }
  };

  const handlePreview = async () => {
    let idToPreview = coId;
    if (!idToPreview) {
       idToPreview = await handleSave(null, true); 
       if (!idToPreview) return; 
    }
    window.open(`/ChangeOrderView?id=${idToPreview}`, '_blank');
  };

  // ⚡ Universal Actions Menu
  const renderActionsMenu = (position = "top", isMobileFull = false) => {
    return (
      <div className={`relative actions-menu-container inline-block ${isMobileFull ? 'w-full sm:w-auto order-2 sm:order-1' : ''}`}>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => setActionsMenuOpen(actionsMenuOpen === position ? false : position)}
          className={`bg-white font-medium shadow-sm transition-all ${isMobileFull ? 'w-full sm:w-auto h-9' : 'h-8 sm:h-9 px-2 sm:px-3'} ${actionsMenuOpen === position ? "border-indigo-400 ring-2 ring-indigo-100" : ""}`}
        >
          <Menu className={`h-4 w-4 text-slate-500 ${isMobileFull ? 'mr-2' : 'sm:mr-2'}`} /> 
          {/* ⚡ Hide the word "Actions" on top menu mobile to save space */}
          <span className={isMobileFull ? "" : "hidden sm:inline"}>Actions</span>
        </Button>
        
        {actionsMenuOpen === position && (
          <div className={`absolute ${position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-full sm:w-56 min-w-[220px] bg-white rounded-lg shadow-xl border border-slate-200 py-1.5 z-50`}>
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Communication</div>
            <button 
              onClick={() => { setActionsMenuOpen(false); handlePreview(); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Eye className="h-4 w-4 mr-3 text-slate-400" /> Client Preview
            </button>
            <button 
              onClick={async () => {
                setActionsMenuOpen(false);
                const savedId = await handleSave(null, true); 
                if (savedId) { setSendMethod("email"); setEmailDialog(true); }
              }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Mail className="h-4 w-4 mr-3 text-slate-400" /> Send via Email
            </button>

            <button 
              onClick={async () => {
                setActionsMenuOpen(false);
                const savedId = await handleSave(null, true); 
                if (savedId) { setSendMethod("sms"); setEmailDialog(true); } 
              }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Smartphone className="h-4 w-4 mr-3 text-slate-400" /> Send via Text Message
            </button>
            
            <div className="h-px bg-slate-100 my-1.5"></div>
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status & Workflow</div>
            
            <button 
              onClick={() => { setActionsMenuOpen(false); handleSave("Sent"); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Send className="h-4 w-4 mr-3 text-blue-500" /> Mark as Sent
            </button>
            
            <button 
              onClick={() => { setActionsMenuOpen(false); handleApproveAndSync(); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <CheckCircle className="h-4 w-4 mr-3 text-emerald-500" /> Mark as Approved
            </button>
            
            <button 
              onClick={() => { 
                setActionsMenuOpen(false); 
                toast.info("Invoice conversion for Change Orders coming soon!"); 
              }} 
              className="w-full text-left px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100/50 flex items-center transition-colors"
            >
              <Zap className="h-4 w-4 mr-3 text-indigo-500" /> Convert to Invoice...
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6 pb-24">
      <UnsavedChangesGuard
        isDirty={isDirty}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving || uploadingPhoto}
        documentName="change order"
        onSave={async () => {
          const revision = getRevision();
          const savedId = await handleSave(null, true);
          return Boolean(savedId) && getRevision() === revision;
        }}
      />
      {documentLoadFailed ? (
        <div role="alert" className="mx-auto mb-4 max-w-4xl rounded-lg border border-red-200 bg-white p-4">
          <p className="mb-3 text-sm text-red-700">The change order could not be loaded. Retry before editing or saving.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { refetchDocument(); refetchPhases(); refetchItems(); }}>Retry</Button>
            <Button variant="outline" onClick={() => handleSafeNavigate("/ChangeOrders")}>Return to change orders</Button>
          </div>
        </div>
      ) : documentLoading && <p role="status" className="mx-auto mb-4 max-w-4xl text-sm text-slate-600">Loading change order…</p>}
      <div className="max-w-4xl mx-auto" inert={documentLoading ? "" : undefined} aria-busy={documentLoading}>
        
        <button 
          onClick={() => handleSafeNavigate(-1)} 
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4 font-medium transition-colors bg-transparent border-none p-0 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* ⚡ STICKY TOP MENU */}
        <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm -mx-4 px-4 sm:-mx-6 sm:px-6 py-3 mb-6">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            
            <div className="min-w-0 flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex h-10 w-10 bg-indigo-100 rounded-lg items-center justify-center shrink-0 border border-indigo-200">
                <FolderKanban className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-bold text-slate-900 flex items-center gap-2 truncate">
                  <span className="truncate">{coId ? "Edit Change Order" : "New Change Order"}</span>
                  {existingCO && <StatusBadge status={existingCO.status} />}
                </h1>
                {existingCO?.change_order_number && <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">{existingCO.change_order_number}</p>}
              </div>
            </div>
            
            {/* ⚡ MOBILE BUTTONS */}
            <div className="flex sm:hidden items-center gap-1.5 shrink-0">
              <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 text-white h-8 px-2 text-xs">
                <Save className="h-3 w-3 mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
              {coId && renderActionsMenu('top')}
            </div>

            {/* ⚡ DESKTOP BUTTONS */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <Button onClick={() => handleSafeNavigate("/ChangeOrders")} variant="outline" size="sm" className="bg-white hidden sm:flex h-9 px-3">
  Cancel
</Button>
              <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm h-9 px-3">
                <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save Draft"}
              </Button>
              {coId && renderActionsMenu('top')}
            </div>
          </div>
        </div>

        <Card className="p-5 mb-4 bg-white border border-slate-200 shadow-sm">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-900 font-medium">Change Order Title *</Label>
              <Input value={localTitle} onChange={e => { setLocalTitle(e.target.value); setForm(f => ({...f, title: e.target.value})); }} placeholder="e.g. Add extra outlets in kitchen" className="bg-white" />
            </div>
            
            {coId && (
              <div>
                <Label className="text-slate-900 font-medium">CO Number</Label>
                <Input value={form.change_order_number || ""} placeholder="e.g. CO-101" className="bg-slate-50 text-slate-500" disabled />
              </div>
            )}
            
            <div>
              <Label className="text-slate-900 font-medium">Linked Project *</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({...form, project_id: v})} disabled={!!coId}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Select active project..." /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id} className="font-medium">{p.project_number} - {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* LOCKED CLIENT FIELD */}
            <div>
              <Label className="text-slate-900 font-medium">Client</Label>
              <Input 
                value={projectClientName || "Select a project first..."} 
                disabled 
                className="bg-slate-50 text-slate-500 font-medium cursor-not-allowed border-slate-200" 
              />
            </div>
            
            <div>
              <Label className="text-slate-900 font-medium">Issue Date</Label>
              <Input type="date" value={form.issue_date} onChange={e => setForm({...form, issue_date: e.target.value})} className="bg-white" />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-slate-900 font-medium">Reason for Change / Scope</Label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.show_overall_scope} onChange={e => setForm({...form, show_overall_scope: e.target.checked})} className="rounded border-slate-300" />
                  Show to client
                </label>
              </div>
              <Textarea value={localOverallScope} onChange={e => { setLocalOverallScope(e.target.value); setForm(f => ({...f, overall_scope: e.target.value})); }} rows={3} placeholder="Why is this change order being issued? What is the summary of changes?..." className="bg-white" />
            </div>
          </div>
        </Card>

        <div className="space-y-4 mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Change Items</h3>
            <Button onClick={addPhase} className="bg-amber-400 hover:bg-amber-500 text-slate-900 shadow-sm" size="sm">
              <Plus className="h-4 w-4 mr-2" /> Add Phase Group
            </Button>
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
                  onSplitLineItem={handleSplitLineItem} 
                  calculatePhaseSubtotal={calculatePhaseSubtotal} calculatePhaseCost={calculatePhaseCost} calculatePhaseMargin={calculatePhaseMargin} calculatePhaseMarginPercent={calculatePhaseMarginPercent} calculatePhaseTax={calculatePhaseTax} calculatePhaseTotal={calculatePhaseTotal}
                  onMovePhaseUp={() => movePhaseUp(phaseIdx)} onMovePhaseDown={() => movePhaseDown(phaseIdx)}
                  isFirst={phaseIdx === 0} isLast={phaseIdx === phases.length - 1}
                />
              </React.Fragment>
            ))}
          </div>

          {phases.length === 0 && (
            <Card className="p-8 text-center bg-slate-50 border border-slate-200 border-dashed shadow-sm">
              <p className="text-slate-500 mb-3 font-medium">No items added to this change order yet.</p>
              <Button onClick={addPhase} variant="outline" className="bg-white">
                <Plus className="h-4 w-4 mr-2" /> Add First Item
              </Button>
            </Card>
          )}
        </div>

        <Card className="p-5 mb-4 bg-slate-50 border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 sm:gap-6">
            <div className="flex-1 w-full space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-slate-900 font-bold text-base">Cost vs Revenue Impact</Label>
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
                      <p className="text-sm sm:text-lg font-semibold text-emerald-600">{formatCurrencyUSD(baseMargin)}</p>
                      <p className="text-xs text-emerald-600">{baseMarginPercent.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-right w-full sm:w-auto min-w-[200px] border-l sm:pl-6">
              <div className="text-base"><span className="text-slate-600">Subtotal:</span> <span className="font-bold text-slate-900">{formatCurrencyUSD(effectiveSubtotal)}</span></div>
              <div className="text-base">
                <span className="text-slate-600">{settings?.tax_label || "Tax"}:</span> 
                <span className="font-bold text-slate-900 ml-2">{formatCurrencyUSD(grandPrimaryTax)}</span>
              </div>
              {settings?.enable_secondary_tax && (
                <div className="text-base">
                  <span className="text-slate-600">{settings?.secondary_tax_label || "PST"}:</span> 
                  <span className="font-bold text-slate-900 ml-2">{formatCurrencyUSD(grandSecondaryTax)}</span>
                </div>
              )}
              <div className="text-xl sm:text-2xl font-black text-indigo-600 border-t-2 border-slate-200 pt-2 mt-2">Net Total: {formatCurrencyUSD(grandTotal)}</div>
            </div>
          </div>
        </Card>

        <Card className="p-5 mb-6 bg-white border border-slate-200 shadow-sm">
          <div className="grid md:grid-cols-2 gap-4 items-start">
            <div>
              <Label className="text-slate-900 font-medium block">Client Message</Label>
              <p className="text-xs text-slate-500 mb-2">Personal message shown on the CO document</p>
              <Textarea value={localClientMessage} onChange={e => { setLocalClientMessage(e.target.value); setForm(f => ({...f, client_message: e.target.value})); }} rows={3} className="bg-slate-50" />
            </div>
            <div>
              <Label className="text-slate-900 font-medium block">Terms & Conditions</Label>
              <p className="text-xs text-slate-500 mb-2">Legal terms for this change</p>
              <Textarea value={localTerms} onChange={e => { setLocalTerms(e.target.value); setForm(f => ({...f, terms: e.target.value})); }} rows={3} className="bg-slate-50" />
            </div>
          </div>
        </Card>

        {/* ⚡ NON-SCROLLING BOTTOM MENU */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm mt-6">
          <Button onClick={() => handleSafeNavigate("/ChangeOrders")} variant="outline" size="sm" className="bg-white w-full sm:w-auto order-3 sm:order-1">
  Cancel
</Button>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            <Button size="sm" onClick={() => handleSave(null)} disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm w-full sm:w-auto">
              <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Draft"}
            </Button>
            {coId && renderActionsMenu('bottom')}
          </div>
        </div>

      </div>

      <SendChangeOrderEmailDialog 
        open={emailDialog} 
        onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
        changeOrderId={coId} 
        coName={`Change Order: ${form.title}`}
        clientName={projectClientName}
        clientEmail={projectClientEmail}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["change-order", coId] });
        }} 
      />

      {/* 📱 TEXT MESSAGE (SMS) DIALOG */}
      <SendChangeOrderTextDialog 
        open={emailDialog && sendMethod === "sms"} 
        onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
        changeOrderId={coId} 
        coName={form.title}
        clientName={projectClientName}
        clientPhone={projectClientPhone}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["change-order", coId] });
        }} 
      />
      
    </div>
  );
}
