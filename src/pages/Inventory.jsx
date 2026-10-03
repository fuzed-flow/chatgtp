import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Minus, Package, Pencil, Trash2, ExternalLink, Image as ImageIcon, Search, Download, UploadCloud, X, ChevronRight, FolderTree, AlertOctagon, Filter, MapPin, AlertTriangle, ClipboardList, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";

const UNITS = ["ea", "ft", "sqft", "hr", "lft", "m", "sqm", "bag", "box", "roll", "sheet", "pail"];

const parseCSV = (text) => {
  const result = []; let row = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) { row.push(cur.trim()); cur = ''; }
    else if (char === '\n' && !inQuotes) { row.push(cur.trim()); result.push(row); row = []; cur = ''; }
    else cur += char;
  }
  if (cur !== '' || row.length > 0) { row.push(cur.trim()); result.push(row); }
  return result;
};

export default function Inventory() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  
  // FIX: Robust fallback to grab the actual user's name for logs
  const employeeName = profile?.full_name || profile?.user_metadata?.full_name || profile?.email || "Admin";

  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  // --- UI STATE ---
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ main: "All", location: "All", status: "All" });
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [errorPopup, setErrorPopup] = useState(null); 

  const [selectedItem, setSelectedItem] = useState(null);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  
  // Usage Report State
  const [reportSearch, setReportSearch] = useState("");
  const [reportFilters, setReportFilters] = useState({ project: "All", employee: "All", type: "All" });

  const defaultForm = { name: "", sku: "", category: "", sub_category: "", unit: "ea", cost: "", quantity_on_hand: "0", reorder_point: "0", location: "Main Storage", supplier: "", vendor_url: "", description: "", image_url: "" };
  const [form, setForm] = useState(defaultForm);

  // 1. Fetch Inventory
  const { data: inventory = [], isLoading: invLoading } = useQuery({ 
    queryKey: ["inventory", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory").select("*").eq("company_id", companyId).order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    } 
  });

  // 2. Fetch Usage Transactions
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["inventory_transactions", companyId],
    enabled: !!companyId && reportOpen, // Only fetch when the report is opened
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_transactions").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) { console.warn("Transactions not found:", error); return []; }
      return data || [];
    }
  });

  // 3. Fetch Categories
  const { data: customCategories = [] } = useQuery({
    queryKey: ["product_categories", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_categories").select("*").eq("company_id", companyId);
      if (error) return [];
      return data || [];
    }
  });

  // --- DROPDOWN LOGIC ---
  const existingPaths = inventory.map(i => ({ main: i.category, sub: i.sub_category }));
  const customPaths = customCategories.map(c => ({ main: c.main_category, sub: c.sub_category }));
  const allPaths = [...existingPaths, ...customPaths].filter(p => p.main);

  const uniqueMains = [...new Set(allPaths.map(p => p.main).filter(Boolean))].sort();
  const uniqueSubs = form.category ? [...new Set(allPaths.filter(p => p.main === form.category).map(p => p.sub).filter(Boolean))].sort() : [];
  const uniqueLocations = [...new Set(inventory.map(i => i.location).filter(Boolean))].sort();
  
  const filterUniqueMains = ["All", ...uniqueMains];
  const filterUniqueLocations = ["All", ...uniqueLocations];

  const filteredInventory = inventory.filter(i => {
    const matchSearch = !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase());
    const matchMain = filters.main === "All" || i.category === filters.main;
    const matchLoc = filters.location === "All" || i.location === filters.location;
    const matchStatus = filters.status === "All" || (filters.status === "Low Stock" && (i.quantity_on_hand <= i.reorder_point));
    return matchSearch && matchMain && matchLoc && matchStatus;
  });

  // --- USAGE REPORT LOGIC ---
  const repUniqueProjects = ["All", ...new Set(transactions.map(t => t.project_name).filter(Boolean))].sort();
  const repUniqueEmployees = ["All", ...new Set(transactions.map(t => t.employee_name).filter(Boolean))].sort();

  const filteredTransactions = transactions.filter(t => {
    const item = inventory.find(i => i.id === t.inventory_id);
    const itemName = item ? item.name : "Unknown Item";
    const matchSearch = !reportSearch || itemName.toLowerCase().includes(reportSearch.toLowerCase()) || t.notes?.toLowerCase().includes(reportSearch.toLowerCase());
    const matchProject = reportFilters.project === "All" || t.project_name === reportFilters.project;
    const matchEmployee = reportFilters.employee === "All" || t.employee_name === reportFilters.employee;
    const matchType = reportFilters.type === "All" || t.transaction_type === reportFilters.type;
    return matchSearch && matchProject && matchEmployee && matchType;
  });

  // --- MUTATIONS ---
  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (!payload.name) throw new Error("Validation failed");

      const dbPayload = {
        company_id: companyId, name: payload.name, sku: payload.sku || null,
        category: payload.category || null, sub_category: payload.sub_category || null,
        unit: payload.unit || "ea", cost: parseFloat(payload.cost) || 0, 
        quantity_on_hand: parseFloat(payload.quantity_on_hand) || 0,
        reorder_point: parseFloat(payload.reorder_point) || 0,
        location: payload.location || 'Main Storage',
        supplier: payload.supplier || null, vendor_url: payload.vendor_url || null,
        description: payload.description || null, image_url: payload.image_url || null
      };

      if (editing) {
        const { error } = await supabase.from("inventory").update(dbPayload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory").insert([dbPayload]);
        if (error) throw error;
      }
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["inventory"] }); 
      setDialogOpen(false); 
      setEditing(null);
      toast.success(editing ? "Item updated!" : "Added to inventory"); 
    },
    onError: (err) => {
      if (err.message === "Validation failed") setErrorPopup({ title: "Name Required", message: "The item must have a name." });
      else { setErrorPopup({ title: "Database Error", message: err.message }); }
    }
  });

  // Rapid Stock Adjuster
  const adjustStockMutation = useMutation({
    mutationFn: async ({ id, newQty, change, name }) => {
      const { error } = await supabase.from("inventory").update({ quantity_on_hand: newQty }).eq("id", id);
      if (error) throw error;
      
      // Log the transaction behind the scenes using the robust employeeName
      await supabase.from("inventory_transactions").insert([{
        company_id: companyId, inventory_id: id, employee_name: employeeName,
        quantity_changed: change, transaction_type: change > 0 ? 'Receive' : 'Consume', notes: "Manual Adjustment in Shop"
      }]);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["inventory_transactions"] }); }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("inventory").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setDetailOpen(false);
      toast.success("Item deleted");
    }
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (items) => {
      const chunkSize = 100;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const { error } = await supabase.from("inventory").insert(chunk);
        if (error) throw error;
      }
    },
    onSuccess: (_, items) => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(`Imported ${items.length} items successfully!`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => {
      setErrorPopup({ title: "Import Failed", message: err.message });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  });

  // --- ACTIONS ---
  const openNew = () => { setEditing(null); setForm(defaultForm); setDialogOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name || "", sku: item.sku || "", category: item.category || "", sub_category: item.sub_category || "",
      unit: item.unit || "ea", cost: item.cost || "", quantity_on_hand: item.quantity_on_hand || "0", reorder_point: item.reorder_point || "0", location: item.location || "",
      supplier: item.supplier || "", vendor_url: item.vendor_url || "",
      description: item.description || "", image_url: item.image_url || "",
    });
    setDialogOpen(true);
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    toast.loading("Reading CSV file...");

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error("File is empty or missing headers.");

        const headers = rows[0].map(h => h.toLowerCase().trim().replace(/['"]/g, ''));
        const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("product") || h.includes("item"));
        const skuIdx = headers.findIndex(h => h === "sku" || h.includes("number"));
        const catIdx = headers.findIndex(h => h === "category" && !h.includes("sub") && !h.includes("3rd") && !h.includes("tertiary"));
        const unitIdx = headers.findIndex(h => h === "unit" || h === "uom");
        const locIdx = headers.findIndex(h => h.includes("location") || h === "bin");
        const qtyIdx = headers.findIndex(h => h.includes("qty") || h.includes("quantity"));
        const costIdx = headers.findIndex(h => h === "cost" || h === "total cost");
        const supIdx = headers.findIndex(h => h.includes("supplier") || h.includes("vendor"));

        if (nameIdx === -1) throw new Error("Could not find a 'Name' column in the CSV.");

        const itemsToInsert = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2 || !row[nameIdx]) continue; 

          itemsToInsert.push({
            company_id: companyId,
            name: row[nameIdx].replace(/['"]/g, ''),
            sku: skuIdx > -1 ? row[skuIdx].replace(/['"]/g, '') : null,
            category: catIdx > -1 ? row[catIdx].replace(/['"]/g, '') : null,
            location: locIdx > -1 ? row[locIdx].replace(/['"]/g, '') : 'Main Storage',
            quantity_on_hand: qtyIdx > -1 ? (parseFloat(row[qtyIdx].replace(/[^0-9.-]+/g, "")) || 0) : 0,
            unit: unitIdx > -1 ? (row[unitIdx].replace(/['"]/g, '') || "ea") : "ea",
            cost: costIdx > -1 ? (parseFloat(row[costIdx].replace(/[^0-9.-]+/g, "")) || 0) : 0,
            supplier: supIdx > -1 ? row[supIdx].replace(/['"]/g, '') : null,
            taxable: true
          });
        }
        if (itemsToInsert.length === 0) throw new Error("No valid items found to import.");
        
        toast.dismiss();
        toast.loading(`Importing ${itemsToInsert.length} items to inventory...`);
        bulkImportMutation.mutate(itemsToInsert);
      } catch (err) {
        toast.dismiss();
        setErrorPopup({ title: "CSV Import Failed", message: err.message });
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const exportInventoryToCSV = () => {
    if (!filteredInventory.length) return toast.error("No items to export");
    const headers = ["Name", "SKU", "Location", "Category", "Sub Category", "Qty on Hand", "Alert Point", "Unit", "Total Cost", "Supplier", "Vendor URL"];
    const rows = filteredInventory.map(p => 
      [p.name, p.sku, p.location, p.category, p.sub_category, p.quantity_on_hand, p.reorder_point, p.unit, p.cost, p.supplier, p.vendor_url]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Warehouse_Inventory_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  };

  const exportUsageToCSV = () => {
    if (!filteredTransactions.length) return toast.error("No transactions to export");
    const headers = ["Date", "Employee", "Item Taken", "Project Assigned", "Qty Changed", "Type", "Notes"];
    const rows = filteredTransactions.map(t => {
      const item = inventory.find(i => i.id === t.inventory_id);
      return [
        format(parseISO(t.created_at), "yyyy-MM-dd HH:mm"),
        t.employee_name,
        item ? item.name : "Unknown Item",
        t.project_name || "Unassigned",
        t.quantity_changed,
        t.transaction_type,
        t.notes
      ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Material_Usage_Report_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  };

  const handleImageUpload = async (file) => {
    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${companyId}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('resources').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('resources').getPublicUrl(filePath);
      setForm({ ...form, image_url: data.publicUrl });
      toast.success("Image uploaded!");
    } catch (error) {
      toast.error("Image upload failed.");
    } finally {
      setUploadingImage(false);
    }
  };

  if (invLoading) return (
    <div className="flex justify-center items-center py-20 min-h-screen bg-slate-50">
      <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* TOP HEADER */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shrink-0 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Package className="h-6 w-6 text-amber-500" /> Warehouse Inventory
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-1">Manage physical shop inventory and materials.</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleCSVUpload} disabled={importing} />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-white font-bold text-slate-600 hidden sm:flex">
                {importing ? "Processing..." : <><UploadCloud className="h-4 w-4 mr-2" /> Import CSV</>}
              </Button>
              <Button variant="outline" onClick={exportInventoryToCSV} className="bg-white font-bold text-slate-600 hidden sm:flex">
                <Download className="h-4 w-4 mr-2" /> Export
              </Button>
              <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
              
              {/* FIX: Changed Button Color to Slate 900 */}
              <Button onClick={() => setReportOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white font-black shadow-md">
                <ClipboardList className="h-4 w-4 mr-1.5 text-slate-300" /> Usage Report
              </Button>

              <Button onClick={openNew} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                <Plus className="h-4 w-4 mr-1.5" /> Add Material
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col max-w-7xl mx-auto w-full p-4 md:p-6">
        
        {/* ADVANCED FILTER BAR */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Filter className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Warehouse Filters</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-10 bg-slate-50 font-bold border-slate-200" />
            </div>
            <div>
              <Select value={filters.status} onValueChange={v => setFilters({...filters, status: v})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="font-bold">All Items</SelectItem>
                  <SelectItem value="Low Stock" className="font-bold text-red-600">Low Stock Alerts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={filters.location} onValueChange={v => setFilters({...filters, location: v})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>{filterUniqueLocations.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Select value={filters.main} onValueChange={v => setFilters({...filters, main: v, sub: "All"})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>{filterUniqueMains.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* DATA TABLE */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
            <h3 className="font-black text-sm text-slate-900 uppercase tracking-wider">Inventory Ledger</h3>
            <Badge className="bg-amber-100 text-amber-800 font-black border-amber-200 tracking-wider">
              {filteredInventory.length} Items Found
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredInventory.length === 0 ? (
              <div className="text-center py-20 px-4">
                <Package className="h-16 w-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-xl font-black text-slate-700">Warehouse empty</h3>
                <p className="text-sm text-slate-500 mt-1 mb-4">Adjust your filters or add physical stock.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-white border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 w-16">Image</th>
                    <th className="px-6 py-4">Item Name / SKU</th>
                    <th className="px-6 py-4">Location</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-center">Qty on Hand</th>
                    <th className="px-6 py-4 text-right">Cost</th>
                    <th className="px-6 py-4 text-right w-16">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInventory.map(p => {
                    const isLowStock = p.quantity_on_hand <= p.reorder_point;
                    return (
                      <tr key={p.id} className={`transition-colors ${isLowStock ? 'bg-red-50/30 hover:bg-red-50' : 'hover:bg-amber-50/30'}`}>
                        <td className="px-6 py-4">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-10 w-10 object-cover rounded-lg border border-slate-200 shadow-sm" />
                          ) : (
                            <div className="h-10 w-10 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center">
                              <ImageIcon className="h-4 w-4 text-slate-300" />
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4" onClick={() => { setSelectedItem(p); setDetailOpen(true); }} style={{cursor: 'pointer'}}>
                          <p className="font-bold text-slate-900 hover:text-amber-600 transition-colors">{p.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">{p.sku || "No SKU"}</p>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-bold text-slate-600 bg-white">
                            <MapPin className="h-3 w-3 mr-1" /> {p.location || "Main Storage"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isLowStock ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200 font-bold uppercase text-[9px] tracking-wider hover:bg-red-100">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Low Stock
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold uppercase text-[9px] tracking-wider hover:bg-emerald-100">
                              In Stock
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button 
                              variant="outline" size="icon" className="h-6 w-6 rounded-full bg-slate-50"
                              onClick={() => adjustStockMutation.mutate({ id: p.id, newQty: p.quantity_on_hand - 1, change: -1, name: p.name })}
                            >
                              <Minus className="h-3 w-3 text-slate-600" />
                            </Button>
                            <div className="w-12 text-center">
                              <span className="font-black text-slate-900 text-lg">{p.quantity_on_hand}</span>
                              <span className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{p.unit}</span>
                            </div>
                            <Button 
                              variant="outline" size="icon" className="h-6 w-6 rounded-full bg-amber-50 border-amber-200 hover:bg-amber-100"
                              onClick={() => adjustStockMutation.mutate({ id: p.id, newQty: p.quantity_on_hand + 1, change: 1, name: p.name })}
                            >
                              <Plus className="h-3 w-3 text-amber-700" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-black text-slate-700">{formatCurrencyUSD(p.cost)} <span className="text-[10px] font-medium text-slate-400">/{p.unit}</span></div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedItem(p); setDetailOpen(true); }} className="text-slate-500 hover:text-amber-600 hover:bg-amber-50 font-bold text-xs h-8">
                            View <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-3xl bg-white border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" /> {editing ? "Edit Inventory Item" : "Receive New Material"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="shrink-0 w-full sm:w-auto flex justify-center">
                {form.image_url ? (
                  <div className="relative group">
                    <img src={form.image_url} alt="Item" className="h-32 w-32 object-cover rounded-xl border border-slate-200 shadow-sm" />
                    <button type="button" onClick={() => setForm({ ...form, image_url: "" })} className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="h-32 w-32 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} disabled={uploadingImage} />
                    {uploadingImage ? (
                      <div className="h-6 w-6 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                    ) : (
                      <>
                        <UploadCloud className="h-6 w-6 text-slate-400 mb-1.5" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Photo</span>
                      </>
                    )}
                  </label>
                )}
              </div>

              <div className="flex-1 space-y-4 w-full">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Material / Item Name *</Label>
                  <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="font-black text-lg text-slate-900 h-12 border-slate-300" placeholder="e.g., 2x4 Lumber" />
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1"><MapPin className="h-3 w-3" /> Physical Location</Label>
                  <Input list="loc-list" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="font-bold bg-white h-9" placeholder="e.g., Warehouse A, Truck 2" />
                  <datalist id="loc-list">{uniqueLocations.map(l => <option key={l} value={l} />)}</datalist>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-2 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unit</Label>
                  <Select value={form.unit} onValueChange={v => setForm({...form, unit: v})}>
                    <SelectTrigger className="mt-1 bg-white font-bold h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u} className="font-bold">{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-800">Unit Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-800 font-bold">$</span>
                    <Input type="number" step="0.01" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} className="pl-7 font-black h-10 border-slate-300 bg-white" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Current Qty</Label>
                  <Input type="number" value={form.quantity_on_hand} onChange={e => setForm({...form, quantity_on_hand: e.target.value})} className="mt-1 font-black h-10 border-emerald-300 bg-emerald-50 text-emerald-900" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Low Stock Alert At</Label>
                  <Input type="number" value={form.reorder_point} onChange={e => setForm({...form, reorder_point: e.target.value})} className="mt-1 font-bold h-10 border-red-200 bg-red-50 text-red-900" placeholder="e.g. 5" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1"><FolderTree className="h-3 w-3" /> Categorization</Label>
                <div className="space-y-3">
                  <Select value={form.category} onValueChange={v => setForm({...form, category: v, sub_category: ""})}>
                    <SelectTrigger className="bg-white font-bold text-xs h-9"><SelectValue placeholder="Main Category" /></SelectTrigger>
                    <SelectContent>{uniqueMains.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={form.sub_category} disabled={!form.category || uniqueSubs.length === 0} onValueChange={v => setForm({...form, sub_category: v})}>
                    <SelectTrigger className="bg-white font-bold text-xs h-9"><SelectValue placeholder="Sub Category" /></SelectTrigger>
                    <SelectContent>{uniqueSubs.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-3">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">SKU / Item #</Label>
                  <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} className="mt-1 font-bold" placeholder="Optional" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Supplier / Vendor</Label>
                  <Input value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} className="mt-1 font-bold" placeholder="e.g., Home Depot" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Supplier URL</Label>
                  <Input type="url" value={form.vendor_url} onChange={e => setForm({...form, vendor_url: e.target.value})} className="mt-1 font-medium text-xs" placeholder="https://..." />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Description & Notes</Label>
              <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} className="mt-1" placeholder="Internal notes or material specs..." />
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-bold">Cancel</Button>
                <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                  {saveMutation.isPending ? "Saving..." : editing ? "Update Inventory" : "Save to Inventory"}
                </Button>
              </div>
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* QUICK VIEW DIALOG */}
      {selectedItem && (
        <Dialog open={detailOpen} onOpenChange={(v) => !v && setDetailOpen(false)}>
          <DialogContent aria-describedby={undefined} className="max-w-sm bg-white border-slate-200 shadow-xl">
            <DialogHeader>
              <div className="flex items-start gap-4">
                {selectedItem.image_url ? (
                  <img src={selectedItem.image_url} alt="" className="h-16 w-16 object-cover rounded-xl border border-slate-200 shadow-sm" />
                ) : (
                  <div className="h-16 w-16 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center">
                    <Package className="h-6 w-6 text-slate-300" />
                  </div>
                )}
                <div>
                  <DialogTitle className="text-lg font-black text-slate-900 leading-tight pr-6">{selectedItem.name}</DialogTitle>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-1">{selectedItem.sku || "No SKU"}</p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-xl border flex flex-col items-center justify-center shadow-inner ${selectedItem.quantity_on_hand <= selectedItem.reorder_point ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${selectedItem.quantity_on_hand <= selectedItem.reorder_point ? 'text-red-600' : 'text-emerald-700'}`}>Qty on Hand</p>
                  <p className={`text-3xl font-black ${selectedItem.quantity_on_hand <= selectedItem.reorder_point ? 'text-red-700' : 'text-emerald-800'}`}>{selectedItem.quantity_on_hand}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Alert at: {selectedItem.reorder_point}</p>
                </div>
                
                <div className="space-y-3">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Location</p>
                    <p className="font-bold text-slate-900">{selectedItem.location || "Main Storage"}</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Unit Cost</p>
                    <p className="font-black text-slate-800">{formatCurrencyUSD(selectedItem.cost)}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-4 gap-x-4 text-sm bg-white p-4 rounded-xl border border-slate-100">
                <div className="col-span-2 flex flex-col gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Category Path</p>
                  <div className="flex flex-wrap items-center gap-1.5 font-black text-slate-900 text-xs">
                    {selectedItem.category ? <span>{selectedItem.category}</span> : <span className="text-slate-300">—</span>}
                    {selectedItem.sub_category && <><ChevronRight className="h-3 w-3 text-slate-300" /> <span>{selectedItem.sub_category}</span></>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Unit Type</p>
                  <p className="font-black text-slate-900 uppercase">{selectedItem.unit}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Supplier</p>
                  <p className="font-black text-slate-900">{selectedItem.supplier || "—"}</p>
                </div>
              </div>

              {selectedItem.vendor_url && (
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                  <a href={selectedItem.vendor_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-xs font-bold text-slate-700 hover:text-amber-600 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" /> View Supplier Page
                  </a>
                </div>
              )}

              {selectedItem.description && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-sm font-medium text-slate-700 italic">
                  "{selectedItem.description}"
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1 font-bold text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100" onClick={() => { if(confirm("Delete this item?")) deleteMutation.mutate(selectedItem.id); }}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
                <Button className="flex-[2] bg-slate-900 hover:bg-slate-800 text-white font-bold" onClick={() => { setDetailOpen(false); openEdit(selectedItem); }}>
                  <Pencil className="h-4 w-4 mr-1.5" /> Edit Full Details
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* HUGE USAGE REPORT DIALOG */}
      <Dialog open={reportOpen} onOpenChange={(v) => !v && setReportOpen(false)}>
        <DialogContent className="max-w-6xl bg-white border-slate-200 shadow-2xl h-[90vh] flex flex-col p-0 overflow-hidden" aria-describedby={undefined}>
          
          {/* FIX: Added pr-12 (padding-right) so the content doesn't sit under the Radix "X" close button */}
          <div className="px-6 py-4 pr-12 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <div>
              <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-6 w-6 text-slate-600" /> Material Usage & Transactions
              </DialogTitle>
              <p className="text-sm font-medium text-slate-500 mt-1">Audit log of all materials taken for projects or received into stock.</p>
            </div>
            <Button onClick={exportUsageToCSV} variant="outline" className="bg-white font-bold text-slate-700 border-slate-300">
              <Download className="h-4 w-4 mr-2" /> Export Ledger
            </Button>
          </div>

          {/* Filters */}
          <div className="p-4 bg-white border-b border-slate-100 shrink-0 flex flex-wrap gap-4 items-end">
            <div className="w-full md:w-64">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input placeholder="Search item or notes..." value={reportSearch} onChange={e => setReportSearch(e.target.value)} className="pl-9 h-9 font-bold bg-slate-50" />
              </div>
            </div>
            <div className="w-40">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Project</Label>
              <Select value={reportFilters.project} onValueChange={v => setReportFilters({...reportFilters, project: v})}>
                <SelectTrigger className="h-9 font-bold bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>{repUniqueProjects.map(c => <SelectItem key={c} value={c}>{c === "All" ? "All Projects" : c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Employee</Label>
              <Select value={reportFilters.employee} onValueChange={v => setReportFilters({...reportFilters, employee: v})}>
                <SelectTrigger className="h-9 font-bold bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>{repUniqueEmployees.map(c => <SelectItem key={c} value={c}>{c === "All" ? "All Employees" : c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Type</Label>
              <Select value={reportFilters.type} onValueChange={v => setReportFilters({...reportFilters, type: v})}>
                <SelectTrigger className="h-9 font-bold bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Types</SelectItem>
                  <SelectItem value="Consume">Consumed (Taken)</SelectItem>
                  <SelectItem value="Receive">Received (Added)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto bg-slate-50/50">
            {txLoading ? (
              <div className="flex justify-center items-center py-20">
                <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="text-center py-20">
                <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-500">No transactions match your filters.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-white border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-3">Date & Time</th>
                    <th className="px-6 py-3">Employee</th>
                    <th className="px-6 py-3">Item Name</th>
                    <th className="px-6 py-3">Project Tag</th>
                    <th className="px-6 py-3 text-center">Type</th>
                    <th className="px-6 py-3 text-center">Qty Chg</th>
                    <th className="px-6 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredTransactions.map(tx => {
                    const item = inventory.find(i => i.id === tx.inventory_id);
                    const isConsume = tx.transaction_type === "Consume";
                    return (
                      <tr key={tx.id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-6 py-3 text-xs font-bold text-slate-500">{format(parseISO(tx.created_at), "MMM d, yyyy - h:mm a")}</td>
                        <td className="px-6 py-3 font-bold text-slate-900">{tx.employee_name || "Unknown"}</td>
                        <td className="px-6 py-3 font-bold text-slate-700">{item ? item.name : "Deleted Item"}</td>
                        <td className="px-6 py-3">
                          {tx.project_name ? (
                            <Badge variant="outline" className="text-[10px] uppercase font-bold text-blue-700 bg-blue-50">
                              {tx.project_name}
                            </Badge>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-6 py-3 text-center">
                          {isConsume ? (
                            <span className="inline-flex items-center text-red-600 bg-red-50 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border border-red-100">
                              <ArrowDownRight className="h-3 w-3 mr-1" /> Taken
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border border-emerald-100">
                              <ArrowUpRight className="h-3 w-3 mr-1" /> Added
                            </span>
                          )}
                        </td>
                        <td className={`px-6 py-3 text-center font-black text-base ${isConsume ? 'text-red-600' : 'text-emerald-600'}`}>
                          {tx.quantity_changed}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-500 truncate max-w-[200px]" title={tx.notes}>
                          {tx.notes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          
          <div className="p-4 border-t border-slate-200 bg-white flex justify-end shrink-0">
            <Button variant="outline" onClick={() => setReportOpen(false)} className="font-bold">Close Report</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ERROR POPUP DIALOG */}
      <Dialog open={!!errorPopup} onOpenChange={() => setErrorPopup(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-md bg-white border-red-200 shadow-xl">
          <div className="flex flex-col items-center text-center pt-4 pb-2">
            <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mb-4 border border-red-200">
              <AlertOctagon className="h-8 w-8 text-red-600" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-900 mb-2">{errorPopup?.title}</DialogTitle>
            <p className="text-slate-600 whitespace-pre-wrap font-medium">{errorPopup?.message}</p>
          </div>
          <DialogFooter className="mt-6 border-t border-slate-100 pt-4">
            <Button onClick={() => setErrorPopup(null)} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold">
              Understood
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}