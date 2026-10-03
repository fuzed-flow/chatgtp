import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// REPLACED BASE44 WITH SUPABASE
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Upload, FileText, ExternalLink, ShieldCheck, Calendar, Edit, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const PERMIT_TYPES = ["Building", "Electrical", "Plumbing", "Mechanical", "Gas", "Demolition", "Grading", "Sign", "Other"];

const STATUS_COLORS = {
  Pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Approved: "bg-blue-100 text-blue-800 border-blue-200",
  Active: "bg-green-100 text-green-800 border-green-200",
  Expired: "bg-red-100 text-red-800 border-red-200",
  Closed: "bg-slate-100 text-slate-700 border-slate-200",
  Rejected: "bg-red-200 text-red-900 border-red-300",
};

const EMPTY_FORM = {
  permit_type: "",
  permit_number: "",
  issued_by: "",
  issue_date: "",
  expiry_date: "",
  status: "Pending",
  description: "",
  notes: "",
  file_url: "",
  file_name: "",
};

export default function PermitsTab({ projectId }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [dialog, setDialog] = useState(false);
  const [editingPermit, setEditingPermit] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  // --- 1. FETCH PERMITS ---
  const { data: permits = [], isLoading } = useQuery({
    queryKey: ["project-permits", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_permits")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  // --- 2. CREATE PERMIT ---
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("project_permits").insert([{ 
        ...data, 
        project_id: projectId,
        company_id: companyId 
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-permits", projectId] });
      closeDialog();
      toast.success("Permit added");
    },
    onError: (err) => toast.error(`Failed to add permit: ${err.message}`)
  });

  // --- 3. UPDATE PERMIT ---
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("project_permits").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-permits", projectId] });
      closeDialog();
      toast.success("Permit updated");
    },
    onError: (err) => toast.error(`Failed to update permit: ${err.message}`)
  });

  // --- 4. DELETE PERMIT ---
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_permits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-permits", projectId] });
      toast.success("Permit deleted");
    },
    onError: (err) => toast.error(`Failed to delete permit: ${err.message}`)
  });

  const closeDialog = () => {
    setDialog(false);
    setEditingPermit(null);
    setForm(EMPTY_FORM);
  };

  const openAdd = () => {
    setEditingPermit(null);
    setForm(EMPTY_FORM);
    setDialog(true);
  };

  const openEdit = (permit) => {
    setEditingPermit(permit);
    setForm({
      permit_type: permit.permit_type || "",
      permit_number: permit.permit_number || "",
      issued_by: permit.issued_by || "",
      issue_date: permit.issue_date || "",
      expiry_date: permit.expiry_date || "",
      status: permit.status || "Pending",
      description: permit.description || "",
      notes: permit.notes || "",
      file_url: permit.file_url || "",
      file_name: permit.file_name || "",
    });
    setDialog(true);
  };

  // --- 5. FILE UPLOAD TO SUPABASE STORAGE ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    toast.loading("Uploading permit file...");
    
    try {
      // Create a unique file name to prevent collisions
      const fileExt = file.name.split('.').pop();
      const fileName = `${projectId}-${Date.now()}.${fileExt}`;
      const filePath = `permits/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('project_files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get the public URL for viewing later
      const { data: { publicUrl } } = supabase.storage
        .from('project_files')
        .getPublicUrl(filePath);

      setForm(f => ({ ...f, file_url: publicUrl, file_name: file.name }));
      toast.dismiss();
      toast.success("File uploaded successfully");
    } catch (err) {
      toast.dismiss();
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingPermit) {
      updateMutation.mutate({ id: editingPermit.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isExpired = (permit) => {
    if (!permit.expiry_date) return false;
    return new Date(permit.expiry_date) < new Date() && permit.status !== "Closed";
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-4 rounded-xl shadow-sm">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-500" /> Building Permits
          </h2>
          <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wider">Manage regulatory compliance</p>
        </div>
        <Button size="sm" onClick={openAdd} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
          <Plus className="h-4 w-4 mr-1.5" /> Add Permit
        </Button>
      </div>

      {permits.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 border-dashed rounded-xl">
          <ShieldCheck className="h-12 w-12 mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-500 mb-1">No permits added yet</p>
          <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto">Track building, electrical, and plumbing permits to ensure site compliance.</p>
          <Button size="sm" variant="outline" onClick={openAdd} className="font-bold text-slate-600 border-slate-300">
            <Plus className="h-4 w-4 mr-2 text-amber-500" /> Add First Permit
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {permits.map(permit => (
            <Card key={permit.id} className={`p-4 border shadow-sm transition-colors ${isExpired(permit) ? "border-red-300 bg-red-50" : "border-slate-200 bg-white hover:border-amber-300"}`}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border ${isExpired(permit) ? "bg-red-100 border-red-200" : "bg-amber-50 border-amber-100"}`}>
                    <ShieldCheck className={`h-5 w-5 ${isExpired(permit) ? "text-red-600" : "text-amber-600"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="text-sm font-black text-slate-900">{permit.permit_type} Permit</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${STATUS_COLORS[permit.status] || "bg-slate-100 text-slate-700 border-slate-200"}`}>
                        {permit.status}
                      </span>
                      {isExpired(permit) && (
                        <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-black uppercase tracking-wider shadow-sm">EXPIRED</span>
                      )}
                    </div>
                    {permit.permit_number && (
                      <p className="text-xs text-slate-600 mb-1 font-medium">Permit #: <span className="font-black text-slate-800">{permit.permit_number}</span></p>
                    )}
                    {permit.issued_by && (
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Issued by: {permit.issued_by}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-2">
                      {permit.issue_date && (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                          <Calendar className="h-3 w-3" />
                          Issued: {format(new Date(permit.issue_date), "MMM d, yyyy")}
                        </div>
                      )}
                      {permit.expiry_date && (
                        <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded ${isExpired(permit) ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>
                          <Calendar className="h-3 w-3" />
                          Expires: {format(new Date(permit.expiry_date), "MMM d, yyyy")}
                        </div>
                      )}
                    </div>
                    {permit.description && (
                      <p className="text-xs font-medium text-slate-600 mt-2 bg-slate-50 p-2 rounded border border-slate-100">{permit.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-3">
                  {permit.file_url && (
                    <a href={permit.file_url} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="gap-1 text-xs font-bold border-slate-300">
                        <FileText className="h-3.5 w-3.5 text-blue-600" /> View
                      </Button>
                    </a>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => openEdit(permit)} className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (window.confirm("Delete this permit?")) deleteMutation.mutate(permit.id); }} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* DIALOG FORM */}
      <Dialog open={dialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-black text-xl flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-500" /> {editingPermit ? "Edit Permit Details" : "Log New Permit"}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Permit Type *</Label>
                <Select value={form.permit_type} onValueChange={v => setForm(f => ({ ...f, permit_type: v }))} required>
                  <SelectTrigger className="font-bold bg-white"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {PERMIT_TYPES.map(t => <SelectItem key={t} value={t} className="font-bold">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="font-bold bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Pending", "Approved", "Active", "Expired", "Closed", "Rejected"].map(s => (
                      <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Permit Number</Label>
                <Input className="font-bold bg-white" value={form.permit_number} onChange={e => setForm(f => ({ ...f, permit_number: e.target.value }))} placeholder="BP-2024-00123" />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Issued By (City/County)</Label>
                <Input className="font-bold bg-white" value={form.issued_by} onChange={e => setForm(f => ({ ...f, issued_by: e.target.value }))} placeholder="City of Calgary" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Issue Date</Label>
                <Input className="font-medium bg-white" type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Expiry Date</Label>
                <Input className="font-medium bg-white" type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Scope of Work / Description</Label>
              <Textarea className="font-medium bg-white text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Brief description of work covered by this permit..." />
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Digital Copy (PDF/Image)</Label>
              {form.file_url ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200">
                  <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-700 truncate flex-1">{form.file_name || "Uploaded file"}</span>
                  <a href={form.file_url} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-slate-200 rounded">
                    <ExternalLink className="h-3 w-3 text-slate-600" />
                  </a>
                  <button type="button" onClick={() => setForm(f => ({ ...f, file_url: "", file_name: "" }))} className="p-1 hover:bg-red-100 rounded text-red-500">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors">
                  <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} />
                  {uploading ? <Loader2 className="h-4 w-4 text-amber-500 animate-spin" /> : <Upload className="h-4 w-4 text-slate-400" />}
                  <span className="text-xs font-bold text-slate-500">{uploading ? "Uploading..." : "Click to upload permit document"}</span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={closeDialog} className="font-bold border-slate-300">Cancel</Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md" disabled={!form.permit_type || uploading || createMutation.isPending || updateMutation.isPending}>
                {editingPermit ? "Save Changes" : "Log Permit"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}