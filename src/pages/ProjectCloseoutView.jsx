import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Download, Edit3, Mail, MessageSquare, Plus, Send, Trash2, UsersRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import DeficiencyItemDialog from "@/components/closeouts/DeficiencyItemDialog";
import ProjectCloseoutDeliveryDialog from "@/components/closeouts/ProjectCloseoutDeliveryDialog";
import ProjectCloseoutPreview from "@/components/closeouts/ProjectCloseoutPreview";
import { generateProjectCloseoutPDF } from "@/components/pdf/PDFGenerator";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/AuthContext";
import { compressDeficiencyPhoto, storagePathFromPublicUrl } from "@/lib/projectCloseouts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function DetailsDialog({ open, onOpenChange, closeout, saving, onSave }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (open && closeout) { setTitle(closeout.title || ""); setDate(closeout.walkthrough_date || ""); setNotes(closeout.notes || ""); } }, [open, closeout]);
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}><DialogContent className="max-h-[92dvh] w-[96vw] overflow-y-auto pt-10 sm:max-w-lg sm:pt-6"><DialogHeader className="pr-8"><DialogTitle>Edit checklist details</DialogTitle><DialogDescription>Update the title, walkthrough date, or general notes.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave({ title: title.trim(), walkthrough_date: date, notes: notes.trim() }); }}><div className="space-y-2"><Label htmlFor="closeout-edit-title">Title</Label><Input id="closeout-edit-title" value={title} onChange={event => setTitle(event.target.value)} disabled={saving} required /></div><div className="space-y-2"><Label htmlFor="closeout-edit-date">Walkthrough date</Label><Input id="closeout-edit-date" type="date" value={date} onChange={event => setDate(event.target.value)} disabled={saving} required /></div><div className="space-y-2"><Label htmlFor="closeout-edit-notes">General notes</Label><Textarea id="closeout-edit-notes" value={notes} onChange={event => setNotes(event.target.value)} disabled={saving} rows={5} className="resize-y" /></div><div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || !title.trim() || !date} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600">{saving ? "Saving…" : "Save details"}</Button></div></form></DialogContent></Dialog>;
}

export default function ProjectCloseoutView() {
  const { profile, company } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const closeoutId = searchParams.get("id") || "";
  const initialMode = searchParams.get("mode");
  const companyId = profile?.company_id;
  const validId = UUID.test(closeoutId);
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [itemDialog, setItemDialog] = useState(null);
  const [delivery, setDelivery] = useState(null);

  const closeoutQuery = useQuery({
    queryKey: ["project-closeout", companyId, closeoutId], enabled: !!companyId && validId,
    queryFn: async () => {
      const { data: closeout, error } = await supabase.from("project_closeouts").select("*").eq("id", closeoutId).eq("company_id", companyId).maybeSingle();
      if (error) throw error;
      if (!closeout) throw new Error("This project closeout could not be found.");
      const [projectResult, clientResult, itemsResult, vendorsResult] = await Promise.all([
        supabase.from("projects").select("id,name,project_number,site_address,client_id").eq("id", closeout.project_id).eq("company_id", companyId).maybeSingle(),
        supabase.from("clients").select("id,name,email,phone,site_address").eq("id", closeout.client_id).eq("company_id", companyId).maybeSingle(),
        supabase.from("project_closeout_items").select("*").eq("closeout_id", closeout.id).eq("company_id", companyId).order("sort_order").order("created_at"),
        supabase.from("vendors").select("id,name,email,phone,category").eq("company_id", companyId).order("name"),
      ]);
      for (const result of [projectResult, clientResult, itemsResult, vendorsResult]) if (result.error) throw result.error;
      return { closeout, project: projectResult.data, client: clientResult.data, items: itemsResult.data || [], vendors: vendorsResult.data || [] };
    },
  });

  useEffect(() => {
    if (!closeoutQuery.data || !["quick", "guided"].includes(initialMode || "") || itemDialog) return;
    setItemDialog({ mode: initialMode, item: null });
    const next = new URLSearchParams(searchParams); next.delete("mode"); setSearchParams(next, { replace: true });
  }, [closeoutQuery.data, initialMode, itemDialog, searchParams, setSearchParams]);

  const content = closeoutQuery.data;
  const vendorById = useMemo(() => Object.fromEntries((content?.vendors || []).map(vendor => [vendor.id, vendor])), [content?.vendors]);
  const displayItems = useMemo(() => (content?.items || []).map((item, index) => ({ ...item, displayNumber: index + 1, vendor: vendorById[item.assigned_vendor_id] })), [content?.items, vendorById]);
  const blockingItems = useMemo(() => displayItems.filter(item => item.status !== "Complete"), [displayItems]);
  const canComplete = displayItems.length > 0 && blockingItems.length === 0;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project-closeout", companyId, closeoutId] });
    queryClient.invalidateQueries({ queryKey: ["project-closeouts", companyId] });
  };

  const detailsMutation = useMutation({
    mutationFn: async values => { const { error } = await supabase.from("project_closeouts").update(values).eq("id", closeoutId).eq("company_id", companyId); if (error) throw error; },
    onSuccess: () => { invalidate(); setDetailsOpen(false); toast.success("Closeout details updated."); },
    onError: error => toast.error(error.message || "Closeout details could not be updated."),
  });
  const itemMutation = useMutation({
    mutationFn: async payload => {
      const previous = itemDialog?.item;
      let photoUrl = previous?.photo_url || "";
      let uploadedPath = null;
      if (payload.file) {
        const photo = await compressDeficiencyPhoto(payload.file);
        uploadedPath = `${companyId}/${content.project.id}/${closeoutId}/${photo.name}`;
        const { error: uploadError } = await supabase.storage.from("project-closeouts").upload(uploadedPath, photo, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (uploadError) throw uploadError;
        photoUrl = supabase.storage.from("project-closeouts").getPublicUrl(uploadedPath).data.publicUrl;
      }
      const values = {
        photo_url: photoUrl, deficiency_type: payload.deficiency_type || "General", description: payload.description?.trim() || "",
        assigned_vendor_id: payload.assigned_vendor_id || null, due_date: payload.due_date || null, status: payload.status || "Open",
      };
      try {
        if (previous?.id) {
          const { error } = await supabase.from("project_closeout_items").update(values).eq("id", previous.id).eq("company_id", companyId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("project_closeout_items").insert({ ...values, company_id: companyId, project_id: content.project.id, closeout_id: closeoutId, sort_order: content.items.length, created_by: profile.id, updated_by: profile.id });
          if (error) throw error;
        }
      } catch (error) {
        if (uploadedPath) await supabase.storage.from("project-closeouts").remove([uploadedPath]);
        throw error;
      }
      if (previous?.photo_url && payload.file) {
        const oldPath = storagePathFromPublicUrl(previous.photo_url);
        if (oldPath) await supabase.storage.from("project-closeouts").remove([oldPath]);
      }
      return payload;
    },
    onSuccess: payload => { invalidate(); if (!payload.keepOpen) setItemDialog(null); toast.success(payload.keepOpen ? "Deficiency saved. Ready for the next photo." : "Deficiency saved."); },
    onError: error => toast.error(error.message || "The deficiency could not be saved."),
  });
  const statusMutation = useMutation({
    mutationFn: async status => { const { error } = await supabase.from("project_closeouts").update({ status }).eq("id", closeoutId).eq("company_id", companyId); if (error) throw error; return status; },
    onSuccess: status => { invalidate(); toast.success(status === "Published" ? "Closeout published to the Client Portal." : "Project closeout marked complete."); },
    onError: error => toast.error(error.message || "The closeout status could not be updated."),
  });

  const deleteItem = async item => {
    if (!window.confirm("Delete this deficiency and its photo? This cannot be undone.")) return;
    const { error } = await supabase.from("project_closeout_items").delete().eq("id", item.id).eq("company_id", companyId);
    if (error) return toast.error(error.message || "The deficiency could not be deleted.");
    const path = storagePathFromPublicUrl(item.photo_url); if (path) await supabase.storage.from("project-closeouts").remove([path]);
    invalidate(); toast.success("Deficiency deleted.");
  };

  const error = !validId ? new Error("This project closeout link is invalid.") : closeoutQuery.error;
  return (
    <div className="min-h-[100dvh] bg-slate-100 pt-[env(safe-area-inset-top)]">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur"><div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-3 py-2 sm:px-6"><Button variant="ghost" asChild className="min-h-11 px-2 sm:px-3"><Link to="/ProjectCloseouts"><ArrowLeft className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Back to </span>Closeouts</Link></Button>{content && <div className="flex items-center gap-2"><StatusBadge status={content.closeout.status} /><Button variant="outline" className="min-h-11 px-3" onClick={() => generateProjectCloseoutPDF(content.closeout, displayItems, content.project, content.client, company)}><Download className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Download PDF</span></Button></div>}</div></header>
      <main className="mx-auto w-full max-w-6xl space-y-5 px-3 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 sm:py-7">
        {closeoutQuery.isPending && validId && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading project closeout…</div>}
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6 text-red-800 shadow-sm"><h1 className="font-bold">Project closeout unavailable</h1><p className="mt-2 text-sm">{error.message}</p></div>}
        {content && <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Onsite walkthrough</p><h1 className="mt-1 text-2xl font-black text-slate-950">{content.closeout.title}</h1><p className="mt-1 text-sm font-semibold text-slate-600">{content.project?.project_number ? `${content.project.project_number} — ` : ""}{content.project?.name} · {content.client?.name}</p></div><div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><Button variant="outline" onClick={() => setDetailsOpen(true)}><Edit3 className="mr-2 h-4 w-4" />Details</Button><Button variant="outline" onClick={() => setItemDialog({ mode: "quick", item: null })}><Camera className="mr-2 h-4 w-4" />Quick photos</Button><Button onClick={() => setItemDialog({ mode: "guided", item: null })} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Plus className="mr-2 h-4 w-4" />Add deficiency</Button></div></div>
            <div className="mt-5 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-5">
              <Button variant="outline" disabled={!displayItems.length} onClick={() => setDelivery({ mode: "vendors" })}><UsersRound className="mr-2 h-4 w-4" />Send to trades</Button>
              <Button variant="outline" disabled={!content.client?.email || !displayItems.length} onClick={() => setDelivery({ mode: "email" })}><Mail className="mr-2 h-4 w-4" />Email client</Button>
              <Button variant="outline" disabled={!content.client?.phone || !displayItems.length} onClick={() => setDelivery({ mode: "sms" })}><MessageSquare className="mr-2 h-4 w-4" />Text client</Button>
              <Button variant="outline" disabled={!displayItems.length || content.closeout.status !== "Draft" || statusMutation.isPending} onClick={() => statusMutation.mutate("Published")}><Send className="mr-2 h-4 w-4" />Publish to portal</Button>
              <Button
                aria-describedby={blockingItems.length ? "closeout-completion-blockers" : undefined}
                disabled={!canComplete || content.closeout.status === "Completed" || statusMutation.isPending}
                onClick={() => statusMutation.mutate("Completed")}
                className="bg-emerald-600 font-bold hover:bg-emerald-700"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />Mark complete
              </Button>
            </div>
            {content.closeout.status !== "Completed" && blockingItems.length > 0 && (
              <div id="closeout-completion-blockers" role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-amber-950">{blockingItems.length} {blockingItems.length === 1 ? "deficiency is" : "deficiencies are"} blocking completion</p>
                    <p className="mt-1 text-sm leading-5 text-amber-900">Every deficiency must have a status of Complete. Select an item below to update it.</p>
                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                      {blockingItems.map(item => (
                        <button key={item.id} type="button" onClick={() => setItemDialog({ mode: "guided", item })} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left transition hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                          <span className="min-w-0"><span className="block text-sm font-bold text-slate-900">#{item.displayNumber} · {item.deficiency_type}</span><span className="block truncate text-xs text-slate-600">{item.description?.trim() || "Description still needed"}</span></span>
                          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">{item.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-lg font-black text-slate-950">Deficiencies ({displayItems.length})</h2></div>{displayItems.length === 0 ? <button type="button" onClick={() => setItemDialog({ mode: "guided", item: null })} className="flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-slate-600 hover:border-amber-400 hover:bg-amber-50"><ClipboardCheck className="mb-3 h-10 w-10 text-slate-300" /><strong>No deficiencies yet</strong><span className="mt-1 text-sm">Tap to add the first walkthrough item.</span></button> : displayItems.map((item, index) => <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid sm:grid-cols-[180px_1fr]"><img src={item.photo_url} alt={`Deficiency ${index + 1}`} className="aspect-[4/3] h-full w-full bg-slate-100 object-cover sm:aspect-auto" /><div className="p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">#{index + 1}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{item.deficiency_type}</span><span className="text-xs font-bold text-slate-500">{item.status}</span></div><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.description?.trim() || <span className="italic text-amber-700">Needs description</span>}</p><p className="mt-3 text-xs font-semibold text-slate-500">{item.vendor?.name ? `Assigned to ${item.vendor.name}` : "Needs subcontractor assignment"}{item.due_date ? ` · Due ${item.due_date}` : ""}</p><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={() => setItemDialog({ mode: "guided", item })}><Edit3 className="mr-1.5 h-4 w-4" />Edit</Button><Button size="sm" variant="ghost" onClick={() => deleteItem(item)} className="text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button></div></div></div></article>)}</div><aside className="lg:sticky lg:top-24 lg:self-start"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black text-slate-950">Walkthrough progress</h3><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-600">Total deficiencies</span><strong>{displayItems.length}</strong></div><div className="flex justify-between"><span className="text-slate-600">Complete</span><strong className="text-emerald-700">{displayItems.filter(item => item.status === "Complete").length}</strong></div><div className="flex justify-between"><span className="text-slate-600">Need descriptions</span><strong className="text-amber-700">{displayItems.filter(item => !item.description?.trim()).length}</strong></div><div className="flex justify-between"><span className="text-slate-600">Unassigned</span><strong className="text-amber-700">{displayItems.filter(item => !item.assigned_vendor_id).length}</strong></div></div><p className="mt-5 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">Quick capture is designed for the job site. Add photos continuously, then complete trade assignments and descriptions from the office.</p></div></aside></div>
          <div className="pt-4"><ProjectCloseoutPreview closeout={content.closeout} items={displayItems} project={content.project} client={content.client} company={company} /></div>
        </>}
      </main>
      {content && <><DetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} closeout={content.closeout} saving={detailsMutation.isPending} onSave={values => detailsMutation.mutate(values)} /><DeficiencyItemDialog open={!!itemDialog} onOpenChange={open => { if (!open) setItemDialog(null); }} mode={itemDialog?.mode} item={itemDialog?.item} vendors={content.vendors} saving={itemMutation.isPending} onSave={payload => itemMutation.mutateAsync(payload).then(() => true).catch(() => false)} /><ProjectCloseoutDeliveryDialog open={!!delivery} onOpenChange={open => { if (!open) setDelivery(null); }} mode={delivery?.mode} closeout={content.closeout} items={displayItems} project={content.project} client={content.client} vendors={content.vendors} company={company} onSent={invalidate} /></>}
    </div>
  );
}
