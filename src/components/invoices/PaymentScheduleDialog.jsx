import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function PaymentScheduleDialog({ open, onOpenChange, initialItems = [], invoiceTotal = 0, onSave }) {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setItems(initialItems.length > 0 ? initialItems : []);
    }
  }, [open, initialItems]);

  const addItem = () => {
    setItems([...items, {
      payment_name: `Payment ${items.length + 1}`,
      amount: 0,
      due_event: "Upon Completion",
      status: "Pending",
      amount_paid: 0,
    }]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  };

  const removeItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (items.length === 0) {
      toast.error("Add at least one payment to the schedule");
      return;
    }

    if (items.some(item => !item.payment_name || item.amount <= 0)) {
      toast.error("All payments must have a name and amount greater than $0");
      return;
    }

    setSaving(true);
    await onSave(items);
    setSaving(false);
    onOpenChange(false);
  };

  const totalScheduled = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const remainingToSchedule = invoiceTotal - totalScheduled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900">Edit Payment Milestones</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
          {items.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-500 font-medium">No milestones defined.</p>
              <p className="text-xs text-slate-400 mt-1">Click below to start breaking down the contract total.</p>
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={idx} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3 relative group transition-all hover:border-amber-300">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Milestone Name *</Label>
                    <Input
                      value={item.payment_name}
                      onChange={e => updateItem(idx, 'payment_name', e.target.value)}
                      placeholder="e.g., Deposit, Final Payment"
                      className="mt-1 font-semibold"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Amount *</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-2.5 text-slate-500 font-bold">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.amount}
                        onChange={e => updateItem(idx, 'amount', Number(e.target.value))}
                        className="pl-7 font-bold text-slate-900"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Requirement / Trigger</Label>
                  <Input
                    value={item.due_event || ""}
                    onChange={e => updateItem(idx, 'due_event', e.target.value)}
                    placeholder="e.g., Upon contract signing, After drywall inspection"
                    className="mt-1"
                  />
                </div>
                
                {/* Delete Button (Only visible if unpaid) */}
                {item.status !== "Paid" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeItem(idx)}
                    className="absolute -top-3 -right-3 h-8 w-8 bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Math & Totals Footer */}
        <div className="pt-4 border-t border-slate-200 mt-2">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Contract Total</p>
              <p className="text-lg font-bold text-slate-900">${(invoiceTotal || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
            </div>
            
            <div className="text-right">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Remaining to Schedule</p>
              {Math.abs(remainingToSchedule) > 0.01 ? (
                <div className="flex items-center justify-end gap-1.5 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <p className="text-lg font-bold">${remainingToSchedule.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                </div>
              ) : (
                <p className="text-lg font-bold text-emerald-600">Balanced</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-4 pt-2">
          <Button onClick={addItem} variant="outline" className="bg-white border-dashed border-slate-300 text-slate-700 font-bold">
            <Plus className="h-4 w-4 mr-2" /> Add Milestone
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || Math.abs(remainingToSchedule) > 0.01} className="bg-slate-900 text-white hover:bg-slate-800 font-bold">
              {saving ? "Saving..." : "Confirm Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}