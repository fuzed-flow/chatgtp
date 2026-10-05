import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext"; 
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label"; 
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Trash2, MoveRight, Image as ImageIcon, GripVertical, Search, ChevronDown, ChevronRight } from "lucide-react";
import ProductSearchOrCreate from "./ProductSearchOrCreate";
import ProductSearchDialog from "./ProductSearchDialog";

const UNITS = ["ea", "ft", "sqft", "hr", "lft", "m", "sqm", "bag", "box", "roll"];

export default function LineItemRow({ 
  item, 
  itemIdx, 
  phaseIdx, 
  phases,
  onUpdate, 
  onDuplicate, 
  onMove, 
  onRemove,
  onPhotoUpload,
  clientSelections,
  dragHandleProps,
  isGlobalCollapsed 
}) {
  const { settings } = useAuth(); 
  const defaultMargin = settings?.default_margin ?? 20;

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  
  // ⚡ Default to collapsed ONLY on mobile (width < 768px)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  // Sync with parent's "Collapse All" button if provided
  useEffect(() => {
    if (typeof isGlobalCollapsed === 'boolean') {
      setIsCollapsed(isGlobalCollapsed);
    }
  }, [isGlobalCollapsed]);

  // Local state for text display only
  const [localQty, setLocalQty] = useState(String(item.quantity || 1));
  const [localUnit, setLocalUnit] = useState(item.unit || "ea");
  const [localMatCost, setLocalMatCost] = useState(String(item.material_cost || 0));
  const [localLabCost, setLocalLabCost] = useState(String(item.labor_cost || 0));
  const [localTotalCost, setLocalTotalCost] = useState(String(item.unit_cost || 0));
  const [localPrice, setLocalPrice] = useState(String(item.unit_price || 0));
  const [localDesc, setLocalDesc] = useState(item.description || "");
  const [localNotes, setLocalNotes] = useState(item.internal_notes || "");
  const [localSupplier, setLocalSupplier] = useState(item.supplier || "");

  const [localMargin, setLocalMargin] = useState(() => {
    const c = Number(item.unit_cost || 0);
    const p = Number(item.unit_price || 0);
    return c > 0 && p > 0 ? (((p - c) / p) * 100).toFixed(1) : "";
  });

  const itemIdRef = useRef(item.id);
  useEffect(() => {
    if (item.id !== itemIdRef.current) {
      itemIdRef.current = item.id;
      setLocalQty(String(item.quantity || 1));
      setLocalUnit(item.unit || "ea");
      setLocalMatCost(String(item.material_cost || 0));
      setLocalLabCost(String(item.labor_cost || 0));
      setLocalTotalCost(String(item.unit_cost || 0));
      setLocalPrice(String(item.unit_price || 0));
      setLocalDesc(item.description || "");
      setLocalNotes(item.internal_notes || "");
      setLocalSupplier(item.supplier || "");
      
      const c = Number(item.unit_cost || 0);
      const p = Number(item.unit_price || 0);
      setLocalMargin(c > 0 && p > 0 ? (((p - c) / p) * 100).toFixed(1) : "");
    }
  });

  const updateField = (field, value) => {
    onUpdate(phaseIdx, itemIdx, field, value);
  };

  const handleProductSelect = (name, product) => {
    if (product) {
      updateField("name", product.name);
      updateField("description", product.description || "");
      setLocalDesc(product.description || "");
      updateField("unit", product.unit || "ea");
      setLocalUnit(product.unit || "ea");
      
      const mat = Number(product.material_cost) || 0;
      const lab = Number(product.labor_cost) || 0;
      const tot = Number(product.cost) || (mat + lab) || Number(item.unit_cost);
      
      updateField("material_cost", mat);
      setLocalMatCost(String(mat));
      updateField("labor_cost", lab);
      setLocalLabCost(String(lab));
      updateField("unit_cost", tot);
      setLocalTotalCost(String(tot));
      
      const pPrice = product.price || item.unit_price || 0;
      updateField("unit_price", pPrice);
      setLocalPrice(String(pPrice));
      
      if (tot > 0 && pPrice > 0) {
        setLocalMargin((((pPrice - tot) / pPrice) * 100).toFixed(1));
      }
      
      updateField("product_id", product.id);
      updateField("photo_url", product.image_url || item.photo_url);

      if (product.supplier) {
        updateField("supplier", product.supplier);
        setLocalSupplier(product.supplier);
      }
      if (product.is_material) {
        updateField("is_material", true);
      }

      if (mat > 0 || lab > 0) setShowCostBreakdown(true);
    } else {
      updateField("name", name);
    }
  };

  const handleMatLabChange = (field, val) => {
    const newVal = Number(val) || 0;
    const isMat = field === 'material';
    
    if (isMat) {
      setLocalMatCost(val);
      updateField("material_cost", newVal);
    } else {
      setLocalLabCost(val);
      updateField("labor_cost", newVal);
    }

    const otherVal = isMat ? Number(localLabCost) : Number(localMatCost);
    const newTotal = Number((newVal + otherVal).toFixed(2));
    
    setLocalTotalCost(String(newTotal));
    updateField("unit_cost", newTotal);

    const oldTotal = Number(localTotalCost) || 0;
    const oldPrice = Number(localPrice) || 0;
    
    let marginPct = defaultMargin / 100;
    if (oldTotal > 0 && oldPrice > 0) {
      marginPct = (oldPrice - oldTotal) / oldPrice; 
    }
    
    if (marginPct >= 0 && marginPct < 1) {
      const newPrice = Number((newTotal / (1 - marginPct)).toFixed(2));
      setLocalPrice(String(newPrice));
      setLocalMargin((marginPct * 100).toFixed(1));
      updateField("unit_price", newPrice);
    }
  };

  const handleTotalCostChange = (val) => {
    const newTotal = Number(val) || 0;
    setLocalTotalCost(val);
    updateField("unit_cost", newTotal);
    
    const oldTotal = Number(localTotalCost) || 0;
    const oldPrice = Number(localPrice) || 0;
    
    let marginPct = defaultMargin / 100;
    if (oldTotal > 0 && oldPrice > 0) {
      marginPct = (oldPrice - oldTotal) / oldPrice; 
    }

    if (marginPct >= 0 && marginPct < 1) {
      const newPrice = Number((newTotal / (1 - marginPct)).toFixed(2));
      setLocalPrice(String(newPrice));
      setLocalMargin((marginPct * 100).toFixed(1));
      updateField("unit_price", newPrice);
    }

    setLocalMatCost("0");
    setLocalLabCost("0");
    updateField("material_cost", 0);
    updateField("labor_cost", 0);
  };

  // Auto-expand textarea helper for mobile
  const handleAutoResize = (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const isItemModified = clientSelections && item.is_optional && item.id ? (() => {
    const clientSelected = clientSelections[item.id] !== false;
    return clientSelected !== (item.default_selected === true);
  })() : false;

  const itemTotal = (Number(localQty) * Number(localPrice)).toFixed(2);

  return (
    <div className={`rounded-lg border transition-all duration-200 ${isItemModified ? 'bg-red-50 border-red-500 border-2 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-amber-400 shadow-sm'} ${isCollapsed ? 'p-2' : 'p-3'}`}>
      
      {isCollapsed ? (
        // ⚡ COLLAPSED VIEW HEADER
        <div className="flex gap-2 items-center">
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing p-1.5 rounded-md hover:bg-slate-200 shrink-0 transition-colors" title="Drag to reorder">
            <GripVertical className="h-4 w-4 text-slate-400" />
          </div>
          
          <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(false)} className="h-8 w-8 shrink-0 hover:bg-slate-200 text-slate-500">
            <ChevronRight className="h-5 w-5" />
          </Button>

          <div className="flex-1 min-w-0 flex items-center justify-between gap-4 cursor-pointer" onClick={() => setIsCollapsed(false)}>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900 text-sm truncate">{item.name || "Unnamed Item"}</p>
              <p className="text-xs text-slate-500 truncate">{localDesc || <span className="italic">No description</span>}</p>
            </div>
            <div className="text-right shrink-0 flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-[10px] font-black uppercase text-slate-400">Qty</p>
                <p className="text-xs font-bold text-slate-700">{localQty} {localUnit}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                <p className="text-sm font-black text-amber-600">${itemTotal}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // ⚡ EXPANDED VIEW HEADER
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          {/* Row 1 on Mobile (Name & Search) / Left side on Desktop */}
          <div className="flex-1 flex gap-2 items-center min-w-0">
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing p-1.5 rounded-md hover:bg-slate-200 shrink-0 transition-colors" title="Drag to reorder">
              <GripVertical className="h-4 w-4 text-slate-400" />
            </div>
            
            {/* The wrapper class reduces input text size on mobile only */}
            <div className="flex-1 min-w-0 [&_input]:text-sm sm:[&_input]:text-base">
              <ProductSearchOrCreate
                value={item.name}
                initialData={{
                  name: item.name,
                  description: localDesc,
                  unit: localUnit,
                  material_cost: localMatCost,
                  labor_cost: localLabCost,
                  unit_cost: localTotalCost,
                  unit_price: localPrice,
                  taxable: item.taxable,
                  photo_url: item.photo_url
                }}
                onSelect={handleProductSelect}
                onProductCreated={(product) => handleProductSelect(product.name, product)}
              />
            </div>
            
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 bg-white border-slate-300 shadow-sm hover:border-amber-400 transition-colors" onClick={() => setProductDialogOpen(true)}>
              <Search className="h-4 w-4 text-amber-600" />
            </Button>

            {/* Collapse toggle (Mobile Top-Right) */}
            <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(true)} className="h-8 w-8 shrink-0 sm:hidden hover:bg-slate-200 text-slate-500 ml-auto">
              <ChevronDown className="h-5 w-5" />
            </Button>
          </div>

          {/* Row 2 on Mobile (Duplicate / Delete) / Right side on Desktop */}
          <div className="flex items-center justify-between sm:justify-end gap-1 w-full sm:w-auto bg-white sm:bg-transparent p-1.5 sm:p-0 rounded-lg sm:rounded-none border sm:border-none border-slate-200 shadow-sm sm:shadow-none">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 hover:bg-blue-50 hover:text-blue-600 rounded-md bg-slate-50 sm:bg-transparent border border-slate-200 sm:border-transparent" onClick={() => onDuplicate(phaseIdx, itemIdx)} title="Duplicate">
                <Copy className="h-4 w-4" />
              </Button>
              {phases?.length > 1 && (
                <Select onValueChange={v => onMove(phaseIdx, itemIdx, Number(v))}>
                  <SelectTrigger className="h-8 w-8 sm:h-9 sm:w-9 p-0 border border-slate-200 sm:border-transparent bg-slate-50 sm:bg-transparent hover:bg-slate-100 rounded-md flex items-center justify-center [&>svg]:hidden" title="Move to phase">
                    <MoveRight className="h-4 w-4 text-slate-600" />
                  </SelectTrigger>
                  <SelectContent>
                    {phases.map((p, pIdx) => pIdx !== phaseIdx && (
                      <SelectItem key={pIdx} value={String(pIdx)} className="font-bold text-xs">Move to {p.phase_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 hover:bg-red-50 hover:text-red-600 rounded-md bg-slate-50 sm:bg-transparent border border-slate-200 sm:border-transparent" onClick={() => onRemove(phaseIdx, itemIdx)} title="Remove Item">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Collapse toggle (Desktop Right side) */}
            <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(true)} className="hidden sm:flex h-9 w-9 shrink-0 hover:bg-slate-200 text-slate-500">
              <ChevronDown className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      {/* ⚡ EXPANDED DETAILS (Hidden when collapsed) */}
      {!isCollapsed && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          {isItemModified && (
            <div className="bg-red-600 text-white text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded mb-2 inline-block shadow-sm">
              CLIENT MODIFIED
            </div>
          )}
          
          <ProductSearchDialog
            open={productDialogOpen}
            onOpenChange={setProductDialogOpen}
            onSelect={handleProductSelect}
          />
          
          {/* Numbers row */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-start">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Qty</Label>
                <Input 
                  type="number" 
                  value={localQty}
                  onChange={e => { setLocalQty(e.target.value); updateField("quantity", Number(e.target.value)); }}
                  className="text-sm h-9 font-black text-slate-900 border-slate-300" 
                />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Unit</Label>
                <Select value={localUnit} onValueChange={v => { setLocalUnit(v); updateField("unit", v); }}>
                  <SelectTrigger className="h-9 text-xs font-bold border-slate-300"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u} className="font-bold">{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {/* COST BLOCK WITH M/L SPLIT */}
              <div className="col-span-2 relative bg-slate-50/50 p-2 rounded-lg border border-slate-100 -mt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Unit Cost</Label>
                  <button 
                    type="button" 
                    onClick={() => setShowCostBreakdown(!showCostBreakdown)} 
                    className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${showCostBreakdown ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                  >
                    {showCostBreakdown ? "Hide M/L" : "Split M/L"}
                  </button>
                </div>
                
                {showCostBreakdown && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200 border-dashed">
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-2 text-[10px] font-black text-slate-400">M:</span>
                      <Input type="number" step="0.01" value={localMatCost} onChange={e => handleMatLabChange('material', e.target.value)} className="h-8 text-xs font-bold pl-6 border-slate-300 bg-white" />
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-2 text-[10px] font-black text-slate-400">L:</span>
                      <Input type="number" step="0.01" value={localLabCost} onChange={e => handleMatLabChange('labor', e.target.value)} className="h-8 text-xs font-bold pl-5 border-slate-300 bg-white" />
                    </div>
                  </div>
                )}
                
                <div className="relative">
                  {showCostBreakdown && <span className="absolute left-2 top-2 text-[10px] font-black text-slate-400">Total:</span>}
                  <Input 
                    type="number" step="0.01" value={localTotalCost} onChange={e => handleTotalCostChange(e.target.value)}
                    className={`text-sm h-9 font-bold text-slate-900 border-slate-300 ${showCostBreakdown ? 'bg-slate-100 pl-11' : 'bg-white'}`} 
                  />
                </div>
              </div>

              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-1.5 block">Unit Price</Label>
                <Input 
                  type="number" step="0.01" value={localPrice}
                  onChange={e => { 
                    setLocalPrice(e.target.value); 
                    updateField("unit_price", Number(e.target.value)); 
                    const p = Number(e.target.value);
                    const c = Number(localTotalCost);
                    if (p > 0 && c > 0) setLocalMargin((((p - c) / p) * 100).toFixed(1));
                  }}
                  className="text-sm h-9 font-black text-amber-900 border-amber-300 bg-amber-50 shadow-inner" 
                />
              </div>

              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Margin</Label>
                <div className="relative">
                  <Input
                    type="number" step="0.1" min="-100" max="100" value={localMargin}
                    onChange={e => {
                      setLocalMargin(e.target.value); 
                      const pct = Number(e.target.value);
                      if (Number(localTotalCost) > 0 && pct < 100) {
                        const newPrice = Number(localTotalCost) / (1 - pct / 100);
                        const rounded = String(Math.round(newPrice * 100) / 100);
                        setLocalPrice(rounded);
                        updateField("unit_price", Number(rounded));
                      }
                    }}
                    className="text-sm h-9 font-bold text-emerald-700 bg-emerald-50 border-emerald-200 pr-6"
                  />
                  <span className="absolute right-2 top-2 text-[10px] font-black text-emerald-700">%</span>
                </div>
                <div className="text-[9px] font-black text-emerald-600 text-center mt-1.5 whitespace-nowrap tracking-wider">
                  Profit: ${((Number(localQty) * Number(localPrice)) - (Number(localQty) * Number(localTotalCost))).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Settings row (Moved duplicate/delete out of here) */}
          <div className="flex flex-wrap items-center gap-4 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm mb-3">
            <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-700 cursor-pointer hover:opacity-70 transition-opacity">
              <input type="checkbox" checked={item.taxable} onChange={e => updateField("taxable", e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5" />
              Taxable
            </label>
            <div className="w-px h-4 bg-slate-200"></div>
            
            <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-900 cursor-pointer hover:opacity-70 transition-opacity">
              <input type="checkbox" checked={item.is_material === true} onChange={e => updateField("is_material", e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5" />
              Track Material
            </label>

            {item.is_material && (
              <>
                <div className="w-px h-4 bg-slate-200"></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Supplier:</span>
                  <input type="text" placeholder="Supplier Name..." value={localSupplier} onChange={e => { setLocalSupplier(e.target.value); updateField("supplier", e.target.value); }} className="h-7 text-[11px] font-bold border border-slate-300 rounded bg-amber-50/40 px-2 outline-none focus:border-amber-500 w-[140px]" />
                </div>
              </>
            )}

            <div className="w-px h-4 bg-slate-200"></div>

            <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-700 cursor-pointer hover:opacity-70 transition-opacity">
              <input type="checkbox" checked={item.is_optional === true} onChange={e => updateField("is_optional", e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5" />
              Optional
            </label>
            
            {item.is_optional && (
              <>
                <div className="w-px h-4 bg-slate-200"></div>
                <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 cursor-pointer hover:opacity-70 transition-opacity">
                  <input type="checkbox" checked={item.default_selected === true} onChange={e => updateField("default_selected", e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5" />
                  Pre-select
                </label>
              </>
            )}
          </div>
          
          <div className="flex gap-4 items-start">
            <div className="flex-1 space-y-3">
              {/* ⚡ Textareas feature resize-y for desktop AND auto-expanding on mobile */}
              <Textarea
               writingTools
               value={localDesc}
               onChange={e => { 
                 setLocalDesc(e.target.value); 
                 updateField("description", e.target.value); 
                 handleAutoResize(e); 
               }}
               placeholder="Description (shown to client on quote)..."
               className="text-sm bg-white border-slate-200 text-slate-900 min-h-[60px] shadow-sm font-medium overflow-hidden resize-y"
              />
              <Textarea
               writingTools
               value={localNotes}
               onChange={e => { 
                 setLocalNotes(e.target.value); 
                 updateField("internal_notes", e.target.value); 
                 handleAutoResize(e); 
               }}
               placeholder="Internal notes (hidden from client)..."
               className="text-xs bg-amber-50/50 border-amber-200 text-slate-700 min-h-[40px] placeholder:text-amber-500/60 font-medium overflow-hidden resize-y"
              />
            </div>
            
            <div className="flex flex-col items-center gap-1.5 shrink-0 pt-1">
              {item.photo_url ? (
                <div className="relative group">
                  <img src={item.photo_url} alt={item.name} className="h-28 w-28 object-cover rounded-xl border border-slate-200 shadow-md bg-white" />
                  <button onClick={() => updateField("photo_url", "")} className="absolute -top-2 -right-2 bg-slate-900 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center text-sm font-black opacity-0 group-hover:opacity-100 transition-all shadow-lg">×</button>
                </div>
              ) : (
                <label className="h-28 w-28 border-2 border-dashed border-slate-300 bg-white rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors shadow-sm">
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPhotoUpload(phaseIdx, itemIdx, e.target.files[0])} />
                  <ImageIcon className="h-6 w-6 text-slate-300 mb-1.5" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Photo</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
