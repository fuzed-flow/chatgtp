import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Images, Save, SkipForward, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFICIENCY_STATUSES,
  DEFICIENCY_TYPES,
  MAX_DEFICIENCY_PHOTOS,
  deficiencyPhotoUrls,
  isDeficiencyPhotoFile,
} from "@/lib/projectCloseouts";

const blank = () => ({ deficiency_type: "General", description: "", assigned_vendor_id: "", due_date: "", status: "Open" });

export default function DeficiencyItemDialog({ open, onOpenChange, mode = "guided", item, vendors = [], saving, onSave }) {
  const [form, setForm] = useState(blank);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState([]);
  const [newPhotos, setNewPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const cameraInputRef = useRef(null);
  const libraryInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());
  const isQuick = mode === "quick" && !item;
  const photoCount = existingPhotoUrls.length + newPhotos.length;

  const revokeNewPreviews = useCallback(() => {
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!open) {
      revokeNewPreviews();
      return;
    }
    revokeNewPreviews();
    setForm(item ? {
      deficiency_type: item.deficiency_type || "General",
      description: item.description || "",
      assigned_vendor_id: item.assigned_vendor_id || "",
      due_date: item.due_date || "",
      status: item.status || "Open",
    } : blank());
    setExistingPhotoUrls(deficiencyPhotoUrls(item));
    setNewPhotos([]);
    setPhotoError("");
  }, [open, item, revokeNewPreviews]);

  useEffect(() => () => revokeNewPreviews(), [revokeNewPreviews]);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const chooseFiles = event => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;

    const available = MAX_DEFICIENCY_PHOTOS - photoCount;
    const valid = selected.filter(file => isDeficiencyPhotoFile(file) && file.size <= 25 * 1024 * 1024);
    const accepted = valid.slice(0, Math.max(available, 0));
    if (valid.length !== selected.length) {
      setPhotoError("Each selection must be an image smaller than 25 MB.");
    } else if (selected.length > available) {
      setPhotoError(`A deficiency can include up to ${MAX_DEFICIENCY_PHOTOS} photos.`);
    } else {
      setPhotoError("");
    }
    if (!accepted.length) return;

    const additions = accepted.map(file => {
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.add(preview);
      return { id: crypto.randomUUID?.() || `${Date.now()}-${file.name}-${file.size}`, file, preview };
    });
    setNewPhotos(current => [...current, ...additions]);
  };
  const removeExistingPhoto = url => setExistingPhotoUrls(current => current.filter(value => value !== url));
  const removeNewPhoto = id => {
    setNewPhotos(current => current.filter(photo => {
      if (photo.id !== id) return true;
      URL.revokeObjectURL(photo.preview);
      previewUrlsRef.current.delete(photo.preview);
      return false;
    }));
  };
  const submit = async (event, keepOpen) => {
    event.preventDefault();
    if (!photoCount) {
      setPhotoError("Add at least one photo before saving this deficiency.");
      return;
    }
    const saved = await onSave({
      ...form,
      files: newPhotos.map(photo => photo.file),
      retainedPhotoUrls: existingPhotoUrls,
      keepOpen,
    });
    if (saved && keepOpen) {
      revokeNewPreviews();
      setForm(blank());
      setExistingPhotoUrls([]);
      setNewPhotos([]);
      setPhotoError("");
      window.setTimeout(() => cameraInputRef.current?.click(), 180);
    }
  };

  const photos = [
    ...existingPhotoUrls.map(url => ({ id: url, preview: url, existing: true })),
    ...newPhotos.map(photo => ({ ...photo, existing: false })),
  ];

  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent closeButtonClassName="hidden" className="h-[100dvh] max-h-none w-screen max-w-none overflow-y-auto rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-2xl sm:rounded-lg sm:border">
        <div className="sticky top-0 z-20 flex items-start justify-between border-b border-slate-200 bg-white px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:static sm:px-6 sm:pt-6">
          <DialogHeader className="pr-4 text-left"><DialogTitle className="text-xl font-black">{item ? "Edit deficiency" : isQuick ? "Quick photo capture" : "Add deficiency"}</DialogTitle><DialogDescription>{isQuick ? "Take or select the photos now. Trade, description, and due date can be completed in the office." : "Add one or more photos and the details, then save and continue to the next deficiency."}</DialogDescription></DialogHeader>
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"><X className="h-5 w-5" /></button>
        </div>
        <form className="space-y-5 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6" onSubmit={event => submit(event, false)}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3"><Label>Deficiency photos</Label><span className="text-xs font-semibold text-slate-500">{photoCount} of {MAX_DEFICIENCY_PHOTOS}</span></div>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" aria-label="Take a deficiency photo" onChange={chooseFiles} className="sr-only" />
            <input ref={libraryInputRef} type="file" accept="image/*" multiple aria-label="Choose deficiency photos from device" onChange={chooseFiles} className="sr-only" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={saving || photoCount >= MAX_DEFICIENCY_PHOTOS} onClick={() => cameraInputRef.current?.click()} className="min-h-12 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"><Camera className="mr-2 h-5 w-5" />Take photo</Button>
              <Button type="button" variant="outline" disabled={saving || photoCount >= MAX_DEFICIENCY_PHOTOS} onClick={() => libraryInputRef.current?.click()} className="min-h-12"><Images className="mr-2 h-5 w-5" />Choose from device</Button>
            </div>
            {photos.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    <img src={photo.preview} alt={`Deficiency photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                    {index === 0 && <span className="absolute left-2 top-2 rounded-full bg-slate-950/90 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">Primary</span>}
                    <button type="button" disabled={saving} onClick={() => photo.existing ? removeExistingPhoto(photo.preview) : removeNewPhoto(photo.id)} aria-label={`Remove deficiency photo ${index + 1}`} className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-red-600 shadow-md hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            ) : (
              <button type="button" disabled={saving} onClick={() => cameraInputRef.current?.click()} className="flex min-h-44 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-900 transition hover:bg-amber-100"><Camera className="mb-3 h-10 w-10" /><span className="font-black">Add the first photo</span><span className="mt-1 text-xs">Take a new photo or choose one from your device above</span></button>
            )}
            {photoError && <p role="alert" className="text-sm font-semibold text-red-700">{photoError}</p>}
            <p className="text-xs leading-5 text-slate-500">The first photo is used as the cover image. You can add up to {MAX_DEFICIENCY_PHOTOS} photos to show different angles or details.</p>
          </div>
          {!isQuick && <>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deficiency-type">Deficiency type</Label><select id="deficiency-type" value={form.deficiency_type} disabled={saving} onChange={event => update("deficiency_type", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{DEFICIENCY_TYPES.map(type => <option key={type}>{type}</option>)}</select></div><div className="space-y-2"><Label htmlFor="deficiency-status">Status</Label><select id="deficiency-status" value={form.status} disabled={saving} onChange={event => update("status", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{DEFICIENCY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></div></div>
            <div className="space-y-2"><Label htmlFor="deficiency-description">Description</Label><Textarea id="deficiency-description" value={form.description} disabled={saving} onChange={event => update("description", event.target.value)} rows={5} placeholder="Describe what needs to be corrected and the expected finish…" className="min-h-32 resize-y" /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deficiency-vendor">Assign subcontractor</Label><select id="deficiency-vendor" value={form.assigned_vendor_id} disabled={saving} onChange={event => update("assigned_vendor_id", event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">Unassigned</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.category ? ` · ${vendor.category}` : ""}</option>)}</select></div><div className="space-y-2"><Label htmlFor="deficiency-due">Due date <span className="font-normal text-slate-400">(optional)</span></Label><Input id="deficiency-due" type="date" value={form.due_date} disabled={saving} onChange={event => update("due_date", event.target.value)} /></div></div>
          </>}
          <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:p-0">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Finish walkthrough</Button>
            <Button type="submit" variant="outline" disabled={saving || !photoCount}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save item"}</Button>
            {!item && <Button type="button" disabled={saving || !photoCount} onClick={event => submit(event, true)} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><SkipForward className="mr-2 h-4 w-4" />{saving ? "Saving…" : isQuick ? "Save photos & next" : "Save & next"}</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
