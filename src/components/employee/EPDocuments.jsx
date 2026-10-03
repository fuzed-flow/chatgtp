import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FileText, AlertTriangle, ExternalLink, CheckCircle2 } from "lucide-react";
import { differenceInDays, parseISO, format } from "date-fns";
import { toast } from "sonner";

const DOC_TYPES = ["Employment Agreement", "Safety Certificate", "Trade Certification", "License", "Company Policy", "Training Acknowledgement", "Other"];

export default function EPDocuments({ currentUser, profile, isAdmin }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: "", document_type: "Company Policy", issue_date: "", expiry_date: "", notes: "", requires_acknowledgement: false, file_url: "", file_name: "", employee_id: "" });

  const { data: docs = [] } = useQuery({
    queryKey: ["emp_docs", isAdmin ? "all" : profile?.id],
    queryFn: () => isAdmin ? base44.entities.EmployeeDocument.list("-created_date") : base44.entities.EmployeeDocument.filter({ employee_id: profile?.id }),
    enabled: isAdmin || !!profile?.id,
  });

  const { data: profiles = [] } = useQuery({ queryKey: ["emp_profiles"], queryFn: () => base44.entities.EmployeeProfile.list(), enabled: !!isAdmin });

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.EmployeeDocument.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["emp_docs"] }); setOpen(false); toast.success("Document added!"); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EmployeeDocument.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["emp_docs"] }); toast.success("Updated"); },
  });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm({ ...form, file_url, file_name: file.name });
    setUploading(false);
  };

  const getExpiryStatus = (expiry) => {
    if (!expiry) return null;
    const days = differenceInDays(parseISO(expiry), new Date());
    if (days < 0) return { label: "Expired", color: "bg-red-100 text-red-700" };
    if (days <= 30) return { label: `Expires in ${days}d`, color: "bg-orange-100 text-orange-700" };
    if (days <= 90) return { label: `Expires in ${Math.round(days / 7)}w`, color: "bg-amber-100 text-amber-700" };
    return { label: `Expires ${format(parseISO(expiry), "MMM d, yyyy")}`, color: "bg-green-100 text-green-700" };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Documents & Certifications</h3>
        {isAdmin && (
          <Button size="sm" className="bg-slate-900 hover:bg-slate-800" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Doc
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {docs.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No documents on file.</p>}
        {docs.map(doc => {
          const expStatus = getExpiryStatus(doc.expiry_date);
          const emp = profiles.find(p => p.id === doc.employee_id);
          return (
            <Card key={doc.id} className="border-slate-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-medium text-slate-900 text-sm">{doc.title}</p>
                      {expStatus && <Badge className={`text-[10px] ${expStatus.color}`}>{expStatus.label}</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">{doc.document_type}{isAdmin && emp ? ` · ${emp.employee_name}` : ""}</p>
                    {doc.notes && <p className="text-xs text-slate-500 mt-0.5 italic">{doc.notes}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
                          <ExternalLink className="h-3 w-3" /> View
                        </a>
                      )}
                      {doc.requires_acknowledgement && !doc.acknowledged_at && (
                        <Button size="sm" variant="outline" className="text-xs h-6 px-2 text-green-700 border-green-300"
                          onClick={() => updateMutation.mutate({ id: doc.id, data: { acknowledged_at: new Date().toISOString() } })}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Acknowledge
                        </Button>
                      )}
                      {doc.acknowledged_at && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Acknowledged</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isAdmin && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-700">Employee</label>
                <Select value={form.employee_id} onValueChange={v => setForm({ ...form, employee_id: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                  <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.employee_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium text-slate-700">Title</label>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1" /></div>
              <div><label className="text-xs font-medium text-slate-700">Type</label>
                <Select value={form.document_type} onValueChange={v => setForm({ ...form, document_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-700">Issue Date</label>
                  <Input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} className="mt-1" /></div>
                <div><label className="text-xs font-medium text-slate-700">Expiry Date</label>
                  <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="mt-1" /></div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Upload File</label>
                <label className="mt-1 flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-slate-50 text-sm text-slate-600">
                  <FileText className="h-4 w-4" />
                  {uploading ? "Uploading..." : form.file_name || "Select file"}
                  <input type="file" className="hidden" onChange={handleUpload} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.requires_acknowledgement} onChange={e => setForm({ ...form, requires_acknowledgement: e.target.checked })} className="rounded" />
                Requires employee acknowledgement
              </label>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                <Button className="flex-1 bg-slate-900 hover:bg-slate-800" onClick={() => createMutation.mutate(form)} disabled={!form.title || createMutation.isPending}>
                  {createMutation.isPending ? "Saving..." : "Add"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}