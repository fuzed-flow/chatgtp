import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from "@/components/ui/textarea";
import { FileEdit, Save } from 'lucide-react';

export default function QuoteCustomizationSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // Load defaults from the company.settings JSONB object
  const [quoteIntro, setQuoteIntro] = useState(settings?.quote_intro || '');
  const [quoteClientMessage, setQuoteClientMessage] = useState(settings?.quote_client_message || '');
  const [defaultTerms, setDefaultTerms] = useState(settings?.default_terms || '');

  const updateSettingsMutation = useMutation({
    mutationFn: async (updatedSettings) => {
      // Merge with existing settings so we don't wipe out other configurations
      const newSettings = { ...settings, ...updatedSettings };
      const { error } = await supabase.from('companies').update({ settings: newSettings }).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Quote defaults saved successfully!');
    },
    onError: (error) => toast.error(`Error saving quote defaults: ${error.message}`)
  });

  const handleSave = () => {
    updateSettingsMutation.mutate({
      quote_intro: quoteIntro,
      quote_client_message: quoteClientMessage,
      default_terms: defaultTerms
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <Card className="p-6 border-slate-200 shadow-sm bg-white">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Quote Customization
            </h2>
            <p className="text-sm font-medium text-slate-500 mt-1">Set the default text that automatically pre-fills when you build a new Quote.</p>
          </div>
          <Button onClick={handleSave} disabled={updateSettingsMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md shrink-0">
            {updateSettingsMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Defaults</>}
          </Button>
        </div>

        <div className="space-y-8">
          
          {/* 1. Introduction */}
          <div>
            <Label className="text-sm font-bold text-slate-700 mb-1 block">1. Default Executive Summary / Intro</Label>
            <p className="text-xs text-slate-500 mb-2 font-medium">Shows at the very top of the Quote PDF, outlining the project overview.</p>
            <Textarea 
              value={quoteIntro} 
              onChange={e => setQuoteIntro(e.target.value)} 
              rows={4} 
              className="resize-y bg-slate-50 font-medium text-sm" 
              placeholder="e.g. We are pleased to provide this proposal for your upcoming project..."
            />
          </div>

          {/* 2. Client Message */}
          <div>
            <Label className="text-sm font-bold text-slate-700 mb-1 block">2. Default Client Message</Label>
            <p className="text-xs text-slate-500 mb-2 font-medium">A personal note to the client that appears right before the pricing breakdown.</p>
            <Textarea 
              value={quoteClientMessage} 
              onChange={e => setQuoteClientMessage(e.target.value)} 
              rows={3} 
              className="resize-y bg-slate-50 font-medium text-sm" 
              placeholder="e.g. Thank you for the opportunity to bid on this job. Please review the line items below..."
            />
          </div>

          {/* 3. Terms and Conditions */}
          <div>
            <Label className="text-sm font-bold text-slate-700 mb-1 block">3. Default Terms and Conditions</Label>
            <p className="text-xs text-slate-500 mb-2 font-medium">The legal boilerplate, warranties, and payment requirements shown at the bottom of the Quote.</p>
            <Textarea 
              value={defaultTerms} 
              onChange={e => setDefaultTerms(e.target.value)} 
              rows={6} 
              className="resize-y bg-slate-50 font-medium text-sm" 
              placeholder="e.g. All work comes with a 1-year warranty. 50% deposit required to begin work..."
            />
          </div>

        </div>
      </Card>
    </div>
  );
}