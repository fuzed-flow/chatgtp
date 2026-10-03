import React, { useState } from "react";
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
  const [browsePath, setBrowsePath] = useState([]); // Array to hold [main, sub, ter]

  // FETCH SUPABASE PRODUCTS
  const { data: products = [], isLoading } = useQuery({
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
        p.sku?.toLowerCase().includes(term)
      );
    });
  }

  const handleSelect = (product) => {
    onSelect(product.name, product);
    setSearchTerm("");
    setBrowsePath([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      onOpenChange(v);
      if (!v) {
        setSearchTerm("");
        setBrowsePath([]);
      }
    }}>
      <DialogContent aria-describedby={undefined} className="max-w-4xl max-h-[85vh] flex flex-col bg-white border-slate-200 shadow-xl p-0 overflow-hidden">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-100 bg-white shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-500" /> Pricebook Catalog
          </DialogTitle>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search catalog..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 font-bold bg-slate-50 border-slate-200 h-9"
            />
          </div>
        </div>

        {/* MAIN EXPLORER AREA */}
        <div className="flex flex-col flex-1 overflow-hidden bg-slate-50/50">
          
          {/* BREADCRUMB BAR (WINDOWS STYLE) */}
          {!isSearchMode && (
            <div className="flex items-center px-4 py-2 bg-white border-b border-slate-200 shadow-sm z-10 shrink-0 text-sm overflow-x-auto whitespace-nowrap">
              <button 
                onClick={() => setBrowsePath([])} 
                className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 transition-colors ${browsePath.length === 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}
              >
                <Home className="h-4 w-4" /> Root
              </button>
              
              {browsePath.map((folder, idx) => (
                <React.Fragment key={folder}>
                  <ChevronRight className="h-4 w-4 text-slate-300 mx-0.5 shrink-0" />
                  <button 
                    onClick={() => setBrowsePath(browsePath.slice(0, idx + 1))} 
                    className={`px-2 py-1 rounded hover:bg-slate-100 transition-colors ${idx === browsePath.length - 1 ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}
                  >
                    {folder}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* LIST COLUMNS HEADER */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-white border-b border-slate-200 text-xs font-black text-slate-400 uppercase tracking-wider shrink-0 shadow-sm z-10">
            <div className="flex-1 pl-1">Name</div>
            <div className="flex items-center gap-4 shrink-0">
              <div className="w-24">SKU</div>
              <div className="w-16">Unit</div>
              <div className="w-20 text-right pr-2">Price</div>
            </div>
          </div>

          {/* LIST BODY */}
          <div className="flex-1 overflow-y-auto bg-white">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="h-6 w-6 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                
                {/* UP FOLDER (..) */}
                {!isSearchMode && browsePath.length > 0 && (
                  <div 
                    onClick={() => setBrowsePath(prev => prev.slice(0, -1))}
                    className="flex items-center px-4 py-3 hover:bg-amber-50/50 cursor-pointer select-none transition-colors group"
                  >
                    <div className="w-10 h-10 flex items-center justify-center mr-3 bg-slate-50 rounded-lg border border-slate-200/60">
                      <CornerLeftUp className="h-5 w-5 text-amber-500" />
                    </div>
                    <span className="text-sm font-bold text-slate-700 group-hover:text-amber-700">..</span>
                  </div>
                )}

                {/* FOLDERS */}
                {!isSearchMode && currentFolders.map(folder => (
                  <div
                    key={folder}
                    onClick={() => setBrowsePath([...browsePath, folder])}
                    className="flex items-center px-4 py-3 hover:bg-amber-50/50 cursor-pointer select-none transition-colors group"
                  >
                    <div className="w-10 h-10 flex items-center justify-center mr-3 bg-amber-50/50 rounded-lg border border-amber-100 group-hover:bg-amber-100/50 transition-colors">
                      <Folder className="h-5 w-5 text-amber-400 fill-amber-100 group-hover:text-amber-500 group-hover:fill-amber-200 transition-colors" />
                    </div>
                    <span className="text-sm font-bold text-slate-800 flex-1 group-hover:text-amber-900">{folder}</span>
                    <span className="text-xs text-slate-400 font-black tracking-wider uppercase mr-2 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/40">Folder</span>
                  </div>
                ))}

                {/* PRODUCTS (FILES) */}
                {currentPathProducts.map(product => (
                  <div 
                    key={product.id} 
                    onClick={() => handleSelect(product)}
                    className="flex items-center justify-between px-4 py-3 hover:bg-blue-50/50 cursor-pointer select-none transition-colors group"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                      {product.image_url ? (
                        <img src={product.image_url} alt="" className="h-10 w-10 rounded-xl object-cover border border-slate-200 shadow-sm shrink-0 bg-white" />
                      ) : (
                        <div className="h-10 w-10 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-center shrink-0 group-hover:bg-white transition-colors">
                          <ImageIcon className="h-5 w-5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                        </div>
                      )}
                      
                      <div className="min-w-0 flex flex-col justify-center">
                        <span className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-700">{product.name}</span>
                        {/* Only show path if searching */}
                        {isSearchMode && product.category && (
                          <span className="text-[9px] text-slate-400 font-bold uppercase truncate mt-0.5">
                            {product.category} {product.sub_category && `> ${product.sub_category}`}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm shrink-0">
                      <span className="w-24 truncate text-xs text-slate-500 font-bold tracking-wide">{product.sku || "—"}</span>
                      <span className="w-16 text-xs text-slate-500 font-semibold uppercase">{product.unit || 'ea'}</span>
                      <span className="w-20 text-right font-black text-slate-900 pr-2">${Number(product.price).toFixed(2)}</span>
                    </div>
                  </div>
                ))}

                {/* EMPTY STATES */}
                {!isSearchMode && currentFolders.length === 0 && currentPathProducts.length === 0 && (
                  <div className="text-center py-16 bg-white">
                    <Folder className="h-10 w-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-400">This folder is empty.</p>
                  </div>
                )}

                {isSearchMode && currentPathProducts.length === 0 && (
                  <div className="text-center py-16 bg-white">
                    <Package className="h-10 w-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-400">No items found matching "{searchTerm}"</p>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
        
        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-bold bg-white h-8">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}