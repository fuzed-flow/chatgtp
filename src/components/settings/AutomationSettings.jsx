import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { checkAccess } from '@/lib/planConfig'; // 👈 Import checkAccess
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Save, Bot, FileText, Receipt, Zap, Clock, Lock } from 'lucide-react';

export default function AutomationSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // 👇 Check if the current plan supports Change Orders
  const canAccessChangeOrders = checkAccess(company?.plan_id, 'hasChangeOrders');

  // --- FORM STATES ---
  // Quotes
  const [quoteEnabled, setQuoteEnabled] = useState(true);
  const [quoteFollowUp1, setQuoteFollowUp1] = useState(3);
  const [quoteFollowUp2, setQuoteFollowUp2] = useState(7);

  // Invoices
  const [invoiceEnabled, setInvoiceEnabled] = useState(true);
  const [invoicePreDue, setInvoicePreDue] = useState(3);
  const [invoiceOverdue1, setInvoiceOverdue1] = useState(3);
  const [invoiceOverdue2, setInvoiceOverdue2] = useState(14);

  // Change Orders
  const [coEnabled, setCoEnabled] = useState(true);
  const [coFollowUp1, setCoFollowUp1] = useState(2);

  // --- INITIALIZE FROM CONTEXT ---
  useEffect(() => {
    if (settings?.automations) {
      const a = settings.automations;
      
      setQuoteEnabled(a.quote_enabled !== false);
      setQuoteFollowUp1(a.quote_followup_1 || 3);
      setQuoteFollowUp2(a.quote_followup_2 || 7);

      setInvoiceEnabled(a.invoice_enabled !== false);
      setInvoicePreDue(a.invoice_predue || 3);
      setInvoiceOverdue1(a.invoice_overdue_1 || 3);
      setInvoiceOverdue2(a.invoice_overdue_2 || 14);

      setCoEnabled(a.co_enabled !== false);
      setCoFollowUp1(a.co_followup_1 || 2);
    }
  }, [settings]);

  // --- SAVE MUTATION ---
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const updatedAutomations = {
        quote_enabled: quoteEnabled,
        quote_followup_1: Number(quoteFollowUp1),
        quote_followup_2: Number(quoteFollowUp2),
        
        invoice_enabled: invoiceEnabled,
        invoice_predue: Number(invoicePreDue),
        invoice_overdue_1: Number(invoiceOverdue1),
        invoice_overdue_2: Number(invoiceOverdue2),
        
        co_enabled: coEnabled,
        co_followup_1: Number(coFollowUp1),
      };

      const { error } = await supabase
        .from('companies')
        .update({ settings: { ...settings, automations: updatedAutomations } })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Automation schedules saved successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save automations: ${error.message}`);
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      <Card className="p-4 bg-blue-50 border border-blue-200 text-blue-900 flex gap-3 items-start shadow-sm">
        <Bot className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-sm">Autopilot Communications</p>
          <p className="font-medium text-blue-800">The system will automatically email and text your clients based on the schedules below. Automations are paused the moment a quote is signed, an invoice is paid, or a change order is approved.</p>
        </div>
      </Card>

      {/* --- QUOTES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4 bg-white">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-500" /> Quote Follow-ups
          </h3>
          <Switch checked={quoteEnabled} onCheckedChange={setQuoteEnabled} />
        </div>
        
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 transition-opacity ${!quoteEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">First Check-in</Label>
            <div className="relative">
              <Input type="number" min="1" value={quoteFollowUp1} onChange={e => setQuoteFollowUp1(e.target.value)} className="pl-9 font-medium" />
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days later</span>
            </div>
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Final Push</Label>
            <div className="relative">
              <Input type="number" min="1" value={quoteFollowUp2} onChange={e => setQuoteFollowUp2(e.target.value)} className="pl-9 font-medium" />
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days later</span>
            </div>
          </div>
        </div>
      </Card>

      {/* --- INVOICES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4 bg-white">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-amber-500" /> Invoice Collections
          </h3>
          <Switch checked={invoiceEnabled} onCheckedChange={setInvoiceEnabled} />
        </div>
        
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-6 transition-opacity ${!invoiceEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Pre-Due Reminder</Label>
            <div className="relative">
              <Input type="number" min="1" value={invoicePreDue} onChange={e => setInvoicePreDue(e.target.value)} className="pl-9 font-medium" />
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days before</span>
            </div>
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Late Notice #1</Label>
            <div className="relative">
              <Input type="number" min="1" value={invoiceOverdue1} onChange={e => setInvoiceOverdue1(e.target.value)} className="pl-9 font-medium" />
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days late</span>
            </div>
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Late Notice #2</Label>
            <div className="relative">
              <Input type="number" min="1" value={invoiceOverdue2} onChange={e => setInvoiceOverdue2(e.target.value)} className="pl-9 font-medium" />
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days late</span>
            </div>
          </div>
        </div>
      </Card>

      {/* --- CHANGE ORDERS --- */}
      <Card className={`p-6 border-slate-200 shadow-sm space-y-4 bg-white ${!canAccessChangeOrders ? 'border-dashed bg-slate-50' : ''}`}>
        {!canAccessChangeOrders ? (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                <Lock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Change Order Automations</h3>
                <p className="text-xs text-slate-500 font-medium">Automatic follow-ups for Change Orders are locked on the Starter plan.</p>
              </div>
            </div>
            <Button 
              type="button" 
              onClick={() => window.location.href = '/Settings?tab=team'} 
              size="sm" 
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shrink-0"
            >
              Upgrade to Professional
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" /> Change Order Approvals
              </h3>
              <Switch checked={coEnabled} onCheckedChange={setCoEnabled} />
            </div>
            
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 transition-opacity ${!coEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Urgent Check-in</Label>
                <div className="relative">
                  <Input type="number" min="1" value={coFollowUp1} onChange={e => setCoFollowUp1(e.target.value)} className="pl-9 font-medium" />
                  <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">Days later</span>
                </div>
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-xs text-slate-500">Change orders require rapid turnarounds. Keeping this follow-up tight avoids job site delays.</p>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* MASTER STICKY SAVE BAR */}
      <div className="flex justify-end pt-2">
        <Button 
          onClick={() => saveSettingsMutation.mutate()} 
          disabled={saveSettingsMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md px-8 h-11"
        >
          {saveSettingsMutation.isPending ? "Saving Automations..." : <><Save className="h-4 w-4 mr-2" /> Save Automations</>}
        </Button>
      </div>

    </div>
  );
}