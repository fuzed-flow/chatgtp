import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Package, Check, Upload, FileText, Download, Mail, Eye, Send, Menu, Save, CheckCircle, DollarSign } from "lucide-react";
import { toast } from "sonner";
import StatusBadge from "../components/shared/StatusBadge";
import { Textarea } from "@/components/ui/textarea";
import AddressAutocomplete from "../components/shared/AddressAutocomplete";
import { format } from "date-fns";
import SendPODialog from "../components/purchase-orders/SendPODialog";
import { generatePOPDF } from "../components/pdf/PDFGenerator";

export default function PurchaseOrderDetail() {
  const { profile, settings } = useAuth();
  const companyId = profile?.company_id;
  const params = new URLSearchParams(window.location.search);
  const poId = params.get("id");
  const queryClient = useQueryClient();

  const [itemDialog, setItemDialog] = useState(false);
  const [itemForm, setItemForm] = useState({ product_id: "", item_name: "", description: "", quantity: "1", unit_cost: "" });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [emailDialog, setEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ recipient: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [poForm, setPoForm] = useState({ purpose: "", shipping_address: "", notes: "", terms: "", order_date: "", expected_delivery_date: "" });
  
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  useEffect(() => {
    const closeMenus = (e) => {
      if (!e.target.closest('.actions-menu-container')) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  const { data: po } = useQuery({
    queryKey: ["purchase-order", poId],
    enabled: !!poId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*").eq("id", poId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["po-items", poId],
    enabled: !!poId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_order_line_items").select("*").eq("purchase_order_id", poId).order("display_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: vendor } = useQuery({
    queryKey: ["vendor", po?.vendor_id],
    enabled: !!po?.vendor_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("id", po.vendor_id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: company } = useQuery({
    queryKey: ["company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).single();
      if (error) throw error;
      return data;
    },
  });

  // --- DUAL-TAX MATH ENGINE ---
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  const combinedTaxRate = primaryTaxRate + secondaryTaxRate;

  const primaryTaxAmount = (po?.subtotal || 0) * primaryTaxRate;
  const secondaryTaxAmount = (po?.subtotal || 0) * secondaryTaxRate;

  useEffect(() => {
    if (po) {
      setPoForm({
        purpose: po.notes || "", 
        shipping_address: po.shipping_address || "",
        notes: po.notes || "",
        terms: po.terms || "",
        order_date: po.order_date || "",
        expected_delivery_date: po.expected_delivery_date || "",
      });
    }
  }, [po]);

  // --- RECALCULATE INCORPORATING NEW SETTINGS ---
  const recalculateTotals = async () => {
    const { data: currentItems } = await supabase.from("purchase_order_line_items").select("*").eq("purchase_order_id", poId);
    
    const subtotal = (currentItems || []).reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unit_cost)), 0);
    const tax = subtotal * combinedTaxRate; 
    const total = subtotal + tax;

    await supabase.from("purchase_orders").update({ subtotal, tax, total }).eq("id", poId);
    queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
  };

  // --- MUTATIONS ---
  const addItemMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("purchase_order_line_items").insert([{
        ...data,
        company_id: companyId,
        purchase_order_id: poId,
        quantity: Number(data.quantity),
        unit_cost: Number(data.unit_cost),
        product_id: data.product_id || null
      }]);
      if (error) throw error;
    },
    onSuccess: async () => {
      await recalculateTotals();
      queryClient.invalidateQueries({ queryKey: ["po-items", poId] });
      setItemDialog(false);
      setItemForm({ product_id: "", item_name: "", description: "", quantity: "1", unit_cost: "" });
      toast.success("Item added");
    },
    onError: (err) => toast.error(`Failed to add item: ${err.message}`)
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("purchase_order_line_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await recalculateTotals();
      queryClient.invalidateQueries({ queryKey: ["po-items", poId] });
      toast.success("Item removed");
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus) => {
      const payload = { status: newStatus };
      if (newStatus === "Approved") {
        payload.actual_delivery_date = new Date().toISOString().split('T')[0];
      }
      const { error } = await supabase.from("purchase_orders").update(payload).eq("id", poId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      toast.success("Status updated");
    },
  });

  const handleFileUpload = async (file) => {
    setUploadingFile(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${companyId}/po_${poId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(fileName);
      
      await supabase.from("purchase_orders").update({ vendor_quote_attachment: publicUrl }).eq("id", poId);
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      toast.success("Vendor quote uploaded successfully");
    } catch (error) {
      toast.error("Upload failed: " + error.message);
    }
    setUploadingFile(false);
  };

  const updatePOField = async (field, value) => {
    try {
      const { error } = await supabase.from("purchase_orders").update({ [field]: value }).eq("id", poId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      toast.success("Purchase order saved");
    } catch (error) {
      toast.error("Update failed");
    }
  };

  const renderActionsMenu = (position = "top") => {
    return (
      <div className="relative actions-menu-container inline-block">
        <Button 
          variant="outline" 
          onClick={() => setActionsMenuOpen(actionsMenuOpen === position ? false : position)}
          className={`bg-white font-medium shadow-sm transition-all ${actionsMenuOpen === position ? "border-amber-400 ring-2 ring-amber-100" : ""}`}
        >
          <Menu className="h-4 w-4 mr-2 text-slate-500" /> Actions
        </Button>
        
        {actionsMenuOpen === position && (
          <div className={`absolute ${position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-56 bg-white rounded-lg shadow-xl border border-slate-200 py-1.5 z-50`}>
            
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Communication</div>
            <button 
              onClick={() => { setActionsMenuOpen(false); window.open(createPageUrl(`PurchaseOrderView?id=${poId}`), '_blank'); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Eye className="h-4 w-4 mr-3 text-slate-400" /> Vendor Preview
            </button>
            <button 
              onClick={async () => {
                setActionsMenuOpen(false);
                const loadingId = toast.loading("Generating PO PDF...");
                try {
                  await generatePOPDF(po, vendor, items, company);
                  toast.success("PDF Downloaded successfully!", { id: loadingId });
                } catch (err) {
                  toast.error("Failed to generate PDF.", { id: loadingId });
                }
              }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Download className="h-4 w-4 mr-3 text-slate-400" /> Download PDF
            </button>
            <button 
              onClick={() => {
                setActionsMenuOpen(false);
                setEmailForm({ recipient: vendor?.email || "", message: "" });
                setEmailDialog(true);
              }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Mail className="h-4 w-4 mr-3 text-slate-400" /> Send via Email
            </button>
            
            <div className="h-px bg-slate-100 my-1.5"></div>
            
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Update Status</div>
            <button 
              onClick={() => { setActionsMenuOpen(false); updateStatusMutation.mutate("Sent"); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <Send className="h-4 w-4 mr-3 text-blue-500" /> Mark as Sent
            </button>
            <button 
              onClick={() => { setActionsMenuOpen(false); updateStatusMutation.mutate("Approved"); }} 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center transition-colors"
            >
              <CheckCircle className="h-4 w-4 mr-3 text-emerald-500" /> Mark as Approved
            </button>
          </div>
        )}
      </div>
    );
  };

  if (!po) return <div className="p-6 text-slate-500">Loading Purchase Order...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        
        <Link to={createPageUrl("PurchaseOrders")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-2 font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Orders
        </Link>

        {/* STICKY HEADER */}
        <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm -mx-4 px-4 sm:-mx-6 sm:px-6 py-3 mb-4 rounded-b-xl">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2 truncate">
                {po.po_number}
                <StatusBadge status={po.status} />
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">Vendor: {vendor?.company_name || vendor?.name || "Unknown"}</p>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={() => toast.success("Changes are automatically saved!")} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                <Save className="h-4 w-4 mr-1" /> Save Draft
              </Button>
              {renderActionsMenu('top')}
            </div>
          </div>
        </div>

        {/* CORE DETAILS CARD */}
        <Card className="p-6 border-slate-200 shadow-sm bg-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200 mb-6">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Order Date</p>
              <p className="font-medium text-slate-900">{po.order_date ? format(new Date(po.order_date), "MMM d, yyyy") : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Expected Delivery</p>
              <p className="font-medium text-slate-900">{po.expected_delivery_date ? format(new Date(po.expected_delivery_date), "MMM d, yyyy") : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Actual Delivery</p>
              <p className="font-medium text-slate-900">{po.actual_delivery_date ? format(new Date(po.actual_delivery_date), "MMM d, yyyy") : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total</p>
              <p className="font-black text-lg text-emerald-600">${(po.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Shipping Address</Label>
                <AddressAutocomplete
                  value={poForm.shipping_address}
                  onChange={(val) => {
                    setPoForm({ ...poForm, shipping_address: val });
                    updatePOField("shipping_address", val);
                  }}
                  className="bg-white"
                  placeholder="Search for delivery address..."
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Vendor Quote Attachment</Label>
                <div className="mt-1 space-y-2">
                  {po.vendor_quote_attachment ? (
                    <div className="flex items-center justify-between p-2 bg-blue-50 text-blue-900 rounded border border-blue-200">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="h-4 w-4 shrink-0" />
                        <a href={po.vendor_quote_attachment} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline truncate">
                          View Vendor Quote Document
                        </a>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await supabase.from("purchase_orders").update({ vendor_quote_attachment: null }).eq("id", poId);
                          queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
                          toast.success("Attachment removed");
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-100 h-8 w-8 p-0 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-2.5 border-2 border-dashed border-slate-300 rounded cursor-pointer hover:border-amber-500 hover:bg-amber-50 transition-colors bg-white">
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                        disabled={uploadingFile}
                      />
                      <Upload className={`h-4 w-4 text-slate-400 ${uploadingFile ? 'animate-bounce text-amber-500' : ''}`} />
                      <span className="text-sm font-medium text-slate-600">{uploadingFile ? "Uploading..." : "Upload Quote (PDF/Image)"}</span>
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Delivery Instructions / Notes</Label>
              <Textarea
                value={poForm.notes}
                onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                onBlur={(e) => updatePOField("notes", poForm.notes)}
                rows={2}
                className="bg-white resize-none"
                placeholder="Gate codes, delivery instructions, internal notes..."
              />
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Terms & Conditions</Label>
              <Textarea
                value={poForm.terms}
                onChange={(e) => setPoForm({ ...poForm, terms: e.target.value })}
                onBlur={(e) => updatePOField("terms", poForm.terms)}
                rows={2}
                className="bg-white resize-none"
                placeholder="Net 30, Pay on receipt, etc."
              />
            </div>
          </div>
        </Card>

        {/* ITEMS CARD */}
        <Card className="p-6 border-slate-200 shadow-sm bg-white mb-12">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" /> Line Items
            </h2>
            <Button size="sm" onClick={() => setItemDialog(true)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          </div>

          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-amber-300 transition-colors group">
                <div className="flex-1">
                  <p className="font-bold text-slate-900">{item.item_name}</p>
                  {item.description && <p className="text-xs text-slate-600 mt-0.5">{item.description}</p>}
                  <div className="flex items-center gap-4 text-xs font-medium text-slate-500 mt-1.5">
                    <span className="bg-white px-2 py-0.5 rounded border border-slate-200">Qty: {item.quantity} {item.unit}</span>
                    <span className="bg-white px-2 py-0.5 rounded border border-slate-200">Unit: ${(item.unit_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <p className="font-black text-slate-900">${((item.quantity || 1) * (item.unit_cost || 0)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm("Remove this item from the Purchase Order?")) {
                        deleteItemMutation.mutate(item.id);
                      }
                    }}
                    className="text-slate-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium text-sm">No items added to this PO yet</p>
              </div>
            )}
          </div>

          {/* Totals Section */}
          {items.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end">
              <div className="w-full sm:w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 font-medium">Subtotal:</span>
                  <span className="font-bold text-slate-900">${(po.subtotal || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 font-medium">{settings?.tax_label || "Tax"}:</span>
                  <span className="font-bold text-slate-900">${primaryTaxAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
                {settings?.enable_secondary_tax && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600 font-medium">{settings?.secondary_tax_label || "PST"}:</span>
                    <span className="font-bold text-slate-900">${secondaryTaxAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2 border-t border-slate-200">
                  <span className="font-black text-slate-900">Total:</span>
                  <span className="font-black text-amber-600">${(po.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}
        </Card>

      </div>

      {/* Add Item Dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent aria-describedby={undefined} className="bg-slate-50">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" /> Add Line Item
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); addItemMutation.mutate(itemForm); }} className="space-y-4 pt-4">
            
            <Card className="p-4 shadow-sm border-slate-200 space-y-4">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Select Product from Catalog</Label>
                <Select 
                  value={itemForm.product_id} 
                  onValueChange={(v) => {
                    const product = products.find(p => p.id === v);
                    setItemForm({
                      ...itemForm, 
                      product_id: v,
                      item_name: product?.name || "",
                      description: product?.description || "",
                      unit_cost: product?.cost?.toString() || ""
                    });
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Choose a product to auto-fill..." />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} - ${p.cost}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Item Name *</Label>
                <Input value={itemForm.item_name} onChange={(e) => setItemForm({...itemForm, item_name: e.target.value})} className="bg-white" required />
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Description</Label>
                <Input value={itemForm.description} onChange={(e) => setItemForm({...itemForm, description: e.target.value})} className="bg-white" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Quantity *</Label>
                  <Input type="number" step="0.01" value={itemForm.quantity} onChange={(e) => setItemForm({...itemForm, quantity: e.target.value})} className="bg-white" required />
                </div>
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Unit Cost *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                    <Input type="number" step="0.01" value={itemForm.unit_cost} onChange={(e) => setItemForm({...itemForm, unit_cost: e.target.value})} className="bg-white pl-7" required />
                  </div>
                </div>
              </div>
            </Card>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setItemDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={addItemMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold">
                {addItemMutation.isPending ? "Adding..." : "Add Item"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DISPATCH DIALOG */}
      <SendPODialog 
        open={emailDialog} 
        onOpenChange={setEmailDialog} 
        poId={poId} 
        poData={po}
        vendorData={vendor}
        itemsData={items}
        companyData={company}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
        }} 
      />
    </div>
  );
}