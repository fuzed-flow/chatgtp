import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Package, Pencil, Trash2, ExternalLink, Image as ImageIcon, Search, Download, Tag, UploadCloud, X, ChevronRight, FolderTree, AlertOctagon, Filter, ArrowUpDown, ChevronUp, ChevronDown, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import { Button } from "@/components/ui/button";

const UNITS = ["ea", "ft", "sqft", "hr", "lft", "m", "sqm", "bag", "box", "roll"];
const PRIORITY_IMAGE_COUNT = 10;

const parseCSV = (text) => {
  const result = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cur.trim());
      cur = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(cur.trim());
      result.push(row);
      row = [];
      cur = '';
    } else {
      cur += char;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur.trim());
    result.push(row);
  }
  return result;
};

export default function Products() {
  const { profile, settings } = useAuth(); // <-- PULLED IN SETTINGS
  const companyId = profile?.company_id;
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  // --- SETTINGS DEFAULTS ---
  const defaultMargin = settings?.default_margin ?? 20;

  // --- UI STATE ---
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editCategoryOpen, setEditCategoryOpen] = useState(false);
  const [filters, setFilters] = useState({
    main: "All",
    sub: "All",
    tertiary: "All",
    supplier: "All"
  });
  
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [errorPopup, setErrorPopup] = useState(null); 

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  
  const defaultForm = { name: "", sku: "", category: "", sub_category: "", tertiary_category: "", unit: "ea", material_cost: "", labor_cost: "", cost: "", price: "", margin: "", supplier: "", vendor_url: "", description: "", taxable: true, image_url: "" };
  const [form, setForm] = useState(defaultForm);

  const [catForm, setCatForm] = useState({ level: "1", main_category: "", sub_category: "", new_name: "" });
  const [editCatForm, setEditCatForm] = useState({ level: "1", main_category: "", sub_category: "", tertiary_category: "", new_name: "" });

  // 1. Fetch Products
  const { data: products = [], isLoading: productsLoading } = useQuery({ 
    queryKey: ["products", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    } 
  });

  // 2. Fetch Custom Categories
  const { data: customCategories = [], isLoading: catsLoading } = useQuery({
    queryKey: ["product_categories", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_categories").select("*").eq("company_id", companyId);
      if (error) return [];
      return data || [];
    }
  });

  // --- CASCADING CATEGORY LOGIC ---
  const existingProductPaths = products.map(p => ({ main: p.category, sub: p.sub_category, ter: p.tertiary_category }));
  const customPaths = customCategories.map(c => ({ main: c.main_category, sub: c.sub_category, ter: c.tertiary_category }));
  const allPaths = [...existingProductPaths, ...customPaths].filter(p => p.main);

  const allUniqueNames = new Set(allPaths.flatMap(p => [p.main, p.sub, p.ter]).filter(Boolean).map(n => n.toLowerCase().trim()));

  const uniqueMains = [...new Set(allPaths.map(p => p.main).filter(Boolean))].sort();
  const uniqueSubs = form.category ? [...new Set(allPaths.filter(p => p.main === form.category).map(p => p.sub).filter(Boolean))].sort() : [];
  const uniqueTers = form.category && form.sub_category ? [...new Set(allPaths.filter(p => p.main === form.category && p.sub === form.sub_category).map(p => p.ter).filter(Boolean))].sort() : [];

  const filterUniqueMains = ["All", ...uniqueMains];
  const filterUniqueSubs = ["All", ...new Set(allPaths.filter(p => filters.main === "All" || p.main === filters.main).map(p => p.sub).filter(Boolean))].sort();
  const filterUniqueTers = ["All", ...new Set(allPaths.filter(p => (filters.main === "All" || p.main === filters.main) && (filters.sub === "All" || p.sub === filters.sub)).map(p => p.ter).filter(Boolean))].sort();
  const filterUniqueSuppliers = ["All", ...new Set(products.map(p => p.supplier).filter(Boolean))].sort();

  // --- FILTERING ---
  const filteredProducts = products.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase());
    const matchMain = filters.main === "All" || p.category === filters.main;
    const matchSub = filters.sub === "All" || p.sub_category === filters.sub;
    const matchTer = filters.tertiary === "All" || p.tertiary_category === filters.tertiary;
    const matchSup = filters.supplier === "All" || p.supplier === filters.supplier;
    return matchSearch && matchMain && matchSub && matchTer && matchSup;
  });

  // --- SORTING ---
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let aValue = a[sortConfig.key];
    let bValue = b[sortConfig.key];

    if (sortConfig.key === 'margin') {
      aValue = a.price > 0 ? ((a.price - (a.cost || 0)) / a.price) : 0;
      bValue = b.price > 0 ? ((b.price - (b.cost || 0)) / b.price) : 0;
    }
    
    if (aValue == null) aValue = '';
    if (bValue == null) bValue = '';

    if (typeof aValue === 'string') aValue = aValue.toLowerCase();
    if (typeof bValue === 'string') bValue = bValue.toLowerCase();

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });
  const priorityImageIds = new Set(sortedProducts.filter(p => p.image_url).slice(0, PRIORITY_IMAGE_COUNT).map(p => p.id));

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown className="h-3 w-3 ml-1 text-slate-300 group-hover:text-slate-400" />;
    return sortConfig.direction === 'asc' 
      ? <ChevronUp className="h-3 w-3 ml-1 text-amber-500" />
      : <ChevronDown className="h-3 w-3 ml-1 text-amber-500" />;
  };

  // --- MUTATIONS ---
  const saveCategoryMutation = useMutation({
    mutationFn: async () => {
      const newName = catForm.new_name.trim();
      if (!newName) {
        setErrorPopup({ title: "Name Required", message: "Please type a name for the new category." });
        throw new Error("Validation failed");
      }
      
      if (allUniqueNames.has(newName.toLowerCase())) {
        setErrorPopup({ 
          title: "Duplicate Name Detected", 
          message: `The name "${newName}" is already being used somewhere else in your categories.\n\nTo keep your catalog organized, you cannot use the exact same name for a Main Category and a Sub-Category.` 
        });
        throw new Error("Duplicate name");
      }

      const dbPayload = { company_id: companyId, main_category: "", sub_category: null, tertiary_category: null };

      if (catForm.level === "1") {
        dbPayload.main_category = newName;
      } else if (catForm.level === "2") {
        if (!catForm.main_category) {
          setErrorPopup({ title: "Parent Required", message: "Please select a Main Category first." });
          throw new Error("Validation failed");
        }
        dbPayload.main_category = catForm.main_category;
        dbPayload.sub_category = newName;
      } else if (catForm.level === "3") {
        if (!catForm.main_category || !catForm.sub_category) {
          setErrorPopup({ title: "Parents Required", message: "Please select both a Main and Sub-Category first." });
          throw new Error("Validation failed");
        }
        dbPayload.main_category = catForm.main_category;
        dbPayload.sub_category = catForm.sub_category;
        dbPayload.tertiary_category = newName;
      }

      const { error } = await supabase.from("product_categories").insert([dbPayload]);
      if (error) throw error;
      return dbPayload;
    },
    onSuccess: (savedData) => {
      qc.invalidateQueries({ queryKey: ["product_categories"] });
      setAddCategoryOpen(false);
      setCatForm({ level: "1", main_category: "", sub_category: "", new_name: "" });
      toast.success("Category added successfully!");
      
      if (dialogOpen) {
        if (savedData.main_category && !savedData.sub_category) setForm(prev => ({ ...prev, category: savedData.main_category, sub_category: "", tertiary_category: "" }));
        if (savedData.sub_category && !savedData.tertiary_category) setForm(prev => ({ ...prev, sub_category: savedData.sub_category, tertiary_category: "" }));
        if (savedData.tertiary_category) setForm(prev => ({ ...prev, tertiary_category: savedData.tertiary_category }));
      }
    }
  });

  const editCategoryMutation = useMutation({
    mutationFn: async () => {
      const newName = editCatForm.new_name.trim();
      if (!newName) {
        setErrorPopup({ title: "Name Required", message: "Please type a new name." });
        throw new Error("Validation failed");
      }
      if (allUniqueNames.has(newName.toLowerCase())) {
        setErrorPopup({ title: "Duplicate Name", message: "This name is already in use in your catalog." });
        throw new Error("Duplicate name");
      }

      if (editCatForm.level === "1") {
        if (!editCatForm.main_category) throw new Error("Validation failed");
        await supabase.from("product_categories").update({ main_category: newName }).eq("company_id", companyId).eq("main_category", editCatForm.main_category);
        await supabase.from("products").update({ category: newName }).eq("company_id", companyId).eq("category", editCatForm.main_category);
      } 
      else if (editCatForm.level === "2") {
        if (!editCatForm.main_category || !editCatForm.sub_category) throw new Error("Validation failed");
        await supabase.from("product_categories").update({ sub_category: newName }).eq("company_id", companyId).eq("main_category", editCatForm.main_category).eq("sub_category", editCatForm.sub_category);
        await supabase.from("products").update({ sub_category: newName }).eq("company_id", companyId).eq("category", editCatForm.main_category).eq("sub_category", editCatForm.sub_category);
      } 
      else if (editCatForm.level === "3") {
        if (!editCatForm.main_category || !editCatForm.sub_category || !editCatForm.tertiary_category) throw new Error("Validation failed");
        await supabase.from("product_categories").update({ tertiary_category: newName }).eq("company_id", companyId).eq("main_category", editCatForm.main_category).eq("sub_category", editCatForm.sub_category).eq("tertiary_category", editCatForm.tertiary_category);
        await supabase.from("products").update({ tertiary_category: newName }).eq("company_id", companyId).eq("category", editCatForm.main_category).eq("sub_category", editCatForm.sub_category).eq("tertiary_category", editCatForm.tertiary_category);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_categories"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setEditCategoryOpen(false);
      setEditCatForm({ level: "1", main_category: "", sub_category: "", tertiary_category: "", new_name: "" });
      toast.success("Category renamed successfully!");
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (!payload.name) {
        setErrorPopup({ title: "Name Required", message: "The product must have a name." });
        throw new Error("Validation failed");
      }

      const dbPayload = {
        company_id: companyId, name: payload.name, sku: payload.sku || null,
        category: payload.category || null, sub_category: payload.sub_category || null, tertiary_category: payload.tertiary_category || null,
        unit: payload.unit || "ea", 
        material_cost: parseFloat(payload.material_cost) || 0,
        labor_cost: parseFloat(payload.labor_cost) || 0,
        cost: parseFloat(payload.cost) || 0, 
        price: parseFloat(payload.price) || 0,
        supplier: payload.supplier || null, 
        vendor_url: payload.vendor_url || null,
        description: payload.description || null, taxable: payload.taxable !== false, image_url: payload.image_url || null
      };

      if (editing) {
        const { error } = await supabase.from("products").update(dbPayload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert([dbPayload]);
        if (error) throw error;
      }
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["products"] }); 
      setDialogOpen(false); 
      setEditing(null);
      toast.success(editing ? "Product updated!" : "Product created!"); 
    },
    onError: (err) => {
      if (err.message !== "Validation failed" && err.message !== "Duplicate name") {
        setErrorPopup({
          title: "Database Save Error",
          message: `Supabase rejected the save. Did you run the SQL script to add the new columns?\n\nError: ${err.message}`
        });
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setDetailOpen(false);
      toast.success("Product deleted");
    }
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (items) => {
      const chunkSize = 100;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        
        // ⚡ ADDED { onConflict: 'id' }
        const { error } = await supabase.from("products").upsert(chunk, { onConflict: 'id' });
        
        if (error) throw error;
      }
    },
    // ... keep onSuccess and onError exactly the same ...
    onSuccess: (_, items) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Successfully imported ${items.length} products!`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => {
      setErrorPopup({
        title: "Import Failed",
        message: `Supabase rejected the import. Did you run the SQL script to add the new columns?\n\nError: ${err.message}`
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onSettled: () => setImporting(false)
  });

  // --- ACTIONS & CALCULATORS ---
  const openNew = () => { 
    setEditing(null); 
    // AUTO-FILL THE DEFAULT MARGIN WHEN CREATING NEW
    setForm({ ...defaultForm, margin: defaultMargin }); 
    setDialogOpen(true); 
  };
  
  const openEdit = (product) => {
    setEditing(product);
    const cost = product.cost || 0;
    const price = product.price || 0;
    const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : "";
    setForm({
      name: product.name || "", sku: product.sku || "", 
      category: product.category || "", sub_category: product.sub_category || "", tertiary_category: product.tertiary_category || "",
      unit: product.unit || "ea", 
      material_cost: product.material_cost || "", 
      labor_cost: product.labor_cost || "", 
      cost: cost || "", price: price || "", margin: margin, 
      supplier: product.supplier || "", vendor_url: product.vendor_url || "", description: product.description || "", taxable: product.taxable !== false, image_url: product.image_url || "",
    });
    setDialogOpen(true);
  };

  // HELPER TO CALCULATE PRICE FROM MARGIN
  const calculatePrice = (cost, marginPct) => {
    const c = parseFloat(cost) || 0;
    const m = parseFloat(marginPct) || 0;
    if (m >= 100) return c.toFixed(2); // Safety against infinity
    return (c / (1 - (m / 100))).toFixed(2);
  };

  const handleMatLabChange = (field, val) => {
    const newVal = parseFloat(val) || 0;
    const otherVal = field === 'material_cost' ? (parseFloat(form.labor_cost) || 0) : (parseFloat(form.material_cost) || 0);
    const newCost = newVal + otherVal;
    
    // Automatically use the default margin if none is set
    const activeMargin = form.margin !== "" ? parseFloat(form.margin) : defaultMargin;
    const newPrice = calculatePrice(newCost, activeMargin);
    
    setForm({ ...form, [field]: val, cost: newCost, margin: activeMargin, price: newPrice });
  };

  const handleCostChange = (val) => {
    const newCost = parseFloat(val) || 0;
    if (isNaN(newCost) && val !== "") return setForm({ ...form, cost: val });
    
    const activeMargin = form.margin !== "" ? parseFloat(form.margin) : defaultMargin;
    const newPrice = calculatePrice(newCost, activeMargin);
    
    setForm({ ...form, cost: val, margin: activeMargin, price: newPrice });
  };

  const handleMarginChange = (val) => {
    const newMargin = parseFloat(val);
    if (isNaN(newMargin)) return setForm({ ...form, margin: val });
    if (form.cost && parseFloat(form.cost) > 0) {
      const newPrice = calculatePrice(form.cost, newMargin);
      setForm({ ...form, margin: val, price: newPrice });
    } else {
      setForm({ ...form, margin: val });
    }
  };

  const handlePriceChange = (val) => {
    const newPrice = parseFloat(val);
    if (isNaN(newPrice)) return setForm({ ...form, price: val });
    if (form.cost && parseFloat(form.cost) >= 0) {
      const newMargin = newPrice > 0 ? (((newPrice - parseFloat(form.cost)) / newPrice) * 100).toFixed(1) : 0;
      setForm({ ...form, price: val, margin: newMargin });
    } else {
      setForm({ ...form, price: val });
    }
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
        const idIdx = headers.findIndex(h => h === "id");
        const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("product") || h.includes("item"));
        const skuIdx = headers.findIndex(h => h === "sku" || h.includes("number"));
        const catIdx = headers.findIndex(h => h === "category" && !h.includes("sub") && !h.includes("3rd") && !h.includes("tertiary"));
        const subCatIdx = headers.findIndex(h => h.includes("sub") && h.includes("category"));
        const terCatIdx = headers.findIndex(h => (h.includes("3rd") || h.includes("tertiary")) && h.includes("category"));
        const unitIdx = headers.findIndex(h => h === "unit" || h === "uom");
        const matCostIdx = headers.findIndex(h => h.includes("material") && h.includes("cost"));
        const labCostIdx = headers.findIndex(h => h.includes("labor") && h.includes("cost"));
        const costIdx = headers.findIndex(h => h === "cost" || h === "total cost" || h.includes("your price"));
        const priceIdx = headers.findIndex(h => h === "price" || h.includes("client") || h.includes("retail"));
        const supIdx = headers.findIndex(h => h.includes("supplier") || h.includes("vendor"));
        const urlIdx = headers.findIndex(h => h.includes("vendor url") || h.includes("link") || h === "url");
        const imgIdx = headers.findIndex(h => h.includes("image") || h.includes("photo"));

        if (nameIdx === -1) throw new Error("Could not find a 'Name' column in the CSV.");

        const itemsToInsert = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2 || !row[nameIdx]) continue; 

          const matCost = matCostIdx > -1 ? (parseFloat(row[matCostIdx].replace(/[^0-9.-]+/g, "")) || 0) : 0;
          const labCost = labCostIdx > -1 ? (parseFloat(row[labCostIdx].replace(/[^0-9.-]+/g, "")) || 0) : 0;
          const totCost = costIdx > -1 ? (parseFloat(row[costIdx].replace(/[^0-9.-]+/g, "")) || 0) : (matCost + labCost);
          
          const parsedName = row[nameIdx].replace(/['"]/g, '').trim();
          
          // securely match by ID if present, otherwise fallback to Name
          const rowId = idIdx > -1 && row[idIdx] ? row[idIdx].replace(/['"]/g, '').trim() : null;
          const existingProduct = rowId 
            ? products.find(p => p.id === rowId) 
            : products.find(p => p.name.toLowerCase() === parsedName.toLowerCase());

          itemsToInsert.push({
            ...(existingProduct ? { id: existingProduct.id } : (rowId ? { id: rowId } : {})),
            company_id: companyId,
            name: parsedName,
            sku: skuIdx > -1 ? row[skuIdx].replace(/['"]/g, '') : null,
            category: catIdx > -1 ? row[catIdx].replace(/['"]/g, '') : null,
            sub_category: subCatIdx > -1 ? row[subCatIdx].replace(/['"]/g, '') : null,
            tertiary_category: terCatIdx > -1 ? row[terCatIdx].replace(/['"]/g, '') : null,
            unit: unitIdx > -1 ? (row[unitIdx].replace(/['"]/g, '') || "ea") : "ea",
            material_cost: matCost,
            labor_cost: labCost,
            cost: totCost,
            price: priceIdx > -1 ? (parseFloat(row[priceIdx].replace(/[^0-9.-]+/g, "")) || 0) : 0,
            supplier: supIdx > -1 ? row[supIdx].replace(/['"]/g, '') : null,
            vendor_url: urlIdx > -1 ? row[urlIdx].replace(/['"]/g, '') : null,
            image_url: imgIdx > -1 ? row[imgIdx].replace(/['"]/g, '') : null,
            taxable: true
          });
        }
        if (itemsToInsert.length === 0) throw new Error("No valid products found to import.");
        
        toast.dismiss();
        toast.loading(`Importing ${itemsToInsert.length} products to database...`);
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

  const exportToCSV = () => {
    if (!sortedProducts.length) return toast.error("No products to export");
    
    // ⚡ ADDED "ID" AS THE FIRST COLUMN
    const headers = ["ID", "Name", "SKU", "Category", "Sub Category", "3rd Category", "Unit", "Material Cost", "Labor Cost", "Total Cost", "Price", "Supplier", "Vendor URL", "Taxable", "Image URL"];
    
    // ⚡ ADDED p.id TO THE EXPORT ROWS
    const rows = sortedProducts.map(p => 
      [p.id, p.name, p.sku, p.category, p.sub_category, p.tertiary_category, p.unit, p.material_cost, p.labor_cost, p.cost, p.price, p.supplier, p.vendor_url, p.taxable ? 'Yes' : 'No', p.image_url]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    );
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Pricebook_${format(new Date(), "yyyy-MM-dd")}.csv`;
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
      console.error("Upload failed", error);
      toast.error("Image upload failed.");
    } finally {
      setUploadingImage(false);
    }
  };

  if (productsLoading || catsLoading) return (
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
                <Package className="h-6 w-6 text-amber-500" /> Pricebook
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-1">Manage your flat-rate catalog, materials, and inventory items.</p>
            </div>
            
            <div className="flex items-center gap-3">
              <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleCSVUpload} disabled={importing} />
              
              {/* Desktop Actions (Hidden on mobile) */}
              <div className="hidden md:flex items-center gap-3">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-white font-bold text-slate-600">
                  {importing ? "Processing..." : <><UploadCloud className="h-4 w-4 mr-2" /> Import CSV</>}
                </Button>
                <Button variant="outline" onClick={exportToCSV} className="bg-white font-bold text-slate-600">
                  <Download className="h-4 w-4 mr-2" /> Export
                </Button>
                <div className="h-6 w-px bg-slate-200"></div>
                <Button onClick={() => setAddCategoryOpen(true)} variant="outline" className="bg-white font-bold text-slate-600">
                  <FolderTree className="h-4 w-4 mr-1.5" /> New Category
                </Button>
                <Button onClick={() => setEditCategoryOpen(true)} variant="outline" className="bg-white font-bold text-slate-600">
                  <Pencil className="h-4 w-4 mr-1.5" /> Edit Category
                </Button>
                <Button onClick={openNew} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                  <Plus className="h-4 w-4 mr-1.5" /> Add Product
                </Button>
              </div>

              {/* Mobile Hamburger Menu (Visible only on small screens) */}
              <div className="md:hidden relative">
                <Button variant="outline" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="bg-white font-bold text-slate-600 px-3">
                  <Menu className="h-5 w-5" />
                </Button>
                
                {mobileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 flex flex-col p-2 gap-1">
                    <Button variant="ghost" className="justify-start text-sm font-bold text-slate-600 w-full" onClick={() => { setMobileMenuOpen(false); setAddCategoryOpen(true); }}>
                      <FolderTree className="h-4 w-4 mr-2 text-slate-400" /> New Category
                    </Button>
                    <Button variant="ghost" className="justify-start text-sm font-bold text-slate-600 w-full" onClick={() => { setMobileMenuOpen(false); setEditCategoryOpen(true); }}>
                      <Pencil className="h-4 w-4 mr-2 text-slate-400" /> Edit Category
                    </Button>
                    <div className="h-px w-full bg-slate-100 my-1"></div>
                    <Button variant="ghost" className="justify-start text-sm font-black text-amber-900 bg-amber-50 hover:bg-amber-100 w-full" onClick={() => { setMobileMenuOpen(false); openNew(); }}>
                      <Plus className="h-4 w-4 mr-2 text-amber-600" /> Add Product
                    </Button>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col max-w-7xl mx-auto w-full p-4 md:p-6">
        
        {/* ADVANCED FILTER BAR */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Filters & Search</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-4 items-end">
            <div className="md:col-span-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Search products or SKUs..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)} 
                  className="pl-9 h-10 bg-slate-50 font-bold border-slate-200" 
                />
              </div>
            </div>
            
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Main Category</Label>
              <Select value={filters.main} onValueChange={v => setFilters({...filters, main: v, sub: "All", tertiary: "All"})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>{filterUniqueMains.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Sub Category</Label>
              <Select value={filters.sub} disabled={filters.main === "All" || filterUniqueSubs.length <= 1} onValueChange={v => setFilters({...filters, sub: v, tertiary: "All"})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>{filterUniqueSubs.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">3rd Category</Label>
              <Select value={filters.tertiary} disabled={filters.sub === "All" || filterUniqueTers.length <= 1} onValueChange={v => setFilters({...filters, tertiary: v})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>{filterUniqueTers.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Supplier</Label>
              <Select value={filters.supplier} onValueChange={v => setFilters({...filters, supplier: v})}>
                <SelectTrigger className="bg-slate-50 font-bold border-slate-200 text-xs h-10"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>{filterUniqueSuppliers.map(c => <SelectItem key={c} value={c} className="font-bold">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* DATA TABLE */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
            <h3 className="font-black text-sm text-slate-900 uppercase tracking-wider">Product Database</h3>
            <Badge className="bg-amber-100 text-amber-800 font-black border-amber-200 tracking-wider">
              {sortedProducts.length} Items Found
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sortedProducts.length === 0 ? (
              <div className="text-center py-20 px-4">
                <Package className="h-16 w-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-xl font-black text-slate-700">No products found</h3>
                <p className="text-sm text-slate-500 mt-1 mb-4">Adjust your filters or add a new product.</p>
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="bg-white font-bold text-slate-700">
                  <UploadCloud className="h-4 w-4 mr-2 text-amber-500" /> Import via CSV Spreadsheet
                </Button>
              </div>
            ) : (
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-white border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider sticky top-0 z-10 shadow-sm select-none">
                  <tr>
                    <th className="px-6 py-4 w-16">Image</th>
                    <th className="px-6 py-4 cursor-pointer hover:bg-slate-50 group transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center">Item Name / SKU {renderSortIcon('name')}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:bg-slate-50 group transition-colors" onClick={() => handleSort('category')}>
                      <div className="flex items-center">Category Path {renderSortIcon('category')}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:bg-slate-50 group transition-colors text-right" onClick={() => handleSort('cost')}>
                      <div className="flex items-center justify-end">Cost {renderSortIcon('cost')}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:bg-slate-50 group transition-colors text-right" onClick={() => handleSort('price')}>
                      <div className="flex items-center justify-end">Price {renderSortIcon('price')}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:bg-slate-50 group transition-colors text-right" onClick={() => handleSort('margin')}>
                      <div className="flex items-center justify-end">Margin {renderSortIcon('margin')}</div>
                    </th>
                    <th className="px-6 py-4 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedProducts.map(p => {
                    const marginPct = p.price > 0 ? (((p.price - (p.cost || 0)) / p.price) * 100).toFixed(0) : 0;
                    return (
                      <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-6 py-4">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name}
                              width="40"
                              height="40"
                              loading={priorityImageIds.has(p.id) ? "eager" : "lazy"}
                              fetchPriority={priorityImageIds.has(p.id) ? "high" : "low"}
                              decoding="async"
                              className="h-10 w-10 object-cover rounded-lg border border-slate-200 shadow-sm"
                            />
                          ) : (
                            <div className="h-10 w-10 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center">
                              <ImageIcon className="h-4 w-4 text-slate-300" />
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4" onClick={() => { setSelectedProduct(p); setDetailOpen(true); }} style={{cursor: 'pointer'}}>
                          <p className="font-bold text-slate-900 hover:text-amber-600 transition-colors">{p.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">{p.sku || "No SKU"}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1 items-start">
                            {p.category ? (
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-bold text-slate-600 bg-white shadow-sm">
                                {p.category}
                              </Badge>
                            ) : <span className="text-xs text-slate-300">—</span>}
                            {p.sub_category && (
                              <span className="text-[9px] font-bold text-slate-500 uppercase flex items-center gap-1"><ChevronRight className="h-3 w-3 text-slate-300" /> {p.sub_category}</span>
                            )}
                            {p.tertiary_category && (
                              <span className="text-[8px] font-bold text-slate-400 uppercase flex items-center gap-1 pl-2"><ChevronRight className="h-2 w-2 text-slate-200" /> {p.tertiary_category}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-bold text-slate-500">{formatCurrencyUSD(p.cost)} <span className="text-[10px] font-medium text-slate-400">/{p.unit}</span></div>
                          {(p.material_cost > 0 || p.labor_cost > 0) && (
                            <div className="text-[9px] font-medium text-slate-400 mt-1">
                              M: ${p.material_cost || 0} / L: ${p.labor_cost || 0}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrencyUSD(p.price)} <span className="text-[10px] font-medium text-slate-400">/{p.unit}</span></td>
                        <td className="px-6 py-4 text-right">
                          <Badge variant="outline" className={`border font-black text-[10px] px-2 py-0.5 ${marginPct > 30 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : marginPct > 15 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {marginPct}%
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="h-8 w-8 text-slate-400 hover:text-amber-600 hover:bg-amber-50">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => { if(confirm("Delete this product?")) deleteMutation.mutate(p.id); }} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

{/* EDIT CATEGORY DIALOG */}
      <Dialog open={editCategoryOpen} onOpenChange={(v) => { if (!v) setEditCategoryOpen(false); }}>
        <DialogContent className="max-w-md bg-white border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Pencil className="h-5 w-5 text-amber-500" /> Edit Category
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Category Level to Edit</Label>
              <Select value={editCatForm.level} onValueChange={v => setEditCatForm({...editCatForm, level: v, main_category: "", sub_category: "", tertiary_category: "", new_name: ""})}>
                <SelectTrigger className="mt-1 font-bold bg-slate-50 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="font-bold">Main Category</SelectItem>
                  <SelectItem value="2" className="font-bold">Sub-Category</SelectItem>
                  <SelectItem value="3" className="font-bold">3rd Tier Category</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select Main Category</Label>
              <Select value={editCatForm.main_category} onValueChange={v => setEditCatForm({...editCatForm, main_category: v, sub_category: "", tertiary_category: ""})}>
                <SelectTrigger className="mt-1 font-bold h-10"><SelectValue placeholder="Select Main..." /></SelectTrigger>
                <SelectContent>
                  {uniqueMains.map(m => <SelectItem key={m} value={m} className="font-bold">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {editCatForm.level !== "1" && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select Sub-Category</Label>
                <Select value={editCatForm.sub_category} onValueChange={v => setEditCatForm({...editCatForm, sub_category: v, tertiary_category: ""})} disabled={!editCatForm.main_category}>
                  <SelectTrigger className="mt-1 font-bold h-10"><SelectValue placeholder="Select Sub..." /></SelectTrigger>
                  <SelectContent>
                    {[...new Set(allPaths.filter(p => p.main === editCatForm.main_category).map(p => p.sub).filter(Boolean))].sort().map(s => (
                      <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {editCatForm.level === "3" && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select 3rd Category</Label>
                <Select value={editCatForm.tertiary_category} onValueChange={v => setEditCatForm({...editCatForm, tertiary_category: v})} disabled={!editCatForm.sub_category}>
                  <SelectTrigger className="mt-1 font-bold h-10"><SelectValue placeholder="Select 3rd..." /></SelectTrigger>
                  <SelectContent>
                    {[...new Set(allPaths.filter(p => p.main === editCatForm.main_category && p.sub === editCatForm.sub_category).map(p => p.ter).filter(Boolean))].sort().map(t => (
                      <SelectItem key={t} value={t} className="font-bold">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-amber-600">Rename To</Label>
              <Input 
                value={editCatForm.new_name} 
                onChange={e => setEditCatForm({...editCatForm, new_name: e.target.value})} 
                className="mt-1 font-black border-amber-300 bg-amber-50 h-10" 
                placeholder="New category name..." 
              />
              <p className="text-[10px] text-slate-400 mt-1 font-medium leading-tight">
                Renaming this category will automatically update all existing products currently assigned to it.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setEditCategoryOpen(false)} className="font-bold">Cancel</Button>
              <Button onClick={() => editCategoryMutation.mutate()} disabled={!editCatForm.new_name || editCategoryMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                {editCategoryMutation.isPending ? "Saving..." : "Update Category"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* NEW CATEGORY DIALOG */}
      <Dialog open={addCategoryOpen} onOpenChange={(v) => { if (!v) setAddCategoryOpen(false); }}>
        <DialogContent className="max-w-md bg-white border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-amber-500" /> Add New Category
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Category Level</Label>
              <Select value={catForm.level} onValueChange={v => setCatForm({...catForm, level: v, main_category: "", sub_category: ""})}>
                <SelectTrigger className="mt-1 font-bold bg-slate-50 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="font-bold">Main Category</SelectItem>
                  <SelectItem value="2" className="font-bold">Sub-Category</SelectItem>
                  <SelectItem value="3" className="font-bold">3rd Tier Category</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {catForm.level !== "1" && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Parent Main Category</Label>
                <Select value={catForm.main_category} onValueChange={v => setCatForm({...catForm, main_category: v, sub_category: ""})}>
                  <SelectTrigger className="mt-1 font-bold h-10"><SelectValue placeholder="Select Main Category..." /></SelectTrigger>
                  <SelectContent>
                    {uniqueMains.map(m => <SelectItem key={m} value={m} className="font-bold">{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {catForm.level === "3" && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Parent Sub-Category</Label>
                <Select value={catForm.sub_category} onValueChange={v => setCatForm({...catForm, sub_category: v})} disabled={!catForm.main_category}>
                  <SelectTrigger className="mt-1 font-bold h-10"><SelectValue placeholder="Select Sub-Category..." /></SelectTrigger>
                  <SelectContent>
                    {[...new Set(allPaths.filter(p => p.main === catForm.main_category).map(p => p.sub).filter(Boolean))].sort().map(s => (
                      <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-amber-600">New Category Name</Label>
              <Input 
                value={catForm.new_name} 
                onChange={e => setCatForm({...catForm, new_name: e.target.value})} 
                className="mt-1 font-black border-amber-300 bg-amber-50 h-10" 
                placeholder="e.g., HVAC, Trim, Valves..." 
              />
              <p className="text-[10px] text-slate-400 mt-1 font-medium">Names must be completely unique across your entire catalog.</p>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddCategoryOpen(false)} className="font-bold">Cancel</Button>
              <Button onClick={() => saveCategoryMutation.mutate()} disabled={!catForm.new_name || saveCategoryMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                {saveCategoryMutation.isPending ? "Saving..." : "Save Category"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CREATE / EDIT PRODUCT DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-3xl bg-white border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Tag className="h-5 w-5 text-amber-500" /> {editing ? "Edit Pricebook Item" : "New Pricebook Item"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="shrink-0 w-full sm:w-auto flex justify-center">
                {form.image_url ? (
                  <div className="relative group">
                    <img src={form.image_url} alt="Product" className="h-32 w-32 object-cover rounded-xl border border-slate-200 shadow-sm" />
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
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Item Name *</Label>
                  <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="mt-1 font-black text-lg text-slate-900 h-12 border-slate-300" placeholder="e.g., Kohler Kitchen Faucet" />
                </div>
                
                {/* 3-TIER CATEGORY CASCADING DROPDOWNS */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><FolderTree className="h-3 w-3" /> Categorization</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setCatForm({ level: "1", main_category: "", sub_category: "", new_name: "" }); setAddCategoryOpen(true); }} className="h-6 text-[10px] font-bold text-amber-700 hover:text-amber-800 hover:bg-amber-100">
                      <Plus className="h-3 w-3 mr-1" /> Add Category
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Main Category</Label>
                      <Select value={form.category} onValueChange={v => setForm({...form, category: v, sub_category: "", tertiary_category: ""})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select Main..." /></SelectTrigger>
                        <SelectContent>
                          {uniqueMains.map(m => <SelectItem key={m} value={m} className="font-bold">{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Sub Category</Label>
                      <Select value={form.sub_category} disabled={!form.category || uniqueSubs.length === 0} onValueChange={v => setForm({...form, sub_category: v, tertiary_category: ""})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select Sub..." /></SelectTrigger>
                        <SelectContent>
                          {uniqueSubs.map(s => <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">3rd Category</Label>
                      <Select value={form.tertiary_category} disabled={!form.sub_category || uniqueTers.length === 0} onValueChange={v => setForm({...form, tertiary_category: v})}>
                        <SelectTrigger className="bg-white font-bold text-xs h-10"><SelectValue placeholder="Select 3rd..." /></SelectTrigger>
                        <SelectContent>
                          {uniqueTers.map(t => <SelectItem key={t} value={t} className="font-bold">{t}</SelectItem>)}
                        </SelectContent>
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
                  <Select value={form.unit} onValueChange={v => setForm({...form, unit: v})}>
                    <SelectTrigger className="mt-1 bg-white font-bold h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u} className="font-bold">{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Material Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                    <Input type="number" step="0.01" value={form.material_cost} onChange={e => handleMatLabChange('material_cost', e.target.value)} className="pl-7 font-bold h-10 border-slate-300 bg-white" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Labor Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                    <Input type="number" step="0.01" value={form.labor_cost} onChange={e => handleMatLabChange('labor_cost', e.target.value)} className="pl-7 font-bold h-10 border-slate-300 bg-white" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-800">Total Cost</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-slate-800 font-bold">$</span>
                    <Input type="number" step="0.01" value={form.cost} onChange={e => handleCostChange(e.target.value)} className="pl-7 font-black h-10 border-slate-400 bg-slate-100" placeholder="0.00" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
                <div className="sm:col-start-3">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Margin</Label>
                  <div className="relative mt-1">
                    <Input type="number" step="0.1" value={form.margin} onChange={e => handleMarginChange(e.target.value)} className="pr-7 font-bold h-10 text-emerald-700 bg-emerald-50/30 border-emerald-200 text-right" placeholder="0.0" />
                    <span className="absolute right-3 top-3 text-emerald-700 font-black">%</span>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Client Pays</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-3 text-amber-700 font-black">$</span>
                    <Input type="number" step="0.01" value={form.price} onChange={e => handlePriceChange(e.target.value)} className="pl-7 font-black text-amber-900 border-amber-300 bg-amber-50 h-10" placeholder="0.00" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">SKU / Item #</Label>
                <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} className="mt-1 font-bold" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier / Vendor</Label>
                <Input value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} className="mt-1 font-bold" placeholder="e.g., Home Depot" />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier Link / URL</Label>
              <Input type="url" value={form.vendor_url} onChange={e => setForm({...form, vendor_url: e.target.value})} className="mt-1 font-bold" placeholder="https://..." />
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Description & Notes</Label>
              <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} className="mt-1" placeholder="Internal notes or material specs..." />
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
                <input type="checkbox" checked={form.taxable} onChange={e => setForm({...form, taxable: e.target.checked})} className="rounded border-slate-300 w-4 h-4 text-amber-500 focus:ring-amber-500" />
                <span className="text-sm font-black text-slate-700">Taxable Item</span>
              </label>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-bold">Cancel</Button>
                <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md">
                  {saveMutation.isPending ? "Saving..." : editing ? "Update Product" : "Save Product"}
                </Button>
              </div>
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* QUICK VIEW DIALOG */}
      {selectedProduct && (
        <Dialog open={detailOpen} onOpenChange={(v) => !v && setDetailOpen(false)}>
          <DialogContent aria-describedby={undefined} className="max-w-sm bg-white border-slate-200 shadow-xl">
            <DialogHeader>
              <div className="flex items-start gap-4">
                {selectedProduct.image_url ? (
                  <img src={selectedProduct.image_url} alt="" className="h-16 w-16 object-cover rounded-xl border border-slate-200 shadow-sm" />
                ) : (
                  <div className="h-16 w-16 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center">
                    <Package className="h-6 w-6 text-slate-300" />
                  </div>
                )}
                <div>
                  <DialogTitle className="text-lg font-black text-slate-900 leading-tight pr-6">{selectedProduct.name}</DialogTitle>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-1">{selectedProduct.sku || "No SKU"}</p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Your Total Cost</p>
                  <p className="text-lg font-bold text-slate-600">{formatCurrencyUSD(selectedProduct.cost)}</p>
                  {(selectedProduct.material_cost > 0 || selectedProduct.labor_cost > 0) && (
                    <div className="text-[9px] font-medium text-slate-400 mt-1">
                      M: ${selectedProduct.material_cost || 0} / L: ${selectedProduct.labor_cost || 0}
                    </div>
                  )}
                </div>
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-0.5">Client Price</p>
                  <p className="text-xl font-black text-amber-900">{formatCurrencyUSD(selectedProduct.price)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-4 gap-x-4 text-sm bg-white p-4 rounded-xl border border-slate-100">
                <div className="col-span-2 flex flex-col gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Category Path</p>
                  <div className="flex flex-wrap items-center gap-1.5 font-black text-slate-900 text-xs">
                    {selectedProduct.category ? <span>{selectedProduct.category}</span> : <span className="text-slate-300">—</span>}
                    {selectedProduct.sub_category && <><ChevronRight className="h-3 w-3 text-slate-300" /> <span>{selectedProduct.sub_category}</span></>}
                    {selectedProduct.tertiary_category && <><ChevronRight className="h-3 w-3 text-slate-300" /> <span>{selectedProduct.tertiary_category}</span></>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Unit Type</p>
                  <p className="font-black text-slate-900 uppercase">{selectedProduct.unit}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Supplier</p>
                  <p className="font-black text-slate-900">{selectedProduct.supplier || "—"}</p>
                </div>
              </div>

              {selectedProduct.vendor_url && (
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                  <a href={selectedProduct.vendor_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900 transition-colors">
                    <ExternalLink className="h-4 w-4" /> View Supplier Page
                  </a>
                </div>
              )}

              {selectedProduct.description && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-sm font-medium text-slate-700 italic">
                  "{selectedProduct.description}"
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button 
                  variant="outline" 
                  className="flex-1 font-bold text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100"
                  onClick={() => { if(confirm("Delete this product?")) deleteMutation.mutate(selectedProduct.id); }}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
                <Button 
                  className="flex-[2] bg-slate-900 hover:bg-slate-800 text-white font-bold"
                  onClick={() => { setDetailOpen(false); openEdit(selectedProduct); }}
                >
                  <Pencil className="h-4 w-4 mr-1.5" /> Edit Full Details
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
