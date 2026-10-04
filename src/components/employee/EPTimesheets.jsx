import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Clock, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

function buildLocalIsoString(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  
  const pad = (num) => String(num).padStart(2, '0');
  const tzo = -d.getTimezoneOffset();
  const sign = tzo >= 0 ? '+' : '-';
  const offH = pad(Math.floor(Math.abs(tzo) / 60));
  const offM = pad(Math.abs(tzo) % 60);

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${sign}${offH}:${offM}`;
}

function calcHours(clockIn, clockOut, breakMins) {
  if (!clockIn || !clockOut) return 0;
  const [inH, inM] = clockIn.split(":").map(Number);
  const [outH, outM] = clockOut.split(":").map(Number);
  
  let totalMins = (outH * 60 + outM) - (inH * 60 + inM) - (breakMins || 0);
  if (totalMins < 0) totalMins += 24 * 60; 
  
  return Math.max(0, totalMins / 60);
}

const STATUS_COLORS = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
  "Clocked In": "bg-blue-100 text-blue-800 border-blue-200",
};

export default function EPTimesheets({ currentUser, companyId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  
  const defaultForm = { 
    date: format(new Date(), "yyyy-MM-dd"), 
    clock_in: "", 
    clock_out: "", 
    break_minutes: 0, 
    project_id: "none", 
    notes: "" 
  };
  
  const [form, setForm] = useState(defaultForm);

  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId);
      return data || [];
    } 
  });

  const { data: sheets = [] } = useQuery({
    queryKey: ["time_entries_mine", currentUser?.full_name],
    enabled: !!currentUser?.full_name,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("employee_name", currentUser.full_name)
        .order("date", { ascending: false })
        .limit(30); 
      
      if (error) throw error;
      return data || [];
    }
  });

  // ONLY CREATE ALLOWED - No updating or deleting!
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const clockInTs = buildLocalIsoString(payload.date, payload.clock_in);
      const clockOutTs = buildLocalIsoString(payload.date, payload.clock_out);

      const dbPayload = {
        company_id: companyId,
        employee_name: currentUser.full_name,
        user_id: currentUser.id,
        project_id: payload.project_id === "none" ? null : payload.project_id,
        date: payload.date,
        clock_in: clockInTs,
        clock_out: clockOutTs,
        total_hours: payload.total_hours,
        notes: payload.notes || null,
        entry_type: "Manual",
        status: "Pending", // Always pending so HR has to approve it
      };

      const { error } = await supabase.from("time_entries").insert([dbPayload]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["time_entries_mine"] }); 
      handleCloseDialog();
      toast.success("Timesheet submitted to HR for approval!"); 
    },
    onError: (err) => toast.error(`Failed to submit: ${err.message}`)
  });

  const handleOpenNew = () => {
    setForm(defaultForm);
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
    setForm(defaultForm);
  };

  const handleSubmit = () => {
    const total = calcHours(form.clock_in, form.clock_out, Number(form.break_minutes));
    if (total <= 0) {
      toast.error("Invalid times. Please check your clock in/out and breaks.");
      return;
    }

    const payload = {
      ...form,
      total_hours: parseFloat(total.toFixed(2)),
    };

    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-amber-500" /> My Time Sheets
          </h3>
          <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">
            Showing last 30 shifts
          </p>
        </div>
        <Button 
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
          onClick={handleOpenNew}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Submit Missing Hours
        </Button>
      </div>

      <div className="space-y-3">
        {sheets.length === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
            <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">You have no recorded shifts yet.</p>
          </div>
        )}
        
        {sheets.map(s => {
          const proj = projects.find(p => p.id === s.project_id);

          return (
            <Card key={s.id} className="border-slate-200 shadow-sm bg-white">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-black text-slate-900 text-base">{s.date}</span>
                      <Badge className={`text-[10px] font-bold uppercase tracking-wider border ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                        {s.status}
                      </Badge>
                      {s.entry_type === "Manual" && (
                        <Badge variant="outline" className="text-[10px] font-bold text-slate-500 bg-slate-50">
                          Manual Entry
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm font-medium text-slate-600 flex-wrap">
                      {s.clock_in && (
                        <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                          <span className="text-slate-400 text-xs uppercase font-bold">IN</span>
                          <span className="text-slate-900">{format(parseISO(s.clock_in), "hh:mm a")}</span>
                        </div>
                      )}
                      {s.clock_out && (
                        <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                          <span className="text-slate-400 text-xs uppercase font-bold">OUT</span>
                          <span className="text-slate-900">{format(parseISO(s.clock_out), "hh:mm a")}</span>
                        </div>
                      )}
                      {proj && (
                        <div className="flex items-center gap-1.5 bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-100">
                          <span className="text-amber-600/60 text-xs uppercase font-bold">PROJ</span>
                          <span className="truncate max-w-[150px]">{proj.name}</span>
                        </div>
                      )}
                    </div>
                    {s.notes && (
                      <div className="mt-3 text-sm text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 italic">
                        "{s.notes}"
                      </div>
                    )}
                  </div>
                  <div className="sm:text-right shrink-0 flex items-center justify-between sm:block border-t border-slate-100 sm:border-0 pt-3 sm:pt-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 sm:block hidden">Total</p>
                    <p className="text-3xl font-black text-slate-900">{(Number(s.total_hours) || 0).toFixed(2)}<span className="text-base text-slate-400">h</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(val) => !val && handleCloseDialog()}>
        <DialogContent className="max-w-sm bg-slate-50" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-black text-xl">
              Submit Missing Shift
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 bg-white font-medium" />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Clock In</label>
                <Input type="time" value={form.clock_in} onChange={e => setForm({ ...form, clock_in: e.target.value })} className="mt-1 bg-white font-medium" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Clock Out</label>
                <Input type="time" value={form.clock_out} onChange={e => setForm({ ...form, clock_out: e.target.value })} className="mt-1 bg-white font-medium" />
              </div>
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Unpaid Break (Minutes)</label>
              <Input type="number" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: e.target.value })} placeholder="e.g., 30" className="mt-1 bg-white font-medium" />
            </div>
            
            {form.clock_in && form.clock_out && (
              <div className="bg-amber-100/50 border border-amber-200 rounded-lg p-3 text-center shadow-sm">
                <span className="text-2xl font-black text-amber-700">{calcHours(form.clock_in, form.clock_out, Number(form.break_minutes)).toFixed(2)} hrs</span>
                <span className="text-xs font-bold uppercase text-amber-600/70 ml-2">Total Shift</span>
              </div>
            )}
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Project</label>
              <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select project..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No Project —</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes to HR</label>
              <Textarea placeholder="Why are you submitting this manually?" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 bg-white font-medium" />
            </div>
            
            <div className="flex gap-2 pt-2 border-t border-slate-200 mt-4">
              <Button variant="outline" className="flex-1 font-bold" onClick={handleCloseDialog}>Cancel</Button>
              <Button 
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
                onClick={handleSubmit} 
                disabled={createMutation.isPending || !form.clock_in || !form.clock_out}
              >
                {createMutation.isPending ? "Saving..." : "Submit to HR"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}