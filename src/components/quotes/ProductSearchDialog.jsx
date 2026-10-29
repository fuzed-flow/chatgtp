import ProductImage from "@/components/shared/ProductImage";
import FinishColour from "@/components/shared/FinishColour";
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Package, ChevronRight, Folder, CornerLeftUp, Home, Image as ImageIcon } from "lucide-react";

export default function ProductSearchDialog({ open, onOpenChange, onSelect }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [searchTerm, setSearchTerm] = useState("");
  const [browsePath, setBrowsePath] = useState([]);
  const [visible,setVisible]=useState(40);
  useEffect(() => setVisible(40),[searchTerm,browsePath]); // Array to hold [main, sub, ter]

  // FETCH SUPABASE PRODUCTS
  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ["products", companyId],
    enabled: open && !!companyId, 
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const isSearchMode = searchTerm.trim().length > 0;

  // --- BROWSING LOGIC ---
  const [currentMain, currentSub, currentTer] = browsePath;
  let currentFolders = [];
  let currentPathProducts = [];

  if (!isSearchMode) {
    if (browsePath.length === 0) {
      currentFolders = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
      currentPathProducts = products.filter(p => !p.category);
    } else if (browsePath.length === 1) {
      currentFolders = [...new Set(products.filter(p => p.category === currentMain).map(p => p.sub_category).filter(Boolean))].sort();
      currentPathProducts = products.filter(p => p.category === currentMain && !p.sub_category);
    } else if (browsePath.length === 2) {
      currentFolders = [...new Set(products.filter(p => p.category === currentMain && p.sub_category === currentSub).map(p => p.tertiary_category).filter(Boolean))].sort();
      currentPathProducts = products.filter(p => p.category === currentMain && p.sub_category === currentSub && !p.tertiary_category);
    } else if (browsePath.length === 3) {
      currentPathProducts = products.filter(p => p.category === currentMain && p.sub_category === currentSub && p.tertiary_category === currentTer);
    }
  } else {
    currentPathProducts = products.filter(p => {
      const term = searchTerm.toLowerCase();
      return (
        p.name?.toLowerCase().includes(term) ||
        p.category?.toLowerCase().includes(term) ||
        p.sub_category?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term) || p.supplier?.toLowerCase().includes(term) || p.finish_colour?.toLowerCase().includes(term)
      );
    });
  }

  const handleSelect = (product) => {
    onSelect(product.name, product);
    setSearchTerm("");
    setBrowsePath([]);
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={v => {onOpenChange(v);if(!v){setSearchTerm('');setBrowsePath([]);}}}>
    <DialogContent aria-describedby={undefined} className="flex max-h-[90dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:p-0">
      <DialogHeader className="shrink-0 border-b p-4 pr-24 text-left"><DialogTitle className="text-xl font-bold">Choose a product</DialogTitle><p className="mt-1 text-sm text-slate-600">Browse your pricebook or search by name, SKU, finish or supplier.</p></DialogHeader>
      <div className="shrink-0 p-4"><Input aria-label="Search products" placeholder="Search products…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-12 text-base" /></div>
      {!isSearchMode && <nav aria-label="Product categories" className="flex shrink-0 flex-wrap gap-1 border-y bg-slate-50 px-3 py-1"><button type="button" onClick={() => setBrowsePath([])} className="min-h-11 rounded px-2 text-sm font-bold text-slate-800 focus-visible:ring-2 focus-visible:ring-amber-500">All products</button>{browsePath.map((part,index) => <button type="button" key={index} onClick={() => setBrowsePath(browsePath.slice(0,index+1))} className="min-h-11 rounded px-2 text-sm text-slate-700 focus-visible:ring-2 focus-visible:ring-amber-500">/ {part}</button>)}</nav>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {isLoading ? <p role="status" className="p-6 text-center text-slate-600">Loading products…</p> : error ? <p role="alert" className="p-6 text-red-700">Products could not load. Close and try again.</p> : <>
          {!isSearchMode && browsePath.length>0 && <button type="button" onClick={() => setBrowsePath(p => p.slice(0,-1))} className="mb-2 min-h-11 rounded-lg border px-4 text-sm font-bold">Back to parent category</button>}
          {!isSearchMode && <div className="grid gap-2 sm:grid-cols-2">{currentFolders.map(folder => <button type="button" key={folder} onClick={() => setBrowsePath([...browsePath,folder])} className="flex min-h-14 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-base font-bold text-slate-900 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500"><Folder className="h-5 w-5 shrink-0 text-amber-700" />{folder}</button>)}</div>}
          <ul className="mt-2 divide-y divide-slate-200">{currentPathProducts.slice(0,visible).map(product => <li key={product.id} className="flex items-start gap-3 py-3">
            <ProductImage src={product.image_url} name={product.name} className="h-16 w-16 sm:h-20 sm:w-20" />
            <div className="min-w-0 flex-1"><button type="button" onClick={() => handleSelect(product)} className="min-h-11 text-left text-base font-bold leading-6 text-slate-900 hover:text-amber-800 focus-visible:ring-2 focus-visible:ring-amber-500">{product.name}</button><p className="mt-1 break-words text-sm text-slate-600">{product.sku || 'No SKU'} · {product.unit || 'ea'}{product.supplier ? ` · ${product.supplier}` : ''}</p><FinishColour value={product.finish_colour} /><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-slate-950">${Number(product.price).toFixed(2)} / {product.unit || 'ea'}</span><Button type="button" onClick={() => handleSelect(product)} className="min-h-11 bg-amber-400 text-slate-950 hover:bg-amber-500" aria-label={`Use ${product.name}`}>Use item</Button></div></div>
          </li>)}</ul>
          {currentPathProducts.length>visible && <Button variant="outline" className="my-3 min-h-11 w-full" onClick={() => setVisible(v => v+40)}>Show more products</Button>}
          {!currentFolders.length && !currentPathProducts.length && <p role="status" className="p-6 text-center text-slate-600">No products found. Try another search.</p>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
