import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, LogIn, LogOut } from "lucide-react";
import { format, differenceInMinutes, parseISO, startOfWeek, endOfWeek } from "date-fns";
import { toast } from "sonner";

function formatDuration(minutes) {
  if (!minutes || minutes < 0) return "0h 00m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{format(now, "hh:mm:ss a")}</span>;
}

export default function EPTimeClock({ currentUser, companyId }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: myEntries = [], isLoading } = useQuery({
    queryKey: ["time_entries_mine", currentUser?.full_name],
    queryFn: async () => {
      const { data } = await supabase
        .from("time_entries")
        .select("*")
        .eq("employee_name", currentUser.full_name) 
        .order("clock_in", { ascending: false });
      return data || [];
    },
    enabled: !!currentUser?.full_name,
    refetchInterval: 30000,
  });

  const activeEntry = myEntries.find(e => e.status === "Clocked In");
  const todayEntries = myEntries.filter(e => e.date === today);
  
  const todayMinutes = todayEntries.reduce((sum, e) => {
    if (e.total_hours) return sum + (Number(e.total_hours) * 60);
    if (e.clock_in && e.status === "Clocked In") {
      return sum + differenceInMinutes(new Date(), parseISO(e.clock_in));
    }
    return sum;
  }, 0);

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekMinutes = myEntries.filter(e => e.date >= weekStart && e.date <= weekEnd).reduce((sum, e) => {
    if (e.total_hours) return sum + (Number(e.total_hours) * 60);
    return sum;
  }, 0);

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id: companyId,
        employee_name: currentUser.full_name,
        user_id: currentUser.id,
        clock_in: new Date().toISOString(),
        date: today,
        status: "Clocked In",
        notes: notes || null,
        entry_type: "Regular"
      };
      const { error } = await supabase.from("time_entries").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_entries_mine"] });
      setNotes("");
      toast.success("Clocked in successfully!");
    },
    onError: (err) => toast.error(`Failed to clock in: ${err.message}`)
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      const nowDate = new Date();
      const clockInDate = parseISO(activeEntry.clock_in);
      const mins = differenceInMinutes(nowDate, clockInDate);
      const totalHours = parseFloat((mins / 60).toFixed(2));

      const { error } = await supabase.from("time_entries").update({
        clock_out: nowDate.toISOString(),
        total_hours: totalHours,
        status: "Pending",
      }).eq("id", activeEntry.id);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_entries_mine"] });
      toast.success("Clocked out! Your hours have been submitted.");
    },
    onError: (err) => toast.error(`Failed to clock out: ${err.message}`)
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center py-4">
        <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tight"><LiveClock /></p>
        <p className="text-sm font-bold uppercase tracking-wider text-slate-400 mt-1">{format(new Date(), "EEEE, MMMM d")}</p>
      </div>

      {activeEntry ? (
        <Card className="border-amber-300 bg-amber-50 shadow-sm">
          <CardContent className="p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
              <p className="text-base font-black text-amber-800">CLOCKED IN</p>
            </div>
            <p className="text-sm font-bold text-amber-700">
              Since {format(parseISO(activeEntry.clock_in), "hh:mm a")}
            </p>
            <p className="text-xs font-medium text-amber-700/80 mt-1">
              {formatDuration(differenceInMinutes(new Date(), parseISO(activeEntry.clock_in)))} elapsed
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <p className="text-base font-black text-slate-600">OFF THE CLOCK</p>
            </div>
            <p className="text-sm text-slate-400">Clock in to start tracking your hours.</p>
          </CardContent>
        </Card>
      )}

      {!activeEntry ? (
        <div className="space-y-3">
          <Input placeholder="What are you working on today? (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="bg-white h-12" />
          <Button className="w-full bg-amber-500 hover:bg-amber-600 shadow-md shadow-amber-500/20 text-slate-900 h-14 text-lg font-black gap-2 transition-all"
            onClick={() => clockInMutation.mutate()} disabled={clockInMutation.isPending}>
            <LogIn className="h-5 w-5" />
            {clockInMutation.isPending ? "Starting Shift..." : "CLOCK IN"}
          </Button>
        </div>
      ) : (
        <Button className="w-full bg-slate-900 hover:bg-black shadow-md shadow-slate-900/20 text-white h-14 text-lg font-black gap-2 transition-all"
          onClick={() => clockOutMutation.mutate()} disabled={clockOutMutation.isPending}>
          <LogOut className="h-5 w-5 text-amber-400" />
          {clockOutMutation.isPending ? "Ending Shift..." : "CLOCK OUT"}
        </Button>
      )}

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200">
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Today's Hours</p>
          <p className="text-2xl font-black text-slate-900">{formatDuration(Math.round(todayMinutes))}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> This Week</p>
          <p className="text-2xl font-black text-slate-900">{formatDuration(Math.round(weekMinutes))}</p>
        </div>
      </div>
    </div>
  );
}