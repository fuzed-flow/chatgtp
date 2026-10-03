import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Save, UserCircle, FileText, Receipt, FilePlus, Download, Image as ImageIcon } from 'lucide-react';

export default function ClientPortalSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  const [features, setFeatures] = useState({
    portal_active: true,
    show_quotes: true,
    show_change_orders: true,
    show_invoices: true,
    show_documents: true,
    show_portfolio: true,
    welcome_message: "Welcome to your client portal. Here you can view your project progress, approve quotes, and manage your invoices."
  });

  useEffect(() => {
    if (settings?.client_portal) {
      setFeatures({
        portal_active: settings.client_portal.portal_active !== false,
        show_quotes: settings.client_portal.show_quotes !== false,
        show_change_orders: settings.client_portal.show_change_orders !== false,
        show_invoices: settings.client_portal.show_invoices !== false,
        show_documents: settings.client_portal.show_documents !== false,
        show_portfolio: settings.client_portal.show_portfolio !== false,
        welcome_message: settings.client_portal.welcome_message || "Welcome to your client portal. Here you can view your project progress, approve quotes, and manage your invoices."
      });
    }
  }, [settings]);

  const handleToggle = (key, value) => {
    setFeatures(prev => ({ ...prev, [key]: value }));
  };

  const saveFeaturesMutation = useMutation({
    mutationFn: async () => {
      const updatedSettings = {
        ...settings,
        client_portal: features
      };

      const { error } = await supabase
        .from('companies')
        .update({ settings: updatedSettings })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Client Portal settings saved successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      <Card className="p-4 bg-indigo-50 border border-indigo-200 text-indigo-900 flex gap-3 items-start shadow-sm">
        <UserCircle className="h-5 w-5 shrink-0 text-indigo-600 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-sm">Client Portal Configuration</p>
          <p className="font-medium text-indigo-800">Customize what your clients can see when they log into their dedicated portal. Turning a module off hides the tab completely from their view.</p>
        </div>
      </Card>

      <Card className="p-6 border-slate-200 shadow-sm space-y-6 bg-white">
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <h3 className="text-lg font-black text-slate-900 block mb-0.5">Enable Client Portal</h3>
            <p className="text-xs text-slate-500">Allow clients to log in and view their dashboard.</p>
          </div>
          <Switch checked={features.portal_active} onCheckedChange={(v) => handleToggle('portal_active', v)} />
        </div>

        <div className={`space-y-3 transition-opacity ${!features.portal_active ? 'opacity-50 pointer-events-none' : ''}`}>
          <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Custom Welcome Message</Label>
          <Textarea 
            value={features.welcome_message}
            onChange={(e) => handleToggle('welcome_message', e.target.value)}
            placeholder="Type a welcome message for your clients..."
            className="bg-slate-50"
            rows={3}
          />
          <p className="text-[10px] text-slate-400">This message appears at the top of their portal dashboard.</p>
        </div>
      </Card>

      <Card className="p-6 border-slate-200 shadow-sm space-y-4 bg-white transition-opacity duration-200">
        <h3 className="text-lg font-black text-slate-900 border-b pb-2">Visible Modules</h3>
        
        <div className={`space-y-4 ${!features.portal_active ? 'opacity-50 pointer-events-none' : ''}`}>
          
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Quotes Tab</Label>
                <p className="text-xs font-medium text-slate-500">Allow clients to view pending and accepted quotes.</p>
              </div>
            </div>
            <Switch checked={features.show_quotes} onCheckedChange={(v) => handleToggle('show_quotes', v)} />
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <FilePlus className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Change Orders Tab</Label>
                <p className="text-xs font-medium text-slate-500">Allow clients to view and approve change orders.</p>
              </div>
            </div>
            <Switch checked={features.show_change_orders} onCheckedChange={(v) => handleToggle('show_change_orders', v)} />
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Receipt className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Invoices Tab</Label>
                <p className="text-xs font-medium text-slate-500">Allow clients to view outstanding and paid invoices.</p>
              </div>
            </div>
            <Switch checked={features.show_invoices} onCheckedChange={(v) => handleToggle('show_invoices', v)} />
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Download className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Documents Tab</Label>
                <p className="text-xs font-medium text-slate-500">Allow clients to view and download attached quote documents.</p>
              </div>
            </div>
            <Switch checked={features.show_documents} onCheckedChange={(v) => handleToggle('show_documents', v)} />
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-pink-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Portfolio Tab</Label>
                <p className="text-xs font-medium text-slate-500">Allow clients to view past project photos attached to quotes.</p>
              </div>
            </div>
            <Switch checked={features.show_portfolio} onCheckedChange={(v) => handleToggle('show_portfolio', v)} />
          </div>

        </div>
      </Card>

      <div className="flex justify-end pt-2">
        <Button 
          onClick={() => saveFeaturesMutation.mutate()} 
          disabled={saveFeaturesMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md px-8 h-11"
        >
          {saveFeaturesMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Portal Settings</>}
        </Button>
      </div>
    </div>
  );
}