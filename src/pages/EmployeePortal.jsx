import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useLocation } from "react-router-dom";
import { checkAccess } from '@/lib/planConfig'; 
import UpgradeWall from '@/components/shared/UpgradeWall';
import { 
  Clock, DollarSign, Palmtree, FileText, 
  Receipt, CheckCircle2, Package, BookOpen, User, 
  Menu, X, ChevronRight, Briefcase, Calendar
} from "lucide-react";

// Existing Sub-Components
import EPTimesheets from "@/components/employee/EPTimesheets";
import EPExpenses from "@/components/employee/EPExpenses";
import EPTasks from "@/components/employee/EPTasks";
import EPDailyLogs from "@/components/employee/EPDailyLogs";
import EPPayroll from "@/components/employee/EPPayroll";
import EPProfile from "@/components/employee/EPProfile";
import EPVacationTracker from "@/components/employee/EPVacationTracker";
import EPTimeClock from "@/components/employee/EPTimeClock";
import EPInventory from "@/components/employee/EPInventory";
import EPAssignedWork from "@/components/employee/EPAssignedWork";

const HR_TABS = new Set(["time_clock", "timesheets", "payroll", "vacation_tracker", "expenses"]);

export default function EmployeePortal() {
  const { profile: authProfile, settings, company } = useAuth();
  const companyId = authProfile?.company_id;
  const authUserId = authProfile?.id;
  const canAccessHR = checkAccess(company?.plan_id, 'hasHR');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { search } = useLocation();
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(search).get("tab") || (canAccessHR && settings?.features?.time_clock !== false ? "time_clock" : "projects"));
  useEffect(() => {
    const requested = new URLSearchParams(search).get("tab");
    if (["time_clock","timesheets","payroll","vacation_tracker","expenses","daily_logs","tasks","inventory","profile","projects","schedule"].includes(requested)) setActiveTab(requested);
    else if (!requested) setActiveTab(canAccessHR && settings?.features?.time_clock !== false ? "time_clock" : "projects");
  }, [search, canAccessHR, settings?.features?.time_clock]);

  // Fetch strictly the logged-in user
  const { data: currentUser } = useQuery({
    queryKey: ["currentUserData", authUserId],
    enabled: !!authUserId,
    queryFn: async () => {
      const { data: userData } = await supabase.from("users").select("*").eq("id", authUserId).maybeSingle(); 
      if (userData) return userData;

      const { data: profileData } = await supabase.from("profiles").select("*").eq("id", authUserId).maybeSingle();
      return profileData || null;
    }
  });

  // 2. We dynamically check the Admin's toggles! 
  // (We use !== false so that if they haven't clicked anything yet, it defaults to TRUE and shows the tab)
  const companySettings = {
    enable_clock_in: settings?.features?.time_clock !== false,
    enable_timesheets: settings?.features?.time_clock !== false,
    enable_payroll: settings?.features?.time_clock !== false,
    enable_vacation: settings?.features?.time_clock !== false,
    enable_expenses: settings?.features?.expenses !== false,
    enable_project_notes: settings?.features?.daily_logs !== false, 
    enable_tasks: settings?.features?.tasks !== false, 
    enable_inventory: settings?.features?.inventory !== false
  };

  // Added mobileLabel to cleanly display shortened names on the bottom bar
  const MY_HR_TABS = [
    { key: "time_clock", label: "Clock In", mobileLabel: "Clock", icon: Clock, enabled: companySettings.enable_clock_in },
    { key: "timesheets", label: "My Time Sheets", mobileLabel: "Time Sheets", icon: FileText, enabled: companySettings.enable_timesheets },
    { key: "payroll", label: "My Pay", mobileLabel: "Pay", icon: DollarSign, enabled: companySettings.enable_payroll },
    { key: "vacation_tracker", label: "My Time Off", mobileLabel: "Time Off", icon: Palmtree, enabled: companySettings.enable_vacation },
    { key: "expenses", label: "My Expenses", mobileLabel: "Expenses", icon: Receipt, enabled: companySettings.enable_expenses },
  ].filter(t => t.enabled && canAccessHR);

  const PROJECT_TABS = [
    { key: "projects", label: "My Projects", mobileLabel: "Projects", icon: Briefcase, enabled: true },
    { key: "schedule", label: "My Schedule", mobileLabel: "Schedule", icon: Calendar, enabled: true },
    { key: "daily_logs", label: "Project Notes", mobileLabel: "Logs", icon: BookOpen, enabled: companySettings.enable_project_notes },
    { key: "tasks", label: "My Tasks", mobileLabel: "Tasks", icon: CheckCircle2, enabled: companySettings.enable_tasks },
    { key: "inventory", label: "Inventory", mobileLabel: "Inventory", icon: Package, enabled: companySettings.enable_inventory },
  ].filter(t => t.enabled);

  const allTabs = [...MY_HR_TABS, ...PROJECT_TABS, { key: "profile", label: "Profile", mobileLabel: "Profile", icon: User }];
  
  // Safely set the default tab to the first available HR tab, or fallback to profile

  const activeTabInfo = allTabs.find(t => t.key === activeTab) || allTabs[0];

  const handleTabChange = (key) => {
    setActiveTab(key);
    setMobileMenuOpen(false);
  };

  // Only pass the personal data down!
  const sharedProps = { currentUser, companyId };

  const renderContent = () => {
    if (HR_TABS.has(activeTab) && !canAccessHR) {
      return <UpgradeWall featureName="Time Tracking & Personal HR" requiredPlan="Professional" />;
    }
    if (!allTabs.some(tab => tab.key === activeTab)) {
      return <div role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">This section is disabled in your company's settings. Contact your administrator to review access.</div>;
    }
    switch (activeTab) {
      case "time_clock": return <EPTimeClock {...sharedProps} />;
      case "timesheets": return <EPTimesheets {...sharedProps} />;
      case "payroll": return <EPPayroll {...sharedProps} />;
      case "vacation_tracker": return <EPVacationTracker {...sharedProps} />;
      case "expenses": return <EPExpenses {...sharedProps} />;
      case "daily_logs": return <EPDailyLogs {...sharedProps} />;
      case "tasks": return <EPTasks {...sharedProps} />;
      case "inventory": return <EPInventory {...sharedProps} />;
      case "projects": return <EPAssignedWork {...sharedProps} />;
      case "schedule": return <EPAssignedWork {...sharedProps} mode="schedule" />;
      case "profile": return <EPProfile {...sharedProps} />;
      default: return <EPProfile {...sharedProps} />;
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-screen bg-slate-50 font-sans">
      
      {/* --- DESKTOP SIDEBAR --- */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200 shrink-0 shadow-sm z-10">
        <div 
          onClick={() => handleTabChange("profile")}
          className="p-5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl flex items-center justify-center shadow-sm group-hover:shadow transition-all bg-gradient-to-br from-slate-800 to-slate-900`}>
              <span className={`text-base font-bold text-amber-400`}>
                {currentUser?.full_name?.charAt(0)?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-900 text-sm truncate group-hover:text-amber-600 transition-colors">
                {currentUser?.full_name || "Employee"}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate mt-0.5">
                {currentUser?.role || "Staff"}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {MY_HR_TABS.length > 0 && (
            <div className="space-y-1">
              <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">My Information</p>
              {MY_HR_TABS.map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? "bg-amber-400 text-slate-900 shadow-md shadow-amber-500/20" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}>
                    <tab.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-slate-900" : "text-slate-400"}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {PROJECT_TABS.length > 0 && (
            <div className="space-y-1">
              <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Briefcase className="h-3 w-3" /> Operations
              </p>
              {PROJECT_TABS.map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? "bg-slate-900 text-white shadow-md shadow-slate-900/20" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}>
                    <tab.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-amber-400" : "text-slate-400"}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      </aside>

      {/* --- MOBILE NAV BAR --- */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-2 py-1.5 flex items-center justify-around shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {(MY_HR_TABS.length ? MY_HR_TABS : PROJECT_TABS).slice(0, 4).map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => handleTabChange(tab.key)}
              className={`flex flex-col items-center gap-1 px-2 py-1 rounded-lg transition-all ${isActive ? "text-amber-600" : "text-slate-400 hover:text-slate-600"}`}>
              <tab.icon className={`h-5 w-5 ${isActive ? "text-amber-500" : ""}`} />
              {/* Changed to use the new mobileLabel */}
              <span className="text-[9px] font-bold">{tab.mobileLabel}</span>
            </button>
          );
        })}
        <button onClick={() => setMobileMenuOpen(true)} className="flex flex-col items-center gap-1 px-2 py-1 rounded-lg text-slate-400 hover:text-slate-600">
          <Menu className="h-5 w-5" />
          <span className="text-[9px] font-bold">More</span>
        </button>
      </div>

      {/* --- MOBILE FULL MENU --- */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-white flex flex-col animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-black text-slate-900 text-lg">Menu</h2>
            <button onClick={() => setMobileMenuOpen(false)} className="p-2 bg-white rounded-full border border-slate-200 text-slate-500 shadow-sm">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            
            {MY_HR_TABS.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">My Information</p>
                {MY_HR_TABS.map(tab => (
                  <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-white shadow-sm hover:border-amber-200 transition-colors">
                    <div className="flex items-center gap-3 text-slate-700 font-bold text-sm">
                      <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                        <tab.icon className="h-4 w-4 text-amber-600" />
                      </div>
                      {tab.label}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </div>
            )}

            {PROJECT_TABS.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Operations</p>
                {PROJECT_TABS.map(tab => (
                  <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-white shadow-sm hover:border-slate-300 transition-colors">
                    <div className="flex items-center gap-3 text-slate-700 font-bold text-sm">
                      <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <tab.icon className="h-4 w-4 text-slate-600" />
                      </div>
                      {tab.label}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- MAIN CONTENT AREA --- */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        
        {/* Mobile Top Bar */}
        <div className="lg:hidden shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm z-30">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {activeTabInfo && <activeTabInfo.icon className="h-5 w-5 text-amber-500 shrink-0" />}
            <h1 className="font-black text-slate-900 text-base truncate">{activeTabInfo?.label}</h1>
          </div>
        </div>

        {/* Desktop Top Bar */}
        <div className="hidden lg:flex shrink-0 items-center justify-between px-8 py-5 border-b border-slate-200 bg-white z-30">
          <div className="flex items-center gap-3">
            {activeTabInfo && (
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${MY_HR_TABS.some(t => t.key === activeTab) ? 'bg-amber-100' : 'bg-slate-100'}`}>
                <activeTabInfo.icon className={`h-5 w-5 ${MY_HR_TABS.some(t => t.key === activeTab) ? 'text-amber-600' : 'text-slate-800'}`} />
              </div>
            )}
            <h1 className="font-black text-slate-900 text-2xl tracking-tight">{activeTabInfo?.label}</h1>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-24 lg:pb-8">
          <div className="max-w-4xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}
