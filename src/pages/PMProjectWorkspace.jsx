import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Link } from "react-router-dom";
import { 
  ArrowLeft, LayoutDashboard, GitBranch, Users, Wrench, Package, 
  MessageSquare, Eye, CalendarRange, ShieldCheck, FileText, 
  FileImage, Globe, ChevronDown, BookOpen 
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PermitsTab from "@/components/projects/PermitsTab";
import { Tabs, TabsContent } from "@/components/ui/tabs";

// Your PM Tabs
import PMProjectOverview from "@/components/pm/PMProjectOverview.jsx";
import PMPhasesTab from "@/components/pm/PMPhasesTab.jsx";
import PMClientTimelineTab from "@/components/pm/PMClientTimelineTab.jsx";
import PMSubcontractorsTab from "@/components/pm/PMSubcontractorsTab.jsx";
import PMStaffTab from "@/components/pm/PMStaffTab.jsx";
import PMScheduleTrackerTab from "@/components/pm/PMScheduleTrackerTab.jsx";
import PMQuotesDocsTab from "@/components/pm/PMQuotesDocsTab.jsx";
import PMPlansElevationsTab from "@/components/pm/PMPlansElevationsTab.jsx";
import PMContractorPortalTab from "@/components/pm/PMContractorPortalTab.jsx";
import PMDailyLogsTab from "@/components/pm/PMDailyLogsTab.jsx";
import PMMaterialsTab from "@/components/pm/PMMaterialsTab.jsx";

// ⚡ NEW: Importing the unified Notes Feed!
import NotesFeed from "@/components/shared/NotesFeed.jsx";

const ALL_TABS = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "phases", label: "Phases", icon: GitBranch },
  { value: "client-timeline", label: "Client View", icon: Eye },
  { value: "schedule", label: "Phase Timeline", icon: CalendarRange },
  { value: "subs", label: "Subcontractors", icon: Wrench },
  { value: "materials", label: "Materials", icon: Package },
  { value: "staff", label: "Staff & Tasks", icon: Users },
  { value: "notes", label: "Client Notes", icon: MessageSquare }, // ⚡ Replaced Issues with Notes
  { value: "permits", label: "Permits", icon: ShieldCheck },
  { value: "quotes-docs", label: "Quotes & Docs", icon: FileText },
  { value: "plans", label: "Plans & Elevations", icon: FileImage },
  { value: "contractor-portal", label: "Contractor Portal", icon: Globe },
  { value: "daily-logs", label: "Project Notes", icon: BookOpen }, // Renamed from Project Notes to avoid confusion
];

export default function PMProjectWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("id");
  const [tab, setTab] = useState("overview");

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    },
    enabled: !!projectId
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>;
  if (!project) return <div className="p-6 text-slate-500">Project not found.</div>;

  const activeTab = ALL_TABS.find(t => t.value === tab) || ALL_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex items-center gap-4 shrink-0">
        <Link to="/PMProjects" className="text-slate-400 hover:text-slate-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{project.name}</h1>
          {project.site_address && <p className="text-xs text-slate-500">{project.site_address}</p>}
        </div>
      </div>

      {/* Tab Selector */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-2 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 transition-colors">
              <ActiveIcon className="h-4 w-4 text-amber-600" />
              <span>{activeTab.label}</span>
              <ChevronDown className="h-4 w-4 text-slate-400 ml-1" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 max-h-[70vh] overflow-y-auto">
            {ALL_TABS.map(({ value, label, icon: Icon }) => (
              <DropdownMenuItem
                key={value}
                onClick={() => setTab(value)}
                className={`flex items-center gap-2 cursor-pointer ${tab === value ? "bg-amber-50 text-amber-700 font-medium" : ""}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-slate-50">
        <Tabs value={tab} onValueChange={setTab} className="h-full">
          <TabsContent value="overview" className="m-0 h-full"><PMProjectOverview project={project} /></TabsContent>
          <TabsContent value="phases" className="m-0 h-full"><PMPhasesTab project={project} /></TabsContent>
          <TabsContent value="client-timeline" className="m-0 h-full"><PMClientTimelineTab project={project} /></TabsContent>
          <TabsContent value="schedule" className="m-0 h-full"><PMScheduleTrackerTab project={project} /></TabsContent>
          <TabsContent value="subs" className="m-0 h-full"><PMSubcontractorsTab project={project} /></TabsContent>
          <TabsContent value="materials" className="m-0 h-full"><PMMaterialsTab projectId={project.id} /></TabsContent>
          <TabsContent value="staff" className="m-0 h-full"><PMStaffTab project={project} /></TabsContent>
          
          {/* ⚡ NEW: Notes Feed Tab Content */}
          <TabsContent value="notes" className="m-0 p-4 md:p-6 h-full overflow-auto">
            <div className="max-w-5xl mx-auto h-[700px] min-h-full">
              {/* Pass the client_id here so the feed knows who to sync it to! */}
              <NotesFeed 
                relatedType="Project" 
                relatedId={project.id} 
                clientId={project.client_id} 
              />
            </div>
          </TabsContent>

          <TabsContent value="permits" className="m-0 p-4 h-full overflow-auto"><PermitsTab projectId={project.id} /></TabsContent>
          <TabsContent value="quotes-docs" className="m-0 h-full"><PMQuotesDocsTab project={project} /></TabsContent>
          <TabsContent value="plans" className="m-0 h-full"><PMPlansElevationsTab project={project} /></TabsContent>
          <TabsContent value="contractor-portal" className="m-0 h-full"><PMContractorPortalTab project={project} /></TabsContent>
          <TabsContent value="daily-logs" className="m-0 h-full"><PMDailyLogsTab project={project} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}