import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Receipt, ExternalLink, Edit2, Trash2, Camera, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import ExpenseCostContext from './ExpenseCostContext';

const STATUS_COLORS = {
  Submitted: "bg-blue-100 text-blue-800 border-blue-200",
  "Under Review": "bg-amber-100 text-amber-800 border-amber-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Left: "bg-red-100 text-red-800 border-red-200",
  Reimbursed: "bg-slate-800 text-white border-slate-900",
};

const CATEGORIES = ["Materials", "Fuel", "Tools", "Meals", "Accommodation", "Parking", "Other"];
const PAYMENT_METHODS = ["Personal Card", "Cash", "Company Card", "Other"];

export default function EPExpenses({ currentUser, companyId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  const defaultForm = { 
    date: format(new Date(), "yyyy-MM-dd"), 
    category: "Materials", 
    amount: "", 
    description: "", 
    payment_method: "Personal Card", 
    project_id: "none", 
    receipt_url: "", purchase_context: 'none',
  };
  const [form, setForm] = useState(defaultForm);

  // Fetch Projects
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId);
      return data || [];
    } 
  });

  // Fetch My Expenses
  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses_mine", currentUser?.id],
    enabled: !!currentUser?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("date", { ascending: false });
      
      if (error) return [];
      return data || [];
    },
  });

  // --- MUTATIONS ---
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from("expenses").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["expenses_mine"] }); 
      handleCloseDialog();
      toast.success("Expense claim submitted to HR!"); 
    },
    onError: (err) => toast.error(`Submission failed: ${err.message}`)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { error } = await supabase.from("expenses").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["expenses_mine"] }); 
      handleCloseDialog();
      toast.success("Expense claim updated!"); 
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses_mine"] });
      toast.success("Expense claim deleted.");
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`)
  });

  // --- STORAGE UPLOAD ---
  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${currentUser.id}/${fileName}`;
      
      // Upload directly to public bucket
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
        
      if (uploadError) throw uploadError;
      
      const { data } = supabase.storage.from('receipts').getPublicUrl(filePath);
      setForm(prev => ({ ...prev, receipt_url: data.publicUrl }));
      toast.success("Receipt image attached successfully!");
    } catch (err) {
      console.error(err);
      toast.error(`Upload Blocked: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // --- TWO DECIMAL PLACE FORMATTER ---
  const handleAmountBlur = () => {
    if (!form.amount) return;
    const parsed = parseFloat(form.amount);
    if (!isNaN(parsed)) {
      setForm(prev => ({ ...prev, amount: parsed.toFixed(2) }));
    }
  };

  const handleOpenNew = () => {
    setEditingId(null);
    setForm(defaultForm);
    setOpen(true);
  };

  const handleEdit = (exp) => {
    setForm({
      date: exp.date,
      category: exp.category || "Materials",
      amount: Number(exp.amount).toFixed(2),
      description: exp.description || "",
      payment_method: exp.payment_method || "Personal Card",
      project_id: exp.project_id || "none",
      receipt_url: exp.receipt_url || "", purchase_context: exp.purchase_order_id ? `po:${exp.purchase_order_id}` : exp.project_material_id ? `material:${exp.project_material_id}` : 'none',
    });
    setEditingId(exp.id);
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm(defaultForm);
  };

  const handleSubmit = () => {
    const parsedAmount = parseFloat(form.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }

    const payload = {
      company_id: companyId || null,
      user_id: currentUser.id,
      user_email: currentUser.email,
      employee_name: currentUser.full_name,
      project_id: form.project_id === "none" ? null : form.project_id,
      date: form.date,
      category: form.category,
      amount: parseFloat(parsedAmount.toFixed(2)),
      description: form.description || null,
      payment_method: form.payment_method,
      receipt_url: form.receipt_url || null,
      status: "Submitted",
      purchase_order_id: form.purchase_context.startsWith('po:') ? form.purchase_context.slice(3) : null,
      project_material_id: form.purchase_context.startsWith('material:') ? form.purchase_context.slice(9) : null,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const pendingAmount = expenses
    .filter(e => ["Submitted", "Under Review", "Approved"].includes(e.status))
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <div className="space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="h-6 w-6 text-amber-500" /> My Expenses
          </h3>
          <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">
            ${pendingAmount.toFixed(2)} Pending Reimbursement
          </p>
        </div>
        <Button 
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
          onClick={handleOpenNew}
        >
          <Plus className="h-4 w-4 mr-1.5" /> New Claim
        </Button>
      </div>

      {/* CLAIM HISTORY */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Claim History</h4>
            <ShieldAlert className="h-4 w-4 text-slate-300" />
          </div>

          <div className="divide-y divide-slate-100">
            {expenses.length === 0 ? (
              <div className="p-8 text-center">
                <Receipt className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-500">You haven't submitted any expenses.</p>
              </div>
            ) : (
              expenses.map(exp => {
                const proj = projects.find(p => p.id === exp.project_id);
                const isLocked = ["Approved", "Reimbursed"].includes(exp.status);

                return (
                  <div key={exp.id} className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                          {exp.category}
                        </Badge>
                        <Badge className={`text-[10px] font-bold uppercase tracking-wider border ${STATUS_COLORS[exp.status] || "bg-slate-100 text-slate-600"}`}>
                          {exp.status}
                        </Badge>
                      </div>

                      <p className="text-base font-black text-slate-900 mt-1">{exp.description || "No description provided"}</p>
                      
                      <div className="flex items-center gap-3 text-xs font-medium text-slate-500 mt-2 flex-wrap">
                        <span className="bg-slate-100 px-2 py-1 rounded">{exp.date}</span>
                        <span className="font-semibold">💳 {exp.payment_method}</span>
                        {proj && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded">Proj: {proj.name}</span>}
                      </div>
                    </div>

                    <div className="shrink-0 sm:text-right flex items-center justify-between sm:block border-t border-slate-100 sm:border-0 pt-3 sm:pt-0">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 sm:block hidden">Amount</p>
                        <p className="text-2xl font-black text-slate-900">${Number(exp.amount).toFixed(2)}</p>
                      </div>
                      
                      {exp.receipt_url && (
                        <a href={exp.receipt_url} target="_blank" rel="noopener noreferrer" 
                           className="text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 flex items-center gap-1 sm:justify-end mt-2 bg-blue-50 px-2 py-1 rounded">
                          <ExternalLink className="h-3 w-3" /> View Receipt
                        </a>
                      )}
                    </div>

                    {!isLocked && (
                      <div className="shrink-0 border-t border-slate-100 pt-3 sm:border-0 sm:pt-0 flex flex-row sm:flex-col gap-2">
                        <Button size="sm" variant="outline" className="flex-1 sm:flex-none font-bold text-slate-600 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 h-8" onClick={() => handleEdit(exp)}>
                          <Edit2 className="h-3.5 w-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Edit</span>
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 sm:flex-none font-bold text-red-600 border-red-200 hover:bg-red-50 h-8" onClick={() => { if(window.confirm("Delete this claim?")) deleteMutation.mutate(exp.id); }}>
                          <Trash2 className="h-3.5 w-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Delete</span>
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* CREATE / EDIT FORM DIALOG */}
      <Dialog open={open} onOpenChange={(val) => !val && handleCloseDialog()}>
        <DialogContent className="max-w-sm bg-slate-50" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl">{editingId ? "Edit Expense Claim" : "New Expense Claim"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</label>
                <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 bg-white" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Amount ($)</label>
                <Input 
                  type="number" 
                  step="0.01" 
                  placeholder="0.00" 
                  value={form.amount} 
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  onBlur={handleAmountBlur} // <-- Triggers formatting dynamically
                  className="mt-1 bg-white font-black" 
                />
              </div>
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Category</label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment Method</label>
              <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Project (Optional)</label>
              <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v, purchase_context: 'none' })}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select project..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No Project —</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <ExpenseCostContext companyId={companyId} projectId={form.project_id} value={form.purchase_context} onChange={purchase_context => setForm({ ...form, purchase_context })} />
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Description</label>
              <Textarea placeholder="What was this purchase for?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="mt-1 bg-white" />
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Receipt Document</label>
              <label className={`mt-1 flex flex-col items-center justify-center gap-2 px-3 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${form.receipt_url ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 bg-white hover:bg-slate-50 hover:border-amber-400'}`}>
                {uploading ? (
                  <div className="h-6 w-6 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                ) : form.receipt_url ? (
                  <>
                    <span className="text-2xl">✓</span>
                    <span className="text-sm font-bold text-emerald-700">Receipt Attached</span>
                    <span className="text-[10px] text-emerald-600/70 uppercase tracking-wider">Tap to swap file</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-8 w-8 text-slate-300" />
                    <span className="text-sm font-bold text-slate-600">Snap picture or upload file</span>
                  </>
                )}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleReceiptUpload} disabled={uploading} />
              </label>
            </div>
            
            <div className="flex gap-2 pt-4 border-t border-slate-200 mt-4">
              <Button variant="outline" className="flex-1 font-bold" onClick={handleCloseDialog}>Cancel</Button>
              <Button 
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
                onClick={handleSubmit} 
                disabled={!form.amount || uploading || createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : (editingId ? "Save Changes" : "Submit Claim")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
