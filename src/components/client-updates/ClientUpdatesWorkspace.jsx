import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Download, Edit3, Eye, Mail, MessageSquare, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import ClientUpdateDeliveryDialog from "@/components/client-updates/ClientUpdateDeliveryDialog";
import ClientUpdateFormDialog from "@/components/client-updates/ClientUpdateFormDialog";
import ClientUpdatePreviewDialog from "@/components/client-updates/ClientUpdatePreviewDialog";
import { generateClientUpdatePDF } from "@/components/pdf/PDFGenerator";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/AuthContext";
import { matchesClientUpdate } from "@/lib/clientUpdates";

const formatDate = value => value
  ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "No date";

export default function ClientUpdatesWorkspace({ fixedProject = null }) {
  const { profile, company } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formState, setFormState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [delivery, setDelivery] = useState(null);

  const projectsQuery = useQuery({
    queryKey: ["client-update-projects", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects")
        .select("id,company_id,client_id,name,project_number,site_address,status")
        .eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const clientsQuery = useQuery({
    queryKey: ["client-update-clients", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients")
        .select("id,name,email,phone,site_address")
        .eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const updatesQuery = useQuery({
    queryKey: ["client-updates", companyId, fixedProject?.id || "all"],
    enabled: !!companyId,
    queryFn: async () => {
      let query = supabase.from("client_updates").select("*").eq("company_id", companyId)
        .order("update_date", { ascending: false }).order("created_at", { ascending: false });
      if (fixedProject?.id) query = query.eq("project_id", fixedProject.id);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const projects = useMemo(() => {
    if (!fixedProject) return projectsQuery.data || [];
    const loaded = projectsQuery.data?.find(project => project.id === fixedProject.id);
    return [{ ...fixedProject, ...loaded }];
  }, [fixedProject, projectsQuery.data]);
  const projectById = useMemo(() => Object.fromEntries(projects.map(project => [project.id, project])), [projects]);
  const clientById = useMemo(() => Object.fromEntries((clientsQuery.data || []).map(client => [client.id, client])), [clientsQuery.data]);
  const updates = updatesQuery.data || [];
  const filtered = useMemo(() => updates.filter(update => {
    const project = projectById[update.project_id];
    const client = clientById[update.client_id];
    return (status === "all" || update.status === status) && matchesClientUpdate(update, project, client, search);
  }), [updates, projectById, clientById, search, status]);

  const saveMutation = useMutation({
    mutationFn: async payload => {
      const project = projectById[payload.project_id];
      if (!project?.client_id) throw new Error("Assign a client to this project before creating an update.");
      const values = {
        title: payload.title,
        update_date: payload.update_date,
        summary: payload.summary,
        completed_work: payload.completed_work,
        upcoming_work: payload.upcoming_work,
        client_notes: payload.client_notes,
        status: payload.status,
        prepared_by_name: profile?.full_name || "Project team",
      };
      if (formState?.update?.id) {
        const { error } = await supabase.from("client_updates").update(values)
          .eq("id", formState.update.id).eq("company_id", companyId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("client_updates").insert({
          ...values,
          company_id: companyId,
          project_id: project.id,
          client_id: project.client_id,
          created_by: profile.id,
          updated_by: profile.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ["client-updates", companyId] });
      setFormState(null);
      toast.success(payload.status === "Published" ? "Client update published to the portal." : "Client update saved as a draft.");
    },
    onError: error => toast.error(error.message || "The client update could not be saved."),
  });

  const isLoading = projectsQuery.isPending || clientsQuery.isPending || updatesQuery.isPending;
  const loadError = projectsQuery.error || clientsQuery.error || updatesQuery.error;
  const eligibleProjects = useMemo(() => projects
    .filter(project => project.client_id)
    .map(project => ({ ...project, client_name: clientById[project.client_id]?.name || "Client" })), [projects, clientById]);
  const openPreview = update => setPreview(update);
  const openDelivery = (update, mode) => setDelivery({ update, mode });
  const related = update => ({ project: projectById[update.project_id], client: clientById[update.client_id] });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Client communication</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Client Updates</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Create a clear record of progress, completed work, and what the client can expect next.</p>
        </div>
        <Button disabled={!eligibleProjects.length} onClick={() => setFormState({ update: null })} className="min-h-11 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Plus className="mr-2 h-4 w-4" />Create update</Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1 sm:max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Search client updates" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search project, client, title or update details..." className="min-h-11 bg-white pl-10" /></div>
        <select aria-label="Filter client updates by status" value={status} onChange={event => setStatus(event.target.value)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm sm:w-44"><option value="all">All statuses</option><option value="Draft">Draft</option><option value="Published">Published</option></select>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800">Client updates could not be loaded. {loadError.message}</Card>}
      {!loadError && !eligibleProjects.length && !isLoading && <Card className="border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Assign a client to a project before creating a client update.</Card>}
      {isLoading ? <Card className="p-8 text-center text-sm text-slate-500">Loading client updates...</Card> : filtered.length === 0 ? (
        <Card className="border-dashed p-8"><EmptyState icon={CalendarDays} title={search || status !== "all" ? "No matching client updates" : "No client updates yet"} description={search || status !== "all" ? "Try another search or status filter." : "Create the first professional project update for this client."} /></Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map(update => {
            const { project, client } = related(update);
            return (
              <Card key={update.id} className="border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><StatusBadge status={update.status} /><span className="text-xs font-bold text-slate-500">{formatDate(update.update_date)}</span></div>
                    <h3 className="mt-2 text-lg font-black text-slate-950">{update.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{project?.project_number ? `${project.project_number} - ` : ""}{project?.name || "Project"}{client?.name ? ` · ${client.name}` : ""}</p>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{update.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-500"><span>{update.completed_work?.length || 0} completed</span><span>{update.upcoming_work?.length || 0} upcoming</span>{update.email_sent_at && <span>Email sent</span>}{update.sms_sent_at && <span>Text sent</span>}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-md lg:justify-end">
                    <Button variant="outline" size="sm" onClick={() => openPreview(update)}><Eye className="mr-1.5 h-4 w-4" />View</Button>
                    <Button variant="outline" size="sm" onClick={() => setFormState({ update })}><Edit3 className="mr-1.5 h-4 w-4" />Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => generateClientUpdatePDF(update, project, client, company)}><Download className="mr-1.5 h-4 w-4" />PDF</Button>
                    <Button variant="outline" size="sm" disabled={!client?.email} onClick={() => openDelivery(update, "email")}><Mail className="mr-1.5 h-4 w-4" />Email</Button>
                    <Button size="sm" disabled={!client?.phone} onClick={() => openDelivery(update, "sms")} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><MessageSquare className="mr-1.5 h-4 w-4" />Text</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ClientUpdateFormDialog open={!!formState} onOpenChange={open => { if (!open) setFormState(null); }} update={formState?.update} projects={eligibleProjects} fixedProject={fixedProject} saving={saveMutation.isPending} onSave={payload => saveMutation.mutate(payload)} />
      <ClientUpdatePreviewDialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }} update={preview} project={preview ? related(preview).project : null} client={preview ? related(preview).client : null} company={company} />
      <ClientUpdateDeliveryDialog open={!!delivery} onOpenChange={open => { if (!open) setDelivery(null); }} mode={delivery?.mode} update={delivery?.update} project={delivery ? related(delivery.update).project : null} client={delivery ? related(delivery.update).client : null} company={company} onSent={() => queryClient.invalidateQueries({ queryKey: ["client-updates", companyId] })} />
    </div>
  );
}
