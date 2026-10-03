import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { format, parseISO, isValid } from "date-fns";
import { Eye, Plus, MessageSquare, Flag, GitBranch, Target, CalendarDays, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import PMStatusBadge from "./PMStatusBadge";

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

export default function PMClientTimelineTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", details: "", event_date: new Date().toISOString().split("T")[0], client_visible: true, category: "Update" });

  // --- SUPABASE QUERIES ---
  const { data: events = [] } = useQuery({ 
    queryKey: ["pm_timeline_events", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_timeline_events").select("*").eq("project_id", project.id);
      if (error && error.code !== '42P01') throw error;
      return data || [];
    } 
  });
  
  const { data: milestones = [] } = useQuery({ 
    queryKey: ["pm_milestones", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_milestones").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    } 
  });
  
  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_phases").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    } 
  });

  // ADDED: Fetch issues so we can display client-visible ones
  const { data: issues = [] } = useQuery({ 
    queryKey: ["project_issues", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_issues").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    } 
  });

  // --- SUPABASE MUTATIONS ---
  const createEvent = useMutation({ 
    mutationFn: async (d) => {
      const { error } = await supabase.from("project_timeline_events").insert([{ ...d, company_id: companyId, project_id: project.id }]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_timeline_events", project.id] }); 
      setAddOpen(false); 
      setForm({ title: "", details: "", event_date: new Date().toISOString().split("T")[0], client_visible: true, category: "Update" }); 
      toast.success("Client update posted!");
    },
    onError: () => toast.error("Failed to post update")
  });

  // Merge and sort all items
  const allItems = [
    // 1. Manual Updates
    ...events.filter(e => e.client_visible).map(e => ({ 
      date: e.event_date, 
      title: e.title, 
      subtitle: e.details, 
      category: e.category, 
      icon: MessageSquare,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-100",
      id: "ev_" + e.id 
    })),
    // 2. Milestones
    ...milestones.filter(m => m.client_visible !== false).map(m => ({ 
      date: m.due_date_target || m.created_at?.split("T")[0], 
      title: m.title, 
      subtitle: m.status === "Completed" ? "Milestone reached." : "Upcoming milestone target.", 
      category: "Milestone", 
      status: m.status, 
      icon: Target,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-100",
      id: "ms_" + m.id 
    })),
    // 3. Phases
    ...phases.filter(p => p.client_visible).map(p => ({ 
      date: p.start_date_actual || p.start_date_target || p.created_at?.split("T")[0], 
      title: p.name, 
      subtitle: p.status === "Completed" ? "Phase completed." : `Phase is ${p.percent_complete || 0}% complete.`, 
      category: "Phase", 
      status: p.status, 
      icon: GitBranch,
      iconColor: "text-purple-500",
      iconBg: "bg-purple-100",
      id: "ph_" + p.id 
    })),
    // 4. ADDED: Client-Visible Issues
    ...issues.filter(i => i.client_visible).map(i => ({
      date: i.created_at?.split("T")[0], // Plot it on the day it was created
      title: `Issue Logged: ${i.title}`,
      subtitle: i.description,
      category: "Issue",
      status: i.status,
      icon: AlertTriangle,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      id: "iss_" + i.id
    }))
  ].filter(i => i.date).sort((a, b) => b.date > a.date ? 1 : -1);

  // Group by exact date string (YYYY-MM-DD)
  const grouped = allItems.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort((a, b) => b > a ? 1 : -1);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
            <Eye className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Client Timeline Feed</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-md leading-relaxed">
              This feed aggregates Phases, Milestones, Issues, and Manual Updates into a clean view for your clients. Internal notes and micro-costs are hidden.
            </p>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 shadow-sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Post Update
        </Button>
      </div>

      {sortedDates.length === 0 && (
        <div className="text-center bg-white border border-slate-200 border-dashed rounded-xl py-16 shadow-sm">
          <EyeOff className="h-12 w-12 mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-700 mb-1">No client-visible events yet</p>
          <p className="text-xs text-slate-500">Post an update or mark a phase/issue as visible to build the client timeline.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setAddOpen(true)}>Post First Update</Button>
        </div>
      )}

      {/* Vertical Timeline Layout */}
      <div className="relative pt-4 pb-10">
        {/* The central line running behind the items */}
        {sortedDates.length > 0 && (
          <div className="absolute left-4 md:left-[120px] top-0 bottom-0 w-px bg-slate-200" />
        )}

        <div className="space-y-10">
          {sortedDates.map(dateStr => {
            const dateObj = safeParseDate(dateStr);
            const formattedDate = dateObj ? format(dateObj, "MMM d, yyyy") : dateStr;
            const shortMonth = dateObj ? format(dateObj, "MMM") : "";
            const dayNum = dateObj ? format(dateObj, "d") : "";

            return (
              <div key={dateStr} className="relative flex flex-col md:flex-row gap-6 md:gap-8 group">
                
                {/* Timeline Date Marker (Left Side on Desktop) */}
                <div className="md:w-[100px] shrink-0 pt-2 flex md:justify-end z-10 pl-1 md:pl-0">
                  <div className="bg-white border-2 border-slate-200 shadow-sm text-slate-700 text-center rounded-xl overflow-hidden hidden md:block">
                    <div className="bg-slate-100 text-[10px] uppercase font-bold tracking-wider py-1 px-3 border-b border-slate-200">{shortMonth}</div>
                    <div className="text-xl font-black py-1 px-3 bg-white">{dayNum}</div>
                  </div>
                  
                  {/* Mobile Date Header */}
                  <div className="md:hidden flex items-center gap-2 mb-2 ml-8">
                    <CalendarDays className="h-4 w-4 text-slate-400" />
                    <span className="font-bold text-slate-700 text-sm">{formattedDate}</span>
                  </div>
                </div>

                {/* Timeline Cards (Right Side) */}
                <div className="flex-1 space-y-4 ml-10 md:ml-0">
                  {grouped[dateStr].map((item, index) => {
                    const Icon = item.icon || Flag;
                    return (
                      <Card key={item.id} className="relative p-4 shadow-sm border-slate-200 hover:shadow-md transition-shadow group-hover:border-blue-200">
                        {/* Status Line Connectors (The horizontal line pointing to the card) */}
                        <div className="absolute top-7 -left-10 md:-left-8 w-10 md:w-8 h-px bg-slate-200 z-0" />
                        
                        {/* Icon Node floating on the main vertical line */}
                        <div className={`absolute top-4 -left-[45px] md:-left-[37px] h-8 w-8 rounded-full border-2 border-white ${item.iconBg} flex items-center justify-center z-10 shadow-sm`}>
                          <Icon className={`h-4 w-4 ${item.iconColor}`} />
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{item.category}</span>
                              {item.status && <PMStatusBadge status={item.status} />}
                            </div>
                            <h3 className="font-bold text-slate-900 text-base md:text-lg">{item.title}</h3>
                            {item.subtitle && <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{item.subtitle}</p>}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Update Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-blue-500"/> Post Client Update</DialogTitle></DialogHeader>
          <div className="space-y-5 pt-2">
            <div>
              <Label className="text-sm font-semibold">Event Title / Summary *</Label>
              <Input className="mt-1" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Framing Inspection Passed" />
            </div>
            
            <div>
              <Label className="text-sm font-semibold">Event Date</Label>
              <Input type="date" className="mt-1 block w-full" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} />
            </div>
            
            <div>
              <Label className="text-sm font-semibold">Details & Notes</Label>
              <Textarea 
                className="mt-1 min-h-[100px]" 
                value={form.details} 
                onChange={e => setForm({...form, details: e.target.value})} 
                placeholder="Add context or notes for the client..." 
              />
            </div>
            
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
              <Switch className="mt-0.5" checked={form.client_visible} onCheckedChange={v => setForm({...form, client_visible: v})} />
              <div>
                <Label className="text-sm font-bold text-blue-900 cursor-pointer" onClick={() => setForm({...form, client_visible: !form.client_visible})}>Visible to Client</Label>
                <p className="text-xs text-blue-700 mt-0.5 leading-tight">If toggled off, this acts as a private project log entry for your internal team only.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => createEvent.mutate(form)} disabled={!form.title || createEvent.isPending}>
                {createEvent.isPending ? "Posting..." : "Post Update"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}