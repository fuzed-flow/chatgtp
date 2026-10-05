import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Camera, CheckCircle2, ClipboardCheck, Edit3, Eye, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/AuthContext";
import { matchesProjectCloseout } from "@/lib/projectCloseouts";

const today = () => new Date().toISOString().slice(0, 10);
const displayDate = value => value
  ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "No date";

function NewCloseoutDialog({ open, onOpenChange, projects, fixedProject, saving, onCreate }) {
  const firstProject = fixedProject?.id || projects[0]?.id || "";
  const [projectId, setProjectId] = useState(firstProject);
  const [title, setTitle] = useState("Project deficiency walkthrough");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");

  React.useEffect(() => {
    if (!open) return;
    setProjectId(fixedProject?.id || projects[0]?.id || "");
    setTitle("Project deficiency walkthrough");
    setDate(today());
    setNotes("");
  }, [open, fixedProject, projects]);

  const submit = (event, mode) => {
    event.preventDefault();
    if (!projectId || !title.trim()) return;
    onCreate({ project_id: projectId, title: title.trim(), walkthrough_date: date, notes: notes.trim(), mode });
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent className="max-h-[94dvh] w-[96vw] overflow-y-auto pt-10 sm:max-w-xl sm:pt-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-xl font-black">Start project closeout</DialogTitle>
          <DialogDescription>Choose a fast photo capture or a guided deficiency walkthrough. You can finish details later.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5 pt-2">
          {!fixedProject && <div className="space-y-2"><Label htmlFor="closeout-project">Project</Label><select id="closeout-project" value={projectId} disabled={saving} onChange={event => setProjectId(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" required><option value="">Select project…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.project_number ? `${project.project_number} — ` : ""}{project.name} · {project.client_name}</option>)}</select></div>}
          <div className="space-y-2"><Label htmlFor="closeout-title">Checklist title</Label><Input id="closeout-title" value={title} disabled={saving} onChange={event => setTitle(event.target.value)} maxLength={200} required /></div>
          <div className="space-y-2"><Label htmlFor="closeout-date">Walkthrough date</Label><Input id="closeout-date" type="date" value={date} disabled={saving} onChange={event => setDate(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="closeout-notes">General notes <span className="font-normal text-slate-400">(optional)</span></Label><Textarea id="closeout-notes" value={notes} disabled={saving} onChange={event => setNotes(event.target.value)} rows={3} placeholder="Access instructions, walkthrough attendees, or overall observations…" /></div>
          <div className="grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-2">
            <Button type="button" variant="outline" disabled={saving || !projectId || !title.trim()} onClick={event => submit(event, "quick")} className="h-auto min-h-16 justify-start px-4 py-3 text-left"><Camera className="mr-3 h-5 w-5 shrink-0 text-amber-600" /><span><strong className="block">Quick photo capture</strong><span className="text-xs font-normal text-slate-500">Photograph now, complete details later</span></span></Button>
            <Button type="button" disabled={saving || !projectId || !title.trim()} onClick={event => submit(event, "guided")} className="h-auto min-h-16 justify-start bg-amber-500 px-4 py-3 text-left text-slate-950 hover:bg-amber-600"><ClipboardCheck className="mr-3 h-5 w-5 shrink-0" /><span><strong className="block">Guided walkthrough</strong><span className="text-xs font-normal">Complete each item, then tap next</span></span></Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectCloseoutsWorkspace({ fixedProject = null }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["project-closeout-projects", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id,company_id,client_id,name,project_number,site_address,status").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const clientsQuery = useQuery({
    queryKey: ["project-closeout-clients", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name,email,phone,site_address").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const closeoutsQuery = useQuery({
    queryKey: ["project-closeouts", companyId, fixedProject?.id || "all"], enabled: !!companyId,
    queryFn: async () => {
      let query = supabase.from("project_closeouts").select("*,project_closeout_items(id,status,description,assigned_vendor_id)").eq("company_id", companyId).order("walkthrough_date", { ascending: false }).order("created_at", { ascending: false });
      if (fixedProject?.id) query = query.eq("project_id", fixedProject.id);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const projects = useMemo(() => fixedProject
    ? [{ ...fixedProject, ...(projectsQuery.data || []).find(project => project.id === fixedProject.id) }]
    : projectsQuery.data || [], [fixedProject, projectsQuery.data]);
  const clients = clientsQuery.data || [];
  const projectById = useMemo(() => Object.fromEntries(projects.map(project => [project.id, project])), [projects]);
  const clientById = useMemo(() => Object.fromEntries(clients.map(client => [client.id, client])), [clients]);
  const eligibleProjects = useMemo(() => projects.filter(project => project.client_id).map(project => ({ ...project, client_name: clientById[project.client_id]?.name || "Client" })), [projects, clientById]);
  const filtered = useMemo(() => (closeoutsQuery.data || []).filter(closeout => {
    const project = projectById[closeout.project_id];
    const client = clientById[closeout.client_id];
    return (status === "all" || closeout.status === status) && matchesProjectCloseout(closeout, project, client, search);
  }), [closeoutsQuery.data, projectById, clientById, search, status]);

  const createMutation = useMutation({
    mutationFn: async payload => {
      const project = projectById[payload.project_id];
      if (!project?.client_id) throw new Error("Assign a client to this project before creating a closeout.");
      const { data, error } = await supabase.from("project_closeouts").insert({
        company_id: companyId, project_id: project.id, client_id: project.client_id,
        title: payload.title, walkthrough_date: payload.walkthrough_date, notes: payload.notes,
        prepared_by_name: profile?.full_name || "Project team", created_by: profile.id, updated_by: profile.id,
      }).select("id").single();
      if (error) throw error;
      return { id: data.id, mode: payload.mode };
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ["project-closeouts", companyId] });
      setCreating(false);
      navigate(`/ProjectCloseoutView?id=${encodeURIComponent(result.id)}&mode=${result.mode}`);
    },
    onError: error => toast.error(error.message || "The project closeout could not be created."),
  });

  const isLoading = projectsQuery.isPending || clientsQuery.isPending || closeoutsQuery.isPending;
  const loadError = projectsQuery.error || clientsQuery.error || closeoutsQuery.error;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Project completion</p><h2 className="mt-1 text-2xl font-black text-slate-950">Project Closeouts</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">Capture deficiencies onsite, assign subcontractors, and deliver a professional closeout checklist.</p></div>
        <Button disabled={!eligibleProjects.length} onClick={() => setCreating(true)} className="min-h-11 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Plus className="mr-2 h-4 w-4" />Start closeout</Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1 sm:max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Search project closeouts" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search project, client or checklist…" className="min-h-11 bg-white pl-10" /></div><select aria-label="Filter closeouts by status" value={status} onChange={event => setStatus(event.target.value)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm sm:w-44"><option value="all">All statuses</option><option value="Draft">Draft</option><option value="Published">Published</option><option value="Completed">Completed</option></select></div>

      {loadError && <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800">Project closeouts could not be loaded. {loadError.message}</Card>}
      {!loadError && !eligibleProjects.length && !isLoading && <Card className="border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Assign a client to a project before creating a project closeout.</Card>}
      {isLoading ? <Card className="p-8 text-center text-sm text-slate-500">Loading project closeouts…</Card> : filtered.length === 0 ? <Card className="border-dashed p-8"><EmptyState icon={ClipboardCheck} title={search || status !== "all" ? "No matching closeouts" : "No project closeouts yet"} description={search || status !== "all" ? "Try another search or status filter." : "Start a deficiency walkthrough from the office or directly on site."} /></Card> : (
        <div className="grid gap-4">{filtered.map(closeout => {
          const project = projectById[closeout.project_id];
          const client = clientById[closeout.client_id];
          const items = closeout.project_closeout_items || [];
          const complete = items.filter(item => item.status === "Complete").length;
          const needsDetails = items.filter(item => !item.description?.trim() || !item.assigned_vendor_id).length;
          return <Card key={closeout.id} className="border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={closeout.status} /><span className="flex items-center gap-1 text-xs font-bold text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{displayDate(closeout.walkthrough_date)}</span>{needsDetails > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{needsDetails} need details</span>}</div><h3 className="mt-2 text-lg font-black text-slate-950">{closeout.title}</h3><p className="mt-1 text-sm font-semibold text-slate-700">{project?.project_number ? `${project.project_number} — ` : ""}{project?.name || "Project"}{client?.name ? ` · ${client.name}` : ""}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-500"><span>{items.length} deficiencies</span><span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{complete} complete</span>{closeout.subcontractors_sent_at && <span>Sent to trades</span>}{closeout.email_sent_at && <span>Client emailed</span>}{closeout.sms_sent_at && <span>Client texted</span>}</div></div><div className="grid grid-cols-2 gap-2 sm:flex"><Button variant="outline" size="sm" asChild><a href={`/ProjectCloseoutView?id=${encodeURIComponent(closeout.id)}`} target="_blank" rel="noopener noreferrer"><Eye className="mr-1.5 h-4 w-4" />View</a></Button><Button size="sm" onClick={() => navigate(`/ProjectCloseoutView?id=${encodeURIComponent(closeout.id)}`)} className="bg-slate-900 font-bold hover:bg-slate-800"><Edit3 className="mr-1.5 h-4 w-4" />Edit</Button></div></div></Card>;
        })}</div>
      )}

      <NewCloseoutDialog open={creating} onOpenChange={setCreating} projects={eligibleProjects} fixedProject={fixedProject} saving={createMutation.isPending} onCreate={payload => createMutation.mutate(payload)} />
    </div>
  );
}
