import React, { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Save, SkipForward, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFICIENCY_STATUSES, DEFICIENCY_TYPES } from "@/lib/projectCloseouts";

const blank = () => ({ file: null, deficiency_type: "General", description: "", assigned_vendor_id: "", due_date: "", status: "Open" });

export default function DeficiencyItemDialog({ open, onOpenChange, mode = "guided", item, vendors = [], saving, onSave }) {
  const [form, setForm] = useState(blank);
  const [preview, setPreview] = useState("");
  const inputRef = useRef(null);
  const isQuick = mode === "quick" && !item;

  useEffect(() => {
    if (!open) return;
    setForm(item ? {
      file: null, deficiency_type: item.deficiency_type || "General", description: item.description || "",
      assigned_vendor_id: item.assigned_vendor_id || "", due_date: item.due_date || "", status: item.status || "Open",
    } : blank());
    setPreview(item?.photo_url || "");
  }, [open, item]);

  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const chooseFile = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    update("file", file);
    setPreview(URL.createObjectURL(file));
  };
  const submit = async (event, keepOpen) => {
    event.preventDefault();
    if (!form.file && !item?.photo_url) return;
    const saved = await onSave({ ...form, keepOpen });
    if (saved && keepOpen) {
      setForm(blank()); setPreview("");
      if (inputRef.current) inputRef.current.value = "";
      window.setTimeout(() => inputRef.current?.click(), 180);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent closeButtonClassName="hidden" className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-2xl sm:rounded-lg sm:border">
        <div className="sticky top-0 z-20 flex items-start justify-between border-b border-slate-200 bg-white px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:static sm:px-6 sm:pt-6">
          <DialogHeader className="pr-4 text-left"><DialogTitle className="text-xl font-black">{item ? "Edit deficiency" : isQuick ? "Quick photo capture" : "Add deficiency"}</DialogTitle><DialogDescription>{isQuick ? "Take the photo now. Trade, description, and due date can be completed in the office." : "Record the photo and details, then save and continue to the next deficiency."}</DialogDescription></DialogHeader>
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"><X className="h-5 w-5" /></button>
        </div>
        <form className="space-y-5 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6" onSubmit={event => submit(event, false)}>
          <div className="space-y-3"><Label>Deficiency photo</Label><input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={chooseFile} className="sr-only" />{preview ? <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"><img src={preview} alt="Deficiency preview" className="aspect-[4/3] w-full object-cover" /><Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => inputRef.current?.click()} className="absolute bottom-3 right-3 shadow-lg"><ImagePlus className="mr-2 h-4 w-4" />Replace photo</Button></div> : <button type="button" disabled={saving} onClick={() => inputRef.current?.click()} className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-900 transition hover:bg-amber-100"><Camera className="mb-3 h-10 w-10" /><span className="font-black">Take or choose photo</span><span className="mt-1 text-xs">Camera opens automatically on supported phones</span></button>}</div>
          {!isQuick && <>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deficiency-type">Deficiency type</Label><select id="deficiency-type" value={form.deficiency_type} disabled={saving} onChange={event => update("deficiency_type", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{DEFICIENCY_TYPES.map(type => <option key={type}>{type}</option>)}</select></div><div className="space-y-2"><Label htmlFor="deficiency-status">Status</Label><select id="deficiency-status" value={form.status} disabled={saving} onChange={event => update("status", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{DEFICIENCY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></div></div>
            <div className="space-y-2"><Label htmlFor="deficiency-description">Description</Label><Textarea id="deficiency-description" value={form.description} disabled={saving} onChange={event => update("description", event.target.value)} rows={5} placeholder="Describe what needs to be corrected and the expected finish…" className="min-h-32 resize-y" /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deficiency-vendor">Assign subcontractor</Label><select id="deficiency-vendor" value={form.assigned_vendor_id} disabled={saving} onChange={event => update("assigned_vendor_id", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">Unassigned</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.category ? ` · ${vendor.category}` : ""}</option>)}</select></div><div className="space-y-2"><Label htmlFor="deficiency-due">Due date <span className="font-normal text-slate-400">(optional)</span></Label><Input id="deficiency-due" type="date" value={form.due_date} disabled={saving} onChange={event => update("due_date", event.target.value)} /></div></div>
          </>}
          <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:p-0">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Finish walkthrough</Button>
            <Button type="submit" variant="outline" disabled={saving || (!form.file && !item?.photo_url)}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save item"}</Button>
            {!item && <Button type="button" disabled={saving || !form.file} onClick={event => submit(event, true)} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><SkipForward className="mr-2 h-4 w-4" />{saving ? "Saving…" : isQuick ? "Save photo & next" : "Save & next"}</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
