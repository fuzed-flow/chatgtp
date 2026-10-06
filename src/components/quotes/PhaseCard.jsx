import React, { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Image as ImageIcon, Copy, ChevronUp, ChevronDown, ListFilter, GripVertical, ChevronRight } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import LineItemRow from "./LineItemRow";
import { Badge } from "@/components/ui/badge"; // Ensure Badge is imported if used

export default function PhaseCard({ 
  phase, 
  phaseIdx, 
  phases,
  products,
  onUpdatePhase,
  onRemovePhase,
  onDuplicatePhase,
  onAddLineItem,
  onUpdateLineItem,
  onDuplicateLineItem,
  onMoveLineItem,
  onReorderLineItems,
  onRemoveLineItem,
  onPhotoUpload,
  onLineItemPhotoUpload,
  calculatePhaseSubtotal,
  calculatePhaseCost,
  calculatePhaseMargin,
  calculatePhaseMarginPercent,
  calculatePhaseTax,
  calculatePhaseTotal,
  clientSelections,
  dragHandleProps,
  onMovePhaseUp,
  onMovePhaseDown,
  isFirst,
  isLast
}) {
  const [localPhaseName, setLocalPhaseName] = useState(phase.phase_name);
  const [localScope, setLocalScope] = useState(phase.scope_of_work || "");
  const [localNotes, setLocalNotes] = useState(phase.internal_notes || "");
  const [showOptions, setShowOptions] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false); // New state for collapse functionality

  const phaseIdRef = useRef(phase.id ?? phase.sort_order);
  useEffect(() => {
    const currentId = phase.id ?? phase.sort_order;
    if (phaseIdRef.current !== currentId) {
      phaseIdRef.current = currentId;
      setLocalPhaseName(phase.phase_name);
      setLocalScope(phase.scope_of_work || "");
      setLocalNotes(phase.internal_notes || "");
    }
  });

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    onReorderLineItems(phaseIdx, result.source.index, result.destination.index);
  };
  
  const isPhaseModified = clientSelections && phase.is_optional && phase.id ? (() => {
    const clientSelected = clientSelections[phase.id] !== false;
    return clientSelected !== (phase.default_selected === true);
  })() : false;
  
  return (
    <Card className={`bg-slate-50/50 border shadow-sm relative overflow-hidden transition-colors ${isPhaseModified ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}>
      
      {/* HEADER BAR */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border-b ${isPhaseModified ? 'bg-red-100/50 border-red-200' : 'bg-white border-slate-200'}`}>
        
        <div className="flex items-center gap-2">
          {/* Mobile Collapse Toggle */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)} 
            className="p-1.5 hover:bg-slate-100 rounded-md transition-colors sm:hidden shrink-0" 
            title="Toggle Collapse"
          >
            {isCollapsed ? <ChevronRight className="h-5 w-5 text-slate-500" /> : <ChevronDown className="h-5 w-5 text-slate-500" />}
          </button>

          {/* Reorder Arrows */}
          <div className="flex flex-col gap-0.5 shrink-0 bg-slate-100 rounded p-0.5 border border-slate-200">
            <button onClick={onMovePhaseUp} disabled={isFirst} className="p-0.5 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent" title="Move Up">
              <ChevronUp className="h-3 w-3 text-slate-500" />
            </button>
            <button onClick={onMovePhaseDown} disabled={isLast} className="p-0.5 hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent" title="Move Down">
              <ChevronDown className="h-3 w-3 text-slate-500" />
            </button>
          </div>
          
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-100 shrink-0 hidden md:block">
            <GripVertical className="h-4 w-4 text-slate-400" />
          </div>

          <div className="relative">
            <Input
              value={localPhaseName}
              onChange={e => { setLocalPhaseName(e.target.value); onUpdatePhase(phaseIdx, "phase_name", e.target.value); }}
              className={`text-base font-black w-[200px] sm:w-[350px] border-transparent hover:border-slate-300 focus:border-amber-400 bg-transparent hover:bg-white focus:bg-white shadow-none focus:shadow-sm px-2 ${isPhaseModified ? 'text-red-900' : 'text-slate-900'}`}
              placeholder="Phase Name (e.g. Demolition)"
            />
          </div>
          
          {isPhaseModified && (
            <Badge variant="outline" className="bg-red-600 text-white font-black uppercase text-[9px] tracking-wider shrink-0 border-0 shadow-sm ml-2">
              Client Modified
            </Badge>
          )}
        </div>

        {/* Phase Actions */}
        <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-md border border-slate-200 shadow-sm shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setShowOptions(!showOptions)} className={`h-7 text-xs font-bold px-2 ${showOptions ? 'bg-amber-100 text-amber-700' : 'text-slate-600 hover:text-slate-900 hover:bg-white'}`}>
            <ListFilter className="h-3.5 w-3.5 mr-1.5" /> Settings
          </Button>
          
          {/* Desktop Collapse Toggle */}
          <div className="w-px h-4 bg-slate-300 mx-1 hidden sm:block"></div>
          <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(!isCollapsed)} className="hidden sm:flex h-7 text-xs font-bold px-2 text-slate-600 hover:text-slate-900 hover:bg-white">
            {isCollapsed ? "Expand" : "Collapse"}
          </Button>

          <div className="w-px h-4 bg-slate-300 mx-1"></div>
          <Button variant="ghost" size="icon" onClick={() => onDuplicatePhase(phaseIdx)} className="h-7 w-7 text-slate-500 hover:text-blue-600 hover:bg-blue-50" title="Duplicate Phase">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onRemovePhase(phaseIdx)} className="h-7 w-7 text-slate-500 hover:text-red-600 hover:bg-red-50" title="Delete Phase">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* COLLAPSIBLE CONTENT WRAPPER */}
      {!isCollapsed && (
        <>
          {/* PHASE SETTINGS TRAY */}
          {showOptions && (
            <div className="bg-amber-50/50 border-b border-amber-100 p-3 flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative inline-block w-8 h-4">
                  <input type="checkbox" checked={phase.show_scope_to_client !== false} onChange={e => onUpdatePhase(phaseIdx, "show_scope_to_client", e.target.checked)} className="peer sr-only" />
                  <div className="w-8 h-4 bg-slate-300 rounded-full peer-checked:bg-amber-500 transition-colors"></div>
                  <div className="absolute left-1 top-0.5 bg-white w-3 h-3 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
                <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors uppercase tracking-wider">Show Scope on Quote</span>
              </label>
              
              <div className="w-px h-4 bg-amber-200 hidden sm:block"></div>

              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative inline-block w-8 h-4">
                  <input type="checkbox" checked={phase.is_optional === true} onChange={e => onUpdatePhase(phaseIdx, "is_optional", e.target.checked)} className="peer sr-only" />
                  <div className="w-8 h-4 bg-slate-300 rounded-full peer-checked:bg-blue-500 transition-colors"></div>
                  <div className="absolute left-1 top-0.5 bg-white w-3 h-3 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
                <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors uppercase tracking-wider">Optional Phase</span>
              </label>

              {phase.is_optional && (
                <>
                  <div className="w-px h-4 bg-amber-200 hidden sm:block"></div>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative inline-block w-8 h-4">
                      <input type="checkbox" checked={phase.default_selected === true} onChange={e => onUpdatePhase(phaseIdx, "default_selected", e.target.checked)} className="peer sr-only" />
                      <div className="w-8 h-4 bg-slate-300 rounded-full peer-checked:bg-emerald-500 transition-colors"></div>
                      <div className="absolute left-1 top-0.5 bg-white w-3 h-3 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                    </div>
                    <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors uppercase tracking-wider">Pre-selected</span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* PHASE BODY */}
          <div className="p-3 sm:p-5">
            {/* SCOPE & NOTES */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Scope of Work (Client-Facing)</Label>
                <Textarea
                  writingTools
                  rewriteField="general_business_text"
                  value={localScope}
                  onChange={e => { setLocalScope(e.target.value); onUpdatePhase(phaseIdx, "scope_of_work", e.target.value); }}
                  rows={2}
                  maxLength={10000}
                  className="bg-white border-slate-200 shadow-sm resize-y font-medium text-sm"
                  placeholder="Describe work for this phase..."
                />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-2">
                  Internal Notes <span className="text-[8px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Hidden</span>
                </Label>
                <Textarea
                  writingTools
                  rewriteField="general_business_text"
                  value={localNotes}
                  onChange={e => { setLocalNotes(e.target.value); onUpdatePhase(phaseIdx, "internal_notes", e.target.value); }}
                  rows={2}
                  maxLength={10000}
                  placeholder="Private considerations, reminders..."
                  className="bg-amber-50/50 border-amber-200 text-slate-700 placeholder:text-amber-400 resize-y font-medium text-sm shadow-sm"
                />
              </div>
            </div>

            {/* PHOTOS */}
            <div className="mb-5">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2 block">Phase Inspiration / Photos</Label>
              <div className="flex flex-wrap gap-2">
                {phase.photos?.map((photo, photoIdx) => (
                  <div key={photo} className="relative group">
                    <img src={photo} alt="" className="h-16 w-16 object-cover rounded-lg border border-slate-200 shadow-sm bg-white" />
                    <button
                      onClick={() => {
                        const updated = { ...phase, photos: phase.photos.filter((_, i) => i !== photoIdx) };
                        onUpdatePhase(phaseIdx, "photos", updated.photos);
                      }}
                      className="absolute -top-1.5 -right-1.5 bg-slate-900 hover:bg-red-600 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all shadow-md"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <label className="h-16 w-16 border-2 border-dashed border-slate-300 bg-white rounded-lg flex items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors shadow-sm">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onPhotoUpload(phaseIdx, e.target.files);
                      }
                    }}
                  />
                  <ImageIcon className="h-5 w-5 text-slate-300" />
                </label>
              </div>
            </div>

            {/* LINE ITEMS */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3 pb-2 border-b border-slate-200">
                <div>
                  <Label className="text-[11px] font-black uppercase tracking-wider text-slate-900 mb-0.5 block">Line Items ({phase.items?.length || 0})</Label>
                  <p className="text-[10px] font-bold text-slate-400">Detailed breakdown of materials and labor.</p>
                </div>
                
                <div className="flex items-center gap-2">
                  <Select onValueChange={v => { 
                    const p = products.find(pr => pr.id === v); 
                    if (p) onAddLineItem(phaseIdx, p); 
                  }}>
                    <SelectTrigger className="w-[140px] text-xs font-bold h-8 bg-white border-slate-300 shadow-sm">
                      <SelectValue placeholder="Pricebook..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.id} className="font-bold text-xs">{p.name} - ${p.price}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center bg-white rounded-md border border-slate-300 shadow-sm">
                    <Button variant="ghost" size="sm" onClick={() => onAddLineItem(phaseIdx)} className="h-8 text-xs font-black px-2.5 hover:bg-amber-50 hover:text-amber-700">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add 1
                    </Button>
                    <div className="w-px h-4 bg-slate-200"></div>
                    <Button variant="ghost" size="sm" onClick={() => { for (let i = 0; i < 5; i++) onAddLineItem(phaseIdx); }} className="h-8 text-xs font-black px-2.5 hover:bg-amber-50 hover:text-amber-700">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add 5
                    </Button>
                  </div>
                </div>
              </div>

              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId={`phase-${phaseIdx}`}>
                  {(provided) => (
                    <div className="space-y-3" ref={provided.innerRef} {...provided.droppableProps}>
                      {phase.items?.length === 0 && (
                        <div className="text-center py-8 bg-white rounded-lg border-2 border-dashed border-slate-200">
                          <p className="text-sm font-bold text-slate-400 mb-3">No line items in this phase yet.</p>
                          <Button variant="outline" size="sm" onClick={() => onAddLineItem(phaseIdx)} className="bg-white font-black shadow-sm">
                            <Plus className="h-4 w-4 mr-1.5" /> Create First Line Item
                          </Button>
                        </div>
                      )}
                      {phase.items?.map((item, itemIdx) => (
                        <Draggable key={item.id || `item-${itemIdx}`} draggableId={item.id || `item-${phaseIdx}-${itemIdx}`} index={itemIdx}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={snapshot.isDragging ? "opacity-90 shadow-2xl ring-2 ring-amber-400 rounded-lg scale-[1.02] transition-transform" : ""}
                            >
                              <LineItemRow
                                item={item}
                                itemIdx={itemIdx}
                                phaseIdx={phaseIdx}
                                phases={phases}
                                onUpdate={onUpdateLineItem}
                                onDuplicate={onDuplicateLineItem}
                                onMove={onMoveLineItem}
                                onRemove={onRemoveLineItem}
                                onPhotoUpload={onLineItemPhotoUpload}
                                clientSelections={clientSelections}
                                dragHandleProps={provided.dragHandleProps}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              
              {phase.items?.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => onAddLineItem(phaseIdx)} 
                  className="w-full mt-3 bg-white border-2 border-dashed border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-500 font-bold"
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Quick Add Row
                </Button>
              )}
            </div>
          </div>

          {/* FOOTER TOTALS */}
          <div className="bg-slate-100 p-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-end gap-4 rounded-b-lg">
            <div className="w-full sm:w-auto"></div>
            <div className="space-y-1 text-right min-w-[220px] bg-white p-3 rounded-lg border border-slate-200 shadow-sm w-full sm:w-auto">
              <div className="text-xs font-bold flex justify-between">
                <span className="text-slate-500">Subtotal:</span> 
                <span className="text-slate-900 ml-4">${calculatePhaseSubtotal(phase).toFixed(2)}</span>
              </div>
              <div className="text-[11px] font-black flex justify-between text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mt-1">
                <span>Margin:</span> 
                <span className="ml-4">${calculatePhaseMargin(phase).toFixed(2)} ({calculatePhaseMarginPercent(phase).toFixed(1)}%)</span>
              </div>
              <div className="text-xs font-bold flex justify-between mt-1">
                <span className="text-slate-500">Tax:</span> 
                <span className="text-slate-900 ml-4">${calculatePhaseTax(phase).toFixed(2)}</span>
              </div>
              <div className="text-sm font-black flex justify-between text-slate-900 pt-2 border-t border-slate-200 mt-2">
                <span className="uppercase tracking-wider">Phase Total:</span>
                <span>${calculatePhaseTotal(phase).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
