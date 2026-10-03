import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

export default function RecordPaymentDialog({ 
  open, 
  onOpenChange, 
  invoice, 
  editingPaymentId = null, 
  onSuccess 
}) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [paymentForm, setPaymentForm] = useState({ 
    amount: "", 
    payment_method: "Bank Transfer", 
    notes: "", 
    schedule_item_id: "none", 
    payment_date: format(new Date(), "yyyy-MM-dd") 
  });

  // 1. Fetch Scheduled Milestones for this specific invoice
  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["active_tranches_dialog", invoice?.id],
    enabled: !!invoice?.id && open,
    queryFn: async () => { 
      const { data } = await supabase.from("invoice_payment_schedules")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("sort_order", { ascending: true }); 
      return data || []; 
    }
  });

  // 2. If editing, fetch the specific payment details
  const { data: editingPayment, isFetching: fetchingPayment } = useQuery({
    queryKey: ["payment_record", editingPaymentId],
    enabled: !!editingPaymentId && open,
    queryFn: async () => {
      const { data } = await supabase.from("payments").select("*").eq("id", editingPaymentId).single();
      return data;
    }
  });

  // 3. Populate form when opened
  useEffect(() => {
    if (open) {
      if (editingPaymentId && editingPayment) {
        setPaymentForm({
          amount: editingPayment.amount,
          payment_method: editingPayment.payment_method,
          notes: editingPayment.notes || "",
          schedule_item_id: editingPayment.schedule_item_id || "none",
          payment_date: editingPayment.payment_date 
            ? format(new Date(editingPayment.payment_date + "T00:00:00"), "yyyy-MM-dd") 
            : format(new Date(editingPayment.created_at), "yyyy-MM-dd")
        });
      } else if (!editingPaymentId) {
        setPaymentForm({ 
          amount: "", 
          payment_method: "Bank Transfer", 
          notes: "", 
          schedule_item_id: "none", 
          payment_date: format(new Date(), "yyyy-MM-dd") 
        });
      }
    }
  }, [open, editingPaymentId, editingPayment]);

  // ⚡ UNIFIED MATH RECALCULATOR (Ensures ledger matches perfectly)
  const recalculateInvoiceBalances = async (invId) => {
    const { data: inv } = await supabase.from("invoices").select("total").eq("id", invId).single();
    if (!inv) return;

    const { data: allPymts = [] } = await supabase.from("payments").select("amount, schedule_item_id").eq("invoice_id", invId);
    
    const totalCollected = allPymts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const newBal = Math.max(0, Number(inv.total) - totalCollected);
    const invStatus = newBal <= 0 ? "Paid" : (totalCollected > 0 ? "Partial" : "Sent");

    await supabase.from("invoices").update({ amount_paid: totalCollected, balance_due: newBal, status: invStatus }).eq("id", invId);

    const { data: schedules = [] } = await supabase.from("invoice_payment_schedules").select("id, amount").eq("invoice_id", invId);
    for (const sched of schedules) {
      const schedTotal = allPymts.filter(p => p.schedule_item_id === sched.id).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const schedStatus = schedTotal >= sched.amount ? "Paid" : (schedTotal > 0 ? "Partial" : "Pending");
      await supabase.from("invoice_payment_schedules").update({ amount_paid: schedTotal, status: schedStatus }).eq("id", sched.id);
    }
  };

  // ⚡ CREATE NEW PAYMENT
  const createPaymentMutation = useMutation({
    mutationFn: async (data) => {
      const { error: pError } = await supabase.from("payments").insert([{ 
        company_id: companyId,
        invoice_id: invoice.id,
        amount: Number(data.amount),
        payment_method: data.payment_method,
        notes: data.notes,
        payment_date: data.payment_date,
        schedule_item_id: data.schedule_item_id === "none" ? null : data.schedule_item_id,
      }]);
      if (pError) throw pError;
      await recalculateInvoiceBalances(invoice.id);
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`)
  });

  // ⚡ UPDATE EXISTING PAYMENT
  const updatePaymentMutation = useMutation({
    mutationFn: async (data) => {
      // Use .update() instead of delete/insert to preserve the original ID and created_at timestamp
      const { error } = await supabase
        .from("payments")
        .update({
          amount: Number(data.amount),
          payment_method: data.payment_method,
          notes: data.notes,
          payment_date: data.payment_date,
          schedule_item_id: data.schedule_item_id === "none" ? null : data.schedule_item_id,
        })
        .eq("id", editingPaymentId);

      if (error) throw error;
      
      // Recalculate balances after the update is complete
      await recalculateInvoiceBalances(invoice.id);
    },
    onSuccess: () => {
      toast.success("Payment details updated successfully!");
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`)
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingPaymentId) {
      updatePaymentMutation.mutate(paymentForm);
    } else {
      createPaymentMutation.mutate(paymentForm);
    }
  };

  const isPending = createPaymentMutation.isPending || updatePaymentMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingPaymentId ? "Edit Payment Record" : "Record Payment"}</DialogTitle>
        </DialogHeader>
        
        {invoice && !fetchingPayment ? (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Applying to Invoice</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{invoice.invoice_number}</p>
              
              {editingPaymentId ? (
                 <p className="text-sm text-amber-600 font-semibold mt-1">Remaining Balance will recalculate after edit.</p>
              ) : (
                 <p className="text-sm text-red-600 font-semibold mt-1">Remaining Balance: ${(invoice.balance_due || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              )}
            </div>

            <div>
              <Label>Which Scheduled Payment is this for? (Optional)</Label>
              <Select 
                value={paymentForm.schedule_item_id} 
                onValueChange={v => {
                  if (v === "none") {
                    // Auto-fill with the entire invoice balance if they apply it globally
                    setPaymentForm(prev => ({
                      ...prev, 
                      schedule_item_id: v, 
                      amount: invoice?.balance_due ? Number(invoice.balance_due).toFixed(2) : ""
                    }));
                  } else {
                    // Auto-fill exactly what is due on the selected milestone
                    const item = scheduleItems.find(i => i.id === v);
                    if (item) {
                      const due = Number(item.amount || 0) - Number(item.amount_paid || 0);
                      setPaymentForm(prev => ({
                        ...prev, 
                        schedule_item_id: v, 
                        amount: due > 0 ? due.toFixed(2) : "0.00"
                      }));
                    }
                  }
                }}
              >
                <SelectTrigger className="mt-1 bg-white border-amber-300">
                  <SelectValue placeholder="Select a specific milestone..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Apply to Overall Balance</SelectItem>
                  {/* Show unpaid items, plus the item currently being edited (if applicable) */}
                  {scheduleItems.filter(i => i.status !== "Paid" || i.id === paymentForm.schedule_item_id).map(i => {
                    const due = Number(i.amount || 0) - Number(i.amount_paid || 0);
                    return (
                      <SelectItem key={i.id} value={i.id}>
                        {i.payment_name} — ${due.toFixed(2)} Due
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {scheduleItems.length === 0 && (
                <p className="text-xs text-slate-500 mt-1 italic">No specific payment schedule found. Applying to general balance.</p>
              )}
            </div>

            <div>
              <Label>Date Received *</Label>
              <Input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm({...paymentForm, payment_date: e.target.value})} className="mt-1 bg-white" required />
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Amount Received *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-900 font-bold">$</span>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={paymentForm.amount} 
                  onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} 
                  className="pl-7 font-bold text-lg h-12" 
                  required 
                />
              </div>
            </div>
            
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentForm.payment_method} onValueChange={v => setPaymentForm({...paymentForm, payment_method: v})}>
                <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Bank Transfer", "Credit Card", "Check", "Cash", "Other"].map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Reference Notes</Label>
              <Input className="mt-1" value={paymentForm.notes} onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} placeholder="Check #, Stripe Ref, etc." />
            </div>
            
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="bg-slate-900 text-white" disabled={isPending}>
                {isPending ? "Saving..." : (editingPaymentId ? "Update Payment" : "Lock in Payment")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="py-8 text-center text-slate-500 text-sm animate-pulse">Loading details...</div>
        )}
      </DialogContent>
    </Dialog>
  );
}