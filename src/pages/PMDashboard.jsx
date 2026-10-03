import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { format, addDays, isAfter, isBefore, parseISO, isValid } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ArrowRight, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PMStatusBadge from "@/components/pm/PMStatusBadge";

// Helper to safely parse dates
const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

export default function PMDashboard() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  // --- SUPABASE QUERIES ---
  const { data: projects = [] } = useQuery({ 
    queryKey: ["pm_projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["pm_clients_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c.name])), [clients]);

  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_phases").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: milestones = [] } = useQuery({ 
    queryKey: ["pm_milestones_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_milestones").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: tasks = [] } = useQuery({ 
    queryKey: ["pm_tasks_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_tasks").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: materials = [] } = useQuery({ 
    queryKey: ["pm_materials_sched_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_materials").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: issues = [] } = useQuery({ 
    queryKey: ["pm_issues_all", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_issues").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  // --- LOGIC & MEMOIZATION ---
  const today = new Date();
  const in14 = addDays(today, 14);

  const activeProjects = projects.filter(p => p.status === "Active" || p.status === "In Progress" || p.status === "Planning");

  const projectProgress = useMemo(() => {
    return activeProjects.map(p => {
      const pPhases = phases.filter(ph => ph.project_id === p.id);
      const avg = pPhases.length > 0 ? Math.round(pPhases.reduce((s, ph) => s + (ph.percent_complete || 0), 0) / pPhases.length) : 0;
      const nextMilestone = milestones
        .filter(m => m.project_id === p.id && m.status !== "Completed" && m.due_date_target)
        .sort((a, b) => new Date(a.due_date_target) - new Date(b.due_date_target))[0];
      return { ...p, progress: avg, nextMilestone };
    });
  }, [activeProjects, phases, milestones]);

  const upcoming = useMemo(() => {
    const items = [];
    milestones.filter(m => {
      const d = safeParseDate(m.due_date_target);
      return m.status !== "Completed" && d && isAfter(d, today) && isBefore(d, in14);
    }).forEach(m => items.push({ type: "Milestone", date: m.due_date_target, label: m.title, project_id: m.project_id }));
    
    tasks.filter(t => {
      const d = safeParseDate(t.due_date_target);
      return t.status !== "Done" && d && isAfter(d, today) && isBefore(d, in14);
    }).forEach(t => items.push({ type: "Task", date: t.due_date_target, label: t.title, project_id: t.project_id }));
    
    materials.filter(m => {
      const d = safeParseDate(m.needed_by_date);
      return d && isAfter(d, today) && isBefore(d, in14) && !["Delivered","Installed"].includes(m.status);
    }).forEach(m => items.push({ type: "Material", date: m.needed_by_date, label: m.custom_material_name || "Material", project_id: m.project_id }));
    
    return items.sort((a, b) => a.date > b.date ? 1 : -1).slice(0, 15);
  }, [milestones, tasks, materials]);

  const atRisk = useMemo(() => {
    const items = [];
    tasks.filter(t => {
      const d = safeParseDate(t.due_date_target);
      return t.status !== "Done" && d && isBefore(d, today);
    }).forEach(t => items.push({ type: "Task", label: t.title, severity: "Overdue", project_id: t.project_id }));
    
    milestones.filter(m => {
      const d = safeParseDate(m.due_date_target);
      return m.status !== "Completed" && d && isBefore(d, today);
    }).forEach(m => items.push({ type: "Milestone", label: m.title, severity: "Overdue", project_id: m.project_id }));
    
    issues.filter(i => i.severity === "Critical" && i.status === "Open")
      .forEach(i => items.push({ type: "Issue", label: i.title, severity: "Critical", project_id: i.project_id }));
      
    return items.slice(0, 15);
  }, [tasks, milestones, issues]);

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const typeColors = { 
    Milestone: "bg-purple-100 text-purple-800", 
    Task: "bg-blue-100 text-blue-800", 
    Material: "bg-amber-100 text-amber-800", 
    Issue: "bg-red-100 text-red-800" 
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Project Management</h1>
          <p className="text-slate-500 text-sm mt-1">{activeProjects.length} active projects</p>
        </div>
        <Link to="/PMProjects">
          <Button className="bg-slate-900 hover:bg-slate-800">
            <FolderKanban className="h-4 w-4 mr-2" /> All Projects
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Projects */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-amber-500" /> Active Projects
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectProgress.length === 0 && <p className="text-slate-400 text-sm text-center py-4">No active projects</p>}
              {projectProgress.map(p => (
  <Link key={p.id} to={`/PMProjectWorkspace?id=${p.id}`} className="block">
    <div className="p-3 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50/30 transition-all">
      
      {/* 1. Header Row */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center min-w-0 flex-1 pr-2">
          <span className="font-semibold text-slate-900 text-sm leading-tight">{p.name}</span>
          <span className="text-xs font-bold text-amber-600 sm:ml-2 leading-tight mt-0.5 sm:mt-0">
            <span className="hidden sm:inline">· </span>{clientMap[p.client_id] || "No Client"}
          </span>
          {p.site_address && (
            <span className="text-xs text-slate-400 sm:ml-2 leading-tight mt-0.5 sm:mt-0">
              ({p.site_address})
            </span>
          )}
        </div>
        
        {/* THIS WAS ACCIDENTALLY DELETED: The percentage and arrow */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-slate-700">{p.progress}%</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
        </div>
      </div> {/* <-- THIS WAS THE MISSING CLOSING DIV */}

      {/* 2. Progress Bar */}
      <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
        <div className="bg-amber-400 h-2 rounded-full transition-all" style={{ width: `${p.progress}%` }} />
      </div>
      
      {/* 3. Next Milestone */}
      {p.nextMilestone && (
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          <span>Next: {p.nextMilestone.title} — {p.nextMilestone.due_date_target}</span>
        </div>
      )}
      
    </div>
  </Link>
))}
            </CardContent>
          </Card>
        </div>

        {/* At Risk */}
        <div>
          <Card className="border-red-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-700">
                <Flame className="h-4 w-4" /> At Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {atRisk.length === 0 && <p className="text-slate-400 text-sm text-center py-4">Nothing at risk</p>}
              {atRisk.map((item, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-50 border border-red-100">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.label}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColors[item.type]}`}>{item.type}</span>
                      <span className="text-[10px] text-slate-400">{projectMap[item.project_id] || ""}</span>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Upcoming 14 days */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-500" /> Upcoming — Next 14 Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 && <p className="text-slate-400 text-sm text-center py-4">Nothing coming up</p>}
          <div className="space-y-2">
            {upcoming.map((item, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 sm:gap-3 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-mono text-slate-500 w-20 shrink-0">{item.date}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColors[item.type]}`}>{item.type}</span>
                <span className="text-sm text-slate-800 truncate flex-1 min-w-[100px]">{item.label}</span>
                <span className="text-xs text-slate-400 ml-auto shrink-0 truncate max-w-[100px] sm:max-w-none">{projectMap[item.project_id] || ""}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}