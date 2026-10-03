import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Plus, Clock, Flag, CheckSquare, Package, Wrench, AlertTriangle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PMStatusBadge from "./PMStatusBadge";

const CATEGORY_ICONS = {
  Phase: Flag, Milestone: Flag, Task: CheckSquare, Material: Package,
  Subcontractor: Wrench, Inspection: AlertTriangle, Change: MessageSquare,
  Payment: MessageSquare, Update: MessageSquare, Issue: AlertTriangle, Other: Clock
};

const CATEGORY_COLORS = {
  Phase: "border-blue-400 bg-blue-50", Milestone: "border-purple-400 bg-purple-50",
  Task: "border-sky-400 bg-sky-50", Material: "border-amber-400 bg-amber-50",
  Subcontractor: "border-orange-400 bg-orange-50", Inspection: "border-yellow-400 bg-yellow-50",
  Issue: "border-red-400 bg-red-50", Update: "border-slate-300 bg-white",
  Change: "border-indigo-400 bg-indigo-50", Payment: "border-green-400 bg-green-50", Other: "border-slate-300 bg-white"
};

export default function PMTimelineTab({ project }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", details: "", event_date: new Date().toISOString().split("T")[0], category: "Update", visibility: "Internal Only" });

  // --- FIREBASE QUERIES ---
  const { data: events = [] } = useQuery({ 
    queryKey: ["pm_timeline", project.id], 
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "pmTimelineEvents"), where("project_id", "==", project.id)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } 
  });
  
  const { data: milestones = [] } = useQuery({ 
    queryKey: ["pm_milestones", project.id], 
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "pmMilestones"), where("project_id", "==", project.id)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } 
  });
  
  const { data: tasks = [] } = useQuery({ 
    queryKey: ["pm_tasks", project.id], 
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "pmTasks"), where("project_id", "==", project.id)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } 
  });
  
  const { data: materials = [] } = useQuery({ 
    queryKey: ["pm_materials_sched", project.id], 
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "pmMaterialScheduleItems"), where("project_id", "==", project.id)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } 
  });

  // --- FIREBASE MUTATIONS ---
  const createEvent = useMutation({ 
    mutationFn: async (d) => await addDoc(collection(db, "pmTimelineEvents"), d), 
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_timeline", project.id] }); 
      setAddOpen(false); 
      setForm({ title: "", details: "", event_date: new Date().toISOString().split("T")[0], category: "Update", visibility: "Internal Only" });
    } 
  });

  // Merge all sources into one feed
  const allItems = [
    ...events.map(e => ({ date: e.event_date, title: e.title, subtitle: e.details, category: e.category, visibility: e.visibility, id: "ev_" + e.id })),
    ...milestones.map(m => ({ date: m.due_date_target, title: m.title, subtitle: m.description, category: "Milestone", status: m.status, id: "ms_" + m.id })),
    ...tasks.map(t => ({ date: t.due_date_target || t.start_date_target, title: t.title, subtitle: t.description, category: "Task", status: t.status, id: "tk_" + t.id })),
    ...materials.map(m => ({ date: m.needed_by_date, title: m.custom_material_name || "Material", subtitle: m.supplier, category: "Material", status: m.status, id: "mt_" + m.id })),
  ].filter(i => i.date).sort((a, b) => b.date > a.date ? 1 : -1);

  // Group by date
  const grouped = allItems.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b > a ? 1 : -1);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-semibold text-slate-800">Internal Timeline</h2>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Update
        </Button>
      </div>

      {sortedDates.length === 0 && <p className="text-center text-slate-400 py-8">No timeline events yet.</p>}

      <div className="space-y-6">
        {sortedDates.map(date => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{date}</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="space-y-2">
              {grouped[date].map(item => {
                const Icon = CATEGORY_ICONS[item.category] || Clock;
                const color = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Other;
                return (
                  <div key={item.id} className={`flex gap-3 p-3 rounded-lg border-l-4 ${color}`}>
                    <Icon className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-900">{item.title}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{item.category}</span>
                        {item.status && <PMStatusBadge status={item.status} />}
                        {item.visibility === "Internal Only" && <span className="text-xs text-slate-400 italic">internal</span>}
                      </div>
                      {item.subtitle && <p className="text-xs text-slate-500 mt-1">{item.subtitle}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Add Timeline Update</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} /></div>
            <div><Label>Date *</Label><Input type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} /></div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Phase","Milestone","Task","Material","Subcontractor","Inspection","Change","Payment","Update","Issue","Other"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Visibility</Label>
              <Select value={form.visibility} onValueChange={v => setForm({...form, visibility: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Internal Only">Internal Only</SelectItem><SelectItem value="Client Visible">Client Visible</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Details</Label><Textarea rows={3} value={form.details} onChange={e => setForm({...form, details: e.target.value})} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900" onClick={() => createEvent.mutate({ ...form, project_id: project.id })} disabled={!form.title || !form.event_date}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}