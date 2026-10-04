import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useLocation } from "react-router-dom";
import { checkAccess } from '@/lib/planConfig'; 
import UpgradeWall from '@/components/shared/UpgradeWall';
import { 
  Users, CheckSquare, Search, DollarSign, Clock, Calendar, 
  ChevronRight, Save, UserCheck, AlertTriangle, FileText, CheckCircle, Pencil, X,
  Palmtree, Receipt, ChevronLeft, Download, Image as ImageIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format, parseISO, startOfWeek, endOfWeek, addDays, subDays, addWeeks, subWeeks, isSameDay, isWithinInterval } from "date-fns";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";

// ==========================================
// HELPER FUNCTIONS (Outside the component)
// ==========================================
const exportToCSV = (data, filename) => {
  if (!data || data.length === 0) {
    toast.error("No data to export for this view");
    return;
  }
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(fieldName => `"${String(row[fieldName] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csvContent = [headers.join(','), ...rows].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const formatDatetimeLocal = (isoString) => {
  if (!isoString) return "";
  try {
    return format(parseISO(isoString), "yyyy-MM-dd'T'HH:mm");
  } catch (e) {
    return "";
  }
};

// ==========================================
// MAIN COMPONENT
// ==========================================
export default function HumanResources() {
  const { profile, settings, company } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();
  const { search: notificationSearch } = useLocation();
  const [activeView, setActiveView] = useState(() => {
    const tab = new URLSearchParams(notificationSearch).get("tab");
    return ["timesheets", "expenses"].includes(tab) ? tab : "directory";
  });
  useEffect(() => {
    const tab = new URLSearchParams(notificationSearch).get("tab");
    if (["timesheets", "expenses"].includes(tab)) setActiveView(tab);
  }, [notificationSearch]);

  // 👇 1. THE GATEKEEPER 👇
  const canAccessHR = checkAccess(company?.plan_id, 'hasHR');

  if (!canAccessHR) {
    return <UpgradeWall featureName="Human Resources & Payroll" requiredPlan="Professional" />;
  }
  // 👆 ------------------ 👆

  // --- FEATURE TOGGLES ---
  const hrSettings = {
    enable_time_tracking: settings?.features?.time_clock !== false,
    enable_expenses: settings?.features?.expenses !== false,
  };

  // --- UI STATE ---
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [search, setSearch] = useState("");
  
  // Filters & Pagination
  const [approvalFilter, setApprovalFilter] = useState("Pending"); 
  const [employeeFilter, setEmployeeFilter] = useState("All"); 
  const [timeView, setTimeView] = useState("Weekly"); 
  const [currentDate, setCurrentDate] = useState(new Date());

  const [editingRate, setEditingRate] = useState(false);
  const [tempRate, setTempRate] = useState("");
  const [selectedEntries, setSelectedEntries] = useState([]);
  const [editEntry, setEditEntry] = useState(null);

  // Helper to smartly switch views and adjust date filters automatically
  const handleViewChange = (view) => {
    setActiveView(view);
    setSelectedEntries([]);
    if (view === "timesheets") setTimeView("Weekly");
    else if (view === "timeoff" || view === "expenses") setTimeView("All Time");
  };

  useEffect(() => {
    if (activeView === "timesheets" && !hrSettings.enable_time_tracking) setActiveView("directory");
    if (activeView === "timeoff" && !hrSettings.enable_time_tracking) setActiveView("directory");
    if (activeView === "expenses" && !hrSettings.enable_expenses) setActiveView("directory");
  }, [hrSettings, activeView]);

  // --- 1. FETCH USERS & PROFILES ---
  const { data: team = [], isLoading: usersLoading } = useQuery({
    queryKey: ["hr_team", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: usersData } = await supabase.from("users").select("*").eq("company_id", companyId);
      const { data: profilesData } = await supabase.from("profiles").select("*").eq("company_id", companyId);
      
      const allUserIds = new Set([
        ...(usersData || []).map(u => u.id),
        ...(profilesData || []).map(p => p.id)
      ]);

      const merged = Array.from(allUserIds).map(id => {
        const u = usersData?.find(user => user.id === id) || {};
        const p = profilesData?.find(prof => prof.id === id) || {};
        return { ...p, ...u, id, hourly_rate: p.hourly_rate || 0 };
      });

      return merged.sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
    }
  });

  // --- 2. FETCH TIME ENTRIES (Clock ins) ---
  const { data: allTimeEntries = [], isLoading: timeLoading } = useQuery({
    queryKey: ["hr_time_entries", companyId],
    enabled: !!companyId && hrSettings.enable_time_tracking,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // --- 3. FETCH TIME OFF REQUESTS ---
  const { data: allTimeOff = [], isLoading: timeOffLoading } = useQuery({
    queryKey: ["hr_time_off", companyId],
    enabled: !!companyId && hrSettings.enable_time_tracking,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_off_requests")
        .select("*")
        .eq("company_id", companyId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // --- 4. FETCH EXPENSES ---
  const { data: allExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["hr_expenses", companyId],
    enabled: !!companyId && hrSettings.enable_expenses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false });
      if (error) { console.warn("Expenses Error:", error); return []; }
      return data || [];
    }
  });

  // --- 5. MUTATIONS ---
  const updateRateMutation = useMutation({
    mutationFn: async ({ userId, rate }) => {
      const { error } = await supabase
        .from("profiles") 
        .update({ hourly_rate: rate })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr_team"] });
      setEditingRate(false);
      toast.success("Pay rate updated successfully");
    },
    onError: (err) => toast.error(`Failed to update rate: ${err.message}`)
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ table, ids, status }) => {
      const { error } = await supabase
        .from(table)
        .update({ status: status, approved_by: profile?.full_name || "Admin" })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { table, status, ids }) => {
      const qKey = table === "expenses" ? "hr_expenses" : table === "time_off_requests" ? "hr_time_off" : "hr_time_entries";
      qc.invalidateQueries({ queryKey: [qKey] });
      setSelectedEntries([]);
      toast.success(`${ids.length} items marked as ${status}!`);
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("time_entries").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr_time_entries"] });
      setEditEntry(null);
      toast.success("Timesheet adjusted successfully!");
    }
  });

  // --- DERIVED DATA ---
  const pendingTimesheetsCount = allTimeEntries.filter(t => t.status === "Pending" || !t.status).length;
  const pendingTimeOffCount = allTimeOff.filter(t => t.status === "Pending" || !t.status).length;
  const pendingExpensesCount = allExpenses.filter(e => e.status === "Pending" || !e.status).length;

  const applyFilters = (list, dateField = "date") => {
    return list.filter(item => {
      if (approvalFilter !== "All") {
        const isPending = item.status === "Pending" || !item.status;
        if (approvalFilter === "Pending" && !isPending) return false;
        if (approvalFilter === "Approved" && item.status !== "Approved") return false;
      }
      if (employeeFilter !== "All" && item.employee_name !== employeeFilter) return false;
      
      if (timeView === "All Time") return true;
      if (!item[dateField]) return false;
      
      const d = parseISO(item[dateField]);
      if (timeView === "Daily") return isSameDay(d, currentDate);
      if (timeView === "Weekly") {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        const end = endOfWeek(currentDate, { weekStartsOn: 1 });
        return isWithinInterval(d, { start, end });
      }
      return true;
    });
  };

  const displayedTimesheets = applyFilters(allTimeEntries, "date");
  const displayedTimeOff = applyFilters(allTimeOff, "start_date");
  const displayedExpenses = applyFilters(allExpenses, "date");

  const selectedUser = team.find(u => u.id === selectedUserId);
  const selectedUserTimeEntries = selectedUser 
    ? allTimeEntries.filter(t => t.employee_name === selectedUser.full_name || t.employee_name === selectedUser.email)
    : [];
  const filteredTeam = team.filter(u => (u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())));

  // --- ACTIONS ---
  const handlePrevDate = () => setCurrentDate(prev => timeView === "Daily" ? subDays(prev, 1) : subWeeks(prev, 1));
  const handleNextDate = () => setCurrentDate(prev => timeView === "Daily" ? addDays(prev, 1) : addWeeks(prev, 1));

  const toggleSelectEntry = (id) => setSelectedEntries(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]);
  const selectAllEntries = (list) => {
    if (selectedEntries.length === list.length) setSelectedEntries([]);
    else setSelectedEntries(list.map(e => e.id));
  };

  const handleExport = () => {
    if (activeView === "timesheets") {
      const data = displayedTimesheets.map(t => ({ 
        Employee: t.employee_name, 
        Date: t.date, 
        "Clock In": t.clock_in ? format(parseISO(t.clock_in), "MMM d, h:mm a") : "", 
        "Clock Out": t.clock_out ? format(parseISO(t.clock_out), "MMM d, h:mm a") : "", 
        Hours: t.total_hours, 
        Type: t.entry_type, 
        Status: t.status || "Pending", 
        Notes: t.notes 
      }));
      exportToCSV(data, `Timesheets_${timeView}_${format(currentDate, "yyyy-MM-dd")}.csv`);
    } else if (activeView === "timeoff") {
      const data = displayedTimeOff.map(t => ({ 
        Employee: t.employee_name, 
        "Start Date": t.start_date, 
        "End Date": t.end_date, 
        "Total Days": t.total_days, 
        Type: t.type, 
        Status: t.status || "Pending", 
        Reason: t.reason 
      }));
      exportToCSV(data, `TimeOff_${timeView}_${format(currentDate, "yyyy-MM-dd")}.csv`);
    } else if (activeView === "expenses") {
      const data = displayedExpenses.map(e => ({ 
        Employee: e.employee_name, 
        Date: e.date, 
        Category: e.category, 
        Merchant: e.merchant, 
        Amount: e.amount, 
        Description: e.description, 
        Status: e.status || "Pending" 
      }));
      exportToCSV(data, `Expenses_${timeView}_${format(currentDate, "yyyy-MM-dd")}.csv`);
    }
  };

  const handleEditSave = () => {
    updateEntryMutation.mutate({
      id: editEntry.id,
      data: {
        date: editEntry.date,
        total_hours: parseFloat(editEntry.total_hours) || 0,
        clock_in: editEntry.clock_in,
        clock_out: editEntry.clock_out,
        entry_type: editEntry.entry_type,
        notes: editEntry.notes,
        status: editEntry.status
      }
    });
  };

  const renderLoading = () => (
    <div className="flex justify-center items-center py-20">
      <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* TOP HEADER & TABS */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shrink-0 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Users className="h-6 w-6 text-amber-500" /> Human Resources
              </h1>
            </div>
            
            {/* DESKTOP BUTTONS */}
            <div className="hidden md:flex p-1 bg-slate-100 rounded-xl border border-slate-200 shrink-0 gap-1 overflow-x-auto">
              <button 
                onClick={() => handleViewChange("directory")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeView === "directory" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Users className="h-4 w-4 shrink-0" /> Employee List
              </button>
              
              {hrSettings.enable_time_tracking && (
                <>
                  <button 
                    onClick={() => handleViewChange("timesheets")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeView === "timesheets" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <Clock className="h-4 w-4 shrink-0" /> Timesheets 
                    {pendingTimesheetsCount > 0 && <span className="bg-amber-500 text-slate-900 font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingTimesheetsCount}</span>}
                  </button>
                  <button 
                    onClick={() => handleViewChange("timeoff")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeView === "timeoff" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <Palmtree className="h-4 w-4 shrink-0" /> Time Off 
                    {pendingTimeOffCount > 0 && <span className="bg-purple-500 text-white font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingTimeOffCount}</span>}
                  </button>
                </>
              )}

              {hrSettings.enable_expenses && (
                <button 
                  onClick={() => handleViewChange("expenses")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeView === "expenses" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <Receipt className="h-4 w-4 shrink-0" /> Expenses 
                  {pendingExpensesCount > 0 && <span className="bg-red-500 text-white font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingExpensesCount}</span>}
                </button>
              )}
            </div>

            {/* MOBILE DROPDOWN */}
            <div className="block md:hidden w-full">
              <Select value={activeView} onValueChange={handleViewChange}>
                <SelectTrigger className="w-full bg-slate-100 font-bold text-slate-800 border-slate-200 h-11">
                  <SelectValue placeholder="Select view..." />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="directory">
                    <div className="flex items-center gap-2 w-full">
                      <Users className="h-4 w-4 text-slate-500" />
                      <span>Employee List</span>
                    </div>
                  </SelectItem>
                  
                  {hrSettings.enable_time_tracking && (
                    <>
                      <SelectItem value="timesheets">
                        <div className="flex items-center justify-between w-full pr-2">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-slate-500" />
                            <span>Timesheets</span>
                          </div>
                          {pendingTimesheetsCount > 0 && <span className="bg-amber-500 text-slate-900 font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingTimesheetsCount}</span>}
                        </div>
                      </SelectItem>
                      <SelectItem value="timeoff">
                        <div className="flex items-center justify-between w-full pr-2">
                          <div className="flex items-center gap-2">
                            <Palmtree className="h-4 w-4 text-slate-500" />
                            <span>Time Off</span>
                          </div>
                          {pendingTimeOffCount > 0 && <span className="bg-purple-500 text-white font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingTimeOffCount}</span>}
                        </div>
                      </SelectItem>
                    </>
                  )}

                  {hrSettings.enable_expenses && (
                    <SelectItem value="expenses">
                      <div className="flex items-center justify-between w-full pr-2">
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4 text-slate-500" />
                          <span>Expenses</span>
                        </div>
                        {pendingExpensesCount > 0 && <span className="bg-red-500 text-white font-black text-[10px] px-1.5 py-0.5 rounded-full">{pendingExpensesCount}</span>}
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="max-w-7xl mx-auto w-full h-full p-4 md:p-6 flex-1 flex flex-col">
          
          {(usersLoading || timeLoading || timeOffLoading || expensesLoading) ? renderLoading() : activeView === "directory" ? (
            
            // ==========================================
            // VIEW 1: SPLIT SCREEN EMPLOYEE LIST
            // ==========================================
            <div className="flex flex-col md:flex-row gap-6 h-full min-h-[600px]">
              {/* LEFT COLUMN: TEAM LIST */}
              <div className="w-full md:w-80 shrink-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-full">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredTeam.map(user => (
                    <button
                      key={user.id}
                      onClick={() => { setSelectedUserId(user.id); setEditingRate(false); }}
                      className={`w-full text-left px-3 py-3 rounded-lg border transition-all flex items-center justify-between ${
                        selectedUserId === user.id ? "bg-amber-50 border-amber-300 shadow-sm" : "bg-white border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`h-9 w-9 rounded-full shrink-0 flex items-center justify-center font-black text-sm ${selectedUserId === user.id ? 'bg-amber-500 text-slate-900' : 'bg-slate-200 text-slate-600'}`}>
                          {(user.full_name || user.email || "U")[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-bold truncate ${selectedUserId === user.id ? 'text-amber-900' : 'text-slate-800'}`}>
                            {user.full_name || "Unnamed Employee"}
                          </p>
                          <p className={`text-[10px] uppercase tracking-wider font-semibold truncate mt-0.5 ${selectedUserId === user.id ? 'text-amber-700' : 'text-slate-500'}`}>
                            {user.role || "Staff"}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 ${selectedUserId === user.id ? 'text-amber-600' : 'text-slate-300'}`} />
                    </button>
                  ))}
                  {filteredTeam.length === 0 && <p className="text-center text-xs text-slate-400 py-6">No employees found.</p>}
                </div>
              </div>

              {/* RIGHT COLUMN: EMPLOYEE FILE */}
              <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-y-auto h-full flex flex-col">
                {selectedUser ? (
                  <div className="flex flex-col h-full">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 justify-between items-start">
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 rounded-full bg-slate-200 flex items-center justify-center font-black text-2xl text-slate-600 shadow-inner">
                          {(selectedUser.full_name || selectedUser.email || "U")[0].toUpperCase()}
                        </div>
                        <div>
                          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{selectedUser.full_name || "Unnamed Employee"}</h2>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="bg-slate-200 text-slate-700 text-[10px] uppercase font-bold">{selectedUser.role || "Staff"}</Badge>
                            <span className="text-sm text-slate-500 font-medium">{selectedUser.email}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm min-w-[200px]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                          <DollarSign className="h-3 w-3" /> Hourly Rate
                        </p>
                        {editingRate ? (
                          <div className="flex gap-2">
                            <Input type="number" step="0.50" value={tempRate} onChange={e => setTempRate(e.target.value)} className="h-8 font-bold" />
                            <Button size="sm" onClick={() => updateRateMutation.mutate({ userId: selectedUser.id, rate: parseFloat(tempRate) || 0 })} disabled={updateRateMutation.isPending} className="h-8 bg-amber-500 hover:bg-amber-600 text-slate-900"><Save className="h-4 w-4" /></Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingRate(false)} className="h-8"><X className="h-4 w-4 text-slate-500" /></Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between group">
                            <p className="text-2xl font-black text-slate-800">{formatCurrencyUSD(selectedUser.hourly_rate || 0)} <span className="text-sm text-slate-400 font-medium">/ hr</span></p>
                            <Button variant="ghost" size="sm" onClick={() => { setTempRate(selectedUser.hourly_rate || 0); setEditingRate(true); }} className="opacity-0 group-hover:opacity-100 text-amber-600 font-bold h-7 px-2">Edit</Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-6 flex-1">
                      {hrSettings.enable_time_tracking ? (
                        <>
                          <h3 className="text-sm font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
                            <Clock className="h-4 w-4" /> Recent Timesheets (All Time)
                          </h3>
                          {selectedUserTimeEntries.length === 0 ? (
                            <div className="text-center py-10 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                              <p className="text-sm text-slate-500 font-medium">No time entries recorded for this employee.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {selectedUserTimeEntries.slice(0, 15).map(entry => (
                                <div key={entry.id} className="flex flex-wrap items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-shadow gap-4">
                                  <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
                                      <Clock className="h-5 w-5 text-slate-600" />
                                    </div>
                                    <div>
                                      <p className="font-bold text-slate-900">{entry.date ? format(parseISO(entry.date), "EEEE, MMM d, yyyy") : "Unknown Date"}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <Badge variant="outline" className="text-[10px] uppercase font-bold text-slate-500">{entry.entry_type || "Regular"}</Badge>
                                        <span className="text-xs font-black text-slate-700">{entry.total_hours} Hours</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right flex items-center gap-3">
                                    {entry.status === "Approved" ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold"><CheckCircle className="h-3 w-3 mr-1" /> Approved</Badge>
                                    ) : (
                                      <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-bold"><AlertTriangle className="h-3 w-3 mr-1" /> Pending</Badge>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center py-20 bg-slate-50/50 rounded-xl">
                          <p className="text-sm font-bold text-slate-500">Employee Details</p>
                          <p className="text-xs text-slate-400 mt-1">Time tracking is currently disabled for this workspace.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-50/50">
                    <UserCheck className="h-16 w-16 mb-4 text-slate-200" />
                    <p className="text-base font-bold text-slate-500">Select an employee</p>
                    <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Choose from the list on the left</p>
                  </div>
                )}
              </div>
            </div>

          ) : (
            
            // ==========================================
            // VIEW 2: APPROVALS BOARDS (Timesheets, Time Off, Expenses)
            // ==========================================
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
              
              {/* Approvals Action Bar */}
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-4 shrink-0">
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                  
                  {/* Status Filter */}
                  <Select value={approvalFilter} onValueChange={setApprovalFilter}>
                    <SelectTrigger className="w-[140px] bg-white font-bold h-9">
                      <SelectValue placeholder="Filter Status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Statuses</SelectItem>
                      <SelectItem value="Pending">Pending Only</SelectItem>
                      <SelectItem value="Approved">Approved Only</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Employee Filter */}
                  <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger className="w-[160px] bg-white font-bold h-9">
                      <SelectValue placeholder="All Employees" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Employees</SelectItem>
                      {team.map(u => (
                        <SelectItem key={u.id} value={u.full_name || u.email}>
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

                  {/* Daily / Weekly / All Time Views */}
                  <div className="flex items-center bg-slate-200/50 rounded-lg p-1 border border-slate-200 w-full sm:w-auto overflow-hidden">
                    <button onClick={() => setTimeView("Daily")} className={`flex-1 sm:flex-none px-3 py-1 text-xs font-bold rounded-md transition-all ${timeView === "Daily" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Daily</button>
                    <button onClick={() => setTimeView("Weekly")} className={`flex-1 sm:flex-none px-3 py-1 text-xs font-bold rounded-md transition-all ${timeView === "Weekly" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Weekly</button>
                    <button onClick={() => setTimeView("All Time")} className={`flex-1 sm:flex-none px-3 py-1 text-xs font-bold rounded-md transition-all ${timeView === "All Time" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>All Time</button>
                  </div>

                  {timeView !== "All Time" && (
                    <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500" onClick={handlePrevDate}><ChevronLeft className="h-4 w-4" /></Button>
                      
                      {timeView === "Daily" ? (
                        <Input 
                          type="date" 
                          value={format(currentDate, "yyyy-MM-dd")}
                          onChange={(e) => {
                            if (e.target.value) setCurrentDate(parseISO(e.target.value));
                          }}
                          className="h-7 border-none shadow-none text-xs font-black text-slate-800 w-32 sm:w-36 text-center uppercase tracking-wider bg-transparent p-0"
                        />
                      ) : (
                        <div className="text-xs font-black text-slate-800 w-32 sm:w-40 text-center uppercase tracking-wider px-2">
                          {`${format(startOfWeek(currentDate, {weekStartsOn:1}), "MMM d")} - ${format(endOfWeek(currentDate, {weekStartsOn:1}), "MMM d")}`}
                        </div>
                      )}

                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500" onClick={handleNextDate}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  )}

                </div>
                
                <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
                  <Button variant="outline" size="sm" onClick={handleExport} className="bg-white font-bold text-slate-600 h-9 hidden sm:flex">
                    <Download className="h-4 w-4 mr-1.5" /> Export CSV
                  </Button>
                  
                  <div className="h-6 w-px bg-slate-200 mx-1"></div>

                  {(() => {
                    const activeList = activeView === "timesheets" ? displayedTimesheets : activeView === "timeoff" ? displayedTimeOff : displayedExpenses;
                    const dbTable = activeView === "expenses" ? "expenses" : activeView === "timeoff" ? "time_off_requests" : "time_entries";
                    return (
                      <>
                        <Button variant="outline" size="sm" onClick={() => selectAllEntries(activeList)} className="bg-white font-bold text-slate-600 h-9">
                          {selectedEntries.length === activeList.length && activeList.length > 0 ? "Deselect All" : "Select All"}
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => updateStatusMutation.mutate({ table: dbTable, ids: selectedEntries, status: "Rejected" })}
                          disabled={selectedEntries.length === 0 || updateStatusMutation.isPending}
                          className="border-red-200 text-red-600 hover:bg-red-50 font-bold h-9"
                        >
                          Reject
                        </Button>
                        <Button 
                          onClick={() => updateStatusMutation.mutate({ table: dbTable, ids: selectedEntries, status: "Approved" })}
                          disabled={selectedEntries.length === 0 || updateStatusMutation.isPending}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md h-9"
                        >
                          Approve ({selectedEntries.length})
                        </Button>
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Data Table Container */}
              <div className="flex-1 overflow-y-auto p-0">
                {(() => {
                  const activeList = activeView === "timesheets" ? displayedTimesheets : activeView === "timeoff" ? displayedTimeOff : displayedExpenses;
                  
                  if (activeList.length === 0) {
                    return (
                      <div className="text-center py-20 px-4">
                        <CheckCircle className="h-16 w-16 text-slate-200 mx-auto mb-4" />
                        <h3 className="text-xl font-black text-slate-700">All caught up!</h3>
                        <p className="text-sm text-slate-500 mt-1">No items match your current date, employee, or status filter.</p>
                      </div>
                    );
                  }

                  return (
                    <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead className="bg-white border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="px-6 py-4 w-12 text-center">
                            <input type="checkbox" checked={selectedEntries.length === activeList.length && activeList.length > 0} onChange={() => selectAllEntries(activeList)} className="rounded border-slate-300 w-4 h-4 cursor-pointer" />
                          </th>
                          <th className="px-6 py-4">Employee</th>
                          
                          {activeView === "expenses" ? (
                            <>
                              <th className="px-6 py-4">Date</th>
                              <th className="px-6 py-4">Category / Merchant</th>
                              <th className="px-6 py-4 font-bold text-slate-900">Amount</th>
                              <th className="px-6 py-4 text-center">Receipt</th>
                            </>
                          ) : activeView === "timeoff" ? (
                            <>
                              <th className="px-6 py-4">Duration (Start - End)</th>
                              <th className="px-6 py-4 text-center font-bold text-slate-900">Total Days</th>
                              <th className="px-6 py-4">Type</th>
                            </>
                          ) : (
                            <>
                              <th className="px-6 py-4">Date</th>
                              <th className="px-6 py-4">Shift (In / Out)</th>
                              <th className="px-6 py-4 text-center font-bold text-slate-900">Hours</th>
                              <th className="px-6 py-4">Type</th>
                            </>
                          )}
                          
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeList.map(item => (
                          <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${selectedEntries.includes(item.id) ? 'bg-amber-50/30' : ''}`}>
                            <td className="px-6 py-4 text-center" onClick={() => toggleSelectEntry(item.id)}>
                              <input type="checkbox" checked={selectedEntries.includes(item.id)} onChange={() => toggleSelectEntry(item.id)} className="rounded border-slate-300 w-4 h-4 cursor-pointer" />
                            </td>
                            <td className="px-6 py-4 font-bold text-slate-900">
                              {item.employee_name || "Unknown"}
                              {activeView === "timeoff" && item.reason && (
                                <p className="text-[10px] text-slate-500 font-medium mt-1 uppercase tracking-wider truncate max-w-[200px]">{item.reason}</p>
                              )}
                            </td>
                            
                            {activeView === "expenses" ? (
                              <>
                                <td className="px-6 py-4 font-medium text-slate-600">{item.date ? format(parseISO(item.date), "MMM d, yyyy") : ""}</td>
                                <td className="px-6 py-4">
                                  <span className="font-bold text-slate-700">{item.category}</span>
                                  <span className="text-slate-400 mx-2">|</span>
                                  <span className="text-slate-600">{item.merchant}</span>
                                </td>
                                <td className="px-6 py-4 font-black text-red-600">{formatCurrencyUSD(item.amount)}</td>
                                <td className="px-6 py-4 text-center">
                                  {item.receipt_url ? (
                                    <a href={item.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100">
                                      <ImageIcon className="h-4 w-4" />
                                    </a>
                                  ) : <span className="text-xs text-slate-300">—</span>}
                                </td>
                              </>
                            ) : activeView === "timeoff" ? (
                              <>
                                <td className="px-6 py-4">
                                  <div className="text-xs font-medium text-slate-600 space-y-0.5">
                                    <div>Start: <span className="font-bold text-slate-800">{item.start_date ? format(parseISO(item.start_date), "MMM d, yyyy") : ""}</span></div>
                                    <div>End: <span className="font-bold text-slate-800">{item.end_date ? format(parseISO(item.end_date), "MMM d, yyyy") : ""}</span></div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center font-black text-slate-800">{item.total_days}</td>
                                <td className="px-6 py-4">
                                  <Badge variant="outline" className={`text-[10px] uppercase font-bold text-purple-600 border-purple-200 bg-purple-50`}>
                                    {item.type || "Time Off"}
                                  </Badge>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-6 py-4 font-medium text-slate-600">{item.date ? format(parseISO(item.date), "MMM d, yyyy") : ""}</td>
                                <td className="px-6 py-4">
                                  {item.clock_in && item.clock_out ? (
                                    <div className="text-xs font-medium text-slate-600 space-y-0.5">
                                      <div>In: <span className="font-bold text-slate-800">{format(parseISO(item.clock_in), "h:mm a")}</span></div>
                                      <div>Out: <span className="font-bold text-slate-800">{format(parseISO(item.clock_out), "h:mm a")}</span></div>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-center font-black text-slate-800">{item.total_hours}</td>
                                <td className="px-6 py-4">
                                  <Badge variant="outline" className={`text-[10px] uppercase font-bold ${["Vacation", "Sick Leave", "Time Off"].includes(item.entry_type) ? 'text-purple-600 border-purple-200 bg-purple-50' : 'text-slate-600 border-slate-200 bg-slate-50'}`}>
                                    {item.entry_type || "Regular"}
                                  </Badge>
                                </td>
                              </>
                            )}

                            <td className="px-6 py-4">
                              {item.status === "Approved" ? (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold hover:bg-emerald-100">Approved</Badge>
                              ) : item.status === "Rejected" ? (
                                <Badge className="bg-red-100 text-red-700 border-red-200 font-bold hover:bg-red-100">Rejected</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-bold hover:bg-amber-100">Pending</Badge>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {activeView === "timesheets" && (
                                <Button variant="ghost" size="sm" onClick={() => setEditEntry({...item})} className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 font-bold">
                                  <Pencil className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Adjust</span>
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* EDIT ENTRY DIALOG (For Timesheets) */}
      <Dialog open={!!editEntry} onOpenChange={(v) => !v && setEditEntry(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-md bg-white border-slate-200 shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">Adjust Timesheet</DialogTitle>
          </DialogHeader>
          {editEntry && (
            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-2">
                <p className="text-sm font-medium text-slate-500">Employee</p>
                <p className="font-bold text-slate-900">{editEntry.employee_name}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</Label>
                  <Input type="date" value={editEntry.date} onChange={e => setEditEntry({...editEntry, date: e.target.value})} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Hours</Label>
                  <Input type="number" step="0.5" value={editEntry.total_hours} onChange={e => setEditEntry({...editEntry, total_hours: e.target.value})} className="mt-1 font-bold" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Clock In Time</Label>
                  <Input 
                    type="datetime-local" 
                    value={formatDatetimeLocal(editEntry.clock_in)} 
                    onChange={e => setEditEntry({...editEntry, clock_in: e.target.value ? new Date(e.target.value).toISOString() : null})} 
                    className="mt-1 text-sm" 
                  />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Clock Out Time</Label>
                  <Input 
                    type="datetime-local" 
                    value={formatDatetimeLocal(editEntry.clock_out)} 
                    onChange={e => setEditEntry({...editEntry, clock_out: e.target.value ? new Date(e.target.value).toISOString() : null})} 
                    className="mt-1 text-sm" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Type</Label>
                  <Select value={editEntry.entry_type} onValueChange={v => setEditEntry({...editEntry, entry_type: v})}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Regular">Regular</SelectItem>
                      <SelectItem value="Overtime">Overtime</SelectItem>
                      <SelectItem value="Double Time">Double Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Status</Label>
                  <Select value={editEntry.status || "Pending"} onValueChange={v => setEditEntry({...editEntry, status: v})}>
                    <SelectTrigger className="mt-1 font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Approved">Approved</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Admin Notes / Overrides</Label>
                <Textarea 
                  value={editEntry.notes || ""} 
                  onChange={e => setEditEntry({...editEntry, notes: e.target.value})} 
                  placeholder="Explain why this entry was adjusted..." 
                  className="mt-1"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <Button variant="outline" onClick={() => setEditEntry(null)} disabled={updateEntryMutation.isPending}>Cancel</Button>
                <Button onClick={handleEditSave} disabled={updateEntryMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md">
                  {updateEntryMutation.isPending ? "Saving..." : "Save Adjustment"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}