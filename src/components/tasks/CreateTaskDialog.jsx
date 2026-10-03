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
      if (selectedProject && selectedProject.client_id) {
        setFormData(prev => ({ ...prev, client_id: String(selectedProject.client_id), lead_id: "none" }));
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
    };

    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl w-[95vw] rounded-xl p-4 sm:p-6 bg-slate-50 overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900">Create Task</DialogTitle>
          <DialogDescription className="text-slate-500 font-medium">
            Link to a Project to assign to the Production team, or a Client/Lead for CRM tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
              <Input id="title" placeholder="Enter task title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="font-bold border-slate-200 bg-white" required />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
              <Textarea id="description" placeholder="Task description (optional)" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="h-20 resize-none font-medium border-slate-200 bg-white" />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="task_type" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Type</Label>
              <Select value={formData.task_type} onValueChange={(v) => setFormData({ ...formData, task_type: v })}>
                <SelectTrigger id="task_type" className="font-medium border-slate-200 text-sm bg-white"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ROUTING DROPDOWNS */}
            <div className="space-y-2 border border-blue-200 bg-blue-50 p-3 rounded-xl col-span-2">
              <Label htmlFor="project" className={`text-[10px] font-black uppercase tracking-wider ${hasLead ? 'text-blue-300' : 'text-blue-800'}`}>Production Project</Label>
              <Select disabled={hasLead} value={String(formData.project_id || "none")} onValueChange={(v) => setFormData({ ...formData, project_id: v })}>
                <SelectTrigger id="project" className={`font-bold border-blue-200 text-sm ${hasLead ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'}`}><SelectValue placeholder="Select..." /></SelectTrigger>
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
              <p className="text-[9px] text-blue-600 font-bold uppercase mt-1">Saves to Project Tasks Table</p>
            </div>

            <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
              <Label htmlFor="lead" className={`text-[10px] font-black uppercase tracking-wider ${hasProject ? 'text-slate-300' : 'text-slate-600'}`}>CRM Lead</Label>
              <Select disabled={hasProject} value={String(formData.lead_id || "none")} onValueChange={(v) => setFormData({ ...formData, lead_id: v, client_id: "none" })}>
                <SelectTrigger id="lead" className={`font-medium border-slate-200 text-sm ${hasProject ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'}`}><SelectValue placeholder="Select..." /></SelectTrigger>
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
                <SelectTrigger id="client" className={`font-medium border-slate-200 text-sm ${hasProject || hasLead ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'}`}>
                  <SelectValue placeholder="Select..." />
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

            <div className="space-y-2">
              <Label htmlFor="vendor" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Vendor / Subcontractor</Label>
              <Select value={String(formData.vendor_id || "none")} onValueChange={(v) => setFormData({ ...formData, vendor_id: v })}>
                <SelectTrigger id="vendor" className="font-medium border-slate-200 text-sm bg-white"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Vendor</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={String(v.id)} value={String(v.id)}>
                      {v.name || "Unnamed Vendor"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigned" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assign To</Label>
              <Select value={String(formData.assigned_to || "none")} onValueChange={(v) => setFormData({ ...formData, assigned_to: v })}>
                <SelectTrigger id="assigned" className="font-medium border-slate-200 text-sm bg-white"><SelectValue placeholder="Select..." /></SelectTrigger>
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
                <SelectTrigger id="priority" className="font-medium border-slate-200 text-sm bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger id="status" className="font-medium border-slate-200 text-sm bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="due_date" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date (Optional)</Label>
              <Input id="due_date" type="date" value={formData.due_date || ""} onChange={(e) => setFormData({ ...formData, due_date: e.target.value })} className="font-medium border-slate-200 text-sm block w-full bg-white" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="estimated_hours" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. Hours</Label>
              <Input id="estimated_hours" type="number" min="0" step="0.5" placeholder="e.g. 2.5" value={formData.estimated_hours || ""} onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value })} className="font-medium border-slate-200 text-sm bg-white" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-200 mt-2">
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