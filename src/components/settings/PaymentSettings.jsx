import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, CreditCard, Building, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';

export default function PaymentSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // --- FORM STATES ---
  const [stripeStatus, setStripeStatus] = useState('unconnected'); 
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Fees & Terms
  const [defaultTerms, setDefaultTerms] = useState('Due on Receipt');

  // --- INITIALIZE FROM CONTEXT ---
  useEffect(() => {
    if (settings) {
      setDefaultTerms(settings?.default_terms || 'Due on Receipt');
      
      // If they have a Stripe Account ID stored, mark as active
      if (company?.stripe_account_id) {
        setStripeStatus('active');
      } else {
        // Reset it if the ID goes missing!
        setStripeStatus('unconnected'); 
      }
    }
  }, [settings, company]);

  // --- SAVE MUTATION ---
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const updatedSettings = {
        ...settings,
        default_terms: defaultTerms
      };

      const { error } = await supabase
        .from('companies')
        .update({ settings: updatedSettings })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Payment settings saved successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    }
  });

  // --- LIVE STRIPE CONNECTION LAUNCHER ---
  const handleStripeConnect = async () => {
    setIsConnecting(true);
    toast.loading("Redirecting to secure FuzedFlow Payments onboarding...", { id: 'stripe-connect' });
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active authentication session found.");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connect-stripe-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to initiate Stripe onboarding.");

      if (result.url) {
        toast.dismiss('stripe-connect');
        window.location.href = result.url;
      } else {
        throw new Error("Stripe onboarding URL was not returned.");
      }
    } catch (err) {
      console.error(err);
      toast.dismiss('stripe-connect');
      toast.error(err.message || "An unexpected error occurred.");
      setIsConnecting(false);
    }
  };

  console.log("Stripe ID React sees:", company?.stripe_account_id);
  
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      {/* --- FUZEDFLOW PAYMENTS (STRIPE CONNECT) --- */}
      <Card className="p-6 border-slate-200 shadow-sm overflow-hidden relative bg-slate-900 text-white">
        <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
          <ShieldCheck className="h-32 w-32" />
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <h3 className="text-xl font-black flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-amber-400" /> FuzedFlow Payments
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              Accept credit cards and secure bank transfers directly from your invoices. Funds are automatically deposited into your bank account. Powered securely by Stripe.
            </p>
          </div>
          
          <div className="shrink-0">
            {stripeStatus === 'active' ? (
              <div className="flex flex-col items-end gap-3">
                <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider">Account Active</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  View Stripe Dashboard <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </div>
            ) : (
              <Button 
                onClick={handleStripeConnect} 
                disabled={isConnecting}
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6 h-12 shadow-lg"
              >
                {isConnecting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting...</>
                ) : (
                  <><Building className="h-4 w-4 mr-2" /> Link Bank Account</>
                )}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* --- FEES & TERMS --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-6 bg-white">
        <h3 className="text-lg font-black text-slate-900 border-b pb-3">Invoicing Defaults</h3>
        
        <div className="max-w-md">
          <div className="space-y-2">
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Default Payment Terms</Label>
            <Select value={defaultTerms} onValueChange={setDefaultTerms}>
              <SelectTrigger className="font-medium bg-slate-50">
                <SelectValue placeholder="Select Terms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Due on Receipt">Due on Receipt</SelectItem>
                <SelectItem value="Net 15">Net 15 Days</SelectItem>
                <SelectItem value="Net 30">Net 30 Days</SelectItem>
                <SelectItem value="Net 60">Net 60 Days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">Sets the default due date for new invoices.</p>
          </div>
        </div>
      </Card>

      {/* MASTER STICKY SAVE BAR */}
      <div className="flex justify-end pt-2">
        <Button 
          onClick={() => saveSettingsMutation.mutate()} 
          disabled={saveSettingsMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md px-8 h-11"
        >
          {saveSettingsMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Payment Settings</>}
        </Button>
      </div>

    </div>
  );
}