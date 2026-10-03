import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Building2, UploadCloud, Loader2, Save } from 'lucide-react';

import AddressAutocomplete from '../shared/AddressAutocomplete';

export default function BrandingSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  // --- IDENTITY FORM STATES ---
  const [companyName, setCompanyName] = useState(company?.name || '');
  const [companyPhone, setCompanyPhone] = useState(settings?.phone || '');
  const [companyEmail, setCompanyEmail] = useState(settings?.email || '');
  const [companyWebsite, setCompanyWebsite] = useState(settings?.website || '');
  const [companyAddress, setCompanyAddress] = useState(settings?.address || ''); 

  // --- PDF SETTINGS FORM STATES ---
  const [brandColor, setBrandColor] = useState(settings?.pdf?.brand_color || '#f59e0b');
  const [showItemPrices, setShowItemPrices] = useState(settings?.pdf?.show_item_prices !== false);
  const [showPhaseTotals, setShowPhaseTotals] = useState(settings?.pdf?.show_phase_totals !== false);

  const updateSettingsMutation = useMutation({
    mutationFn: async ({ updatedFields, updatedSettings }) => {
      const payloads = { ...updatedFields };
      if (updatedSettings) {
        payloads.settings = { ...settings, ...updatedSettings };
      }
      const { error } = await supabase.from('companies').update(payloads).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Settings saved successfully');
    },
    onError: (error) => toast.error(`Error saving settings: ${error.message}`)
  });

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${company.id}-${Date.now()}.${fileExt}`;

    try {
      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, file);
      if (uploadError) throw new Error("Ensure 'logos' storage bucket exists and is Public.");

      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);
      updateSettingsMutation.mutate({ updatedFields: { logo_url: publicUrl } });
    } catch (err) {
      toast.error(err.message || 'Failed to upload logo.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveIdentity = () => {
    updateSettingsMutation.mutate({ 
      updatedFields: { name: companyName },
      updatedSettings: { 
        phone: companyPhone, 
        email: companyEmail, 
        website: companyWebsite,
        address: companyAddress
      }
    });
  };

  // --- NEW: DEDICATED SAVE FUNCTION FOR PDF STYLING ---
  const handleSavePDFSettings = () => {
    updateSettingsMutation.mutate({
      updatedSettings: {
        pdf: {
          ...settings?.pdf,
          brand_color: brandColor,
          show_item_prices: showItemPrices,
          show_phase_totals: showPhaseTotals
        }
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      
      {/* IDENTITY CARD */}
      <Card className="p-6 border-slate-200 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-6 border-b pb-2">Company Identity</h3>
        
        <div className="space-y-6">
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Company Logo</Label>
            <div className="flex items-center gap-6">
              <div className="h-20 w-40 bg-slate-50 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">
                {company?.logo_url ? (
                  <img src={company.logo_url} alt="Logo" className="h-full w-full object-contain p-2" />
                ) : (
                  <Building2 className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div>
                <Input type="file" accept="image/*" id="logo-upload" className="hidden" onChange={handleLogoUpload} disabled={isUploading} />
                <Label htmlFor="logo-upload" className="cursor-pointer inline-flex items-center px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all">
                  {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UploadCloud className="h-4 w-4 mr-2" />}
                  Upload Logo
                </Label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label className="text-xs font-bold text-slate-500 mb-1 block">Company Name *</Label>
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="font-bold bg-slate-50" />
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-500 mb-1 block">Phone Number</Label>
              <Input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} className="font-medium bg-slate-50" />
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-500 mb-1 block">Email Address</Label>
              <Input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} className="font-medium bg-slate-50" />
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-500 mb-1 block">Website</Label>
              <Input value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} placeholder="https://" className="font-medium bg-slate-50" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs font-bold text-slate-500 mb-1 block">Physical / Billing Address</Label>
              <AddressAutocomplete 
                value={companyAddress} 
                onChange={setCompanyAddress} 
                placeholder="Start typing your company address..." 
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end border-t border-slate-100">
            <Button 
              onClick={handleSaveIdentity} 
              disabled={updateSettingsMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md shrink-0"
            >
              {updateSettingsMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Identity</>}
            </Button>
          </div>
        </div>
      </Card>

      {/* PDF STYLING CARD */}
      <Card className="p-6 border-slate-200 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-6 border-b pb-2">PDF Document Styling</h3>
        
        <div className="space-y-6">
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Primary Brand Color</Label>
            <div className="flex items-center gap-3">
              <input 
                type="color" 
                value={brandColor} 
                onChange={(e) => setBrandColor(e.target.value)} 
                className="h-10 w-10 p-1 bg-white border border-slate-200 rounded cursor-pointer" 
              />
              <Input 
                value={brandColor} 
                onChange={(e) => setBrandColor(e.target.value)} 
                className="w-32 font-medium" 
              />
            </div>
          </div>
          
          <div className="border-t border-slate-100 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div><p className="font-bold text-slate-900">Show Item Quantities & Prices</p></div>
              <Switch checked={showItemPrices} onCheckedChange={setShowItemPrices} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div><p className="font-bold text-slate-900">Show Phase/Category Totals</p></div>
              <Switch checked={showPhaseTotals} onCheckedChange={setShowPhaseTotals} />
            </div>
          </div>

          {/* NEW: PDF SAVE BUTTON */}
          <div className="pt-4 flex justify-end border-t border-slate-100">
            <Button 
              onClick={handleSavePDFSettings} 
              disabled={updateSettingsMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md shrink-0"
            >
              {updateSettingsMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save PDF Settings</>}
            </Button>
          </div>

        </div>
      </Card>
    </div>
  );
}