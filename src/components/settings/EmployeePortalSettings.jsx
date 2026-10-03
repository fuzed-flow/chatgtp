import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Save, Clock, Receipt, Package, BookOpen, CheckCircle2, Users } from 'lucide-react';

export default function EmployeePortalSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // Initialize toggle states based on existing settings (default to true if undefined)
  const [features, setFeatures] = useState({
    time_clock: true,
    expenses: true,
    inventory: true,
    daily_logs: true,
    tasks: true,
  });

  useEffect(() => {
    if (settings?.features) {
      setFeatures({
        time_clock: settings.features.time_clock !== false,
        expenses: settings.features.expenses !== false,
        inventory: settings.features.inventory !== false,
        daily_logs: settings.features.daily_logs !== false,
        tasks: settings.features.tasks !== false,
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
        features: {
          ...settings?.features,
          ...features
        }
      };

      const { error } = await supabase
        .from('companies')
        .update({ settings: updatedSettings })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Employee Portal settings saved successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      <Card className="p-4 bg-amber-50 border border-amber-200 text-amber-900 flex gap-3 items-start shadow-sm">
        <Users className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-sm">Employee Portal Access</p>
          <p className="font-medium text-amber-800">Customize what modules your field workers and employees can access when they log into their portal. Turning a feature off hides the tab completely from their mobile and desktop views.</p>
        </div>
      </Card>

      <Card className="p-6 border-slate-200 shadow-sm space-y-6">
        <h3 className="text-lg font-black text-slate-900 border-b pb-2">Active Modules</h3>
        
        <div className="space-y-4">
          
          {/* Time & Attendance */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Time & Attendance</Label>
                <p className="text-xs font-medium text-slate-500">Enables Clock In/Out, Timesheets, Payroll views, and Vacation requests.</p>
              </div>
            </div>
            <Switch 
              checked={features.time_clock} 
              onCheckedChange={(v) => handleToggle('time_clock', v)} 
            />
          </div>

          {/* Expenses */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Receipt className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Expense Tracking</Label>
                <p className="text-xs font-medium text-slate-500">Allows employees to upload receipts and submit out-of-pocket expenses.</p>
              </div>
            </div>
            <Switch 
              checked={features.expenses} 
              onCheckedChange={(v) => handleToggle('expenses', v)} 
            />
          </div>

          {/* Project Notes / Daily Logs */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Daily Logs & Project Notes</Label>
                <p className="text-xs font-medium text-slate-500">Enables field staff to submit end-of-day site reports and progress photos.</p>
              </div>
            </div>
            <Switch 
              checked={features.daily_logs} 
              onCheckedChange={(v) => handleToggle('daily_logs', v)} 
            />
          </div>

          {/* Task Management */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Task Assignments</Label>
                <p className="text-xs font-medium text-slate-500">Allows employees to view, manage, and complete tasks assigned to them.</p>
              </div>
            </div>
            <Switch 
              checked={features.tasks} 
              onCheckedChange={(v) => handleToggle('tasks', v)} 
            />
          </div>

          {/* Inventory */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Package className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <Label className="text-base font-bold text-slate-900 block mb-0.5">Inventory Checks</Label>
                <p className="text-xs font-medium text-slate-500">Grants access to view or request materials from company stock.</p>
              </div>
            </div>
            <Switch 
              checked={features.inventory} 
              onCheckedChange={(v) => handleToggle('inventory', v)} 
            />
          </div>

        </div>
      </Card>

      <div className="flex justify-end pt-2">
        <Button 
          onClick={() => saveFeaturesMutation.mutate()} 
          disabled={saveFeaturesMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md px-8 h-11"
        >
          {saveFeaturesMutation.isPending ? "Saving..." : <><Save className="h-4 w-4 mr-2" /> Save Module Settings</>}
        </Button>
      </div>
    </div>
  );
}