import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, ExternalLink, CheckCircle2, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrencyUSD } from "../utils/formatCurrency";

export default function StripePaymentsTab() {
  // Extracting company as well to check the Stripe connection status
  const { profile, company } = useAuth();
  const companyId = profile?.company_id;
  
  // Dynamic check to ensure the user has completed the Express onboarding
  const isConnected = !!company?.stripe_account_id;

  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // 1. Fetch only Approved quotes for this company
  const { data: quotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ["quotes-for-payment", companyId],
    enabled: !!companyId && isConnected, // Only fetch if Stripe is connected
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "Approved")
        .order("created_at", { ascending: false });
        
      if (error) throw error;
      return data || [];
    },
  });

  // 2. Fetch clients to attach emails to the checkout session
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_payment_lookup", companyId],
    enabled: !!companyId && isConnected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email")
        .eq("company_id", companyId);
        
      if (error) throw error;
      return data || [];
    },
  });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  const selectedQuote = quotes.find(q => q.id === selectedQuoteId);
  const selectedClient = selectedQuote ? clientMap[selectedQuote.client_id] : null;

  const handleCreateCheckout = async () => {
    if (!selectedQuoteId || !depositAmount) {
      return toast.error("Please select a quote and enter an amount.");
    }

    // --- NEW: Security and Math Validation ---
    const depositValue = parseFloat(depositAmount);
    
    if (isNaN(depositValue) || depositValue <= 0) {
      return toast.error("Deposit amount must be greater than zero.");
    }
    
    if (selectedQuote && depositValue > (selectedQuote.total || 0)) {
      return toast.error(`Deposit cannot exceed the quote total of ${formatCurrencyUSD(selectedQuote.total)}.`);
    }
    
    setLoading(true);
    setError(null);
    setResult(null);
    toast.loading("Contacting Stripe...");
    
    try {
      // 3. Call your Supabase Edge Function to generate the Stripe Session
      const { data, error: fnError } = await supabase.functions.invoke("createDepositCheckout", {
        body: {
          quote_id: selectedQuoteId,
          deposit_amount: depositValue,
          client_email: selectedClient?.email || "",
          client_name: selectedClient?.name || "",
        }
      });

      if (fnError) throw fnError;
      if (!data?.checkout_url) throw new Error("No checkout URL returned from Stripe.");

      setResult(data);
      toast.dismiss();
      toast.success("Payment link generated successfully!");
      
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to create checkout link. Ensure your Stripe Edge Function is deployed.");
      toast.dismiss();
      toast.error("Failed to generate link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      
      {/* --- NEW: Dynamic Connection Status Card --- */}
      {isConnected ? (
        <Card className="p-5 border-emerald-200 bg-emerald-50 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-black text-emerald-900">Stripe is Connected</p>
              <p className="text-sm font-medium text-emerald-700">Your Stripe account is successfully linked and ready to process client payments.</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5 border-amber-200 bg-amber-50 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" />
            <div>
              <p className="font-black text-amber-900">Action Required: Connect Stripe</p>
              <p className="text-sm font-medium text-amber-700">
                You must set up FuzedFlow Payments in your platform settings before you can generate deposit links.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Generate Deposit Link */}
      <Card className={`p-6 border-slate-200 shadow-sm space-y-5 bg-white ${!isConnected ? "opacity-60 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-2 mb-2 border-b border-slate-100 pb-3">
          <CreditCard className="h-5 w-5 text-amber-500" />
          <h3 className="font-black text-lg text-slate-900">Generate Deposit Payment Link</h3>
        </div>
        
        <p className="text-sm font-medium text-slate-500">
          Select an approved quote and enter a deposit amount to generate a secure Stripe checkout link. You can send this link directly to your client via email or SMS.
        </p>

        <div className="grid md:grid-cols-2 gap-6 pt-2">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Approved Quote</Label>
            <Select value={selectedQuoteId} onValueChange={setSelectedQuoteId} disabled={!isConnected || quotesLoading}>
              <SelectTrigger className="font-bold bg-slate-50 border-slate-200 h-11">
                <SelectValue placeholder={quotesLoading ? "Loading quotes..." : "Select a quote..."} />
              </SelectTrigger>
              <SelectContent>
                {quotes.length === 0 ? (
                  <SelectItem value="none" disabled>No approved quotes found</SelectItem>
                ) : (
                  quotes.map(q => (
                    <SelectItem key={q.id} value={q.id} className="font-bold">
                      {q.quote_number} — {q.title}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Deposit Amount to Collect</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">$</span>
              <Input
                type="number"
                placeholder="0.00"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                disabled={!isConnected}
                className="pl-7 font-black bg-slate-50 border-slate-200 h-11 text-lg"
              />
            </div>
          </div>
        </div>

        {selectedQuote && (
          <div className="text-sm bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2 mt-4">
            <div className="flex justify-between border-b border-slate-200 pb-2">
              <span className="font-bold text-slate-500">Client:</span> 
              <span className="font-black text-slate-900">{selectedClient?.name || "—"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200 pb-2">
              <span className="font-bold text-slate-500">Client Email:</span> 
              <span className="font-medium text-slate-700">{selectedClient?.email || "—"}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="font-bold text-slate-500">Total Quote Value:</span> 
              <span className="font-black text-emerald-600">{formatCurrencyUSD(selectedQuote.total || 0)}</span>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button
            onClick={handleCreateCheckout}
            disabled={loading || !selectedQuoteId || !depositAmount || !isConnected}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md h-11 px-6"
          >
            {loading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CreditCard className="h-5 w-5 mr-2" />}
            {loading ? "Connecting to Stripe..." : "Generate Payment Link"}
          </Button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 mt-4">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-red-900">Checkout Generation Failed</p>
              <p className="text-xs font-medium text-red-700 mt-1 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {result?.checkout_url && (
          <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl space-y-4 mt-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-base font-black text-blue-900">Payment Link Ready!</p>
            </div>
            
            <div className="bg-white p-3 rounded-lg border border-blue-100">
              <p className="text-xs font-medium text-slate-600 break-all select-all">{result.checkout_url}</p>
            </div>
            
            <div className="flex gap-3">
              <Button 
                onClick={() => {
                  navigator.clipboard.writeText(result.checkout_url);
                  toast.success("Link copied to clipboard!");
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold"
              >
                Copy Link
              </Button>
              <a href={result.checkout_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" className="w-full gap-2 font-bold border-blue-200 text-blue-700 hover:bg-blue-100">
                  <ExternalLink className="h-4 w-4" /> Test Link
                </Button>
              </a>
            </div>
          </div>
        )}
      </Card>

      {/* Info / Instructions */}
      <Card className="p-6 border-slate-200 bg-slate-50 shadow-sm">
        <h4 className="font-black text-slate-900 mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-500" /> How it works
        </h4>
        <ol className="text-sm font-medium text-slate-600 space-y-3 list-decimal list-outside pl-4">
          <li className="pl-1"><span className="font-bold text-slate-800">Approve Quote:</span> A quote must be marked as <strong>Approved</strong> to generate a payment link.</li>
          <li className="pl-1"><span className="font-bold text-slate-800">Set Amount:</span> Enter the exact deposit amount (e.g., 50% of the quote total).</li>
          <li className="pl-1"><span className="font-bold text-slate-800">Share Link:</span> Copy and send the generated Stripe link to your client via email or text.</li>
          <li className="pl-1"><span className="font-bold text-slate-800">Get Paid:</span> The client pays securely via Stripe — no account needed on their end.</li>
          <li className="pl-1"><span className="font-bold text-slate-800">Track Funds:</span> View completed transactions in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">Stripe Dashboard</a>.</li>
        </ol>
      </Card>
    </div>
  );
}