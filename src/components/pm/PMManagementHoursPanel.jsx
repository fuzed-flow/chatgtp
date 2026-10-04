import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";

export default function PMManagementHoursPanel({ project, staff = [], users = [] }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [caps, setCaps] = useState({});
  const lock = useRef(false);
  useEffect(() => { setHours(""); setNotes(""); setCaps({}); }, [project.id, profile?.id]);
  const canManage = ["owner", "admin", "manager"].includes(profile?.role);
  const canRecord = ["owner", "admin", "manager", "office"].includes(profile?.role) && (["owner", "admin"].includes(profile?.role) || staff.some(item => item.user_id === profile?.id && item.is_active !== false));
  const entries = useQuery({
    queryKey: ["pm_management_hours", project.id, profile?.id], enabled: !!canRecord,
    queryFn: async () => {
      const { data, error } = await supabase.from("time_entries").select("id,total_hours,status,date").eq("company_id", profile.company_id).eq("project_id", project.id).eq("user_id", profile.id).eq("is_project_management", true);
      if (error) throw error;
      return data || [];
    },
  });
  const save = useMutation({
    mutationFn: async action => {
      try {
        let result;
        if (action.type === "cap") {
          const value = caps[action.id];
          if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error("Set a positive hour cap or leave it blank.");
          result = await supabase.from("project_staff").update({ pm_hours_cap: value === "" ? null : Number(value) }).eq("company_id", profile.company_id).eq("project_id", project.id).eq("id", action.id).select("id");
          if (!result.error && !result.data?.length) throw new Error("This assignment changed. Reload staff before saving its hour cap.");
        } else {
          if (!date || !Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 24) throw new Error("Choose a date and record between 0 and 24 hours.");
          result = await supabase.from("time_entries").insert({ company_id: profile.company_id, project_id: project.id, user_id: profile.id, employee_name: profile.full_name, date, total_hours: Number(hours), status: "Pending", entry_type: "Manual", is_project_management: true, notes: notes.trim() || null });
        }
        if (result.error) throw result.error;
      } finally { lock.current = false; }
    },
    onSuccess: (_, action) => {
      qc.invalidateQueries({ queryKey: ["project_staff", project.id] });
      qc.invalidateQueries({ queryKey: ["pm_management_hours", project.id] });
      qc.invalidateQueries({ queryKey: ["hr_time_entries"] });
      if (action.type !== "cap") { setHours(""); setNotes(""); }
      toast.success(action.type === "cap" ? "Management hour cap saved" : "Management hours submitted for approval");
    },
    onError: error => toast.error(error.message || "Could not save management hours."),
  });
  const requestSave = action => {
    if (lock.current) return;
    lock.current = true;
    save.mutate(action);
  };
  if (!canManage && !canRecord) return null;
  const recorded = (entries.data || []).filter(entry => ["approved", "pending", "submitted", "under review"].includes(String(entry.status || "").toLowerCase())).reduce((sum, entry) => sum + Number(entry.total_hours || 0), 0);
  return (
    <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-4">
      <div><h3 className="font-semibold text-slate-900">Project management hours</h3><p className="mt-1 text-sm text-slate-500">Caps compare submitted and approved management time, with alerts at 90% and above the cap.</p></div>
      {canManage && staff.filter(item => item.is_active !== false && ["owner", "admin", "manager", "office"].includes(users.find(user => user.id === item.user_id)?.role)).map(item => {
        const user = users.find(person => person.id === item.user_id);
        return <div key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1"><Label htmlFor={`pm-cap-${item.id}`}>{user?.full_name || "Project manager"} · hour cap</Label><Input id={`pm-cap-${item.id}`} type="number" min="0.01" step="any" placeholder="No cap" value={caps[item.id] ?? item.pm_hours_cap ?? ""} onChange={event => setCaps({ ...caps, [item.id]: event.target.value })} disabled={save.isPending} className="mt-1 min-h-11" /></div><Button className="min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={save.isPending || caps[item.id] === undefined} onClick={() => requestSave({ type: "cap", id: item.id })}>Save cap</Button></div>;
      })}
      {canRecord && <form className="space-y-3 border-t border-slate-200 pt-3" onSubmit={event => { event.preventDefault(); requestSave({ type: "hours" }); }}><p className="text-sm text-slate-600">Your recorded management time: {recorded.toFixed(2)} hours</p>{entries.isError && <p role="alert" className="text-sm text-red-700">Recorded hours could not load.</p>}<div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="management-date">Date</Label><Input id="management-date" type="date" value={date} onChange={event => setDate(event.target.value)} required disabled={save.isPending} className="mt-1 min-h-11" /></div><div><Label htmlFor="management-hours">Management hours</Label><Input id="management-hours" type="number" min="0.01" max="24" step="any" value={hours} onChange={event => setHours(event.target.value)} required disabled={save.isPending} className="mt-1 min-h-11" /></div></div><div><Label htmlFor="management-notes">Work performed</Label><Input id="management-notes" value={notes} onChange={event => setNotes(event.target.value)} disabled={save.isPending} className="mt-1 min-h-11" /></div><Button type="submit" className="min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={save.isPending}>{save.isPending ? "Saving..." : "Submit management hours"}</Button></form>}
    </section>
  );
}
