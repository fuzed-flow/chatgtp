import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const STATUSES = ["To Do", "Doing", "Blocked", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TASK_TYPES = ["General", "Request for Quote", "Request for Pricing", "Site Visit", "Follow Up", "Administrative", "Other"];

const getClientName = (c) => {
  if (!c) return "Unknown Client";
  if (c.name && c.name.trim() !== "") return c.name;
  const fullName = [c.first_name, c.surname].filter(Boolean).join(" ");
  if (fullName && fullName.trim() !== "") return fullName;
  if (c.primary_contact_name && c.primary_contact_name.trim() !== "") return c.primary_contact_name;
  return "Unnamed Client";
};

const getProjectName = (p) => {
  if (!p) return "Unknown Project";
  if (p.name && p.name.trim() !== "") return p.name;
  if (p.project_number) return `Project #${p.project_number}`;
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
  isLoading,
  defaultClientId = "none",
  defaultProjectId = "none",
  defaultLeadId = "none",
}) {
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
    if (open) {
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
    }
  }, [open, defaultClientId, defaultProjectId, defaultLeadId]);

  // Routing Logic
  const hasProject = formData.project_id !== "none";
  const hasLead = formData.lead_id !== "none";
  
  // Auto-select Client and disable dropdown when a Project is selected
  useEffect(() => {
    if (hasProject) {
      const selectedProject = projects.find(p => String(p.id) === formData.project_id);
      if (selectedProject) {
        setFormData(prev => ({
          ...prev,
          client_id: selectedProject.client_id ? String(selectedProject.client_id) : "none",
          lead_id: "none",
          vendor_id: "none",
        }));
      }
    }
  }, [formData.project_id, projects]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    // The explicit flag telling the parent page which Supabase table to insert into
    const isProjectTask = formData.project_id !== "none";

    const payload = {
      ...formData,
      is_project_task: isProjectTask,
      estimated_hours: formData.estimated_hours ? Number(formData.estimated_hours) : null,
      client_id: formData.client_id === "none" ? null : formData.client_id,
      project_id: formData.project_id === "none" ? null : formData.project_id,
      lead_id: formData.lead_id === "none" ? null : formData.lead_id,
      vendor_id: formData.vendor_id === "none" ? null : formData.vendor_id,
      task_type: formData.task_type === "none" ? null : formData.task_type,
      assigned_to: formData.assigned_to === "none" ? null : formData.assigned_to,
      due_date: formData.due_date || null,
    };

    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[96vw] overflow-y-auto rounded-xl bg-slate-50 p-4 pt-10 sm:max-w-2xl sm:p-6">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-xl font-black text-slate-900">Create Task</DialogTitle>
          <DialogDescription className="text-slate-500 font-medium">
            Add the work first, then choose where it belongs and who is responsible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Task details</p>
              <p className="mt-1 text-sm text-slate-600">Describe the outcome clearly enough for the assignee to act without guessing.</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
              <Input id="title" autoFocus placeholder="Enter task title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="min-h-11 border-slate-300 bg-white font-bold" required />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
              <Textarea id="description" rows={4} placeholder="Add scope, location, expectations, or access details (optional)" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="min-h-28 bg-white font-medium" />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="task_type" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Type</Label>
              <Select value={formData.task_type} onValueChange={(v) => setFormData({ ...formData, task_type: v })}>
                <SelectTrigger id="task_type" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-slate-200 pt-1 sm:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Link the task</p>
              <p className="mt-1 text-sm text-slate-600">Choose a production project, or leave it unselected and link a CRM lead or client.</p>
            </div>

            {/* ROUTING DROPDOWNS */}
            <div className="col-span-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <Label htmlFor="project" className={`text-[10px] font-black uppercase tracking-wider ${hasLead ? 'text-slate-400' : 'text-amber-900'}`}>Production Project</Label>
              <Select disabled={hasLead} value={String(formData.project_id || "none")} onValueChange={(v) => setFormData({ ...formData, project_id: v })}>
                <SelectTrigger id="project" className={`min-h-11 border-amber-300 text-sm font-bold focus:ring-amber-500 ${hasLead ? 'bg-slate-100 opacity-60' : 'bg-white shadow-sm'}`}><SelectValue placeholder="Select a project..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Project</SelectItem>
                  {projects.map((p) => {
                    const projectClient = clients.find(c => String(c.id) === String(p.client_id));
                    const clientName = projectClient ? getClientName(projectClient) : "";
                    return (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {getProjectName(p)} {clientName ? `— ${clientName}` : ""}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs font-medium text-amber-800">Project tasks appear in the selected project's Staff &amp; Tasks workspace.</p>
            </div>

            <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
              <Label htmlFor="lead" className={`text-[10px] font-black uppercase tracking-wider ${hasProject ? 'text-slate-300' : 'text-slate-600'}`}>CRM Lead</Label>
              <Select disabled={hasProject} value={String(formData.lead_id || "none")} onValueChange={(v) => setFormData({ ...formData, lead_id: v, client_id: "none" })}>
                <SelectTrigger id="lead" className={`min-h-11 border-slate-300 text-sm font-medium ${hasProject ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'}`}><SelectValue placeholder="Select a lead..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Lead</SelectItem>
                  {leads.map((l) => (
                    <SelectItem key={String(l.id)} value={String(l.id)}>
                      {l.contact_name || "Unnamed Lead"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
              <Label htmlFor="client" className={`text-[10px] font-black uppercase tracking-wider ${hasProject || hasLead ? 'text-slate-300' : 'text-slate-600'}`}>CRM Client</Label>
              <Select disabled={hasProject || hasLead} value={String(formData.client_id || "none")} onValueChange={(v) => setFormData({ ...formData, client_id: v })}>
                <SelectTrigger id="client" className={`min-h-11 border-slate-300 text-sm font-medium ${hasProject || hasLead ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'}`}>
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={String(c.id)} value={String(c.id)}>
                      {getClientName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-slate-200 pt-1 sm:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Assignment &amp; schedule</p>
              <p className="mt-1 text-sm text-slate-600">Assign internal ownership, an optional external company, timing, and priority.</p>
            </div>

            <div className={`space-y-2 rounded-xl border p-4 sm:col-span-2 ${hasProject ? 'border-slate-200 bg-slate-100' : 'border-amber-200 bg-amber-50/60'}`}>
              <Label htmlFor="vendor" className={`text-[10px] font-black uppercase tracking-wider ${hasProject ? 'text-slate-400' : 'text-amber-900'}`}>Vendor / Subcontractor <span className="font-medium normal-case tracking-normal">(optional)</span></Label>
              <Select disabled={hasProject} value={String(formData.vendor_id || "none")} onValueChange={(v) => setFormData({ ...formData, vendor_id: v })}>
                <SelectTrigger id="vendor" className={`min-h-11 border-slate-300 text-sm font-medium ${hasProject ? 'bg-slate-100 opacity-60' : 'bg-white'}`}><SelectValue placeholder="Select an external company..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Vendor</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={String(v.id)} value={String(v.id)}>
                      {v.name || "Unnamed Vendor"}{v.category ? ` — ${v.category}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-slate-600">{hasProject ? "Project tasks use the project's Subcontractors workspace, so this CRM vendor link is unavailable." : vendors.length ? "Use this when an external trade or supplier is responsible for the CRM task." : "No vendors are available. Add one in Vendors before linking an external company."}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigned" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assign To</Label>
              <Select value={String(formData.assigned_to || "none")} onValueChange={(v) => setFormData({ ...formData, assigned_to: v })}>
                <SelectTrigger id="assigned" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue placeholder="Select a team member..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={String(u.id)} value={String(u.id)}>
                      {u.full_name || "Unknown User"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="priority" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Priority</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                <SelectTrigger id="priority" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger id="status" className="min-h-11 border-slate-300 bg-white text-sm font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="due_date" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date (Optional)</Label>
              <Input id="due_date" type="date" value={formData.due_date || ""} onChange={(e) => setFormData({ ...formData, due_date: e.target.value })} className="block min-h-11 w-full border-slate-300 bg-white text-sm font-medium" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="estimated_hours" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. Hours</Label>
              <Input id="estimated_hours" type="number" min="0" step="0.5" placeholder="e.g. 2.5" value={formData.estimated_hours || ""} onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value })} className="min-h-11 border-slate-300 bg-white text-sm font-medium" />
            </div>
          </div>

          <div className="sticky -bottom-4 -mx-4 flex flex-col justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-4 pb-1 pt-4 backdrop-blur sm:-bottom-6 sm:-mx-6 sm:flex-row sm:px-6 sm:pb-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto font-bold order-2 sm:order-1 border-slate-300">Cancel</Button>
            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md order-1 sm:order-2">
              {isLoading ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
