import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Upload, Trash2, FileText, Plus, Building2, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import DocumentWorkflows from "@/components/documents/DocumentWorkflows";
import { fileChecksum } from "@/lib/documentWorkflows";

const DOC_TYPES = ["Supplier Quote", "Contractor Quote", "Invoice", "Contract", "Drawing", "Specification", "Other"];

const TYPE_COLORS = {
  "Supplier Quote": "bg-blue-100 text-blue-700 border-blue-200",
  "Contractor Quote": "bg-purple-100 text-purple-700 border-purple-200",
  "Invoice": "bg-amber-100 text-amber-700 border-amber-200",
  "Contract": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Drawing": "bg-slate-100 text-slate-700 border-slate-200",
  "Specification": "bg-rose-100 text-rose-700 border-rose-200",
  "Other": "bg-gray-100 text-gray-700 border-gray-200",
};

export default function PMQuotesDocsTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    doc_type: "Supplier Quote",
    vendor_name: "",
    amount: "",
    notes: "",
    file_url: "",
    file_name: "", file_sha256: null
  });

  // --- SUPABASE QUERIES ---
  const { data: docs = [] } = useQuery({
    queryKey: ["project_documents", companyId, project?.id],
    enabled: !!project?.id && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_documents").select("*").eq("company_id", companyId).eq("project_id", project.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // --- SUPABASE MUTATIONS ---
  const createDoc = useMutation({
    mutationFn: async (d) => {
      const payload = {
        ...d,
        company_id: companyId,
        project_id: project.id, uploaded_by: profile.id,
        amount: d.amount ? Number(d.amount) : null
      };
      const { error } = await supabase.from("project_documents").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_documents", companyId, project.id] });
      setAddOpen(false);
      resetForm();
      toast.success("Document saved successfully");
    }
  });

  const deleteDoc = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_documents").delete().eq("company_id", companyId).eq("project_id", project.id).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_documents", companyId, project.id] });
      toast.success("Document deleted");
    },
    onError: (err) => {
      console.error(err);
      toast.error(err.code === "23503" ? "This document has request history and must be retained. Upload a new document to replace it." : "Failed to delete document");
    }
  });

  const resetForm = () => setForm({ doc_type: "Supplier Quote", vendor_name: "", amount: "", notes: "", file_url: "", file_name: "", file_sha256: null });

  // NATIVE SUPABASE STORAGE UPLOAD
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${project.id}/${crypto.randomUUID()}_${safeName}`;
      const checksum = await fileChecksum(file);

      const { data, error } = await supabase.storage
        .from('project_documents')
        .upload(filePath, file);

      if (error) throw error;

      const { data: publicData } = supabase.storage
        .from('project_documents')
        .getPublicUrl(filePath);

      setForm(f => ({ ...f, file_url: publicData.publicUrl, file_name: file.name, file_sha256: checksum }));
      toast.success("File uploaded! Fill out the details and click Save.");

    } catch (err) {
      alert(`File Upload Error: ${err.message || "Unknown error occurred during upload."}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSave = async () => {
    if (!form.file_url || !form.file_name) {
      alert("Please wait for the file to finish uploading before saving.");
      return;
    }

    try {
      await createDoc.mutateAsync(form);
    } catch (err) {
      alert(`Database Save Error: ${err.message || "Failed to save record."}`);
    }
  };

  // FORCED BLOB DOWNLOAD (Bypasses the browser cross-origin tab override)
  const triggerFileDownload = async (url, filename) => {
    toast.loading("Preparing download...");
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || "download";
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.dismiss();
    } catch (err) {
      toast.dismiss();
      console.error("Forced download failed, falling back to open tab link:", err);
      window.open(url, "_blank");
    }
  };

  // Group documents by type
  const grouped = DOC_TYPES.reduce((acc, t) => {
    const items = docs.filter(d => d.doc_type === t);
    if (items.length) acc[t] = items;
    return acc;
  }, {});

  const ungrouped = docs.filter(d => !DOC_TYPES.includes(d.doc_type));
  if (ungrouped.length) grouped["Other"] = [...(grouped["Other"] || []), ...ungrouped];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="font-semibold text-slate-800 text-lg">Quotes & Documents</h2>
          <p className="text-xs text-slate-500 mt-0.5">{docs.length} document{docs.length !== 1 ? "s" : ""} uploaded</p>
        </div>
        <Button size="sm" className="min-h-11 bg-amber-500 hover:bg-amber-600 text-slate-900 shrink-0" onClick={() => { resetForm(); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Upload Document
        </Button>
      </div>

      <DocumentWorkflows project={project} documents={docs} />

      {/* Empty State Banner */}
      {docs.length === 0 && (
        <div className="text-center bg-white border border-slate-200 border-dashed rounded-xl py-16 shadow-sm">
          <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-700">No documents yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">Upload supplier quotes, contractor quotes, contracts and spec sheets to keep everything organized.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { resetForm(); setAddOpen(true); }}>Upload First Document</Button>
        </div>
      )}

      {/* Category Folders */}
      <div className="space-y-8">
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type}>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              {type} <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[9px]">{items.length}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(doc => (
                <div key={doc.id} className="flex flex-wrap sm:flex-nowrap items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-amber-300 transition-all group">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
                    <FileText className="h-5 w-5 text-blue-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {/* Clickable Title links to new tab */}
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-sm text-slate-900 truncate hover:text-amber-700 hover:underline"
                        title="Open document in new tab"
                      >
                        {doc.file_name || "Document"}
                      </a>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TYPE_COLORS[doc.doc_type] || TYPE_COLORS["Other"]}`}>{doc.doc_type || "Other"}</span>
                    </div>

                    <div className="flex gap-4 text-xs font-medium text-slate-500 mt-1.5 flex-wrap">
                      {doc.vendor_name && (
                        <span className="flex items-center gap-1 text-slate-700">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          {doc.vendor_name}
                        </span>
                      )}
                      {doc.amount != null && <span className="text-amber-600 font-bold">${Number(doc.amount).toLocaleString()}</span>}
                    </div>
                    {doc.notes && <p className="text-xs text-slate-500 mt-2 line-clamp-2 italic leading-relaxed">"{doc.notes}"</p>}
                  </div>

                  {/* Action Layout Buttons */}
                  <div className="flex flex-row items-center gap-1 shrink-0 opacity-100 transition-opacity">
                    {doc.file_url && doc.file_url !== "#" && (
                      <>
                        {/* 1. OPEN IN NEW TAB */}
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex h-11 w-11 items-center justify-center rounded-md text-amber-600 hover:bg-amber-50 hover:text-amber-700" title="Open document in new tab" aria-label="Open document in new tab">
                            <ExternalLink className="h-4 w-4" />
                        </a>

                        {/* 2. REAL FORCED DOWNLOAD */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-11 w-11 text-slate-600 hover:bg-slate-100"
                          title="Download file to device"
                          onClick={() => triggerFileDownload(doc.file_url, doc.file_name)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </>
                    )}

                    {/* 3. DELETE RECORD */}
                    <Button size="icon" variant="ghost" className="h-11 w-11 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Delete document" onClick={() => {
                      if(window.confirm("Delete this document permanently?")) deleteDoc.mutate(doc.id);
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Upload Dialog Form */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Document Type</Label>
              <Select value={form.doc_type} onValueChange={v => setForm({...form, doc_type: v})}>
                <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Vendor / Company</Label>
                <Input className="mt-1" placeholder="e.g. ABC Supplies Ltd." value={form.vendor_name} onChange={e => setForm({...form, vendor_name: e.target.value})} />
              </div>
              <div>
                <Label>Amount ($)</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
                  <Input className="pl-7" type="number" placeholder="0.00" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
                </div>
              </div>
            </div>

            <div>
              <Label>Internal Notes</Label>
              <Input className="mt-1" placeholder="Brief description..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>

            <div>
              <Label>File *</Label>
              <div className="mt-1">
                {form.file_url ? (
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 shadow-sm">
                    <FileText className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span className="truncate flex-1 font-medium">{form.file_name}</span>
                    <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs text-emerald-700 hover:bg-emerald-100 shrink-0" onClick={() => setForm(f => ({...f, file_url: "", file_name: "", file_sha256: null}))}>Remove</Button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all ${uploading ? "border-amber-300 bg-amber-50" : "border-slate-300 hover:border-amber-400 hover:bg-amber-50/50 bg-slate-50"}`}>
                    <Upload className={`h-8 w-8 mb-3 ${uploading ? "text-amber-500 animate-pulse" : "text-slate-400"}`} />
                    <span className="text-sm font-semibold text-slate-700">{uploading ? "Uploading..." : "Click to select a file"}</span>
                    <span className="text-xs text-slate-400 mt-1">Supports PDF, JPG, PNG, DOCX</span>
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="min-h-11 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={!form.file_url || uploading || createDoc.isPending} onClick={handleSave}>
                {createDoc.isPending ? "Saving..." : "Save Document"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
