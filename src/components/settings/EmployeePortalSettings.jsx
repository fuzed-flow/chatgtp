import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Save, Clock, Receipt, Package, BookOpen, CheckCircle2, Users, FileText, DollarSign, Palmtree } from 'lucide-react';

const TIME_FEATURES = [
  {
    key: 'employee_time_clock',
    label: 'Clock In & Out',
    description: 'Let employees start and finish their own shifts.',
    icon: Clock,
  },
  {
    key: 'employee_timesheets',
    label: 'Timesheets',
    description: 'Let employees review and submit their recorded hours.',
    icon: FileText,
  },
  {
    key: 'employee_payroll',
    label: 'My Pay',
    description: 'Show employees their personal pay summary.',
    icon: DollarSign,
  },
  {
    key: 'employee_time_off',
    label: 'Time Off',
    description: 'Let employees submit and review their own time-off requests.',
    icon: Palmtree,
  },
];

const enabledUnlessFalse = (value, fallback = true) => (
  typeof value === 'boolean' ? value : fallback
);

const portalFeaturesFromSettings = (settings) => {
  const savedFeatures = settings?.features || {};
  const legacyTimeAccess = savedFeatures.time_clock !== false;

  return {
    employee_time_clock: enabledUnlessFalse(savedFeatures.employee_time_clock, legacyTimeAccess),
    employee_timesheets: enabledUnlessFalse(savedFeatures.employee_timesheets, legacyTimeAccess),
    employee_payroll: enabledUnlessFalse(savedFeatures.employee_payroll, legacyTimeAccess),
    employee_time_off: enabledUnlessFalse(savedFeatures.employee_time_off, legacyTimeAccess),
    expenses: savedFeatures.expenses !== false,
    inventory: savedFeatures.inventory !== false,
    daily_logs: savedFeatures.daily_logs !== false,
    tasks: savedFeatures.tasks !== false,
  };
};

export default function EmployeePortalSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // Derive the first render from saved settings so controls do not briefly show
  // the wrong value while the synchronization effect is waiting to run.
  const [features, setFeatures] = useState(() => portalFeaturesFromSettings(settings));

  useEffect(() => {
    setFeatures(portalFeaturesFromSettings(settings));
  }, [settings]);

  const handleToggle = (key, value) => {
    setFeatures(prev => ({ ...prev, [key]: value }));
  };

  const saveFeaturesMutation = useMutation({
    mutationFn: async () => {
      if (!company?.id) throw new Error('Company information is unavailable. Refresh and try again.');

      const anyTimeFeatureEnabled = TIME_FEATURES.some(({ key }) => features[key]);
      const updatedSettings = {
        ...settings,
        features: {
          ...settings?.features,
          // Keep the existing master flag in sync for older screens while the
          // employee portal uses the individual controls below.
          time_clock: anyTimeFeatureEnabled,
          ...features
        }
      };

      const { data, error } = await supabase
        .from('companies')
        .update({ settings: updatedSettings })
        .eq('id', company.id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('You do not have permission to change Employee Portal settings.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company', company.id] });
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
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-base font-bold text-slate-900">Time & Attendance</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Choose exactly which personal time tools employees can open.</p>
            </div>
            <div className="divide-y divide-slate-200">
              {TIME_FEATURES.map(({ key, label, description, icon: Icon }) => (
                <div key={key} className="flex min-h-16 items-center justify-between gap-4 bg-white px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50">
                      <Icon className="h-5 w-5 text-amber-600" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor={`portal-${key}`} className="block text-sm font-bold text-slate-900">{label}</Label>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">{description}</p>
                    </div>
                  </div>
                  <Switch
                    id={`portal-${key}`}
                    aria-label={`Allow employee access to ${label}`}
                    checked={features[key]}
                    onCheckedChange={(value) => handleToggle(key, value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Expenses */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-center">
                <Receipt className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <Label htmlFor="portal-expenses" className="text-base font-bold text-slate-900 block mb-0.5">Expense Tracking</Label>
                <p className="text-xs font-medium text-slate-500">Allows employees to upload receipts and submit out-of-pocket expenses.</p>
              </div>
            </div>
            <Switch 
              id="portal-expenses"
              aria-label="Allow employee access to Expense Tracking"
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
                <Label htmlFor="portal-daily-logs" className="text-base font-bold text-slate-900 block mb-0.5">Daily Logs & Project Notes</Label>
                <p className="text-xs font-medium text-slate-500">Enables field staff to submit end-of-day site reports and progress photos.</p>
              </div>
            </div>
            <Switch 
              id="portal-daily-logs"
              aria-label="Allow employee access to Daily Logs and Project Notes"
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
                <Label htmlFor="portal-tasks" className="text-base font-bold text-slate-900 block mb-0.5">Task Assignments</Label>
                <p className="text-xs font-medium text-slate-500">Allows employees to view and update the status of tasks assigned to them.</p>
              </div>
            </div>
            <Switch 
              id="portal-tasks"
              aria-label="Allow employee access to Task Assignments"
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
                <Label htmlFor="portal-inventory" className="text-base font-bold text-slate-900 block mb-0.5">Inventory Checks</Label>
                <p className="text-xs font-medium text-slate-500">Grants access to view or request materials from company stock.</p>
              </div>
            </div>
            <Switch 
              id="portal-inventory"
              aria-label="Allow employee access to Inventory Checks"
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
