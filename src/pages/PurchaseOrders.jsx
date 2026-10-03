import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShoppingCart, Plus, Search, Package, Calendar, DollarSign, Trash2, Box, Truck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import StatusBadge from "../components/shared/StatusBadge";
import DataTable from "../components/shared/DataTable";
import PageHeader from "../components/shared/PageHeader";
import AddressAutocomplete from "../components/shared/AddressAutocomplete"; // <-- NEW IMPORT

export default function PurchaseOrders() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [createDialog, setCreateDialog] = useState(false);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [similarVendors, setSimilarVendors] = useState([]);

  const [form, setForm] = useState({
    vendor_id: "",
    project_id: "",
    order_date: format(new Date(), 'yyyy-MM-dd'),
    expected_delivery_date: "",
    shipping_address: "",
    notes: "",
    terms: ""
  });

  const [newVendor, setNewVendor] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    address: ""
  });

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- QUERIES ---
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchase-orders", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error && error.code !== '42P01') throw error;
      return data || [];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("company_id", companyId);
      if (error && error.code !== '42P01') throw error;
      return data || [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("company_id", companyId);
      if (error && error.code !== '42P01') throw error;
      return data || [];
    },
  });

  const { data: company } = useQuery({
    queryKey: ["company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    }
  });

  // --- MUTATIONS ---
  const createVendorMutation = useMutation({
    mutationFn: async (data) => {
      const { data: vendor, error } = await supabase.from("vendors").insert([{ ...data, company_id: companyId }]).select().single();
      if (error) throw error;
      return vendor;
    },
    onSuccess: (vendor) => {
      queryClient.invalidateQueries({ queryKey: ["vendors", companyId] });
      setForm({ ...form, vendor_id: vendor.id });
      setShowNewVendor(false);
      setNewVendor({ company_name: "", contact_name: "", email: "", phone: "", address: "" });
      setSimilarVendors([]);
      toast.success("Vendor created successfully");
    },
    onError: (err) => toast.error(`Failed to create vendor: ${err.message}`)
  });

  const createPOMutation = useMutation({
    mutationFn: async (data) => {
      console.log("1. Starting PO Creation with data:", data);

      if (!companyId) throw new Error("Company ID is missing from your session.");
      if (!data.vendor_id) throw new Error("Vendor ID is missing.");

      const poNumber = `${company?.po_number_prefix || "PO-"}${company?.next_po_number || 1001}`;
      console.log("2. Generated PO Number:", poNumber);
      
      // Force every value into its strict Postgres-friendly format
      const payload = {
        company_id: companyId,
        vendor_id: data.vendor_id,
        project_id: (data.project_id === "none" || data.project_id === "" || !data.project_id) ? null : data.project_id,
        expected_delivery_date: (data.expected_delivery_date === "" || !data.expected_delivery_date) ? null : data.expected_delivery_date,
        order_date: (data.order_date === "" || !data.order_date) ? null : data.order_date,
        shipping_address: typeof data.shipping_address === 'string' ? data.shipping_address : "",
        notes: data.notes || "",
        terms: data.terms || "",
        po_number: poNumber,
        status: "Draft",
        subtotal: 0,
        tax: 0,
        total: 0
      };

      console.log("3. Payload ready for Supabase:", payload);

      const { data: newPO, error } = await supabase
        .from("purchase_orders")
        .insert([payload])
        .select()
        .single();

      if (error) {
        console.error("4. SUPABASE INSERT ERROR:", error);
        throw new Error(error.message);
      }

      console.log("5. PO Created successfully:", newPO);

      // Increment the company counter
      await supabase.from("companies").update({ 
        next_po_number: (company?.next_po_number || 1001) + 1 
      }).eq("id", companyId);

      return newPO;
    },
    onSuccess: (newPO) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["company"] });
      
      setCreateDialog(false);
      setForm({
        vendor_id: "", project_id: "none", order_date: format(new Date(), 'yyyy-MM-dd'), expected_delivery_date: "", shipping_address: "", notes: "", terms: ""
      });
      
      toast.success("Purchase order created successfully!");
      // Fallback navigation in case createPageUrl is acting up
      window.location.href = `/PurchaseOrderDetail?id=${newPO.id}`; 
    },
    onError: (err) => {
      console.error("Mutation Error Caught:", err);
      toast.error(`Failed to create PO: ${err.message}`);
    }
  });

  const deletePOMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase order deleted");
    },
    onError: (err) => toast.error(`Failed to delete PO: ${err.message}`)
  });

  // --- LOGIC ---
  const checkSimilarVendors = (name) => {
    if (!name || name.length < 3) {
      setSimilarVendors([]);
      return;
    }
    const similar = vendors.filter(v => {
      const vendorName = (v.company_name || v.name || "").toLowerCase();
      const searchName = name.toLowerCase();
      return vendorName.includes(searchName) || searchName.includes(vendorName);
    });
    setSimilarVendors(similar);
  };

  const enrichedPOs = purchaseOrders.map(po => {
    const vendor = vendors.find(v => v.id === po.vendor_id);
    const project = projects.find(p => p.id === po.project_id);
    return {
      ...po,
      vendor_name: vendor?.company_name || vendor?.name || "Unknown Vendor",
      project_name: project?.name || "—"
    };
  });

  const filteredPOs = enrichedPOs.filter(po => {
    const matchesSearch = !searchTerm || 
                          po.po_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          po.vendor_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || po.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const totalSpent = purchaseOrders.filter(po => ["Received", "Billed"].includes(po.status)).reduce((sum, po) => sum + (po.total || 0), 0);
  const totalPending = purchaseOrders.filter(po => ["Sent"].includes(po.status)).reduce((sum, po) => sum + (po.total || 0), 0);

  const columns = [
    {
      key: "po_number",
      label: "PO Number",
      render: (val, row) => (
        <button onClick={() => window.location.href = createPageUrl(`PurchaseOrderDetail?id=${row.id}`)} className="font-bold text-slate-800 hover:text-amber-600 underline">
          {val}
        </button>
      ),
    },
    { key: "vendor_name", label: "Vendor", render: (val) => <span className="font-medium text-slate-700">{val}</span> },
    { key: "project_name", label: "Project", render: (val) => <span className="text-sm text-slate-600">{val}</span> },
    { key: "order_date", label: "Order Date", render: (val) => <span className="text-sm text-slate-500">{val ? format(new Date(val), "MMM d, yyyy") : "—"}</span> },
    { key: "expected_delivery_date", label: "Expected Delivery", render: (val) => <span className="text-sm text-slate-500">{val ? format(new Date(val), "MMM d, yyyy") : "—"}</span> },
    { key: "total", label: "Total", render: (val) => <span className="font-bold text-slate-900">${(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> },
    { key: "status", label: "Status", render: (val) => <StatusBadge status={val || "Draft"} /> },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.preventDefault();
            if (window.confirm("Delete this purchase order?")) {
              deletePOMutation.mutate(row.id);
            }
          }}
        >
          <Trash2 className="h-4 w-4 text-red-400 hover:text-red-600" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      <PageHeader 
        title="Purchase Orders" 
        description="Manage supplier orders, track deliveries, and control job costs." 
        actions={
          <Button onClick={() => setCreateDialog(true)} className="bg-slate-900 hover:bg-slate-800 text-white">
             {/* ⚡ HIDES TEXT ON MOBILE */}
            <Plus className="h-4 w-4 sm:mr-2" /> 
            <span className="hidden sm:inline">New Purchase Order</span>
          </Button>
        } 
      />

      {/* STAT CARDS ⚡ HIDDEN ON MOBILE (hidden sm:grid) */}
      <div className="hidden sm:grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Received</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">${totalSpent.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <Box className="h-10 w-10 text-emerald-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Awaiting Delivery</p>
            <p className="text-2xl font-black text-amber-600 mt-1">${totalPending.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <Truck className="h-10 w-10 text-amber-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Active POs</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{purchaseOrders.length}</p>
          </div>
          <ShoppingCart className="h-10 w-10 text-slate-100" />
        </Card>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by PO # or Vendor Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px] bg-white">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["Draft", "Sent", "Received", "Billed", "Cancelled"].map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable 
          columns={columns} 
          data={filteredPOs} 
          emptyMessage="No purchase orders found. Create one to start tracking job costs."
        />
      </div>

      {/* CREATE DIALOG */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-md bg-slate-50">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-amber-500" /> New Purchase Order
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={(e) => { e.preventDefault(); createPOMutation.mutate(form); }} className="space-y-4 pt-4">
            
            {!showNewVendor ? (
              <Card className="p-4 shadow-sm border-slate-200">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Select Vendor *</Label>
                <Select value={form.vendor_id} onValueChange={(v) => {
                  if (v === "new") setShowNewVendor(true);
                  else setForm({...form, vendor_id: v});
                }}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Choose an existing vendor..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new" className="text-amber-600 font-bold bg-amber-50">
                      + Create New Vendor
                    </SelectItem>
                    {vendors.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.company_name || v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Card>
            ) : (
              <Card className="p-4 shadow-sm border-amber-300 bg-amber-50/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2"><Package className="h-4 w-4 text-amber-500" /> New Vendor Profile</h3>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewVendor(false); setSimilarVendors([]); }} className="text-slate-500 h-8">
                    Cancel
                  </Button>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Company Name *</Label>
                    <Input 
                      value={newVendor.company_name} 
                      onChange={(e) => {
                        setNewVendor({...newVendor, company_name: e.target.value});
                        checkSimilarVendors(e.target.value);
                      }}
                      placeholder="e.g. ABC Home Supplies"
                      className="bg-white"
                    />
                  </div>

                  {similarVendors.length > 0 && (
                    <div className="p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                      <p className="text-xs font-semibold text-yellow-800 mb-2">⚠️ Similar vendors already exist:</p>
                      <div className="space-y-1">
                        {similarVendors.map(v => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setForm({...form, vendor_id: v.id});
                              setShowNewVendor(false);
                              setSimilarVendors([]);
                              toast.info("Selected existing vendor");
                            }}
                            className="w-full text-left text-xs p-2 bg-white rounded shadow-sm hover:bg-yellow-50 transition-colors font-medium text-slate-700"
                          >
                            {v.company_name || v.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Contact Name</Label>
                    <Input value={newVendor.contact_name} onChange={(e) => setNewVendor({...newVendor, contact_name: e.target.value})} className="bg-white" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Email</Label>
                      <Input type="email" value={newVendor.email} onChange={(e) => setNewVendor({...newVendor, email: e.target.value})} className="bg-white" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Phone</Label>
                      <Input value={newVendor.phone} onChange={(e) => setNewVendor({...newVendor, phone: e.target.value})} className="bg-white" />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => createVendorMutation.mutate(newVendor)}
                    disabled={!newVendor.company_name}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white mt-2"
                  >
                    Save Vendor & Continue
                  </Button>
                </div>
              </Card>
            )}

            <Card className="p-4 shadow-sm border-slate-200 space-y-4">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Link to Project (Optional)</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm({...form, project_id: v})}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General Order (No Project)</SelectItem>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Order Date</Label>
                  <Input type="date" value={form.order_date} onChange={(e) => setForm({...form, order_date: e.target.value})} className="bg-white" />
                </div>
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Expected Delivery</Label>
                  <Input type="date" value={form.expected_delivery_date} onChange={(e) => setForm({...form, expected_delivery_date: e.target.value})} className="bg-white" />
                </div>
              </div>

              {/* --- NEW AUTOCOMPLETE SHIPPING ADDRESS --- */}
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Shipping Address</Label>
                <AddressAutocomplete 
                  value={form.shipping_address} 
                  onChange={(val) => setForm({...form, shipping_address: val})} 
                  placeholder="Search for delivery address..."
                  className="bg-white"
                />
              </div>

              {/* --- KEPT AS NOTES/INSTRUCTIONS --- */}
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Delivery Instructions / Notes</Label>
                <Textarea 
                  value={form.notes} 
                  onChange={(e) => setForm({...form, notes: e.target.value})} 
                  rows={2} 
                  className="bg-white resize-none" 
                  placeholder="Gate codes, delivery hours, etc." 
                />
              </div>
            </Card>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={!form.vendor_id || createPOMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6 shadow-md">
                {createPOMutation.isPending ? "Creating..." : "Create PO Draft"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}