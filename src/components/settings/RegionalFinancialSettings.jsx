import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Globe, DollarSign, Percent, Calendar, Calculator, FileText, Hash } from 'lucide-react';

export default function RegionalFinancialSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // --- FORM STATES ---
  // Regional
  const [timezone, setTimezone] = useState('America/Edmonton');
  const [currency, setCurrency] = useState('CAD');
  const [dateFormat, setDateFormat] = useState('MMM d, yyyy');

  // Financial (Primary Tax)
  const [taxLabel, setTaxLabel] = useState('GST');
  const [taxRate, setTaxRate] = useState(5.0);
  const [taxId, setTaxId] = useState(''); 
  const [defaultMargin, setDefaultMargin] = useState(20);

  // Financial (Secondary Tax - PST/QST)
  const [enableSecondaryTax, setEnableSecondaryTax] = useState(false);
  const [secondaryTaxLabel, setSecondaryTaxLabel] = useState('PST');
  const [secondaryTaxRate, setSecondaryTaxRate] = useState(7.0);
  const [secondaryTaxId, setSecondaryTaxId] = useState('');

  // --- INITIALIZE FROM CONTEXT ---
  useEffect(() => {
    if (company) {
      setTimezone(company.timezone || 'America/Edmonton');
      setTaxRate(company.gst_rate ?? settings?.tax_rate ?? 5.0);
      setTaxLabel(settings?.tax_label || 'GST');
      setTaxId(settings?.tax_id || ''); 
      setCurrency(settings?.currency || 'CAD');
      setDateFormat(settings?.date_format || 'MMM d, yyyy');
      setDefaultMargin(settings?.default_margin || 20);

      // Load Secondary Tax Settings
      setEnableSecondaryTax(settings?.enable_secondary_tax || false);
      setSecondaryTaxLabel(settings?.secondary_tax_label || 'PST');
      setSecondaryTaxRate(settings?.secondary_tax_rate ?? 7.0);
      setSecondaryTaxId(settings?.secondary_tax_id || '');
    }
  }, [company, settings]);

  // --- SAVE MUTATION ---
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const updatedSettings = {
        ...settings,
        tax_rate: Number(taxRate),
        tax_label: taxLabel,
        tax_id: taxId, 
        currency: currency,
        date_format: dateFormat,
        default_margin: Number(defaultMargin),
        // Save Secondary Tax info
        enable_secondary_tax: enableSecondaryTax,
        secondary_tax_label: secondaryTaxLabel,
        secondary_tax_rate: Number(secondaryTaxRate),
        secondary_tax_id: secondaryTaxId
      };

      const { error } = await supabase
        .from('companies')
        .update({
          timezone: timezone,
          gst_rate: Number(taxRate), 
          settings: updatedSettings
        })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Regional & Financial settings saved successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    }
  });

  const timezones = [
    { value: 'America/Vancouver', label: 'Pacific Time (PT) - Vancouver / LA' },
    { value: 'America/Edmonton', label: 'Mountain Time (MT) - Edmonton / Denver' },
    { value: 'America/Winnipeg', label: 'Central Time (CT) - Winnipeg' },
    { value: 'America/Chicago', label: 'Central Time (CT) - Chicago' },
    { value: 'America/Toronto', label: 'Eastern Time (ET) - Toronto / New York' },
    { value: 'America/Halifax', label: 'Atlantic Time (AST) - Halifax' },
    { value: 'America/St_Johns', label: 'Newfoundland Time (NT) - St. Johns' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      {/* --- REGIONAL SETTINGS --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-6 bg-white">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b pb-3">
          <Globe className="h-5 w-5 text-amber-500" /> Regional Preferences
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">System Timezone</Label>
            <p className="text-[10px] text-slate-400 mb-2">Dictates how timestamps display on the Time Clock and Daily Logs.</p>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="font-medium bg-slate-50">
                <SelectValue placeholder="Select Timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Date Format</Label>
            <p className="text-[10px] text-slate-400 mb-2">How dates are printed on PDFs and Client Portals.</p>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger className="font-medium bg-slate-50">
                <SelectValue placeholder="Select Date Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MMM d, yyyy">Jan 1, 2024 (MMM d, yyyy)</SelectItem>
                <SelectItem value="MM/dd/yyyy">01/31/2024 (MM/dd/yyyy)</SelectItem>
                <SelectItem value="dd/MM/yyyy">31/01/2024 (dd/MM/yyyy)</SelectItem>
                <SelectItem value="yyyy-MM-dd">2024-01-31 (yyyy-MM-dd)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* --- FINANCIAL SETTINGS --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-6 bg-white">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b pb-3">
          <Calculator className="h-5 w-5 text-amber-500" /> Financial & Tax Defaults
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="lg:col-span-2">
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Base Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="font-medium bg-slate-50">
                <SelectValue placeholder="Select Currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CAD">CAD - Canadian Dollar ($)</SelectItem>
                <SelectItem value="USD">USD - US Dollar ($)</SelectItem>
                <SelectItem value="GBP">GBP - British Pound (£)</SelectItem>
                <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
                <SelectItem value="AUD">AUD - Australian Dollar ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="lg:col-span-2">
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Target Profit Margin</Label>
            <div className="relative">
              <Input 
                type="number" 
                step="1" 
                value={defaultMargin} 
                onChange={e => setDefaultMargin(e.target.value)} 
                className="font-medium bg-slate-50 pr-8" 
              />
              <Percent className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Default estimator markup.</p>
          </div>

          {/* PRIMARY TAX BLOCK */}
          <div className="lg:col-span-4 mt-2">
            <h4 className="text-sm font-bold text-slate-800 border-b pb-2 mb-4">Primary Tax (e.g., GST / HST / VAT)</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Tax/Business Number</Label>
                <div className="relative">
                  <Hash className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input 
                    type="text" 
                    value={taxId} 
                    onChange={e => setTaxId(e.target.value)} 
                    placeholder="e.g. 12345 6789 RT0001"
                    className="font-medium bg-slate-50 pl-9" 
                  />
                </div>
              </div>

              <div className="md:col-span-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Display Label</Label>
                <div className="relative">
                  <FileText className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input 
                    type="text" 
                    value={taxLabel} 
                    onChange={e => setTaxLabel(e.target.value)} 
                    placeholder="GST"
                    className="font-medium bg-slate-50 pl-9" 
                  />
                </div>
              </div>

              <div className="md:col-span-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Rate</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={taxRate} 
                    onChange={e => setTaxRate(e.target.value)} 
                    className="font-medium bg-slate-50 pr-8" 
                  />
                  <Percent className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
          </div>

          {/* SECONDARY TAX BLOCK */}
          <div className="lg:col-span-4 mt-2 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Secondary Tax (e.g., PST / QST)</h4>
                <p className="text-xs text-slate-500 mt-1">Enable if your province or state requires a secondary blended tax.</p>
              </div>
              <Switch checked={enableSecondaryTax} onCheckedChange={setEnableSecondaryTax} />
            </div>

            {enableSecondaryTax && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4 border-t border-slate-200 animate-in fade-in slide-in-from-top-2">
                <div className="md:col-span-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Secondary Tax Number (Optional)</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      type="text" 
                      value={secondaryTaxId} 
                      onChange={e => setSecondaryTaxId(e.target.value)} 
                      placeholder="e.g. PST-1234567"
                      className="font-medium bg-white pl-9" 
                    />
                  </div>
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Display Label</Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      type="text" 
                      value={secondaryTaxLabel} 
                      onChange={e => setSecondaryTaxLabel(e.target.value)} 
                      placeholder="PST"
                      className="font-medium bg-white pl-9" 
                    />
                  </div>
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Rate</Label>
                  <div className="relative">
                    <Input 
                      type="number" 
                      step="0.01" 
                      value={secondaryTaxRate} 
                      onChange={e => setSecondaryTaxRate(e.target.value)} 
                      className="font-medium bg-white pr-8" 
                    />
                    <Percent className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>
            )}
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
          {saveSettingsMutation.isPending ? "Saving Settings..." : <><Save className="h-4 w-4 mr-2" /> Save Regional Settings</>}
        </Button>
      </div>

    </div>
  );
}