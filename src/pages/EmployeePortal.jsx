import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  Menu,
  Package,
  Palmtree,
  Receipt,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { checkAccess } from "@/lib/planConfig";
import { FIELD_ROLES, normalizeRole } from "@/lib/roleAccess";
import UpgradeWall from "@/components/shared/UpgradeWall";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
const PORTAL_CONTEXT_PARAMS = [
  "notificationTask",
  "notificationProject",
  "notificationEvent",
  "notificationPhase",
  "notificationLog",
  "reservation",
  "reservationId",
  "inventoryId",
];

function PortalError({ message, onRetry }) {
  return (
    <div className="flex h-full min-h-64 items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <AlertCircle className="mx-auto h-9 w-9 text-red-500" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-black text-slate-900">Employee portal unavailable</h1>
        <p role="alert" className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function EmployeePortal() {
  const { profile: authProfile, settings, company } = useAuth();
  const companyId = authProfile?.company_id;
  const authUserId = authProfile?.id;
  const userRole = normalizeRole(authProfile?.role || authProfile?.user_role);
  const isFieldRole = FIELD_ROLES.includes(userRole);
  const canAccessHR = checkAccess(company?.plan_id, "hasHR");
  const features = settings?.features || {};
  const featureEnabled = (key, fallbackKey) => {
    if (typeof features[key] === "boolean") return features[key];
    return features[fallbackKey] !== false;
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const fieldContentRef = useRef(null);

  const companySettings = {
    enable_clock_in: featureEnabled("employee_time_clock", "time_clock"),
    enable_timesheets: featureEnabled("employee_timesheets", "time_clock"),
    enable_payroll: featureEnabled("employee_payroll", "time_clock"),
    enable_vacation: featureEnabled("employee_time_off", "time_clock"),
    enable_expenses: features.expenses !== false,
    enable_project_notes: features.daily_logs !== false,
    enable_tasks: features.tasks !== false,
    enable_inventory: features.inventory !== false,
  };

  const allTabs = [
    { key: "time_clock", label: "Clock In", mobileLabel: "Clock", icon: Clock, section: "information", enabled: companySettings.enable_clock_in, requiresHR: true },
    { key: "timesheets", label: "My Timesheets", mobileLabel: "Timesheets", icon: FileText, section: "information", enabled: companySettings.enable_timesheets, requiresHR: true },
    { key: "payroll", label: "My Pay", mobileLabel: "Pay", icon: DollarSign, section: "information", enabled: companySettings.enable_payroll, requiresHR: true },
    { key: "vacation_tracker", label: "My Time Off", mobileLabel: "Time Off", icon: Palmtree, section: "information", enabled: companySettings.enable_vacation, requiresHR: true },
    { key: "expenses", label: "My Expenses", mobileLabel: "Expenses", icon: Receipt, section: "information", enabled: companySettings.enable_expenses, requiresHR: true },
    { key: "projects", label: "My Projects", mobileLabel: "Projects", icon: Briefcase, section: "operations", enabled: true },
    { key: "schedule", label: "My Schedule", mobileLabel: "Schedule", icon: Calendar, section: "operations", enabled: true },
    { key: "daily_logs", label: "Project Notes", mobileLabel: "Notes", icon: BookOpen, section: "operations", enabled: companySettings.enable_project_notes },
    { key: "tasks", label: "My Tasks", mobileLabel: "Tasks", icon: CheckCircle2, section: "operations", enabled: companySettings.enable_tasks },
    { key: "inventory", label: "Inventory", mobileLabel: "Inventory", icon: Package, section: "operations", enabled: companySettings.enable_inventory },
    { key: "profile", label: "My Profile", mobileLabel: "Profile", icon: User, section: "account", enabled: true },
  ];

  const availableTabs = allTabs.filter(tab => tab.enabled && (!tab.requiresHR || canAccessHR));
  const requestedTab = searchParams.get("tab");
  const defaultTab = availableTabs.find(tab => tab.key === "time_clock")?.key || "projects";
  const activeTab = allTabs.some(tab => tab.key === requestedTab) ? requestedTab : defaultTab;
  const activeTabInfo = allTabs.find(tab => tab.key === activeTab) || allTabs.find(tab => tab.key === defaultTab);
  const ActiveIcon = activeTabInfo.icon;

  const hrTabs = availableTabs.filter(tab => tab.section === "information");
  const projectTabs = availableTabs.filter(tab => tab.section === "operations");
  const profileTab = availableTabs.find(tab => tab.key === "profile");
  const mobilePrimaryTabs = ["time_clock", "projects", "schedule", "tasks"]
    .map(key => availableTabs.find(tab => tab.key === key))
    .filter(Boolean);
  const mobilePrimaryKeys = new Set(mobilePrimaryTabs.map(tab => tab.key));
  const mobileMoreGroups = [
    { label: "My information", tabs: hrTabs.filter(tab => !mobilePrimaryKeys.has(tab.key)) },
    { label: "Operations", tabs: projectTabs.filter(tab => !mobilePrimaryKeys.has(tab.key)) },
    { label: "Account", tabs: profileTab ? [profileTab] : [] },
  ].filter(group => group.tabs.length);
  const moreIsActive = !mobilePrimaryKeys.has(activeTab);

  // Browser Back/Forward changes the URL-backed section without calling the
  // tab click handler. Reset the field portal's sole scroll owner whenever the
  // active section changes so history navigation never opens mid-page.
  useEffect(() => {
    fieldContentRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [activeTab]);

  const handleTabChange = key => {
    const nextParams = new URLSearchParams(searchParams);
    PORTAL_CONTEXT_PARAMS.forEach(param => nextParams.delete(param));
    nextParams.set("tab", key);
    setSearchParams(nextParams);
    setMobileMenuOpen(false);
  };

  if (!authUserId || !companyId) {
    return <PortalError message="Your signed-in account is missing an employee profile. Sign in again or ask your administrator to review your account." />;
  }

  const currentUser = authProfile;
  const sharedProps = { currentUser, companyId };
  const renderContent = () => {
    if (HR_TABS.has(activeTab) && !canAccessHR) {
      return <UpgradeWall featureName="Time Tracking & Personal HR" requiredPlan="Professional" />;
    }
    if (!activeTabInfo.enabled) {
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
      default: return <EPAssignedWork {...sharedProps} />;
    }
  };

  const renderTabButton = (tab, variant = "default") => {
    const isActive = activeTab === tab.key;
    const isInformation = tab.section === "information";
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => handleTabChange(tab.key)}
        aria-current={isActive ? "page" : undefined}
        className={variant === "compact"
          ? `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-slate-900"}`
          : `flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${isActive ? (isInformation ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20" : "bg-slate-900 text-white shadow-md shadow-slate-900/20") : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
      >
        <tab.icon className={`h-4 w-4 shrink-0 ${isActive && !isInformation ? "text-amber-400" : isActive ? "text-slate-900" : "text-slate-400"}`} aria-hidden="true" />
        <span>{tab.label}</span>
      </button>
    );
  };

  return (
    <div className={isFieldRole ? "flex h-full min-h-0 overflow-hidden bg-slate-50 font-sans" : "min-h-full bg-slate-50 font-sans"}>
      {isFieldRole ? (
        <aside aria-label="Employee portal navigation" className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm lg:flex">
          <button type="button" onClick={() => handleTabChange("profile")} aria-label="Profile" aria-current={activeTab === "profile" ? "page" : undefined} className="group flex w-full items-center gap-3 border-b border-slate-100 p-5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-base font-bold text-amber-400 shadow-sm transition-shadow group-hover:shadow">
              {currentUser.full_name?.charAt(0)?.toUpperCase() || "U"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-900 transition-colors group-hover:text-amber-600">{currentUser.full_name || "Employee"}</span>
              <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{currentUser.role || "Staff"} · Profile</span>
            </span>
          </button>

          <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
            {hrTabs.length ? (
              <section aria-labelledby="employee-information-heading" className="space-y-1">
                <h2 id="employee-information-heading" className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">My information</h2>
                {hrTabs.map(tab => renderTabButton(tab))}
              </section>
            ) : null}
            <section aria-labelledby="employee-operations-heading" className="space-y-1">
              <h2 id="employee-operations-heading" className="mb-2 flex items-center gap-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Briefcase className="h-3 w-3" aria-hidden="true" /> Operations</h2>
              {projectTabs.map(tab => renderTabButton(tab))}
            </section>
            <section aria-labelledby="employee-support-heading" className="space-y-1">
              <h2 id="employee-support-heading" className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Support</h2>
              <Link to="/Warranty" className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> Warranty
              </Link>
            </section>
          </nav>
        </aside>
      ) : null}

      <main className={isFieldRole ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "min-w-0"}>
        <header className="border-b border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-6 lg:px-8 lg:py-5">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeTabInfo.section === "information" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-800"}`}>
              <ActiveIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              {!isFieldRole ? <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">My portal</p> : null}
              <h1 className="truncate text-lg font-black tracking-tight text-slate-900 sm:text-2xl">{activeTabInfo.label}</h1>
            </div>
          </div>
        </header>

        {!isFieldRole ? (
          <nav aria-label="Employee portal sections" className="border-b border-slate-200 bg-slate-100/80 px-4 py-3 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
              <div className="flex items-center gap-2 sm:hidden">
                <label htmlFor="employee-portal-section" className="sr-only">Portal section</label>
                <select id="employee-portal-section" value={activeTab} onChange={event => handleTabChange(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  {!availableTabs.some(tab => tab.key === activeTab) ? <option value={activeTab}>{activeTabInfo.label} (Unavailable)</option> : null}
                  {availableTabs.map(tab => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
                </select>
                <button type="button" onClick={() => handleTabChange("profile")} aria-label="Open my profile" aria-current={activeTab === "profile" ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${activeTab === "profile" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  <User className="h-4 w-4" aria-hidden="true" /> Profile
                </button>
              </div>
              <div className="hidden gap-2 overflow-x-auto pb-1 sm:flex">
                {availableTabs.map(tab => renderTabButton(tab, "compact"))}
              </div>
            </div>
          </nav>
        ) : null}

        <div ref={isFieldRole ? fieldContentRef : undefined} data-employee-portal-content className={isFieldRole ? "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8 lg:pb-8 lg:pt-8" : "px-4 py-5 sm:px-6 lg:px-8 lg:py-8"}>
          <div className="mx-auto max-w-5xl">{renderContent()}</div>
        </div>
      </main>

      {isFieldRole ? (
        <>
          <nav data-mobile-navigation aria-label="Employee portal mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden">
            <div className="mx-auto grid max-w-lg gap-0.5" style={{ gridTemplateColumns: `repeat(${mobilePrimaryTabs.length + 1}, minmax(0, 1fr))` }}>
              {mobilePrimaryTabs.map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button key={tab.key} type="button" onClick={() => handleTabChange(tab.key)} aria-current={isActive ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${isActive ? "bg-amber-100 text-amber-800" : "text-slate-500 active:bg-slate-100 active:text-slate-900"}`}>
                    <tab.icon className="h-5 w-5" aria-hidden="true" />
                    <span className="max-w-full truncate">{tab.mobileLabel}</span>
                  </button>
                );
              })}
              <button type="button" onClick={() => setMobileMenuOpen(true)} aria-expanded={mobileMenuOpen} aria-haspopup="dialog" className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${moreIsActive || mobileMenuOpen ? "bg-amber-100 text-amber-800" : "text-slate-500 active:bg-slate-100 active:text-slate-900"}`}>
                <Menu className="h-5 w-5" aria-hidden="true" /><span>More</span>
              </button>
            </div>
          </nav>

          <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DialogContent className="bottom-0 left-0 right-0 top-auto z-[130] !flex max-h-[88dvh] min-h-0 w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-3xl border-slate-200 bg-slate-50 p-0 shadow-2xl lg:hidden" closeButtonClassName="right-4 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white opacity-100">
              <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-5 pb-4 pt-6 pr-16 text-left">
                <DialogTitle className="text-xl font-black text-slate-900">Employee portal menu</DialogTitle>
                <DialogDescription className="text-slate-600">Choose a section of your personal workspace.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 touch-pan-y space-y-6 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4" style={{ WebkitOverflowScrolling: "touch" }}>
                {mobileMoreGroups.map(group => (
                  <section key={group.label} aria-labelledby={`mobile-${group.label.replace(/\s+/g, "-").toLowerCase()}`}>
                    <h2 id={`mobile-${group.label.replace(/\s+/g, "-").toLowerCase()}`} className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{group.label}</h2>
                    <div className="space-y-2">
                      {group.tabs.map(tab => {
                        const isActive = activeTab === tab.key;
                        return (
                          <button key={tab.key} type="button" onClick={() => handleTabChange(tab.key)} aria-label={tab.key === "profile" ? "Profile" : undefined} aria-current={isActive ? "page" : undefined} className={`flex min-h-14 w-full items-center justify-between rounded-2xl border px-3 py-2 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${isActive ? "border-amber-400 bg-amber-50 text-slate-950" : "border-slate-200 bg-white text-slate-700"}`}>
                            <span className="flex min-w-0 items-center gap-3 text-sm font-bold"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tab.section === "information" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}><tab.icon className="h-4 w-4" aria-hidden="true" /></span><span className="truncate">{tab.label}</span></span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <section aria-labelledby="mobile-support-heading">
                  <h2 id="mobile-support-heading" className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Support</h2>
                  <Link to="/Warranty" onClick={() => setMobileMenuOpen(false)} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-slate-700 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                    <span className="flex items-center gap-3 text-sm font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span>Warranty</span>
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </Link>
                </section>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
