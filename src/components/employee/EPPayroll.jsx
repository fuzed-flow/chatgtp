import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Clock, TrendingUp, Receipt, Info, ShieldAlert, CalendarRange } from "lucide-react";
import { format, differenceInDays, addDays, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

// --- PAY PERIOD CALCULATOR ---
function getBiWeeklyPeriods(currentDate) {
  const anchorDateStr = "2026-06-01"; 
  const now = new Date(currentDate);
  const anchor = new Date(`${anchorDateStr}T00:00:00`); 
  
  const daysDiff = differenceInDays(now, anchor);
  const periodsPassed = Math.floor(daysDiff / 14);
  
  const currentStart = addDays(anchor, periodsPassed * 14);
  const currentEnd = addDays(currentStart, 13);
  
  const lastStart = subDays(currentStart, 14);
  const lastEnd = subDays(currentStart, 1);

  return {
    current: {
      startStr: format(currentStart, "yyyy-MM-dd"),
      endStr: format(currentEnd, "yyyy-MM-dd"),
      label: `${format(currentStart, "MMM d")} - ${format(currentEnd, "MMM d, yyyy")}`
    },
    last: {
      startStr: format(lastStart, "yyyy-MM-dd"),
      endStr: format(lastEnd, "yyyy-MM-dd"),
      label: `${format(lastStart, "MMM d")} - ${format(lastEnd, "MMM d, yyyy")}`
    }
  };
}

export default function EPPayroll({ currentUser, companyId }) {
  const { profile } = useAuth();
  const actorId = profile?.id;
  const activeCompanyId = profile?.company_id;
  const identityReady = !!actorId && actorId === currentUser?.id && !!activeCompanyId && activeCompanyId === companyId;
  const periods = getBiWeeklyPeriods(new Date());

  // Canonical payroll identity is the authenticated profile UUID. A narrowly
  // scoped name fallback is used only for legacy rows without user_id and only
  // when that name uniquely identifies this active company profile. RLS applies
  // the same uniqueness rule server-side.
  const timesheetsQuery = useQuery({
    queryKey: ["time_entries_payroll", activeCompanyId, actorId, profile?.full_name, periods.last.startStr, periods.current.endStr],
    enabled: identityReady,
    queryFn: async () => {
      const entryFields = "id,company_id,user_id,date,total_hours,status";
      const [canonical, nameMatches] = await Promise.all([
        supabase
          .from("time_entries")
          .select(entryFields)
          .eq("company_id", activeCompanyId)
          .eq("user_id", actorId)
          .gte("date", periods.last.startStr)
          .lte("date", periods.current.endStr)
          .order("date", { ascending: false }),
        profile?.full_name
          ? supabase
              .from("profiles")
              .select("id")
              .eq("company_id", activeCompanyId)
              .eq("full_name", profile.full_name)
              .or("is_active.is.null,is_active.eq.true")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (canonical.error) throw canonical.error;
      if (nameMatches.error) throw nameMatches.error;

      let legacy = [];
      if (nameMatches.data?.length === 1 && nameMatches.data[0].id === actorId) {
        const { data, error } = await supabase
          .from("time_entries")
          .select(entryFields)
          .eq("company_id", activeCompanyId)
          .is("user_id", null)
          .eq("employee_name", profile.full_name)
          .gte("date", periods.last.startStr)
          .lte("date", periods.current.endStr)
          .order("date", { ascending: false });
        if (error) throw error;
        legacy = data || [];
      }

      return [...new Map([...(canonical.data || []), ...legacy].map(entry => [entry.id, entry])).values()]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
  });
  const timesheets = timesheetsQuery.data || [];

  // Fetch APPROVED expenses
  const expensesQuery = useQuery({
    queryKey: ["expenses_payroll", activeCompanyId, actorId, periods.current.startStr, periods.current.endStr],
    enabled: identityReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,company_id,user_id,date,amount,status")
        .eq("company_id", activeCompanyId)
        .eq("user_id", actorId)
        .eq("status", "Approved")
        .gte("date", periods.current.startStr)
        .lte("date", periods.current.endStr);

      if (error) throw error;
      return data || [];
    }
  });
  const expenses = expensesQuery.data || [];

  // --- CURRENT PERIOD MATH ---
  const currentSheets = timesheets.filter(t => t.date >= periods.current.startStr && t.date <= periods.current.endStr);
  
  // Split into Approved vs Pending
  const approvedSheets = currentSheets.filter(t => t.status === "Approved");
  const pendingSheets = currentSheets.filter(t => t.status === "Pending" || t.status === "Clocked In");

  const approvedHours = approvedSheets.reduce((sum, t) => sum + Number(t.total_hours || 0), 0);
  const pendingHours = pendingSheets.reduce((sum, t) => sum + Number(t.total_hours || 0), 0);
  const totalCurrentHours = approvedHours + pendingHours;
  
  // Overtime (Calculated on ALL submitted hours over 8 per day)
  const currentOT = currentSheets.reduce((sum, t) => {
    const hrs = Number(t.total_hours || 0);
    return sum + (hrs > 8 ? hrs - 8 : 0);
  }, 0);

  // --- LAST PERIOD MATH ---
  const lastSheets = timesheets.filter(t => t.date >= periods.last.startStr && t.date <= periods.last.endStr);
  const lastHours = lastSheets.reduce((sum, t) => sum + Number(t.total_hours || 0), 0);
  
  // Expenses
  const pendingExpenses = expenses
    .filter(e => e.date >= periods.current.startStr && e.date <= periods.current.endStr)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // --- ESTIMATED PAY CALCULATIONS ---
  const hourlyRate = profile?.hourly_rate || 0;
  
  const approvedPay = approvedHours * hourlyRate;
  const pendingPay = pendingHours * hourlyRate;
  const estimatedTotalPay = approvedPay + pendingPay;

  if (timesheetsQuery.isLoading || expensesQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!identityReady || timesheetsQuery.isError || expensesQuery.isError) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>My Pay could not be loaded. Check your employee profile and connection, then try again.</p>
        {identityReady && <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => { timesheetsQuery.refetch(); expensesQuery.refetch(); }}>Retry</Button>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-amber-500" /> My Pay & Hours
        </h3>
        <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4" /> Current Period: {periods.current.label}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
        <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-bold text-blue-900">How this works</h4>
          <p className="text-xs text-blue-700 mt-1 leading-relaxed">
            Your shifts must be <strong>Approved</strong> by HR to be processed for payroll. Pending shifts are counted in your estimates below but are not finalized.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* APPROVED HOURS */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Approved</span>
            </div>
            <p className="text-3xl font-black text-slate-900">{approvedHours.toFixed(2)}<span className="text-base font-bold text-slate-400 ml-1">h</span></p>
            <p className="text-[10px] font-bold text-emerald-600 uppercase mt-1">Ready for Pay</p>
          </CardContent>
        </Card>

        {/* PENDING HOURS */}
        <Card className="border-slate-200 shadow-sm bg-slate-50">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Pending</span>
            </div>
            <p className="text-3xl font-black text-slate-900">{pendingHours.toFixed(2)}<span className="text-base font-bold text-slate-400 ml-1">h</span></p>
            <p className="text-[10px] font-bold text-amber-600 uppercase mt-1">Awaiting Approval</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Overtime</span>
            </div>
            <p className="text-3xl font-black text-amber-700">{currentOT.toFixed(2)}<span className="text-base font-bold text-amber-500 ml-1">h</span></p>
            <p className="text-[10px] font-bold text-amber-600/70 uppercase mt-1">Total OT (This Period)</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Expenses</span>
            </div>
            <p className="text-3xl font-black text-emerald-700">${pendingExpenses.toFixed(2)}</p>
            <p className="text-[10px] font-bold text-emerald-600/70 uppercase mt-1">Approved & Unpaid</p>
          </CardContent>
        </Card>
      </div>

      {/* ESTIMATED PAY CARD */}
      {hourlyRate > 0 ? (
        <Card className="border-slate-900 bg-slate-900 shadow-md">
          <CardContent className="p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">Estimated Gross Pay (This Period)</p>
            <div className="flex items-end gap-3">
              <p className="text-5xl font-black text-white">${estimatedTotalPay.toFixed(2)}</p>
            </div>
            
            <div className="mt-5 space-y-2 bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex justify-between items-center">
                <span className="text-sm text-emerald-400 font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Approved Pay
                </span>
                <span className="text-base text-white font-black">${approvedPay.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                <span className="text-sm text-amber-400 font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Pending Pay
                </span>
                <span className="text-base text-white font-black">${pendingPay.toFixed(2)}</span>
              </div>
              
              {pendingPay > 0 && (
                <p className="text-[10px] text-amber-500/80 font-medium italic mt-2 text-right">
                  * Pending pay has not been officially approved by HR yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-slate-50 shadow-sm border-dashed">
          <CardContent className="p-6 text-center">
            <DollarSign className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700">Wage data unavailable</p>
            <p className="text-xs text-slate-500 mt-1">Your hourly rate has not been configured by HR yet, so we cannot estimate your pay.</p>
          </CardContent>
        </Card>
      )}

      {/* SHIFTS LIST */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">All Shifts ({periods.current.label})</h4>
            <ShieldAlert className="h-4 w-4 text-slate-300" />
          </div>
          
          {currentSheets.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="h-8 w-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-500">No shifts recorded for this pay period yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {currentSheets.map(s => {
                const hrs = Number(s.total_hours || 0);
                const ot = hrs > 8 ? hrs - 8 : 0;
                
                return (
                  <div key={s.id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold text-slate-900">{format(new Date(s.date + 'T00:00:00'), 'EEEE, MMM d')}</p>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          s.status === "Approved" ? "bg-emerald-100 text-emerald-800" : 
                          s.status === "Clocked In" ? "bg-blue-100 text-blue-800" :
                          "bg-amber-100 text-amber-800"
                        }`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-black text-slate-900">{hrs.toFixed(2)}h</p>
                      {ot > 0 && <p className="text-[10px] font-bold text-amber-600 uppercase">+{ot.toFixed(2)}h OT</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Quick helper icon for the UI
function CheckCircle2(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  );
}
