import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "../utils";
import { Link, useNavigate } from "react-router-dom";
import { 
  ArrowLeft, Save, Send, DollarSign, Eye, Printer, 
  ChevronDown, CheckCircle, FileText, ClipboardList, Plus, AlertTriangle, Lock, Tag, Mail, Smartphone, Settings, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import StatusBadge from "../components/shared/StatusBadge";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import AddressAutocomplete from "../components/shared/AddressAutocomplete";
import SendInvoiceEmailDialog from "../components/invoices/SendInvoiceEmailDialog";
import SendInvoiceTextDialog from "../components/invoices/SendInvoiceTextDialog";
import RecordPaymentDialog from "../components/invoices/RecordPaymentDialog";
import { generateInvoicePDF } from "../components/pdf/PDFGenerator";
import PhaseCard from "../components/quotes/PhaseCard";
import { usePhaseFunctions } from "../components/quotes/usePhaseManagement";

const safeNum = (val) => {
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

const getDefaultTermValue = (termLabel) => {
  if (termLabel === "Net 15") return "net_15";
  if (termLabel === "Net 30") return "net_30";
  if (termLabel === "Net 60") return "net_60";
  return "due_on_receipt";
};

export default function InvoiceBuilder() {
  const params = new URLSearchParams(window.location.search);
  const [invoiceId, setInvoiceId] = useState(params.get("id"));
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // ⚡ 1. UNSAVED CHANGES TRACKER
  const [isDirty, setIsDirty] = useState(false);

  // A. Detect typing or changes
  useEffect(() => {
    const markDirty = () => setIsDirty(true);
    window.addEventListener("input", markDirty);
    window.addEventListener("change", markDirty);
    return () => {
      window.removeEventListener("input", markDirty);
      window.removeEventListener("change", markDirty);
    };
  }, []);

  // B. Prevent closing the browser tab or hitting Refresh
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // C. ⚡ NEW: Intercept React Router Sidebar Links
  useEffect(() => {
    const handleGlobalClick = (e) => {
      const link = e.target.closest("a");
      // If they clicked a link, the form is dirty, and it's not a "new tab" link
      if (link && isDirty && link.target !== "_blank") {
        if (!window.confirm("⚠️ WARNING: You have unsaved changes. Are you sure you want to exit? You will lose your data.")) {
          e.preventDefault();
          e.stopPropagation(); // Stops React Router from executing the navigation!
        }
      }
    };
    
    // { capture: true } is the magic here. It catches the click BEFORE React gets it.
    document.addEventListener("click", handleGlobalClick, { capture: true });
    return () => document.removeEventListener("click", handleGlobalClick, { capture: true });
  }, [isDirty]);

  // D. Safe navigation for manual Buttons (Back/Cancel)
  const handleSafeNavigate = (e, path) => {
    e.preventDefault();
    if (isDirty && !window.confirm("⚠️ WARNING: You have unsaved changes. Are you sure you want to exit? You will lose your data.")) {
      return;
    }
    navigate(path);
  };
  
  const { profile, settings } = useAuth();
  const companyId = profile?.company_id;

  const defaultTermVal = getDefaultTermValue(settings?.default_terms);
  let defaultDueDate = new Date();
  if (defaultTermVal === "net_15") defaultDueDate = addDays(defaultDueDate, 15);
  else if (defaultTermVal === "net_30") defaultDueDate = addDays(defaultDueDate, 30);
  else if (defaultTermVal === "net_60") defaultDueDate = addDays(defaultDueDate, 60);

  const [form, setForm] = useState({
    client_id: "none", project_id: null, quote_id: "none",
    status: "Draft", issue_date: format(new Date(), "yyyy-MM-dd"),
    due_terms: defaultTermVal, due_date: format(defaultDueDate, "yyyy-MM-dd"), 
    notes: "", show_notes: true, internal_notes: "",
    site_address: "", billing_address: "",
    discount_amount: 0, discount_type: "fixed"
  });
  
  const [phases, setPhases] = useState([]);
  const hasLoadedPhases = useRef(false);
  const [importedQuoteId, setImportedQuoteId] = useState(null);

  const [paymentScheduleItems, setPaymentScheduleItems] = useState([]);
  const [manualItems, setManualItems] = useState([]); 
  const [saving, setSaving] = useState(false);
  
  const [milestoneDialog, setMilestoneDialog] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ payment_name: "", due_event: "", amount: "", amount_type: "fixed", percentage: 0 });
  const [editingMilestoneIndex, setEditingMilestoneIndex] = useState(null);

  const [ledgerDialog, setLedgerDialog] = useState(false); 
  const [emailDialog, setEmailDialog] = useState(false);
  const [sendMethod, setSendMethod] = useState("email");

  // --- QUERIES ---
  const { data: company } = useQuery({ 
    queryKey: ["company", companyId], enabled: !!companyId, 
    queryFn: async () => { const { data } = await supabase.from("companies").select("*").eq("id", companyId).single(); return data || null; } 
  });

  const { data: clients = [] } = useQuery({ queryKey: ["clients", companyId], enabled: !!companyId, queryFn: async () => { const { data } = await supabase.from("clients").select("*").eq("company_id", companyId); return data || []; } });
  const { data: quotes = [] } = useQuery({ queryKey: ["quotes", companyId], enabled: !!companyId, queryFn: async () => { const { data } = await supabase.from("quotes").select("*").eq("company_id", companyId); return data || []; } });
  const { data: products = [] } = useQuery({ queryKey: ["products", companyId], enabled: !!companyId, queryFn: async () => { const { data } = await supabase.from("products").select("*").eq("company_id", companyId); return data || []; } });

  const { data: existingInvoice } = useQuery({ queryKey: ["invoice", invoiceId], enabled: !!invoiceId, queryFn: async () => { const { data } = await supabase.from("invoices").select("*").eq("id", invoiceId).single(); return data; } });
  
  const { data: existingScheduleItems = [], isFetched: scheduleFetched } = useQuery({ queryKey: ["invoice-schedule-items", invoiceId], enabled: !!invoiceId, queryFn: async () => { const { data } = await supabase.from("invoice_payment_schedules").select("*").eq("invoice_id", invoiceId).order("sort_order", { ascending: true }); return data || []; } });
  
  const { data: quotePaymentScheduleItems = [] } = useQuery({ queryKey: ["quote-payment-schedule", form.quote_id], enabled: !!form.quote_id && form.quote_id !== "none" && (!invoiceId || form.quote_id !== importedQuoteId), queryFn: async () => { const { data } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", form.quote_id).order("sort_order", { ascending: true }); return data || []; } });
  const { data: linkedQuote } = useQuery({ queryKey: ["quote", form.quote_id], enabled: !!form.quote_id && form.quote_id !== "none", queryFn: async () => { const { data } = await supabase.from("quotes").select("*").eq("id", form.quote_id).single(); return data; } });
  
  const { data: quotePhases = [], isFetched: quotePhasesFetched } = useQuery({ queryKey: ["quote_phases", form.quote_id], enabled: !!form.quote_id && form.quote_id !== "none", queryFn: async () => { const { data } = await supabase.from("quote_phases").select("*").eq("quote_id", form.quote_id).order("sort_order"); return data || []; } });
  const { data: quoteItems = [], isFetched: quoteItemsFetched } = useQuery({ queryKey: ["quote_line_items", form.quote_id], enabled: !!form.quote_id && form.quote_id !== "none", queryFn: async () => { const { data } = await supabase.from("quote_line_items").select("*").eq("quote_id", form.quote_id).order("display_order"); return data || []; } });

  const { data: existingPhases = [], isFetched: invPhasesFetched, isFetching: invPhasesFetching } = useQuery({ 
    queryKey: ["invoice_phases", invoiceId], enabled: !!invoiceId, 
    queryFn: async () => { const { data } = await supabase.from("invoice_phases").select("*").eq("invoice_id", invoiceId); return data?.sort((a,b) => (a.sort_order||0) - (b.sort_order||0)) || []; } 
  });
  const { data: existingPhaseItems = [], isFetched: invItemsFetched, isFetching: invItemsFetching } = useQuery({ 
    queryKey: ["invoice_phase_items", invoiceId], enabled: !!invoiceId, 
    queryFn: async () => { const { data } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).not("phase_id", "is", null).order("created_at", { ascending: true }); return data || []; } 
  });
  const { data: existingManualItems = [] } = useQuery({ 
    queryKey: ["invoice_manual_items", invoiceId], enabled: !!invoiceId, 
    queryFn: async () => { const { data } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).is("phase_id", null).order("created_at", { ascending: true }); return data || []; } 
  });
  
  const { data: payments = [] } = useQuery({ queryKey: ["invoice-payments-builder", invoiceId], enabled: !!invoiceId, queryFn: async () => { const { data } = await supabase.from("payments").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: false }); return data || []; } });

  // --- USE EFFECTS ---
  useEffect(() => {
    if (existingInvoice) {
      setForm({
        client_id: existingInvoice.client_id || "none", project_id: existingInvoice.project_id || null,
        quote_id: existingInvoice.quote_id || "none", status: existingInvoice.status || "Draft",
        issue_date: existingInvoice.issue_date || format(new Date(), "yyyy-MM-dd"), 
        due_terms: existingInvoice.due_terms || "due_on_receipt",
        due_date: existingInvoice.due_date || format(new Date(), "yyyy-MM-dd"),
        notes: existingInvoice.notes || "Thank you for your business. Please remit payment according to the schedule below.", 
        show_notes: existingInvoice.show_notes !== false,
        internal_notes: existingInvoice.internal_notes || "",
        site_address: existingInvoice.site_address || "",
        billing_address: existingInvoice.billing_address || "",
        discount_amount: existingInvoice.discount_amount || 0,
        discount_type: existingInvoice.discount_type || "fixed"
      });
      setImportedQuoteId(existingInvoice.quote_id || "none");
    }
  }, [existingInvoice]);

  useEffect(() => {
    if (invPhasesFetched && invItemsFetched && !invPhasesFetching && !invItemsFetching && existingPhases.length > 0 && !hasLoadedPhases.current) {
      hasLoadedPhases.current = true;
      const phasesWithItems = existingPhases.map(phase => ({
        ...phase,
        items: existingPhaseItems.filter(item => item.phase_id === phase.id).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      }));
      setPhases(phasesWithItems);
    }
  }, [existingPhases, existingPhaseItems, invPhasesFetched, invItemsFetched, invPhasesFetching, invItemsFetching]);

  useEffect(() => {
    if (existingManualItems.length > 0 && manualItems.length === 0) {
      setManualItems(existingManualItems.map(item => ({ 
        id: item.id, 
        name: item.name, 
        amount: item.amount || item.unit_price || item.line_total || 0 
      })));
    }
  }, [existingManualItems]);

  useEffect(() => {
    if (form.quote_id && form.quote_id !== "none" && form.quote_id !== importedQuoteId && quotePhasesFetched && quoteItemsFetched) {
      if (quotePhases.length > 0) {
        const phasesWithItems = quotePhases.map(phase => ({
          id: `temp-phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          phase_name: phase.phase_name,
          scope_of_work: phase.scope_of_work || "",
          show_scope_to_client: phase.show_scope_to_client !== false,
          internal_notes: phase.internal_notes || "",
          sort_order: phase.sort_order,
          items: quoteItems.filter(item => item.phase_id === phase.id).map((item, idx) => ({
             id: `temp-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
             name: item.name,
             description: item.description || "",
             quantity: item.quantity || 1,
             unit: item.unit || "ea",
             unit_cost: item.unit_cost || 0,
             unit_price: item.unit_price || 0,
             taxable: item.taxable !== false,
             is_material: item.is_material === true,
             supplier: item.supplier || null
          }))
        }));
        setPhases(phasesWithItems);
        setImportedQuoteId(form.quote_id);
        setPaymentScheduleItems([]);
        toast.success("Scope of Work imported from quote.");
      }
    } 
    else if (form.quote_id === "none" && importedQuoteId && importedQuoteId !== "none") {
      setPhases([]);
      setImportedQuoteId("none");
      setPaymentScheduleItems([]);
      toast.info("Quote unlinked. Scope of Work cleared.");
    }
  }, [form.quote_id, importedQuoteId, quotePhasesFetched, quoteItemsFetched, quotePhases, quoteItems]);

  useEffect(() => {
    if (!invoiceId && linkedQuote && linkedQuote.discount_amount > 0) {
      setForm(prev => ({
        ...prev, 
        discount_amount: linkedQuote.discount_amount,
        discount_type: linkedQuote.discount_type || "fixed"
      }));
    }
  }, [linkedQuote, invoiceId]);

  // --- PHASE & GRID HANDLERS ---
  const { duplicatePhase, reorderLineItems, reorderPhases } = usePhaseFunctions(phases, setPhases);

  const addPhase = () => setPhases([...phases, { id: `temp-phase-${Date.now()}`, phase_name: `Phase ${phases.length + 1}`, scope_of_work: "", show_scope_to_client: true, sort_order: phases.length, items: [] }]);
  const updatePhase = (idx, field, value) => { const updated = [...phases]; updated[idx] = { ...updated[idx], [field]: value }; setPhases(updated); };
  const removePhase = (idx) => setPhases(phases.filter((_, i) => i !== idx));
  const movePhaseUp = (idx) => { if (idx > 0) reorderPhases(idx, idx - 1); };
  const movePhaseDown = (idx) => { if (idx < phases.length - 1) reorderPhases(idx, idx + 1); };

  const addLineItem = (phaseIdx, product = null) => {
    const updated = [...phases];
    const newItem = product ? {
      id: `temp-${Date.now()}`, name: product.name, description: product.description || "", quantity: 1, unit: product.unit || "ea",
      unit_price: product.price || 0, taxable: product.taxable !== false, product_id: product.id, is_material: product.is_material || false
    } : {
      id: `temp-${Date.now()}`, name: "", description: "", quantity: 1, unit: "ea", unit_price: 0, taxable: true
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
    const dup = { ...updated[phaseIdx].items[itemIdx], id: `temp-${Date.now()}` };
    updated[phaseIdx].items.splice(itemIdx + 1, 0, dup);
    setPhases(updated);
  };
  const moveLineItem = (fromPhaseIdx, itemIdx, toPhaseIdx) => {
    const updated = [...phases];
    const [itemToMove] = updated[fromPhaseIdx].items.splice(itemIdx, 1);
    updated[toPhaseIdx].items = [...(updated[toPhaseIdx].items || []), itemToMove];
    setPhases(updated);
  };
  const handleSplitLineItem = () => {}; 
  const onPhotoUpload = () => {}; 
  const onLineItemPhotoUpload = () => {}; 

  // --- MATH & DERIVED TOTALS ---
  const isItemActive = (item) => !item.is_optional || item.default_selected === true;
  const isPhaseActive = (phase) => !phase.is_optional || phase.default_selected === true;

  const calculatePhaseSubtotal = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(isItemActive).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0) || 0;
  };
  const calculatePhaseTaxableAmount = (phase) => {
    if (!isPhaseActive(phase)) return 0;
    return phase.items?.filter(i => isItemActive(i) && i.taxable).reduce((sum, item) => sum + (safeNum(item.quantity) * safeNum(item.unit_price)), 0) || 0;
  };
  
  const calculatePhaseCost = (phase) => 0; 
  const calculatePhaseMargin = (phase) => 0; 
  const calculatePhaseMarginPercent = (phase) => 0;
  const calculatePhaseTax = (phase) => calculatePhaseTaxableAmount(phase) * ((settings?.tax_rate ?? 5) / 100 + (settings?.enable_secondary_tax ? (settings?.secondary_tax_rate ?? 7) / 100 : 0));
  const calculatePhaseTotal = (phase) => calculatePhaseSubtotal(phase) + calculatePhaseTax(phase);

  const phasesSubtotal = phases.reduce((sum, phase) => sum + calculatePhaseSubtotal(phase), 0);
  const phasesTaxableAmount = phases.reduce((sum, phase) => sum + calculatePhaseTaxableAmount(phase), 0);

  const manualTotal = manualItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const rawSubtotal = phasesSubtotal + manualTotal; 

  let discountValue = 0;
  if (form.discount_type === 'percentage') {
    discountValue = rawSubtotal * ((form.discount_amount || 0) / 100);
  } else {
    discountValue = Number(form.discount_amount || 0);
  }

  const currentSubtotal = rawSubtotal - discountValue;
  
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  
  const taxableProportion = rawSubtotal > 0 ? ((phasesTaxableAmount + manualTotal) / rawSubtotal) : 1;
  const taxableSubtotalAfterDiscount = currentSubtotal * taxableProportion;

  const primaryTaxAmount = taxableSubtotalAfterDiscount * primaryTaxRate;
  const secondaryTaxAmount = taxableSubtotalAfterDiscount * secondaryTaxRate;
  const currentTax = primaryTaxAmount + secondaryTaxAmount; 
  
  const currentTotal = currentSubtotal + currentTax;
  const currentPaid = existingInvoice?.amount_paid || 0;
  const currentBalance = currentTotal - currentPaid;

  const scheduleTotal = paymentScheduleItems.reduce((acc, item) => {
    if (item.amount_type === "percentage") return acc + (currentTotal * safeNum(item.percentage) / 100);
    return acc + (Number(item.amount) || 0);
  }, 0);

  const nextPaymentItem = paymentScheduleItems.find(i => i.status !== "Paid");
  const nextPaymentDue = nextPaymentItem 
    ? ((nextPaymentItem.amount_type === "percentage" ? (currentTotal * safeNum(nextPaymentItem.percentage) / 100) : safeNum(nextPaymentItem.amount)) - Number(nextPaymentItem.amount_paid || 0)) 
    : 0;

  // 1. Setup default milestones (Only multi-tranche if imported from a quote)
  useEffect(() => {
    if (invoiceId && (!scheduleFetched || !invPhasesFetched || !invItemsFetched)) return;
    if (currentTotal <= 0) return;

    if (paymentScheduleItems.length === 0) {
      if (invoiceId && existingScheduleItems.length > 0) {
        setPaymentScheduleItems(existingScheduleItems);
      } else {
        if (quotePaymentScheduleItems.length > 0) {
          setPaymentScheduleItems(quotePaymentScheduleItems.map(item => ({
            payment_name: item.payment_name,
            amount: item.amount_type === "percentage" ? (currentTotal * safeNum(item.percentage) / 100) : safeNum(item.amount),
            amount_type: item.amount_type || "fixed", 
            percentage: item.percentage || 0,
            due_event: item.due_event || "", status: "Pending", amount_paid: 0,
          })));
        } else {
          // Standard invoice: Single 100% payment block
          setPaymentScheduleItems([
            { payment_name: "Full Payment", amount: currentTotal, amount_type: "fixed", percentage: 0, due_event: "Upon Receipt", status: "Pending", amount_paid: 0 }
          ]);
        }
      }
    }
  }, [scheduleFetched, invPhasesFetched, invItemsFetched, existingScheduleItems, quotePaymentScheduleItems, invoiceId, paymentScheduleItems.length]);

  // 2. Silent Auto-Balancing: Automatically force the last unpaid milestone to match the remaining total
  useEffect(() => {
    if (currentTotal <= 0 || paymentScheduleItems.length === 0) return;

    const nextUnpaidIdx = paymentScheduleItems.findLastIndex(i => i.status !== "Paid");
    if (nextUnpaidIdx === -1) return; // Everything is already paid

    const currentScheduleTotalExcludingLast = paymentScheduleItems.reduce((acc, item, idx) => {
      if (idx === nextUnpaidIdx) return acc;
      if (item.amount_type === "percentage") return acc + (currentTotal * safeNum(item.percentage) / 100);
      return acc + (Number(item.amount) || 0);
    }, 0);

    const expectedLastAmount = Math.max(0, currentTotal - currentScheduleTotalExcludingLast);
    const currentLastAmount = paymentScheduleItems[nextUnpaidIdx].amount_type === "percentage"
       ? (currentTotal * safeNum(paymentScheduleItems[nextUnpaidIdx].percentage) / 100)
       : Number(paymentScheduleItems[nextUnpaidIdx].amount);

    // If there is a penny mismatch, quietly correct the final tranches
    if (Math.abs(expectedLastAmount - currentLastAmount) > 0.01) {
       setPaymentScheduleItems(prev => {
          const updated = [...prev];
          updated[nextUnpaidIdx] = {
             ...updated[nextUnpaidIdx],
             amount_type: "fixed",
             percentage: 0,
             amount: expectedLastAmount
          };
          return updated;
       });
    }
  }, [currentTotal]);

  const handleDueTermsChange = (term) => {
    let date = new Date(form.issue_date);
    if (term === "net_15") date = addDays(date, 15);
    else if (term === "net_30") date = addDays(date, 30);
    else if (term === "net_60") date = addDays(date, 60);
    setForm({...form, due_terms: term, due_date: format(date, "yyyy-MM-dd")});
  };

  const handleSave = async (newStatus = null, silent = false) => {
    if (!form.client_id || form.client_id === "none") { toast.error("Client is required"); return null; }
    setSaving(true);
    
    let invNum = existingInvoice?.invoice_number;
    let shouldIncrementCounter = false;

    if (!invNum) {
      const prefix = company?.invoice_number_prefix || "INV-";
      const nextNum = company?.next_invoice_number || 1001;
      invNum = `${prefix}${nextNum}`;
      shouldIncrementCounter = true;
    }
    
    // ... existing save logic ...
      
      toast.dismiss(); 
      setIsDirty(false); // ⚡ ADD THIS LINE HERE so the warning goes away!
      if (!skipToast) { toast.success("Saved successfully!"); }
      return savedId;

    const invoiceData = {
      company_id: companyId, client_id: form.client_id, project_id: form.project_id || null, quote_id: form.quote_id === "none" ? null : form.quote_id,
      site_address: form.site_address || "", billing_address: form.billing_address || "",
      issue_date: form.issue_date || null, due_terms: form.due_terms, due_date: form.due_date || null,
      notes: form.notes || "", show_notes: form.show_notes, internal_notes: form.internal_notes || "",
      discount_amount: form.discount_amount || 0, discount_type: form.discount_type || "fixed",
      invoice_number: invNum, status: newStatus || form.status,
      subtotal: currentSubtotal, tax: currentTax, total: currentTotal, balance_due: currentBalance,
    };

    try {
      let savedId = invoiceId;
      
      if (invoiceId) {
        const { error } = await supabase.from("invoices").update(invoiceData).eq("id", invoiceId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase.from("invoices").insert([invoiceData]).select().single();
        if (error) throw error;
        savedId = created.id;

        if (shouldIncrementCounter) {
          const currentCounter = company?.next_invoice_number ? Number(company.next_invoice_number) : 1001;
          await supabase.from("companies").update({ next_invoice_number: currentCounter + 1 }).eq("id", companyId);
          queryClient.invalidateQueries({ queryKey: ["company"] });
        }
      }

      await supabase.from("invoice_phases").delete().eq("invoice_id", savedId);
      await supabase.from("invoice_line_items").delete().eq("invoice_id", savedId);
      
      for (const phase of phases) {
        if (!isPhaseActive(phase)) continue;
        const { data: newPhase, error: pErr } = await supabase.from("invoice_phases").insert([{
          company_id: companyId, invoice_id: savedId, phase_name: phase.phase_name, scope_of_work: phase.scope_of_work || "", sort_order: phase.sort_order || 0,
        }]).select().single();

        if (pErr) throw pErr;

        if (newPhase && phase.items?.length > 0) {
          const itemsToInsert = phase.items.filter(isItemActive).map((item, idx) => ({
            company_id: companyId, invoice_id: savedId, phase_id: newPhase.id, name: item.name,
            description: item.description || "", quantity: safeNum(item.quantity) || 1, unit: item.unit || "ea",
            unit_price: safeNum(item.unit_price) || 0, taxable: Boolean(item.taxable), 
            line_total: safeNum(item.quantity) * safeNum(item.unit_price), display_order: idx
          }));
          if (itemsToInsert.length > 0) {
            const { error: iErr } = await supabase.from("invoice_line_items").insert(itemsToInsert);
            if (iErr) throw iErr;
          }
        }
      }

      const validManualItems = manualItems.filter(i => i.name && i.name.trim() !== "");
      if (validManualItems.length > 0) {
        const manualItemsToInsert = validManualItems.map((item, idx) => ({
          company_id: companyId, invoice_id: savedId, name: item.name, 
          amount: Number(item.amount) || 0, unit_price: Number(item.amount) || 0, line_total: Number(item.amount) || 0, display_order: idx + 1000
        }));
        const { error: mErr } = await supabase.from("invoice_line_items").insert(manualItemsToInsert);
        if (mErr) throw mErr;
      }

      await supabase.from("invoice_payment_schedules").delete().eq("invoice_id", savedId);
      if (paymentScheduleItems.length > 0) {
        const schedulesToInsert = paymentScheduleItems.map((item, idx) => {
          const calculatedAmount = item.amount_type === "percentage" ? (currentTotal * safeNum(item.percentage) / 100) : safeNum(item.amount);
          return {
            company_id: companyId, invoice_id: savedId, payment_name: item.payment_name,
            amount: calculatedAmount, due_event: item.due_event, status: item.status || "Pending",
            amount_paid: item.amount_paid || 0, sort_order: idx,
            amount_type: item.amount_type || "fixed", percentage: item.percentage || 0
          };
        });
        await supabase.from("invoice_payment_schedules").insert(schedulesToInsert);
      }

      if (!invoiceId) {
        hasLoadedPhases.current = false;
        setInvoiceId(savedId);
        window.history.replaceState(null, "", createPageUrl(`InvoiceBuilder?id=${savedId}`));
      }

      queryClient.invalidateQueries({ queryKey: ["invoice_phases", savedId] });
      queryClient.invalidateQueries({ queryKey: ["invoice_phase_items", savedId] });
      queryClient.invalidateQueries({ queryKey: ["invoice_manual_items", savedId] }); 
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      
      if (!silent) toast.success("Invoice successfully saved!");
      return savedId;
      
    } catch (error) { 
      alert(`Database Save Error: ${error.message}`);
      toast.error("Failed to save invoice."); 
      return null; 
    } 
    finally { setSaving(false); }
  };

  const addMilestoneScheduleItem = () => {
    if (!milestoneForm.payment_name.trim()) { toast.error("Payment name is required"); return; }
    
    const paymentAmount = milestoneForm.amount_type === "percentage" ? (currentTotal * safeNum(milestoneForm.percentage) / 100) : safeNum(milestoneForm.amount);
    
    if (editingMilestoneIndex !== null) {
      const totalExcludingCurrent = paymentScheduleItems.reduce((sum, item, idx) => {
        if (idx === editingMilestoneIndex) return sum;
        if (item.amount_type === "percentage") return sum + (currentTotal * safeNum(item.percentage) / 100);
        return sum + safeNum(item.amount);
      }, 0);
      
      const newTotal = totalExcludingCurrent + paymentAmount;
      if (newTotal > currentTotal + 0.01) { toast.error(`Payment exceeds quote total. Max: $${(currentTotal - totalExcludingCurrent).toFixed(2)}`); return; }
      
      const updated = [...paymentScheduleItems];
      updated[editingMilestoneIndex] = { ...milestoneForm, id: updated[editingMilestoneIndex].id || Date.now() };
      setPaymentScheduleItems(updated);
      toast.success("Milestone updated");
    } else {
      const remainingAmount = currentTotal - scheduleTotal;
      const newTotal = scheduleTotal + paymentAmount;
      if (newTotal > currentTotal + 0.01) { toast.error(`Payment exceeds quote total. Max: $${remainingAmount.toFixed(2)}`); return; }
      
      setPaymentScheduleItems([...paymentScheduleItems, { ...milestoneForm, id: Date.now() }]);
      toast.success(Math.abs(newTotal - currentTotal) < 0.01 ? "Final payment added" : "Payment added");
    }
    
    setMilestoneForm({ payment_name: "", due_event: "", amount: "", amount_type: "fixed", percentage: 0 });
    setEditingMilestoneIndex(null);
    setMilestoneDialog(false); 
  };

  const removeMilestoneScheduleItem = (index) => {
    setPaymentScheduleItems(paymentScheduleItems.filter((_, i) => i !== index));
    toast.success("Milestone removed");
  };

  const handleAction = async (action) => {
    switch (action) {
      case "preview":
        await handleSave(null, true);
        window.open(`/InvoiceView?id=${invoiceId}`, "_blank");
        break;
        
      case "payment":
        await handleSave(null, true); 
        setLedgerDialog(true);
        break;
        
      case "print":
        toast.loading("Preparing PDF...", { id: "pdf-gen" });
        await handleSave(null, true); 
        
        const pdfInvoice = {
          ...existingInvoice,
          invoice_number: existingInvoice?.invoice_number || `DRAFT`,
          issue_date: form.issue_date,
          due_date: form.due_date,
          subtotal: currentSubtotal,
          tax: currentTax,
          total: currentTotal,
          balance_due: currentBalance,
          amount_paid: currentPaid,
          discount_amount: form.discount_amount,
          discount_type: form.discount_type,
          billing_address: form.billing_address,
          site_address: form.site_address,
          notes: form.notes,
          show_notes: form.show_notes
        };

        const currentClient = clients.find(c => c.id === form.client_id) || { name: 'Client' };
        const organization = { name: "Pro-Trades" }; 

        const allPdfItems = phases.flatMap(p => p.items.filter(isItemActive));

        await generateInvoicePDF({
          invoice: pdfInvoice,
          client: currentClient,
          project: null,
          quotePhases: phases,
          quoteItems: allPdfItems,
          manualItems,
          scheduleItems: paymentScheduleItems,
          payments,
          organization
        });

        toast.dismiss("pdf-gen");
        toast.success("PDF downloaded!");
        break;
        
      default:
        break;
    }
  };

  const clientQuotes = form.client_id && form.client_id !== "none"
    ? quotes.filter(q => q.client_id === form.client_id && !["Deleted", "Archived", "Lost", "Canceled"].includes(q.status))
    : [];

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        
        <div className="mb-2">
          <button onClick={(e) => handleSafeNavigate(e, -1)}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4 font-medium transition-colors bg-transparent border-none p-0 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        </div>

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 md:p-6 rounded-xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              {invoiceId ? "Edit Invoice" : "Create Invoice"}
            </h1>
            <p className="text-sm font-medium text-slate-500">
              {invoiceId ? `Invoice ID: ${invoiceId.split("-")[0].toUpperCase()}` : "Draft a new bill for your client"}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Select value={form.status} onValueChange={(v) => setForm({...form, status: v})}>
              <SelectTrigger className={`w-full sm:w-[140px] font-bold ${
                form.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                form.status === 'Sent' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                'bg-slate-100 text-slate-700'
              }`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft" className="font-bold">Draft</SelectItem>
                <SelectItem value="Sent" className="font-bold text-blue-700">Sent</SelectItem>
                <SelectItem value="Paid" className="font-bold text-emerald-700">Paid</SelectItem>
                <SelectItem value="Overdue" className="font-bold text-red-700">Overdue</SelectItem>
                <SelectItem value="Cancelled" className="font-bold text-slate-500">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Button 
              onClick={() => handleSave()} 
              disabled={saving}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md"
            >
              {saving ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Invoice</>}
            </Button>

            {invoiceId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="bg-white w-full sm:w-auto" onClick={(e) => handleSafeNavigate(e, "/Invoices")}>
  Cancel
</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Share</div>
                  <DropdownMenuItem onClick={() => { setSendMethod("email"); setEmailDialog(true); }} className="cursor-pointer font-medium text-slate-700 focus:bg-blue-50 focus:text-blue-700">
                    <Mail className="h-4 w-4 mr-2 text-blue-500" /> Send via Email
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSendMethod("sms"); setEmailDialog(true); }} className="cursor-pointer font-medium text-slate-700 focus:bg-amber-50 focus:text-amber-700">
                    <Smartphone className="h-4 w-4 mr-2 text-amber-500" /> Send via Text Message
                  </DropdownMenuItem>
                  
                  <div className="h-px bg-slate-100 my-1"></div>
                  
                  <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Manage</div>
                  <DropdownMenuItem onClick={() => handleAction("preview")} className="cursor-pointer font-medium text-slate-700">
                    <Eye className="h-4 w-4 mr-2 text-slate-400" /> Client Preview
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction("payment")} className="cursor-pointer font-medium text-slate-700 focus:bg-emerald-50 focus:text-emerald-700">
                    <DollarSign className="h-4 w-4 mr-2 text-emerald-500" /> Record Ledger Payment
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction("print")} className="cursor-pointer font-medium text-slate-700">
                    <Printer className="h-4 w-4 mr-2 text-slate-400" /> Download PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LEFT COLUMN: Main Form & Scope */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* 1. BILLING DETAILS */}
            <Card className="p-5 border-slate-200 shadow-sm bg-white">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> Billing Details
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Client *</Label>
                  <Select value={form.client_id} onValueChange={v => {
                    const client = clients.find(c => c.id === v);
                    setForm({
                      ...form, 
                      client_id: v, 
                      quote_id: "none", 
                      billing_address: client?.billing_address || form.billing_address,
                      site_address: client?.site_address || form.site_address 
                    });
                  }}>
                    <SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Select a Client —</SelectItem>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-amber-600 font-bold">Import from Quote</Label>
                  <Select value={form.quote_id} onValueChange={v => setForm({...form, quote_id: v})} disabled={!form.client_id || form.client_id === "none"}>
                    <SelectTrigger className="mt-1 font-medium border-amber-200 bg-amber-50/30 text-amber-900 focus:ring-amber-500">
                      <SelectValue placeholder={!form.client_id || form.client_id === "none" ? "Select a client first..." : "Select a quote to pull line items..."} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Do not link a quote —</SelectItem>
                      {clientQuotes.map(q => <SelectItem key={q.id} value={q.id}>{q.name || q.title || `Quote #${q.quote_number || q.id.slice(0,4)}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!invoiceId && form.quote_id !== "none" && (
                    <p className="text-[10px] text-amber-600 mt-1.5 font-medium flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Scope of Work successfully copied from quote.
                    </p>
                  )}
                </div>

                <div>
                  <Label>Billing Address</Label>
                  <AddressAutocomplete value={form.billing_address || ""} onChange={v => setForm({...form, billing_address: v})} className="mt-1 bg-white" />
                </div>
                <div>
                  <Label>Site Address</Label>
                  <AddressAutocomplete value={form.site_address || ""} onChange={v => setForm({...form, site_address: v})} className="mt-1 bg-white" />
                </div>
                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" value={form.issue_date} onChange={e => {
                    setForm({...form, issue_date: e.target.value});
                    handleDueTermsChange(form.due_terms); 
                  }} className="mt-1 bg-white" />
                </div>
                <div>
                  <Label>Payment Terms</Label>
                  <Select value={form.due_terms} onValueChange={handleDueTermsChange}>
                    <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                      <SelectItem value="net_15">Net 15</SelectItem>
                      <SelectItem value="net_30">Net 30</SelectItem>
                      <SelectItem value="net_60">Net 60</SelectItem>
                      <SelectItem value="custom">Custom Date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.due_terms === "custom" && (
                  <div className="sm:col-start-2">
                    <Label>Custom Due Date</Label>
                    <Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} className="mt-1 bg-white" />
                  </div>
                )}
              </div>
            </Card>

            {/* 2. EDITABLE SCOPE OF WORK */}
            <Card className="p-5 border-slate-200 shadow-sm bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-amber-500" /> Invoice Scope of Work
              </h3>
              
              <div className="space-y-4 mb-4">
                {phases.map((phase, phaseIdx) => (
                  <PhaseCard
                    key={phase.id || `phase-${phaseIdx}`}
                    phase={phase} phaseIdx={phaseIdx} phases={phases} products={products}
                    onUpdatePhase={updatePhase} onRemovePhase={removePhase} onDuplicatePhase={() => {}}
                    onAddLineItem={addLineItem} onUpdateLineItem={updateLineItem} onDuplicateLineItem={duplicateLineItem}
                    onMoveLineItem={moveLineItem} onReorderLineItems={reorderLineItems} onRemoveLineItem={removeLineItem}
                    onPhotoUpload={onPhotoUpload} onLineItemPhotoUpload={onLineItemPhotoUpload}
                    onSplitLineItem={handleSplitLineItem}
                    calculatePhaseSubtotal={calculatePhaseSubtotal} calculatePhaseCost={calculatePhaseCost} 
                    calculatePhaseMargin={calculatePhaseMargin} calculatePhaseMarginPercent={calculatePhaseMarginPercent} 
                    calculatePhaseTax={calculatePhaseTax} calculatePhaseTotal={calculatePhaseTotal}
                    clientSelections={null}
                    onMovePhaseUp={() => movePhaseUp(phaseIdx)} onMovePhaseDown={() => movePhaseDown(phaseIdx)}
                    isFirst={phaseIdx === 0} isLast={phaseIdx === phases.length - 1}
                  />
                ))}
              </div>

              <Button variant="outline" onClick={addPhase} className="w-full mb-6 border-dashed border-2 border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50 bg-white font-bold">
                <Plus className="h-4 w-4 mr-2" /> Add Phase
              </Button>

              {/* Manual Ad-Hoc Additions */}
              {manualItems.map((mItem, idx) => (
                <div key={idx} className="flex gap-2 items-center mb-2">
                  <Input placeholder="Additional Item Name (e.g. Extra Dumpster Fee)" value={mItem.name} onChange={e => { const updated = [...manualItems]; updated[idx].name = e.target.value; setManualItems(updated); }} className="flex-1 bg-white" />
                  <div className="relative w-32">
                    <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
                    <Input type="number" value={mItem.amount} onChange={e => { const updated = [...manualItems]; updated[idx].amount = e.target.value; setManualItems(updated); }} className="pl-6 bg-white" />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setManualItems(manualItems.filter((_, i) => i !== idx))} className="h-10 w-10 text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setManualItems([...manualItems, {name:"", amount:""}])} className="bg-white border-dashed border-slate-300 text-slate-600 mt-2 mb-6">
                <Plus className="h-4 w-4 mr-2" /> Add Additional Charge
              </Button>

              {/* Discount Editor */}
              <div className="border-t border-slate-200 pt-4 mt-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-blue-500" /> Apply Discount
                </h3>
                <div className="flex items-center gap-3">
                  <div className="relative w-1/3">
                    <span className="absolute left-3 top-2.5 text-slate-500">{form.discount_type === "fixed" ? "$" : "%"}</span>
                    <Input type="number" step="0.01" value={form.discount_amount} onChange={e => setForm({...form, discount_amount: Number(e.target.value)})} className="pl-7 bg-white" />
                  </div>
                  <Select value={form.discount_type} onValueChange={v => setForm({...form, discount_type: v})}>
                    <SelectTrigger className="w-1/3 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex-1 text-right">
                    <span className="text-sm text-slate-500 mr-2">Discount Value:</span>
                    <span className="font-bold text-red-600">-${discountValue.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* 3. PAYMENT MILESTONES */}
            <Card className="p-5 border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-500" /> Payment Schedule
                </h3>
                <Button size="sm" onClick={() => { setMilestoneForm({ payment_name: "", due_event: "", amount: "", amount_type: "fixed", percentage: 0 }); setEditingMilestoneIndex(null); setMilestoneDialog(true); }} variant="outline" className="bg-white">
                  <Plus className="h-4 w-4 mr-1" /> Add Milestone
                </Button>
              </div>

              <div className="space-y-3">
                {paymentScheduleItems.map((item, idx) => {
                  const isPaid = item.status === "Paid";
                  const displayAmount = item.amount_type === "percentage" ? (currentTotal * safeNum(item.percentage) / 100) : safeNum(item.amount);
                  return (
                    <div key={idx} className={`p-4 rounded-xl border ${isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'} flex items-center justify-between shadow-sm`}>
                      <div>
                        <h4 className={`font-bold text-base ${isPaid ? 'text-emerald-900' : 'text-slate-900'}`}>{item.payment_name}</h4>
                        <p className="text-xs text-slate-500 font-medium">Requirement: {item.due_event || "Standard Payment"}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className={`text-xl font-black ${isPaid ? 'text-emerald-700' : 'text-slate-900'}`}>
                             {item.amount_type === "percentage" ? <span className="text-sm mr-2 text-slate-500 font-medium">{item.percentage}%</span> : ""}
                             ${Number(displayAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </p>
                          <StatusBadge status={item.status || "Pending"} />
                        </div>
                        
                        <div className="flex flex-col gap-1 border-l border-slate-200 pl-3">
                          <Button size="sm" variant="ghost" onClick={() => { setMilestoneForm({ payment_name: item.payment_name, due_event: item.due_event, amount: item.amount || 0, amount_type: item.amount_type || "fixed", percentage: item.percentage || 0 }); setEditingMilestoneIndex(idx); setMilestoneDialog(true); }} className="text-blue-600 hover:bg-blue-50 h-6 w-6 p-0">
                            <Settings className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeMilestoneScheduleItem(idx)} className="text-red-600 hover:bg-red-50 h-6 w-6 p-0">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* 4. NOTES */}
            <div className="grid sm:grid-cols-2 gap-6">
              <Card className="p-5 border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Note to Client</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Show on Invoice</span>
                    <Switch checked={form.show_notes} onCheckedChange={c => setForm({...form, show_notes: c})} />
                  </div>
                </div>
                <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={4} className="bg-white text-sm" disabled={!form.show_notes} />
              </Card>

              <Card className="p-5 border-amber-200 bg-amber-50 shadow-sm">
                <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Lock className="h-4 w-4" /> Internal PM Notes
                </h3>
                <Textarea value={form.internal_notes} onChange={e => setForm({...form, internal_notes: e.target.value})} rows={4} className="bg-white border-amber-300 text-sm" placeholder="Private notes, tracking numbers, or PM reminders..." />
              </Card>
            </div>

          </div>

          {/* RIGHT COLUMN: Ledger Sidebar */}
          <div className="space-y-6">
            <Card className="p-6 border-slate-200 bg-slate-900 text-white shadow-xl sticky top-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Invoice Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Quote Scope Sum:</span>
                  <span className="font-semibold">${rawSubtotal.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
                
                {discountValue > 0 && (
                  <div className="flex justify-between text-sm text-red-400">
                    <span>Discount:</span>
                    <span className="font-semibold">-${discountValue.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                  </div>
                )}
                
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">{settings?.tax_label || "Tax"}:</span>
                  <span className="font-semibold">${primaryTaxAmount.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
                
                {settings?.enable_secondary_tax && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">{settings?.secondary_tax_label || "PST"}:</span>
                    <span className="font-semibold">${secondaryTaxAmount.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                  </div>
                )}

                <div className="flex justify-between text-base border-t border-slate-700 pt-3">
                  <span className="text-slate-100 font-bold">Total Contract:</span>
                  <span className="font-bold">${currentTotal.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-base border-t border-slate-700 pt-3 text-emerald-400">
                  <span className="font-bold">Total Collected:</span>
                  <span className="font-bold">-${currentPaid.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-2xl font-black border-t-2 border-slate-600 pt-4 text-white">
                  <span>Balance:</span>
                  <span className="text-amber-400">${currentBalance.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
              </div>

              {nextPaymentDue > 0 && (
                <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-1">Next Payment Due</p>
                  <div className="flex justify-between items-end">
                    <p className="text-sm text-slate-300 truncate pr-2">{nextPaymentItem?.payment_name}</p>
                    <p className="text-xl font-black text-amber-400">${nextPaymentDue.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
                  </div>
                </div>
              )}

              <Button onClick={() => handleSave()} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold h-12 text-base shadow-sm mt-6">
                <Save className="h-5 w-5 mr-2" /> {saving ? "Saving..." : (invoiceId ? "Save Invoice" : "Create Invoice")}
              </Button>
            </Card>
          </div>
        </div>

        {/* ⚡ MILESTONE DIALOG */}
        <Dialog open={milestoneDialog} onOpenChange={(open) => { setMilestoneDialog(open); if (!open) { setEditingMilestoneIndex(null); setMilestoneForm({ payment_name: "", due_event: "", amount: "", amount_type: "fixed", percentage: 0 }); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editingMilestoneIndex !== null ? "Edit Schedule Item" : "Add Schedule Item"}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Payment Name *</Label>
                <Input value={milestoneForm.payment_name} onChange={e => setMilestoneForm({...milestoneForm, payment_name: e.target.value})} placeholder="e.g., Deposit, First Payment, Final Payment" />
              </div>
              <div>
                <Label>Due Event / Milestone</Label>
                <div className="flex gap-2">
                  <Select onValueChange={(v) => setMilestoneForm({...milestoneForm, due_event: v})}>
                    <SelectTrigger className="w-[180px] bg-white"><SelectValue placeholder="Presets..." /></SelectTrigger>
                    <SelectContent>
                      {["Upon Approval", "Start of Project", "Materials Delivered", "50% Complete", "Rough-ins Complete", "Substantial Completion", "Upon Completion", "Final Sign-off"].map(e => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input 
                    value={milestoneForm.due_event} 
                    onChange={(e) => setMilestoneForm({...milestoneForm, due_event: e.target.value})} 
                    placeholder="Type or select a milestone..."
                    className="bg-white flex-1"
                  />
                </div>
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Amount *</Label>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={milestoneForm.amount_type === "fixed" ? "default" : "outline"} onClick={() => setMilestoneForm({...milestoneForm, amount_type: "fixed"})} className={`h-6 px-2 text-xs ${milestoneForm.amount_type === "fixed" ? "" : "bg-white text-slate-600"}`}>$</Button>
                    <Button type="button" size="sm" variant={milestoneForm.amount_type === "percentage" ? "default" : "outline"} onClick={() => setMilestoneForm({...milestoneForm, amount_type: "percentage"})} className={`h-6 px-2 text-xs ${milestoneForm.amount_type === "percentage" ? "" : "bg-white text-slate-600"}`}>%</Button>
                  </div>
                </div>
                {milestoneForm.amount_type === "fixed" ? (
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-900 font-medium">$</span>
                    <Input type="number" value={milestoneForm.amount} onChange={e => setMilestoneForm({...milestoneForm, amount: e.target.value})} placeholder="0.00" className="pl-7" step="0.01" min="0" />
                  </div>
                ) : (
                  <div className="relative">
                    <Input type="number" value={milestoneForm.percentage} onChange={e => setMilestoneForm({...milestoneForm, percentage: parseFloat(e.target.value) || 0})} placeholder="0.00" className="pr-7" step="0.01" min="0" max="100" />
                    <span className="absolute right-3 top-2.5 text-slate-900 font-medium">%</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <Button variant="outline" onClick={() => setMilestoneDialog(false)}>Cancel</Button>
                <Button onClick={addMilestoneScheduleItem} className="bg-slate-900 text-white">Save Item</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ⚡ IMPORTED: Record Payment Ledger Dialog */}
        <RecordPaymentDialog 
          open={ledgerDialog} 
          onOpenChange={setLedgerDialog} 
          invoice={existingInvoice} 
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoice-schedule-items", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoice-payments-builder", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }} 
        />

        {/* PREMIUM SAAS EMAIL DIALOG */}
        <SendInvoiceEmailDialog
          open={emailDialog && sendMethod === "email"} 
          onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
          invoiceId={invoiceId}
          invoiceNumber={existingInvoice?.invoice_number}
          clientId={form.client_id}
          clientName={clients?.find(c => c.id === form.client_id)?.name}
          clientEmail={clients?.find(c => c.id === form.client_id)?.email}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }} 
        />

        {/* 📱 SMS DIALOG */}
        <SendInvoiceTextDialog 
          open={emailDialog && sendMethod === "sms"} 
          onOpenChange={(isOpen) => { if(!isOpen) setEmailDialog(false); }} 
          invoice={existingInvoice || form} 
          client={clients?.find(c => c.id === form.client_id)} 
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }} 
        />

      </div>
    </div>
  );
}