import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Upload, Trash2, FileImage, Download, Plus, ZoomIn, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const DRAWING_TYPES = ["Floor Plan", "Elevation", "Site Plan", "Electrical", "Plumbing", "Mechanical", "Structural", "Detail Drawing", "As-Built", "Other"];

const TYPE_COLORS = {
  "Floor Plan": "bg-blue-100 text-blue-700 border-blue-200",
  "Elevation": "bg-purple-100 text-purple-700 border-purple-200",
  "Site Plan": "bg-green-100 text-green-700 border-green-200",
  "Electrical": "bg-yellow-100 text-yellow-700 border-yellow-200",
  "Plumbing": "bg-cyan-100 text-cyan-700 border-cyan-200",
  "Mechanical": "bg-orange-100 text-orange-700 border-orange-200",
  "Structural": "bg-red-100 text-red-700 border-red-200",
  "Detail Drawing": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "As-Built": "bg-slate-100 text-slate-700 border-slate-200",
  "Other": "bg-gray-100 text-gray-700 border-gray-200",
};

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];

function isImage(fileName) {
  if (!fileName) return false;
  const ext = fileName.split(".").pop()?.toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

export default function PMPlansElevationsTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [form, setForm] = useState({ drawing_type: "Floor Plan", title: "", revision: "", notes: "", file_url: "", file_name: "" });

  // --- SUPABASE QUERIES ---
  const { data: docs = [] } = useQuery({
    queryKey: ["project_drawings", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_drawings")
        .select("*")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // --- SUPABASE MUTATIONS ---
  const createDoc = useMutation({
    mutationFn: async (d) => {
      const payload = { ...d, company_id: companyId, project_id: project.id };
      const { error } = await supabase.from("project_drawings").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project_drawings", project.id] }); 
      setAddOpen(false); 
      resetForm(); 
      toast.success("Plan saved successfully");
    },
    onError: (err) => {
      console.error(err);
      toast.error("Failed to save plan record");
    }
  });

  const deleteDoc = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_drawings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project_drawings", project.id] }); 
      toast.success("Plan removed");
    },
    onError: (err) => {
      console.error(err);
      toast.error("Failed to delete plan");
    }
  });

  const resetForm = () => setForm({ drawing_type: "Floor Plan", title: "", revision: "", notes: "", file_url: "", file_name: "" });

  // NATIVE SUPABASE FILE STORAGE HANDLER
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${project.id}/${Date.now()}_${safeName}`;

      const { data, error } = await supabase.storage
        .from('project_drawings')
        .upload(filePath, file);

      if (error) throw error;

      const { data: publicData } = supabase.storage
        .from('project_drawings')
        .getPublicUrl(filePath);

      setForm(f => ({ ...f, file_url: publicData.publicUrl, file_name: file.name, title: f.title || file.name }));
      toast.success("File loaded successfully!");
    } catch (err) {
      alert(`File Storage Upload Error: ${err.message || "Failed to process asset."}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSave = async () => {
    if (!form.file_url) {
      alert("Please upload a plan or elevation file first.");
      return;
    }
    
    try {
      // Use mutateAsync so we can catch the exact error if it fails
      await createDoc.mutateAsync(form);
    } catch (err) {
      alert(`Database Save Error: ${err.message || "Unknown error occurred"}`);
    }
  };;

  // FORCED DIRECT LOCAL FILE BLOB DOWNLOAD
  const triggerFileDownload = async (url, filename) => {
    toast.loading("Downloading file...");
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || "plan_sheet";
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.dismiss();
    } catch (err) {
      toast.dismiss();
      window.open(url, "_blank");
    }
  };

  // Group by drawing type enum keys
  const grouped = DRAWING_TYPES.reduce((acc, t) => {
    const items = docs.filter(d => d.drawing_type === t);
    if (items.length) acc[t] = items;
    return acc;
  }, {});
  
  const ungrouped = docs.filter(d => !DRAWING_TYPES.includes(d.drawing_type));
  if (ungrouped.length) grouped["Other"] = [...(grouped["Other"] || []), ...ungrouped];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="font-semibold text-slate-800 text-lg">Plans & Elevations</h2>
          <p className="text-xs text-slate-500 mt-0.5">{docs.length} file{docs.length !== 1 ? "s" : ""} uploaded</p>
        </div>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white shrink-0" onClick={() => { resetForm(); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Upload Plan / Elevation
        </Button>
      </div>

      {/* Empty State Presentation */}
      {docs.length === 0 && (
        <div className="text-center bg-white border border-slate-200 border-dashed rounded-xl py-16 shadow-sm">
          <FileImage className="h-12 w-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-700">No plans or elevations cataloged yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">Upload structural plans, elevations, schematic electrical sheets, or site surveys to sync your site crews.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { resetForm(); setAddOpen(true); }}>Upload First File</Button>
        </div>
      )}

      {/* Folders Loop Grid */}
      <div className="space-y-8">
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${TYPE_COLORS[type] || TYPE_COLORS["Other"]}`}>{type}</span>
              <span className="text-slate-500 font-medium">{items.length} file{items.length !== 1 ? "s" : ""}</span>
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map(doc => {
                const img = isImage(doc.file_name);
                return (
                  <div key={doc.id} className="group relative bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-amber-400 hover:shadow-md transition-all flex flex-col">
                    
                    {/* Media Thumbnail Container */}
                    <div
                      className="h-36 bg-slate-50 border-b border-slate-100 flex items-center justify-center cursor-pointer relative overflow-hidden shrink-0"
                      onClick={() => img ? setLightbox(doc) : window.open(doc.file_url, "_blank")}
                    >
                      {img ? (
                        <img src={doc.file_url} alt={doc.file_name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102" />
                      ) : (
                        <div className="flex flex-col items-center text-slate-400 p-4 text-center">
                          <FileImage className="h-10 w-10 mb-1 text-slate-300" />
                          <span className="text-[9px] uppercase font-black tracking-wider bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{doc.file_name?.split(".").pop()}</span>
                        </div>
                      )}
                      
                      {/* Hover Overlay Visual Feedback */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all" />
                      </div>
                    </div>

                    {/* Meta Card Description Area */}
                    <div className="p-3 flex-1 flex flex-col justify-between bg-white min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate" title={doc.title || doc.file_name}>
                          {doc.title || doc.file_name}
                        </p>
                        {doc.revision && (
                          <p className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded border border-amber-200/40 px-1.5 py-0.5 inline-block mt-1">
                            Rev: {doc.revision}
                          </p>
                        )}
                      </div>
                      {doc.notes && <p className="text-xs text-slate-500 mt-2 line-clamp-2 italic">"{doc.notes}"</p>}
                    </div>

                    {/* Floating Side-by-Side Action Bar: Open, Download, Delete */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
                      {/* BUTTON 1: OPEN IN NEW TAB */}
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <button className="h-7 w-7 bg-white/95 rounded-md flex items-center justify-center shadow-sm border border-amber-200 hover:border-amber-300 hover:bg-amber-50 text-amber-600 hover:text-amber-700" title="Open sheet in new browser tab">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </a>

                      {/* BUTTON 2: FORCED DOWNLOAD BLOB */}
                      <button 
                        className="h-7 w-7 bg-white/95 rounded-md flex items-center justify-center shadow-sm border border-slate-200 hover:bg-white text-slate-600" 
                        title="Download file to device"
                        onClick={() => triggerFileDownload(doc.file_url, doc.file_name)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>

                      {/* BUTTON 3: DELETE SHEET ENTRY */}
                      <button 
                        className="h-7 w-7 bg-white/95 rounded-md flex items-center justify-center shadow-sm border border-slate-200 hover:bg-white text-red-500 hover:border-red-200" 
                        title="Delete file from server"
                        onClick={() => { if(window.confirm("Permanently delete this file?")) deleteDoc.mutate(doc.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox Immersive Preview Screen */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all" onClick={() => setLightbox(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightbox.file_url} alt={lightbox.file_name} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-white/10" onClick={e => e.stopPropagation()} />
          <div className="mt-4 text-white text-sm font-semibold bg-slate-900/80 border border-slate-700/50 px-5 py-2.5 rounded-full tracking-wide shadow-xl max-w-md truncate">
            {lightbox.title || lightbox.file_name} {lightbox.revision ? `(Rev: ${lightbox.revision})` : ""}
          </div>
        </div>
      )}

      {/* Upload Dialogue Sliding Drawer */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader><DialogTitle>Upload Plan / Elevation</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Category</Label>
              <Select value={form.drawing_type} onValueChange={v => setForm({...form, drawing_type: v})}>
                <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{DRAWING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Title / Description *</Label>
                <Input className="mt-1 bg-white" placeholder="e.g. Main Floor Plan" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              </div>
              <div>
                <Label>Revision / Version</Label>
                <Input className="mt-1 bg-white" placeholder="e.g. Rev A, IFC v2" value={form.revision} onChange={e => setForm({...form, revision: e.target.value})} />
              </div>
            </div>

            <div>
              <Label>Scope / Content Notes</Label>
              <Input className="mt-1 bg-white" placeholder="Add clarifications or scaling notices..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>

            <div>
              <Label>Plan / Elevation File *</Label>
              <div className="mt-1">
                {form.file_url ? (
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 shadow-sm">
                    <FileImage className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span className="truncate flex-1 font-semibold">{form.file_name}</span>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-emerald-700 hover:bg-emerald-100 shrink-0" onClick={() => setForm(f => ({...f, file_url: "", file_name: ""}))}>Remove</Button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all ${uploading ? "border-amber-300 bg-amber-50" : "border-slate-300 hover:border-amber-400 hover:bg-amber-50/50 bg-slate-50"}`}>
                    <Upload className={`h-8 w-8 mb-3 ${uploading ? "text-amber-500 animate-pulse" : "text-slate-400"}`} />
                    <span className="text-sm font-semibold text-slate-700">{uploading ? "Uploading..." : "Click to select a plan or elevation file"}</span>
                    <span className="text-xs text-slate-400 mt-1">Supports PDF, JPG, PNG, etc.</span>
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white font-medium" disabled={!form.file_url || uploading || createDoc.isPending} onClick={handleSave}>
                {createDoc.isPending ? "Saving changes..." : "Save Plan / Elevation"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
