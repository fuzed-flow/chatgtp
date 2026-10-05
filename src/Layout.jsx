import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "./utils";
import { useAuth } from "@/lib/AuthContext";
import {
  LayoutDashboard, Users, Target, FileText,
  CalendarDays, ListChecks, Receipt, Package,
  Settings, ChevronLeft, ChevronRight,
  LogOut, HardHat, FileCheck, BarChart3, FileStack,
  Building2, ShoppingCart, DollarSign, FileSignature, MoreVertical, FolderKanban, ChevronDown, File, Contact, Newspaper, ClipboardCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GlobalSearch from "./components/shared/GlobalSearch";
import OnboardingTour from "./components/shared/OnboardingTour";
import AccessibilityEnhancer from "./components/shared/AccessibilityEnhancer";
import EnhancedNotificationCenter from "./components/shared/EnhancedNotificationCenter";
import HelpMenu from "./components/shared/HelpMenu";

const NAV_ITEMS = [
  { name: "Dashboard", icon: LayoutDashboard, page: "Dashboard", permissionKey: "dashboard", section: "main" },
  { name: "Leads", icon: Target, page: "LeadTracker", permissionKey: "leads", section: "sales" },
  { name: "Sales Performance", icon: BarChart3, page: "SalesPerformance", permissionKey: "reports", section: "sales" },
  { name: "Clients", icon: Users, page: "Clients", permissionKey: "clients", section: "sales" },
  { name: "Quotes", icon: FileText, page: "Quotes", permissionKey: "quotes", section: "quotes" },  
  { name: "Templates", icon: FileStack, page: "Templates", permissionKey: "templates", section: "quotes" },
  { name: "PM Dashboard", icon: FolderKanban, page: "PMDashboard", permissionKey: "projects", section: "pm" },
  { name: "PM Projects", icon: FolderKanban, page: "PMProjects", permissionKey: "projects", section: "pm" },
  { name: "Project Timeline", icon: CalendarDays, page: "PMTimeline", permissionKey: "projects", section: "pm" },
  { name: "Client Updates", icon: Newspaper, page: "ClientUpdates", permissionKey: "projects", section: "pm" },
  { name: "Project Closeouts", icon: ClipboardCheck, page: "ProjectCloseouts", permissionKey: "projects", section: "pm" },
  { name: "Approvals", icon: FileCheck, page: "Approvals", permissionKey: "approvals", section: "pm" },
  { name: "Invoices & Payments", icon: Receipt, page: "Invoices", permissionKey: "invoices", adminOnly: true, section: "financial" },
  { name: "Purchase Orders", icon: ShoppingCart, page: "PurchaseOrders", permissionKey: "purchase_orders", section: "financial" },
  { name: "Change Orders", icon: FileText, page: "ChangeOrders", permissionKey: "change_orders", section: "financial" },
  { name: "Project Notes", icon: File, page: "DailyLogs", permissionKey: "DailyLogs", section: "resources" },
  { name: "All Tasks", icon: ListChecks, page: "Tasks", permissionKey: "tasks", section: "resources" },
  { name: "Subcontractors", icon: Building2, page: "Vendors", permissionKey: "vendors", section: "resources" },
  { name: "Products", icon: Package, page: "Products", permissionKey: "products", section: "resources" },
  { name: "Inventory", icon: Package, page: "Inventory", permissionKey: "inventory", section: "resources" },
  { name: "Client Forms", icon: FileSignature, page: "ClientForms", permissionKey: "client_forms", section: "resources" },
  { name: "Warranty", icon: FileCheck, page: "Warranty", permissionKey: "projects", section: "resources" },
  { name: "Reports", icon: BarChart3, page: "Reports", permissionKey: "reports", section: "resources" },
  { name: "Human Resources", icon: Users, page: "HumanResources", permissionKey: "human_resources", adminOnly: true, section: "resources" },
  { name: "Employee Portal", icon: HardHat, page: "EmployeePortal", allUsers: true, section: "employee" },
  { name: "Settings", icon: Settings, page: "AdminSettings", permissionKey: "settings", section: "settings" }
];

const SECTION_LABELS = {
  main: "",
  sales: "CRM",
  quotes: "Quotes",
  clients: "Clients",
  leads: "Leads",
  projects: "Projects",
  pm: "Project Management",
  financial: "Financial",
  resources: "Resources",
  employee: "Employee Portal",
  settings: "",
  more: "More"
};

const SECTION_ICONS = {
  sales: Contact,
  main: LayoutDashboard,
  quotes: FileText,
  clients: Users,
  leads: Target,
  projects: FolderKanban,
  pm: FolderKanban,
  financial: DollarSign,
  resources: Package,
  employee: HardHat,
  settings: Settings,
  more: MoreVertical
};

export default function Layout({ children, currentPageName }) {
  const { profile, signOut } = useAuth(); 
  
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();

  const userRole = profile?.role || profile?.user_role || "user";
  const isEmployeeRole = ["employee", "subcontractor"].includes(userRole);

  useEffect(() => {
    if (isEmployeeRole && currentPageName && !["EmployeePortal", "FAQ", "Tutorials", "Contact", "HelpArticles", "Warranty", "DocumentRequests"].includes(currentPageName)) {
      navigate("/EmployeePortal", { replace: true });
    }
  }, [isEmployeeRole, currentPageName, navigate]);

  if (currentPageName === "PublicQuoteView") {
    return <>{children}</>;
  }

  const hasPermission = (item) => {
    if (isEmployeeRole) return ["EmployeePortal", "Warranty", "DocumentRequests"].includes(item.page);
    if (!profile) return false; 
    if (item.allUsers) return true;
    
    if (userRole === "admin" || userRole === "owner") return true;
    if (item.adminOnly && !["admin", "owner", "office"].includes(userRole)) return false;
    
    if (!profile.permissions || profile.permissions.length === 0) {
      return !item.adminOnly;
    }
    return profile.permissions.includes(item.permissionKey);
  };

  const visibleNavItems = NAV_ITEMS.filter(hasPermission);
  
  const groupedItems = visibleNavItems.reduce((acc, item) => {
    const section = item.section || "more";
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {});

  const sectionOrder = ["main", "sales", "quotes", "pm", "financial", "resources", "employee", "more", "settings"];
  const mobilePrimary = [
    { page: "Dashboard", label: "Dashboard", activePages: ["Dashboard"] },
    { page: "LeadTracker", label: "Leads", activePages: ["LeadTracker", "LeadDetail"] },
    { page: "PMProjects", label: "Projects", activePages: ["PMDashboard", "PMProjects", "PMProjectWorkspace", "ProjectDetail", "PMTimeline", "ClientUpdates", "ProjectCloseouts", "Approvals"] },
    { page: "Tasks", label: "Tasks", activePages: ["Tasks"] },
  ].map(primary => ({ ...visibleNavItems.find(item => item.page === primary.page), ...primary })).filter(item => item.icon);
  const primaryPages = new Set(mobilePrimary.map(item => item.page));
  const mobileMoreGroups = sectionOrder.map(section => ({
    section,
    label: SECTION_LABELS[section] || (section === "main" ? "Workspace" : "More"),
    items: (groupedItems[section] || []).filter(item => !primaryPages.has(item.page)),
  })).filter(group => group.items.length);
  const isMoreActive = !mobilePrimary.some(item => item.activePages.includes(currentPageName));

  const closeSidebar = () => setMoreOpen(false);

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 overflow-hidden">
      <style>{`
        :root {
          --brand-primary: #0f172a;
          --brand-accent: #f59e0b;
          --brand-surface: #f8fafc;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .nav-item { animation: slideIn 0.3s ease-out; }
      `}</style>

      {/* Sidebar */}
      <aside id="workspace-navigation" className={`
        relative z-50 hidden h-full flex-col lg:flex
        bg-black text-slate-100 
        transition-all duration-300 ease-in-out shadow-2xl
        ${collapsed ? "w-[68px]" : "w-[260px]"}
      `}
      style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 20px 25px rgba(0, 0, 0, 0.15)" }}
      >
        <div className="border-b border-slate-700/50 shrink-0">
          {collapsed ? (
            <Link 
              to="/Dashboard" 
              onClick={closeSidebar}
              className="flex h-14 items-center justify-center lg:h-16 transition-opacity hover:opacity-80"
            >
              <img 
                src="https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzedflow_logo_black_bg_optimized.svg" 
                alt="Fuzed Flow Icon" 
                className="h-8 w-8 object-contain"
              />
            </Link>
          ) : (
            <Link 
              to="/Dashboard" 
              onClick={closeSidebar}
              className="flex w-full h-14 lg:h-auto lg:py-6 items-center justify-center px-4 lg:px-6 transition-opacity hover:opacity-80"
            >
              <img 
                src="https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/FuzedFlowHero.webp" 
                alt="Fuzed Flow Logo" 
                className="hidden h-24 w-auto object-contain lg:block"
              />
              <img 
                src="https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzedflow_logo_black_bg_optimized.svg" 
                alt="Fuzed Flow Logo" 
                className="h-10 w-auto object-contain lg:hidden"
              />
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col overflow-y-auto py-3 lg:py-4 px-2 lg:px-3 custom-scrollbar">
          {sectionOrder.map((sectionKey) => {
            const items = groupedItems[sectionKey];
            if (!items || items.length === 0) return null;

            const isDropdownSection = ["sales","quotes", "pm", "financial", "resources", "more"].includes(sectionKey);
            
            if (isDropdownSection) {
              const SectionIcon = SECTION_ICONS[sectionKey] || MoreVertical;
              const sectionName = SECTION_LABELS[sectionKey] || "More";
              const hasActiveItem = items.some(item => item.page === currentPageName);
              return (
                <DropdownMenu key={sectionKey}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium 
                        transition-all duration-200 group relative mt-2
                        ${hasActiveItem
                            ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-yellow-300 shadow-[inset_0_2px_4px_rgba(255,255,255,0.1),inset_0_-2px_4px_rgba(0,0,0,0.3),0_4px_12px_rgba(0,0,0,0.4)] border border-slate-700/50"
                            : "text-slate-900 hover:text-black bg-gradient-to-br from-yellow-300 to-yellow-400 hover:translate-y-[-1px] border border-yellow-400"
                        }
                        ${collapsed ? "justify-center" : ""}
                      `}
                      title={collapsed ? sectionName : undefined}
                    >
                      {hasActiveItem && !collapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 lg:h-8 bg-gradient-to-b from-yellow-300 to-yellow-500 rounded-r-full" />}
                      <SectionIcon className={`h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110 ${hasActiveItem ? "text-yellow-300" : ""}`} />
                      {!collapsed && <span className="truncate flex-1 text-left">{sectionName}</span>}
                      {!collapsed && <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${hasActiveItem ? "text-yellow-300/70" : "opacity-50"}`} />}
                    </button>
                  </DropdownMenuTrigger>
                  
                  <DropdownMenuContent side="right" align="start" className="w-56 bg-white/95 backdrop-blur-md border-slate-200/60 p-1.5 rounded-xl shadow-xl">
                    <div className="px-2 py-1.5 mb-1 border-b border-slate-100">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{sectionName}</span>
                    </div>
                    
                    {items.map((item) => {
                      const isActive = currentPageName === item.page;
                      return (
                        <DropdownMenuItem key={item.page} asChild className={`rounded-lg cursor-pointer my-0.5 ${isActive ? "bg-slate-100/80 text-slate-900 font-semibold" : "text-slate-600 focus:bg-slate-50"}`}>
                          <Link
                            to={createPageUrl(item.page)}
                            onClick={closeSidebar}
                            className="flex items-center gap-2.5 w-full py-2 px-2"
                          >
                            <item.icon className={`h-[18px] w-[18px] ${isActive ? "text-amber-500" : "text-slate-400"}`} />
                            <span>{item.name}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            return (
              <div key={sectionKey} className={sectionKey === "settings" ? "mt-auto pt-4 pb-2" : sectionKey !== "main" ? "mt-4" : ""}>
                {!collapsed && SECTION_LABELS[sectionKey] && (
                  <div className="px-2 lg:px-3 mb-1.5 lg:mb-2 mt-2">
                    <span className="text-[9px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-wider opacity-70">
                      {SECTION_LABELS[sectionKey]}
                    </span>
                  </div>
                )}

                <div className="space-y-1">
                  {items.map((item, idx) => {
                    const isActive = currentPageName === item.page;
                    return (
                      <Link
                        key={item.page}
                        to={createPageUrl(item.page)}
                        onClick={closeSidebar}
                        style={{ animationDelay: `${idx * 0.02}s` }}
                        className={`
                          nav-item flex items-center gap-2 lg:gap-3 px-2 lg:px-3 py-2 lg:py-2.5 rounded-lg lg:rounded-xl text-xs lg:text-sm font-medium 
                          transition-all duration-200 group relative
                          ${isActive
                            ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-yellow-300 shadow-[inset_0_2px_4px_rgba(255,255,255,0.1),inset_0_-2px_4px_rgba(0,0,0,0.3),0_4px_12px_rgba(0,0,0,0.4)] border border-slate-700/50"
                            : "text-slate-900 hover:text-black bg-gradient-to-br from-yellow-300 to-yellow-400 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5),inset_0_-1px_2px_rgba(0,0,0,0.1),0_2px_6px_rgba(0,0,0,0.15)] hover:shadow-[inset_0_1px_3px_rgba(255,255,255,0.6),inset_0_-1px_3px_rgba(0,0,0,0.15),0_3px_8px_rgba(0,0,0,0.2)] hover:translate-y-[-1px] active:translate-y-[1px] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] border border-yellow-400"
                          }
                          ${collapsed ? "justify-center" : ""}
                        `}
                        title={collapsed ? item.name : undefined}
                      >
                        {isActive && !collapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 lg:h-8 bg-gradient-to-b from-slate-900 to-slate-800 rounded-r-full" />}
                        <item.icon className={`h-4 w-4 lg:h-[18px] lg:w-[18px] shrink-0 transition-transform group-hover:scale-110 ${isActive ? "text-yellow-300" : ""}`} />
                        {!collapsed && <span className="truncate">{item.name}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 6px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: rgba(15,23,42,0.1); border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.3); border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(15,23,42,0.5); }
        `}</style>

        <div className="hidden lg:flex border-t border-slate-800 p-3 bg-black">
          <Button
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full text-slate-400 hover:text-white hover:bg-slate-800 transition-all rounded-lg"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="relative z-[100] h-14 lg:h-16 bg-black border-b border-slate-700/50 flex items-center justify-between px-3 lg:px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-2 lg:gap-4 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <h2 className="text-xs lg:text-base font-bold text-white capitalize tracking-tight truncate">
                {currentPageName?.replace(/([A-Z])/g, ' $1').trim().replace('P M', 'PM') || "Dashboard"}
              </h2>
              <p className="text-[10px] lg:text-xs text-slate-400 hidden sm:block">Welcome back</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-3 shrink-0">
            {/* 1. Unified Search */}
            <GlobalSearch onCloseSidebar={closeSidebar} />

            {/* 2. Notification Bell */}
            <EnhancedNotificationCenter onCloseSidebar={closeSidebar} />
            
            {/* 3. Help Menu */}
            <HelpMenu onCloseSidebar={closeSidebar} />
            
            {/* 4. User Profile Dropdown */}
            {profile && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button 
                    type="button"
                    aria-label="Open account menu"
                    onClick={closeSidebar} 
                    className="flex items-center gap-1.5 lg:gap-3 px-1.5 lg:px-3 py-1 lg:py-1.5 rounded-lg lg:rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700/50 outline-none cursor-pointer"
                  >
                    <div className="h-7 w-7 lg:h-9 lg:w-9 rounded-lg lg:rounded-xl bg-gradient-to-br from-yellow-300 to-yellow-600 flex items-center justify-center shadow-md shadow-yellow-500/40">
                      <span className="text-[10px] lg:text-sm font-bold text-slate-900">
                        {profile.full_name?.charAt(0)?.toUpperCase() || "U"}
                      </span>
                    </div>
                    <span className="text-xs lg:text-sm font-medium text-slate-200 hidden md:block max-w-[100px] lg:max-w-none truncate">
                      {profile.full_name}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                
                <DropdownMenuContent align="end" className="w-56 p-2 bg-white z-[100] border-slate-200 shadow-xl rounded-xl">
                  <div className="flex flex-col space-y-1 p-2 border-b border-slate-100 mb-1">
                    <p className="text-sm font-bold leading-none text-slate-900">{profile.full_name}</p>
                    <p className="text-xs leading-none text-slate-500 mt-1.5">{profile.email || "No email available"}</p>
                  </div>
                  
                  <DropdownMenuItem 
                    onClick={() => {
                      closeSidebar();
                      signOut();
                    }}
                    className="text-red-600 focus:text-red-700 focus:bg-red-50 font-bold cursor-pointer rounded-lg py-2.5 mt-1"
                  >
                    <LogOut className="h-4 w-4 mr-2" /> Log Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden w-full bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>

      <nav aria-label="Primary mobile navigation" className="fixed inset-x-0 bottom-0 z-[110] border-t border-slate-800 bg-black/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg gap-0.5" style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}>
          {mobilePrimary.map(item => {
            const active = item.activePages.includes(currentPageName);
            return <Link key={item.page} to={createPageUrl(item.page)} onClick={closeSidebar} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition-colors ${active ? "bg-amber-400/15 text-amber-300" : "text-slate-400 active:bg-slate-800 active:text-white"}`}><item.icon className="h-5 w-5" aria-hidden="true" /><span className="max-w-full truncate">{item.label}</span></Link>;
          })}
          <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition-colors ${isMoreActive || moreOpen ? "bg-amber-400/15 text-amber-300" : "text-slate-400 active:bg-slate-800 active:text-white"}`}><MoreVertical className="h-5 w-5" aria-hidden="true" /><span>More</span></button>
        </div>
      </nav>

      {moreOpen ? <button type="button" aria-label="Close more navigation" onClick={closeSidebar} className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm lg:hidden" /> : null}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="bottom-0 left-0 right-0 top-auto z-[130] max-h-[82dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-b-none rounded-t-3xl border-slate-700 bg-slate-950 p-0 text-white shadow-2xl lg:hidden">
          <DialogHeader className="border-b border-slate-800 px-5 pb-4 pt-5 pr-14 text-left">
            <DialogTitle className="text-xl font-black text-white">More</DialogTitle>
            <DialogDescription className="text-slate-400">Open another workspace area.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            {mobileMoreGroups.map(group => <section key={group.section} className="mb-4"><h3 className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{group.label}</h3><div className="grid grid-cols-2 gap-2">{group.items.map(item => {
              const active = currentPageName === item.page;
              return <Link key={item.page} to={createPageUrl(item.page)} onClick={closeSidebar} aria-current={active ? "page" : undefined} className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-bold transition-colors ${active ? "border-amber-300/40 bg-amber-400/15 text-amber-200" : "border-slate-800 bg-slate-900 text-slate-200 active:bg-slate-800"}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-400"}`}><item.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span><span className="min-w-0 leading-4">{item.name}</span></Link>;
            })}</div></section>)}
          </div>
        </DialogContent>
      </Dialog>

      {/* Global Components */}
      <OnboardingTour />
      <AccessibilityEnhancer />
    </div>
  );
}
