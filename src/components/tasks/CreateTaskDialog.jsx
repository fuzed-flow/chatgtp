import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { VENDOR_CATEGORIES } from "@/lib/vendorCategories";

const STATUSES = ["To Do", "Doing", "Blocked", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TASK_TYPES = ["General", "Request for Quote", "Request for Pricing", "Site Visit", "Follow Up", "Administrative", "Other"];
const EMPTY_VENDOR = { name: "", category: "Other" };

const getClientName = (client) => {
  if (!client) return "Unknown Client";
  if (client.name?.trim()) return client.name.trim();
  const fullName = [client.first_name, client.surname].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (client.primary_contact_name?.trim()) return client.primary_contact_name.trim();
  return "Unnamed Client";
};

const getProjectName = (project) => {
  if (!project) return "Unknown Project";
  if (project.name?.trim()) return project.name.trim();
  if (project.project_number) return `Project #${project.project_number}`;
  return "Unnamed Project";
};

export default function CreateTaskDialog({
  open,
  onOpenChange,
  clients = [],
  projects = [],
  leads = [],
  vendors = [],
  users = [],
  onSubmit,
  onCreateVendor,
  isLoading,
  isCreatingVendor = false,
  defaultClientId = "none",
  defaultProjectId = "none",
  defaultLeadId = "none",
}) {
  const titleInputRef = useRef(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showVendorCreator, setShowVendorCreator] = useState(false);
  const [vendorDraft, setVendorDraft] = useState(EMPTY_VENDOR);
  const [vendorError, setVendorError] = useState("");
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    client_id: "none",
    project_id: "none",
    lead_id: "none",
    vendor_id: "none",
    task_type: "General",
    assigned_to: "none",
    priority: "Medium",
    status: "To Do",
    due_date: "",
    estimated_hours: "",
  });

  useEffect(() => {
    if (!open) return;
    setFormData({
      title: "",
      description: "",
      client_id: defaultClientId,
      project_id: defaultProjectId,
      lead_id: defaultLeadId,
      vendor_id: "none",
      task_type: "General",
      assigned_to: "none",
      priority: "Medium",
      status: "To Do",
      due_date: "",
      estimated_hours: "",
    });
    setShowMoreOptions(false);
    setShowVendorCreator(false);
    setVendorDraft(EMPTY_VENDOR);
    setVendorError("");
  }, [open, defaultClientId, defaultProjectId, defaultLeadId]);

  const hasProject = formData.project_id !== "none";
  const hasLead = formData.lead_id !== "none";

  useEffect(() => {
    if (!hasProject) return;
    const selectedProject = projects.find(project => String(project.id) === formData.project_id);
    if (!selectedProject) return;
    setFormData(current => ({
      ...current,
      client_id: selectedProject.client_id ? String(selectedProject.client_id) : "none",
      lead_id: "none",
    }));
  }, [formData.project_id, hasProject, projects]);

  const handleCreateVendor = async () => {
    const name = vendorDraft.name.trim();
    if (!name) {
      setVendorError("Enter the subcontractor or vendor name.");
      return;
    }
    if (!onCreateVendor) return;

    setVendorError("");
    try {
      const vendor = await onCreateVendor({ name, category: vendorDraft.category });
      if (!vendor?.id) throw new Error("The vendor was created without a usable record.");
      setFormData(current => ({ ...current, vendor_id: String(vendor.id) }));
      setVendorDraft(EMPTY_VENDOR);
      setShowVendorCreator(false);
    } catch (error) {
      setVendorError(error?.message || "The vendor could not be created.");
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!formData.title.trim()) return;

    onSubmit({
      ...formData,
      is_project_task: hasProject,
      estimated_hours: formData.estimated_hours ? Number(formData.estimated_hours) : null,
      client_id: formData.client_id === "none" ? null : formData.client_id,
      project_id: formData.project_id === "none" ? null : formData.project_id,
      lead_id: formData.lead_id === "none" ? null : formData.lead_id,
      vendor_id: formData.vendor_id === "none" ? null : formData.vendor_id,
      task_type: formData.task_type === "none" ? null : formData.task_type,
      assigned_to: formData.assigned_to === "none" ? null : formData.assigned_to,
      due_date: formData.due_date || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-slate-50 p-0 sm:h-auto sm:max-h-[92dvh] sm:max-w-2xl"
        closeButtonClassName="right-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 opacity-100 shadow-sm hover:bg-amber-100 sm:right-4 sm:top-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
            window.requestAnimationFrame(() => titleInputRef.current?.focus());
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-4 pb-4 pr-16 pt-[calc(env(safe-area-inset-top)+1rem)] text-left sm:px-6 sm:pb-5 sm:pr-16 sm:pt-6">
          <DialogTitle className="text-xl font-black text-slate-900">Create Task</DialogTitle>
          <DialogDescription className="font-medium text-slate-500">
            Add the work, where it belongs, and who is responsible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Task details</p>
                <p className="mt-1 text-sm text-slate-600">Describe the outcome clearly enough for the assignee to act without guessing.</p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-task-title" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
                <Input ref={titleInputRef} id="create-task-title" placeholder="Enter task title" value={formData.title} onChange={(event) => setFormData(current => ({ ...current, title: event.target.value }))} className="min-h-11 border-slate-300 bg-white font-bold" required />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-task-description" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
                <Textarea id="create-task-description" rows={4} placeholder="Add scope, location, expectations, or access details (optional)" value={formData.description} onChange={(event) => setFormData(current => ({ ...current, description: event.target.value }))} className="min-h-28 bg-white font-medium" />
              </div>

              <div className="border-t border-slate-200 pt-1 sm:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Link the task</p>
                <p className="mt-1 text-sm text-slate-600">Choose a production project, or link the task to a CRM lead or client.</p>
              </div>

              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:col-span-2">
                <Label htmlFor="create-task-project" className={`text-[10px] font-black uppercase tracking-wider ${hasLead ? "text-slate-400" : "text-amber-900"}`}>Production Project</Label>
                <Select disabled={hasLead} value={String(formData.project_id || "none")} onValueChange={(value) => setFormData(current => ({ ...current, project_id: value }))}>
                  <SelectTrigger id="create-task-project" className={`min-h-11 border-amber-300 text-sm font-bold focus:ring-amber-500 ${hasLead ? "bg-slate-100 opacity-60" : "bg-white shadow-sm"}`}><SelectValue placeholder="Select a project..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map((project) => {
                      const projectClient = clients.find(client => String(client.id) === String(project.client_id));
                      const clientName = projectClient ? getClientName(projectClient) : "";
                      return <SelectItem key={String(project.id)} value={String(project.id)}>{getProjectName(project)} {clientName ? `— ${clientName}` : ""}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs font-medium text-amber-800">Project tasks appear in the selected project&apos;s Staff &amp; Tasks workspace.</p>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <Label htmlFor="create-task-lead" className={`text-[10px] font-black uppercase tracking-wider ${hasProject ? "text-slate-300" : "text-slate-600"}`}>CRM Lead</Label>
                <Select disabled={hasProject} value={String(formData.lead_id || "none")} onValueChange={(value) => setFormData(current => ({ ...current, lead_id: value, client_id: "none" }))}>
                  <SelectTrigger id="create-task-lead" className={`min-h-11 border-slate-300 text-sm font-medium ${hasProject ? "bg-slate-50 opacity-60" : "bg-white shadow-sm"}`}><SelectValue placeholder="Select a lead..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    {leads.map(lead => <SelectItem key={String(lead.id)} value={String(lead.id)}>{lead.contact_name || "Unnamed Lead"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <Label htmlFor="create-task-client" className={`text-[10px] font-black uppercase tracking-wider ${hasProject || hasLead ? "text-slate-300" : "text-slate-600"}`}>CRM Client</Label>
                <Select disabled={hasProject || hasLead} value={String(formData.client_id || "none")} onValueChange={(value) => setFormData(current => ({ ...current, client_id: value }))}>
                  <SelectTrigger id="create-task-client" className={`min-h-11 border-slate-300 text-sm font-medium ${hasProject || hasLead ? "bg-slate-50 opacity-60" : "bg-white shadow-sm"}`}><SelectValue placeholder="Select a client..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map(client => <SelectItem key={String(client.id)} value={String(client.id)}>{getClientName(client)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t border-slate-200 pt-1 sm:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Assignment &amp; schedule</p>
                <p className="mt-1 text-sm text-slate-600">Assign internal ownership, an external company, timing, and priority.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-task-assigned" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assign To</Label>
                <Select value={String(formData.assigned_to || "none")} onValueChange={(value) => setFormData(current => ({ ...current, assigned_to: value }))}>
                  <SelectTrigger id="create-task-assigned" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue placeholder="Select a team member..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {users.map(user => <SelectItem key={String(user.id)} value={String(user.id)}>{user.full_name || "Unknown User"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-task-due-date" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date <span className="font-medium normal-case tracking-normal">(optional)</span></Label>
                <Input id="create-task-due-date" type="date" value={formData.due_date || ""} onChange={(event) => setFormData(current => ({ ...current, due_date: event.target.value }))} className="block min-h-11 w-full border-slate-300 bg-white text-sm font-medium" />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-task-priority" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Priority</Label>
                <Select value={formData.priority} onValueChange={(value) => setFormData(current => ({ ...current, priority: value }))}>
                  <SelectTrigger id="create-task-priority" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(priority => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="create-task-vendor" className="text-[10px] font-black uppercase tracking-wider text-amber-900">Vendor / Subcontractor <span className="font-medium normal-case tracking-normal">(optional)</span></Label>
                  {onCreateVendor && !showVendorCreator && (
                    <button type="button" onClick={() => { setShowVendorCreator(true); setVendorError(""); }} className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-black text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                      <Plus className="h-4 w-4" /> Add vendor
                    </button>
                  )}
                </div>
                <Select value={String(formData.vendor_id || "none")} onValueChange={(value) => setFormData(current => ({ ...current, vendor_id: value }))}>
                  <SelectTrigger id="create-task-vendor" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue placeholder="Select an external company..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Vendor</SelectItem>
                    {vendors.map(vendor => <SelectItem key={String(vendor.id)} value={String(vendor.id)}>{vendor.name || "Unnamed Vendor"}{vendor.category ? ` — ${vendor.category}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>

                {showVendorCreator && (
                  <div className="space-y-3 rounded-xl border border-amber-300 bg-white p-3" aria-label="Add vendor">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="create-task-new-vendor" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Company name *</Label>
                        <Input id="create-task-new-vendor" value={vendorDraft.name} onChange={(event) => setVendorDraft(current => ({ ...current, name: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleCreateVendor(); } }} placeholder="e.g. ABC Painting" className="min-h-11" disabled={isCreatingVendor} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="create-task-new-vendor-category" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Trade category</Label>
                        <Select value={vendorDraft.category} onValueChange={(value) => setVendorDraft(current => ({ ...current, category: value }))} disabled={isCreatingVendor}>
                          <SelectTrigger id="create-task-new-vendor-category" className="min-h-11"><SelectValue /></SelectTrigger>
                          <SelectContent>{VENDOR_CATEGORIES.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    {vendorError && <p role="alert" className="text-xs font-semibold text-red-700">{vendorError}</p>}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button type="button" variant="ghost" onClick={() => { setShowVendorCreator(false); setVendorDraft(EMPTY_VENDOR); setVendorError(""); }} disabled={isCreatingVendor}>Cancel</Button>
                      <Button type="button" onClick={handleCreateVendor} disabled={isCreatingVendor || !vendorDraft.name.trim()} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600">{isCreatingVendor ? "Adding..." : "Add and select"}</Button>
                    </div>
                  </div>
                )}

                <p className="text-xs leading-5 text-slate-600">
                  {vendors.length ? "Assign the external trade or supplier responsible for this task." : onCreateVendor ? "No vendors are available yet. Add one here without leaving the task." : "No vendors are available. Ask an office or management user to add one."}
                </p>
              </div>

              <div className="sm:col-span-2">
                <button type="button" aria-expanded={showMoreOptions} aria-controls="create-task-more-options" onClick={() => setShowMoreOptions(current => !current)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 shadow-sm hover:border-amber-400 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                  More options
                  <ChevronDown className={`h-4 w-4 transition-transform ${showMoreOptions ? "rotate-180" : ""}`} />
                </button>
              </div>

              <div id="create-task-more-options" className={`${showMoreOptions ? "grid" : "hidden"} gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2 sm:grid-cols-2`}>
                <div className="space-y-2">
                  <Label htmlFor="create-task-type" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Type</Label>
                  <Select value={formData.task_type} onValueChange={(value) => setFormData(current => ({ ...current, task_type: value }))}>
                    <SelectTrigger id="create-task-type" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue placeholder="Select type..." /></SelectTrigger>
                    <SelectContent>{TASK_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-task-status" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
                  <Select value={formData.status} onValueChange={(value) => setFormData(current => ({ ...current, status: value }))}>
                    <SelectTrigger id="create-task-status" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="create-task-hours" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Estimated Hours</Label>
                  <Input id="create-task-hours" type="number" min="0" step="0.5" placeholder="e.g. 2.5" value={formData.estimated_hours || ""} onChange={(event) => setFormData(current => ({ ...current, estimated_hours: event.target.value }))} className="min-h-11 border-slate-300 bg-white text-sm font-medium" />
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:flex sm:justify-end sm:gap-2 sm:px-6 sm:pb-4 sm:pt-4">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11 w-full border-slate-300 font-bold sm:w-auto">Cancel</Button>
              <Button type="submit" disabled={isLoading || isCreatingVendor} className="min-h-11 w-full bg-amber-500 font-bold text-slate-900 shadow-md hover:bg-amber-600 sm:w-auto">{isLoading ? "Creating..." : "Create Task"}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
