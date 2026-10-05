import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Package, ClipboardList, Trash2, Calendar, Briefcase, FileText, ArrowDownRight, Check } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { toast } from "sonner";
import EPEquipmentReservations from "./EPEquipmentReservations";

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

export default function EPInventory() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [open, setOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  const activeCompanyId = profile?.company_id;
  const actorId = profile?.id;

  const defaultForm = {
    inventory_id: "",
    project_id: "none",
    quantity: "",
    notes: ""
  };

  const [form, setForm] = useState(defaultForm);

  // 1. Fetch Projects for the dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ["inventory-assigned-projects", activeCompanyId, actorId],
    enabled: !!activeCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, name").eq("company_id", activeCompanyId);
      if (error) throw error;
      if (['owner','admin','manager','office'].includes(profile?.role)) return data || [];
      const { data: assignments, error: assignmentError } = await supabase.from('project_staff').select('project_id').eq('company_id', activeCompanyId).eq('user_id', actorId).neq('is_active', false);
      if (assignmentError) throw assignmentError;
      return (data || []).filter(p => assignments?.some(a => a.project_id === p.id));
    }
  });

  // 2. Fetch Actual Warehouse Inventory
  const { data: inventory = [], isLoading: invLoading } = useQuery({
    queryKey: ["inventory", activeCompanyId],
    enabled: !!activeCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory").select("*").eq("company_id", activeCompanyId).order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  // 3. Fetch My Inventory Transactions
  const { data: ownLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["inventory_transactions_mine", actorId, activeCompanyId],
    enabled: !!activeCompanyId && !!actorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("company_id", activeCompanyId)
        .eq("user_id", actorId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });
  // Older name-based records remain visible as read-only history. Only records
  // with a server-captured user_id can authorize a stock return.
  const { data: legacyLogs = [] } = useQuery({ queryKey: ['inventory-legacy-history', activeCompanyId, actorId, profile?.full_name, profile?.email], enabled: !!activeCompanyId && !!actorId,
    queryFn: async () => { const { data, error } = await supabase.from('inventory_transactions').select('*').eq('company_id', activeCompanyId).is('user_id', null).eq('employee_name', profile?.full_name || profile?.email).order('created_at', { ascending: false }); if (error) throw error; return data || []; } });
  const logs = [...ownLogs, ...legacyLogs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // 4. Create Mutation (Deducts stock AND logs transaction into inventory_transactions)
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('consume_inventory_material', { p_inventory: payload.inventory_id, p_quantity: Number(payload.quantity), p_project: payload.project_id === 'none' ? null : payload.project_id, p_notes: payload.notes || null });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_transactions_mine"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setOpen(false);
      setForm(defaultForm);
      toast.success("Material usage logged successfully!");
    },
    onError: (err) => {
      console.error("Save Error Details:", err);
      toast.error(`System Error: ${err.message}`);
    }
  });

  // Returns are atomic and preserve the original usage history.
  const deleteMutation = useMutation({
    mutationFn: async (txId) => {
      const { error } = await supabase.rpc('refund_inventory_material', { p_transaction: txId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_transactions_mine"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setSelectedLog(null);
      toast.success("Material returned to stock. The usage record has been retained.");
    },
    onError: (err) => toast.error(`Could not return materials: ${err.message}`)
  });

  const handleFormSubmit = () => {
    if (!form.inventory_id) {
      return toast.error("Please pick a material from the warehouse drop-down.");
    }
    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      return toast.error("Please enter a valid amount taken.");
    }
    createMutation.mutate(form);
  };

  // --- Real-time Inventory Calculation for UI Feedback ---
  const selectedInvItem = inventory.find(i => String(i.id) === String(form.inventory_id));
  const currentInvStock = selectedInvItem ? Number(selectedInvItem.quantity_on_hand ?? selectedInvItem.quantity ?? 0) : 0;
  const takingQty = parseFloat(form.quantity) || 0;
  const remainingStock = currentInvStock - takingQty;

  if (logsLoading || invLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  const renderLogRow = (log) => {
    const item = inventory.find(i => String(i.id) === String(log.inventory_id));
    const dateObj = safeParseDate(log.created_at);
    const displayQty = Math.abs(log.quantity_changed);

    return (
      <tr key={log.id} className="border-b last:border-0 border-slate-100 hover:bg-slate-50 transition-colors">
        <td className="px-4 py-3 align-middle whitespace-nowrap">
          <div className="flex flex-col">
            <span className="font-black text-slate-900">{dateObj ? format(dateObj, "MMM d, yyyy") : log.created_at}</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{dateObj ? format(dateObj, "h:mm a") : ""}</span>
          </div>
        </td>

        <td className="px-4 py-3 align-middle min-w-[180px]">
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-bold text-slate-800">{item ? item.name : "Unknown/Deleted Item"}</span>
            <span className="text-[10px] font-black uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded-md flex items-center gap-1 border border-red-100">
              <ArrowDownRight className="h-3 w-3" /> {displayQty} {item?.unit || "Units"}
            </span>
          </div>
        </td>

        <td className="px-4 py-3 align-middle min-w-[150px]">
          {log.refunded_at ? <Badge variant="outline">Returned to stock</Badge> : log.project_name ? (
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] uppercase tracking-wider font-bold">
              <Briefcase className="h-3 w-3 mr-1" /> {log.project_name}
            </Badge>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">— Unassigned —</span>
          )}
        </td>

        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedLog(log)}
              className="text-slate-500 hover:text-amber-600 hover:bg-amber-50 font-bold"
            >
              <FileText className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Details</span>
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">

      <EPEquipmentReservations profile={profile} />
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 text-amber-500" /> Material Usage
          </h3>
          <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">
            {logs.length} Transactions Logged
          </p>
        </div>
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Log Material Taken
        </Button>
      </div>

      {/* LOGS TABLE */}
      <div className="space-y-4">
        {logs.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
            <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">You haven't logged any materials yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Checkout History</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50/50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Material / Quantity</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(renderLogRow)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* DETAILS DIALOG */}
      {selectedLog && (
        <Dialog open={!!selectedLog} onOpenChange={(val) => !val && setSelectedLog(null)}>
          <DialogContent className="max-w-md bg-white border-slate-200 shadow-xl" aria-describedby={undefined}>
            <DialogHeader>
              <div className="flex items-start justify-between pr-6">
                <div>
                  <DialogTitle className="font-black text-xl text-slate-900 mb-1">
                    Transaction Details
                  </DialogTitle>
                  <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" /> {safeParseDate(selectedLog.created_at) ? format(safeParseDate(selectedLog.created_at), "MMMM d, yyyy - h:mm a") : selectedLog.created_at}
                  </p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-6 pt-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Item Taken</p>
                <p className="text-lg font-black text-slate-800">
                  {inventory.find(i => String(i.id) === String(selectedLog.inventory_id))?.name || "Unknown Item"}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 border border-red-100 text-red-700 rounded-md font-black text-sm">
                  <ArrowDownRight className="h-4 w-4" /> {Math.abs(selectedLog.quantity_changed)} {inventory.find(i => String(i.id) === String(selectedLog.inventory_id))?.unit || "Units"}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /> Assigned Project
                </p>
                {selectedLog.project_name ? (
                  <p className="text-sm font-bold text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg shadow-sm">
                    {selectedLog.project_name}
                  </p>
                ) : (
                  <p className="text-sm italic text-slate-400">No project assigned</p>
                )}
              </div>

              {selectedLog.notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Additional Notes</p>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 whitespace-pre-wrap shadow-sm">
                    {selectedLog.notes}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100">
                {!selectedLog.user_id ? <p className="text-sm text-slate-600">This older record was saved by employee name. Ask your office to verify and correct its stock balance.</p> : selectedLog.refunded_at ? <p className="text-sm font-semibold text-slate-600">Returned to stock. This record is retained for your history.</p> : <Button
                  variant="destructive"
                  className="w-full font-bold bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-100 shadow-none transition-colors"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(selectedLog.id)}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" /> Return materials to stock
                </Button>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* CREATE NEW LOG DIALOG */}
      <Dialog open={open} onOpenChange={(val) => !val && setOpen(false)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-black text-xl text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" /> Log Materials Taken
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Warehouse Material *</Label>
                <Select value={form.inventory_id} onValueChange={v => setForm({ ...form, inventory_id: v })}>
                  <SelectTrigger className="bg-white font-bold h-12 border-slate-300 shadow-sm text-slate-900">
                    <SelectValue placeholder="Select item from storage..." />
                  </SelectTrigger>
                  <SelectContent>
                    {inventory.filter(i => i.item_type !== "Equipment").map(i => (
                      <SelectItem key={i.id} value={String(i.id)} className="font-bold py-2">
                        <div className="flex flex-col items-start">
                          <span>{i.name}</span>
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 mt-0.5">{i.quantity_on_hand ?? i.quantity ?? 0} {i.unit || 'Units'} in stock</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Quantity Taken *</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.quantity}
                      onChange={e => setForm({ ...form, quantity: e.target.value })}
                      className="bg-slate-50 font-black h-10 border-slate-300 text-slate-900 pr-16"
                      placeholder="0"
                    />
                    {selectedInvItem && (
                      <span className="absolute right-3 top-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        {selectedInvItem.unit || 'Units'}
                      </span>
                    )}
                  </div>

                  {/* DYNAMIC INVENTORY CALCULATOR FEEDBACK */}
                  {selectedInvItem && (
                    <p className={`text-[10px] font-bold mt-2 flex justify-between items-center ${remainingStock < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      <span>Remaining:</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{remainingStock} {selectedInvItem.unit || 'Units'}</span>
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Project (Optional)</Label>
                  <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                    <SelectTrigger className="bg-slate-50 font-bold h-10 border-slate-300 text-slate-900">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="font-bold text-slate-500">— Shop / Unassigned —</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={p.id} className="font-bold">{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Notes / Where used?</Label>
              <Textarea
                value={form.notes}
                onChange={e => {
                  setForm({ ...form, notes: e.target.value });
                }}
                rows={2}
                className="bg-slate-50 border-slate-300 font-medium text-sm text-slate-900 resize-y"
                placeholder="E.g., Used for framing the basement..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" className="font-bold" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md animate-none min-w-[120px]"
                onClick={handleFormSubmit}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Logging..." : <><Check className="h-4 w-4 mr-1.5" /> Log Checkout</>}
              </Button>
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
