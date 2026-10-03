import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { checkAccess } from '@/lib/planConfig'; // 👈 NEW IMPORT
import UpgradeWall from '@/components/shared/UpgradeWall'; // 👈 NEW IMPORT
import { 
  Building2, Globe, CreditCard, Zap, MonitorSmartphone, Lock, 
  Bell, Blocks, Users, Palette, MessageSquare, FileText, Loader2, DollarSign
} from 'lucide-react';

// UI Components
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// Modular Settings Components
import BrandingSettings from "../components/settings/BrandingSettings";
import QuoteCustomizationSettings from "../components/settings/QuoteCustomizationSettings";
import MessageTemplatesSettings from "../components/settings/MessageTemplatesSettings";
import EmployeePortalSettings from "../components/settings/EmployeePortalSettings";
import TeamManagementSettings from "../components/settings/TeamManagementSettings";
import RegionalFinancialSettings from "../components/settings/RegionalFinancialSettings";
import PaymentSettings from "../components/settings/PaymentSettings";
import AutomationSettings from "../components/settings/AutomationSettings";
import NotificationSettings from "../components/settings/NotificationSettings";
import ClientPortalSettings from "../components/settings/ClientPortalSettings";

export default function AdminSettings() {
  const { profile, company } = useAuth();
  const navigate = useNavigate();
  
  // 1. Define Role Bools
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';
  const isManager = profile?.role === 'manager';

  // 👇 2. GRAB FEATURE FLAGS 👇
  const canAccessHR = checkAccess(company?.plan_id, 'hasHR');
  // 👆 ---------------------- 👆

  // 3. Default Admins to Branding, Default Managers to Quote Customization
  const [activeTab, setActiveTab] = useState(isAdmin ? 'branding' : 'quote_custom');
  
  // 4. Loading States for Integrations
  const [isConnectingQBO, setIsConnectingQBO] = useState(false);
  const [isManagingBilling, setIsManagingBilling] = useState(false);
  const [isConnectingStripe, setIsConnectingStripe] = useState(false);

  // Security Check: Only allow Admins and Managers
  if (!isAdmin && !isManager) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-black text-slate-900">Access Denied</h2>
          <p className="text-slate-500 font-medium">You do not have permission to view Settings.</p>
        </div>
      </div>
    );
  }

  // --- EDGE FUNCTION INTEGRATIONS ---

  // A. QuickBooks Connection
  const handleQBOConnect = async () => {
    toast.info("Coming soon!");
  };

  // B. Stripe Connect (Money flowing TO the user from their clients)
  const handleStripeConnect = async () => {
    setIsConnectingStripe(true);
    toast.loading("Setting up your payments portal...");

    try {
      const { data, error } = await supabase.functions.invoke('connect-stripe-express', {
        body: {} 
      });
      if (error) throw error;
      toast.dismiss();

      if (data?.url) window.location.href = data.url;
      else throw new Error("Missing Stripe Connect URL.");
    } catch (error) {
      toast.dismiss();
      toast.error("Failed to connect Stripe: " + error.message);
      setIsConnectingStripe(false);
    }
  };

  // C. Subscription Billing (Money flowing FROM the user to you)
  const handleManageSubscription = async () => {
  if (!company?.stripe_customer_id) {
    toast.info("Choose a plan to start your 14-day free trial!");
    window.location.href = "https://www.fuzedflow.com/#pricing"; 
    return;
  }

  setIsManagingBilling(true);
  // FIX: Capture the ID into a variable so it can be dismissed later
  const loadingToastId = toast.loading("Opening secure billing portal...");

  try {
    const { data, error } = await supabase.functions.invoke('create-portal-session', {
      body: { return_url: window.location.href } 
    });

    if (error) throw error;

    if (data?.url) {
      toast.dismiss(loadingToastId);
      window.location.href = data.url; 
    } else {
      throw new Error("Missing portal URL in response.");
    }
    
  } catch (error) {
    toast.dismiss(loadingToastId); 
    toast.error("Failed to open billing portal: " + error.message);
    setIsManagingBilling(false);
  }
};

  // --- SIDEBAR CONFIG ---
  const menuItems = [
    { id: 'branding', label: 'Branding & PDFs', icon: Palette },
    { id: 'quote_custom', label: 'Quote Customization', icon: FileText },
    { id: 'messages', label: 'Message Templates', icon: MessageSquare },
    { id: 'employee_portal', label: 'Employee Portal', icon: Blocks },
    { id: 'team', label: 'Team Management', icon: Users },
    { id: 'financials', label: 'Regional & Financial', icon: Globe },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'automations', label: 'Automations', icon: Zap },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'portal', label: 'Client Portal', icon: MonitorSmartphone },
  ];

  // 🛡️ Filter out restricted menus for Managers
  const restrictedForManagers = ['branding', 'employee_portal', 'team', 'payments'];
  const visibleMenuItems = menuItems.filter(item => 
    isAdmin ? true : !restrictedForManagers.includes(item.id)
  );

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 flex flex-col md:flex-row gap-8 items-start">
      
      {/* NAVIGATION SIDEBAR / DROPDOWN PANEL */}
      <aside className="w-full md:w-64 shrink-0 space-y-4 md:sticky md:top-8 flex flex-col">
        <div className="px-2 hidden md:block">
          <h1 className="text-2xl font-black text-slate-900">Settings</h1>
          <p className="text-sm font-medium text-slate-500">Manage your workspace.</p>
        </div>

        {/* MOBILE DROP DOWN VIEW */}
        <div className="block md:hidden w-full space-y-2">
          <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Settings Section</Label>
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full h-12 bg-white border-slate-200 shadow-sm font-bold text-slate-800 focus:ring-amber-500">
              <SelectValue placeholder="Select section..." />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              {visibleMenuItems.map(item => {
                const Icon = item.icon;
                return (
                  <SelectItem key={item.id} value={item.id} className="font-semibold text-slate-700 focus:bg-amber-50 focus:text-amber-900">
                    <div className="flex items-center gap-2.5 py-1">
                      <Icon className="h-4 w-4 text-slate-400" />
                      <span>{item.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        
        {/* DESKTOP SIDEBAR NAVIGATION */}
        <nav className="hidden md:block space-y-1">
          {visibleMenuItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-bold text-sm transition-all ${
                  isActive 
                    ? 'bg-amber-100 text-amber-900' 
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-amber-600' : 'text-slate-400'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* 🛡️ ADMIN ONLY: INTEGRATIONS & BILLING PANEL */}
        {isAdmin && (
          <div className="pt-4 border-t border-slate-200 px-2 grid grid-cols-1 gap-3 w-full">
            
            {/* QUICKBOOKS BUTTON */}
            <div className="flex flex-col">
              <Button 
  onClick={() => toast.info("Coming soon!")}
  className={`w-full font-bold h-10 shadow-sm transition-all ${
    company?.qbo_connected 
      ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-100' 
      : 'bg-[#2ca01c] hover:bg-[#238016] text-white'
  }`}
>
  <svg className="h-4 w-4 mr-2 shrink-0" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.664 16.336c-.464.464-1.08.704-1.728.704-.648 0-1.264-.24-1.728-.704l-3.52-3.52v3.312c0 .48-.384.88-.88.88s-.88-.384-.88-.88V7.808c0-.48.384-.88.88-.88s.88.384.88.88v3.312l3.52-3.52c.464-.464 1.08-.704 1.728-.704.648 0 1.264.24 1.728.704.944.944.944 2.496 0 3.44L14.32 12l3.344 3.344c.944.944.944 2.496 0 3.44z"/>
  </svg>
  {company?.qbo_connected ? 'QuickBooks Connected' : 'Connect QuickBooks'}
</Button>
            </div>

            {/* MANAGE APP SUBSCRIPTION BUTTON */}
            <div className="flex flex-col mt-2">
              <Button 
                onClick={handleManageSubscription} 
                disabled={isManagingBilling}
                variant="outline"
                className="w-full font-bold h-10 border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                {isManagingBilling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin text-slate-400" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2 text-slate-400" /> 
                )}
                Manage Subscription
              </Button>
            </div>

          </div>
        )}
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full max-w-3xl space-y-6">
        {activeTab === 'branding' && <BrandingSettings />}
        {activeTab === 'quote_custom' && <QuoteCustomizationSettings />}
        {activeTab === 'messages' && <MessageTemplatesSettings />}
        
        {/* 👇 5. THE TAB GATEKEEPERS 👇 */}
        {activeTab === 'employee_portal' && (
          canAccessHR 
            ? <EmployeePortalSettings /> 
            : <UpgradeWall featureName="Employee Portal Settings" requiredPlan="Professional" />
        )}
        {/* 👆 ----------------------- 👆 */}

        {activeTab === 'team' && <TeamManagementSettings />}
        {activeTab === 'financials' && <RegionalFinancialSettings />}
        {activeTab === 'payments' && <PaymentSettings />}
        {activeTab === 'automations' && <AutomationSettings />}
        {activeTab === 'notifications' && <NotificationSettings />}
        {activeTab === 'portal' && <ClientPortalSettings />}

        {/* Toaster placed here cleanly so pop-ups will render */}
        <Toaster 
          position="top-center" 
          toastOptions={{
            style: {
              background: '#0f172a', // slate-900 to match your sidebar
              color: '#f59e0b',      // amber-500 to match your accent color
              border: '1px solid #334155', // subtle slate border
              fontWeight: 'bold',
            }
          }}
        />
      </main>
    </div>
  );
}