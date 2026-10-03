import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Check, Tag, FolderTree, UploadCloud, X, Package } from "lucide-react";
import { toast } from "sonner";

const UNITS = ["ea", "ft", "sqft", "hr", "lft", "m", "sqm", "bag", "box", "roll"];

export default function ProductSearchOrCreate({ value, initialData, onSelect, onProductCreated }) {
  const { profile, settings } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();

  const [searchTerm, setSearchTerm] = useState(value || "");
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false); // ⚡ NEW STATE
  const dropdownRef = useRef(null);

  const defaultMargin = settings?.default_margin ?? 20;

  const defaultForm = {
    name: "", category: "", sub_category: "", tertiary_category: "", 
    unit: "ea", material_cost: "", labor_cost: "", cost: "", margin: defaultMargin, price: "", 
    description: "", sku: "", supplier: "", vendor_url: "", taxable: true, image_url: ""
  };
  const [newProduct, setNewProduct] = useState(defaultForm);

  // ⚡ NEW: INLINE PRODUCT SEARCH QUERY
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["product-inline-search", companyId, searchTerm],
    enabled: !!companyId && searchTerm.trim().length > 1, 
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId) 
        .ilike("name", `%${searchTerm}%`) 
        .limit(8); 

      if (error) throw error;
      return data || [];
    }
  });

  // Handle closing dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  // --- FETCH CATEGORIES FOR DROPDOWNS ---
  const { data: existingProducts = [] } = useQuery({ 
    queryKey: ["products_cats", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("category, sub_category, tertiary_category").eq("company_id", companyId);
      return data || [];
    } 
  });

  const { data: customCategories = [] } = useQuery({
    queryKey: ["product_categories", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("product_categories").select("*").eq("company_id", companyId);
      return data || [];
    }
  });

  // Build the cascading dropdown options
  const existingProductPaths = existingProducts.map(p => ({ main: p.category, sub: p.sub_category, ter: p.tertiary_category }));
  const customPaths = customCategories.map(c => ({ main: c.main_category, sub: c.sub_category, ter: c.tertiary_category }));
  const allPaths = [...existingProductPaths, ...customPaths].filter(p => p.main);

  const uniqueMains = [...new Set(allPaths.map(p => p.main).filter(Boolean))].sort();
  const uniqueSubs = newProduct.category ? [...new Set(allPaths.filter(p => p.main === newProduct.category).map(p => p.sub).filter(Boolean))].sort() : [];
  const uniqueTers = newProduct.category && newProduct.sub_category ? [...new Set(allPaths.filter(p => p.main === newProduct.category && p.sub === newProduct.sub_category).map(p => p.ter).filter(Boolean))].sort() : [];

  // --- MATH ENGINE ---
  const calculatePrice = (cost, marginPct) => {
    const c = parseFloat(cost) || 0;
    const m = parseFloat(marginPct) || 0;
    if (m >= 100) return c.toFixed(2); 
    return (c / (1 - (m / 100))).toFixed(2);
  };

  const handleMatLabChange = (field, val) => {
    const newVal = parseFloat(val) || 0;
    const otherVal = field === 'material_cost' ? (parseFloat(newProduct.labor_cost) || 0) : (parseFloat(newProduct.material_cost) || 0);
    const newCost = newVal + otherVal;
    const activeMargin = newProduct.margin !== "" ? parseFloat(newProduct.margin) : defaultMargin;
    const newPrice = calculatePrice(newCost, activeMargin);
    setNewProduct({ ...newProduct, [field]: val, cost: newCost, margin: activeMargin, price: newPrice });
  };

  const handleCostChange = (val) => {
    const newCost = parseFloat(val) || 0;
    if (isNaN(newCost) && val !== "") return setNewProduct({ ...newProduct, cost: val });
    const activeMargin = newProduct.margin !== "" ? parseFloat(newProduct.margin) : defaultMargin;
    const newPrice = calculatePrice(newCost, activeMargin);
    setNewProduct({ ...newProduct, cost: val, margin: activeMargin, price: newPrice });
  };

  const handleMarginChange = (val) => {
    const newMargin = parseFloat(val);
    if (isNaN(newMargin)) return setNewProduct({ ...newProduct, margin: val });
    if (newProduct.cost && parseFloat(newProduct.cost) > 0) {
      const newPrice = calculatePrice(newProduct.cost, newMargin);
      setNewProduct({ ...newProduct, margin: val, price: newPrice });
    } else {
      setNewProduct({ ...newProduct, margin: val });
    }
  };

  const handlePriceChange = (val) => {
    const newPrice = parseFloat(val);
    if (isNaN(newPrice)) return setNewProduct({ ...newProduct, price: val });
    if (newProduct.cost && parseFloat(newProduct.cost) >= 0) {
      const newMargin = newPrice > 0 ? (((newPrice - parseFloat(newProduct.cost)) / newPrice) * 100).toFixed(1) : 0;
      setNewProduct({ ...newProduct, price: val, margin: newMargin });
    } else {
      setNewProduct({ ...newProduct, price: val });
    }
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
      setNewProduct({ ...newProduct, image_url: data.publicUrl });
      toast.success("Image uploaded!");
    } catch (error) {
      toast.error("Image upload failed.");
    } finally {
      setUploadingImage(false);
    }
  };

  // --- MUTATION ---
  const createProductMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        company_id: companyId, name: data.name, category: data.category || null, sub_category: data.sub_category || null,
        tertiary_category: data.tertiary_category || null, unit: data.unit || "ea", 
        material_cost: parseFloat(data.material_cost) || 0, labor_cost: parseFloat(data.labor_cost) || 0,
        cost: parseFloat(data.cost) || 0, price: parseFloat(data.price) || 0, 
        supplier: data.supplier || null, vendor_url: data.vendor_url || null,
        description: data.description || null, sku: data.sku || null, taxable: data.taxable, image_url: data.image_url || null
      };
      const { data: inserted, error } = await supabase.from("products").insert([payload]).select().single();
      if (error) throw error;
      return inserted;
    },
    onSuccess: (product) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      onProductCreated?.(product);
      setShowNewProduct(false);
      setNewProduct(defaultForm);
      toast.success("Added to Pricebook!");
    },
    onError: (err) => toast.error(`Error saving: ${err.message}`)
  });

  useEffect(() => { setSearchTerm(value || ""); }, [value]);

  return (
    <div className="relative flex-1" ref={dropdownRef}>
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              onSelect(e.target.value); 
              setShowDropdown(true); // ⚡ OPEN DROPDOWN ON TYPE
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Type line item name..."
            className="pl-9 font-bold bg-white shadow-sm border-slate-300 h-9 text-slate-900"
          />
          
          {/* ⚡ NEW: INLINE DROPDOWN MENU */}
          {showDropdown && searchTerm.trim().length > 1 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
              {isSearching ? (
                <div className="p-3 text-sm text-slate-500 text-center font-medium">Searching catalog...</div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {searchResults.map(prod => (
                    <div 
                      key={prod.id} 
                      className="px-3 py-2 hover:bg-amber-50 cursor-pointer transition-colors flex items-center justify-between group"
                      onClick={() => {
                        setSearchTerm(prod.name);
                        onSelect(prod.name, prod);
                        setShowDropdown(false);
                      }}
                    >
                      <div className="min-w-0 pr-4">
                        <p className="text-sm font-bold text-slate-900 truncate group-hover:text-amber-800">{prod.name}</p>
                        {prod.category && <p className="text-[10px] uppercase font-bold text-slate-400 truncate">{prod.category}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-slate-900">${Number(prod.price).toFixed(2)}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">{prod.unit || 'ea'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 flex flex-col items-center justify-center text-center">
                  <Package className="h-6 w-6 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-600 mb-1">No matches found</p>
                  <p className="text-xs text-slate-400">Click "Add to Catalog" to create this item.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {searchTerm.trim().length > 0 && (
          <Button 
            type="button"
            size="sm"
            onClick={() => {
              let currentMargin = defaultMargin;
              const passedCost = parseFloat(initialData?.unit_cost) || 0;
              const passedPrice = parseFloat(initialData?.unit_price) || 0;
              
              if (passedCost > 0 && passedPrice > 0) {
                currentMargin = (((passedPrice - passedCost) / passedPrice) * 100).toFixed(1);
              }

              setNewProduct({ 
                ...defaultForm, 
                name: searchTerm || initialData?.name || "", 
                description: initialData?.description || "",
                unit: initialData?.unit || "ea",
                material_cost: initialData?.material_cost || "",
                labor_cost: initialData?.labor_cost || "",
                cost: passedCost || "",
                price: passedPrice || "",
                margin: currentMargin,
                taxable: initialData?.taxable !== false,
                image_url: initialData?.photo_url || ""
              });
              setShowNewProduct(true);
              setShowDropdown(false); // ⚡ Close dropdown when adding
            }}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black h-9 px-3 shrink-0 shadow-sm"
          >
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Add to Catalog</span>
            <span className="sm:hidden ml-1">Add</span>
          </Button>
        )}
      </div>

      {/* --- THE POP-UP FORM --- */}
      <Dialog open={showNewProduct} onOpenChange={(v) => !v && setShowNewProduct(false)}>
        <DialogContent className="max-w-3xl bg-white border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Tag className="h-5 w-5 text-amber-500" /> New Pricebook Item
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="shrink-0 w-full sm:w-auto flex justify-center">
                {newProduct.image_url ? (
                  <div className="relative group">
                    <img src={newProduct.image_url} alt="Product" className="h-32 w-32 object-cover rounded-xl border border-slate-200 shadow-sm" />
                    <button type="button" onClick={() => setNewProduct({ ...newProduct, image_url: "" })} className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600">
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
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Item Name *</Label>
                  <Input value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="mt-1 font-black text-lg text-slate-900 h-12 border-slate-300" placeholder="e.g., Kohler Kitchen Faucet" />
                </div>
                
                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center px-3 py-2 bg-slate-100 border-b border-slate-200">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><FolderTree className="h-3 w-3" /> Categorization</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Main Category</Label>
                      <Select value={newProduct.category} onValueChange={v => setNewProduct({...newProduct, category: v, sub_category: "", tertiary_category: ""})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select Main..." /></SelectTrigger>
                        <SelectContent>{uniqueMains.map(m => <SelectItem key={m} value={m} className="font-bold">{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Sub Category</Label>
                      <Select value={newProduct.sub_category} disabled={!newProduct.category || uniqueSubs.length === 0} onValueChange={v => setNewProduct({...newProduct, sub_category: v, tertiary_category: ""})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select Sub..." /></SelectTrigger>
                        <SelectContent>{uniqueSubs.map(s => <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">3rd Category</Label>
                      <Select value={newProduct.tertiary_category} disabled={!newProduct.sub_category || uniqueTers.length === 0} onValueChange={v => setNewProduct({...newProduct, tertiary_category: v})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select 3rd..." /></SelectTrigger>
                        <SelectContent>{uniqueTers.map(t => <SelectItem key={t} value={t} className="font-bold">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-2 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unit</Label>
                  <Select value={newProduct.unit} onValueChange={v => setNewProduct({...newProduct, unit: v})}>
                    <SelectTrigger className="mt-1 bg-white font-bold h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u} className="font-bold">{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Material Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                    <Input type="number" step="0.01" value={newProduct.material_cost} onChange={e => handleMatLabChange('material_cost', e.target.value)} className="pl-7 font-bold h-10 border-slate-300 bg-white" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Labor Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                    <Input type="number" step="0.01" value={newProduct.labor_cost} onChange={e => handleMatLabChange('labor_cost', e.target.value)} className="pl-7 font-bold h-10 border-slate-300 bg-white" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-800">Total Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-800 font-bold">$</span>
                    <Input type="number" step="0.01" value={newProduct.cost} onChange={e => handleCostChange(e.target.value)} className="pl-7 font-black h-10 border-slate-400 bg-slate-100" placeholder="0.00" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
                <div className="sm:col-start-3">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Margin</Label>
                  <div className="relative mt-1">
                    <Input type="number" step="0.1" value={newProduct.margin} onChange={e => handleMarginChange(e.target.value)} className="pr-7 font-bold h-10 text-emerald-700 bg-emerald-50/30 border-emerald-200 text-right" placeholder="0.0" />
                    <span className="absolute right-3 top-3 text-emerald-700 font-black">%</span>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Client Pays</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-amber-700 font-black">$</span>
                    <Input type="number" step="0.01" value={newProduct.price} onChange={e => handlePriceChange(e.target.value)} className="pl-7 font-black text-amber-900 border-amber-300 bg-amber-50 h-10" placeholder="0.00" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">SKU / Item #</Label>
                <Input value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} className="mt-1 font-bold" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier / Vendor</Label>
                <Input value={newProduct.supplier} onChange={e => setNewProduct({...newProduct, supplier: e.target.value})} className="mt-1 font-bold" placeholder="e.g., Home Depot" />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier Link / URL</Label>
              <Input type="url" value={newProduct.vendor_url} onChange={e => setNewProduct({...newProduct, vendor_url: e.target.value})} className="mt-1 font-bold" placeholder="https://..." />
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Description & Notes</Label>
              <Textarea value={newProduct.description} onChange={e => setNewProduct({...newProduct, description: e.target.value})} rows={2} className="mt-1" placeholder="Internal notes or material specs..." />
            </div>

            {/* RESPONSIVE BOTTOM ACTION BAR */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors w-fit">
                <input type="checkbox" checked={newProduct.taxable} onChange={e => setNewProduct({...newProduct, taxable: e.target.checked})} className="rounded border-slate-300 w-4 h-4 text-amber-500 focus:ring-amber-500" />
                <span className="text-sm font-black text-slate-700">Taxable Item</span>
              </label>
              
              <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
                <Button variant="outline" onClick={() => setShowNewProduct(false)} className="w-full sm:w-auto font-bold h-11 sm:h-10">Cancel</Button>
                <Button 
                  onClick={() => createProductMutation.mutate(newProduct)} 
                  disabled={!newProduct.name || !newProduct.price || createProductMutation.isPending} 
                  className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md h-11 sm:h-10"
                >
                  <Check className="h-4 w-4 mr-2" /> 
                  <span className="hidden sm:inline">{createProductMutation.isPending ? "Saving..." : "Save & Add to Quote"}</span>
                  <span className="sm:hidden">{createProductMutation.isPending ? "Saving..." : "Save Item"}</span>
                </Button>
              </div>
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}