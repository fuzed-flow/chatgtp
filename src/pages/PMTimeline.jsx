import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { parseISO, format, differenceInDays, addDays, startOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { ArrowRight, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_COLORS = {
  "Active":     "bg-emerald-400",
  "Lead":       "bg-blue-400",
  "On Hold":    "bg-amber-400",
  "Completed":  "bg-slate-400",
  "Cancelled":  "bg-red-400",
};

const STATUS_BG = {
  "Active":     "bg-emerald-100 border-emerald-300",
  "Lead":       "bg-blue-100 border-blue-300",
  "On Hold":    "bg-amber-100 border-amber-300",
  "Completed":  "bg-slate-100 border-slate-300",
  "Cancelled":  "bg-red-100 border-red-200",
};

const CELL_WIDTH = 32; // px per day
const ROW_HEIGHT = 48;
const DEFAULT_LABEL_WIDTH = 220;

export default function PMTimeline() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [offsetDays, setOffsetDays] = useState(0);
  const [viewMode, setViewMode] = useState("timeline");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const viewDays = 60;

  // MOBILE FIX: Detect small screens and shrink the initial label width to 120px
  const [labelWidth, setLabelWidth] = useState(() => 
    typeof window !== "undefined" && window.innerWidth < 768 ? 120 : DEFAULT_LABEL_WIDTH
  );

  // --- SUPABASE QUERY ---
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["pm_projects_timeline", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("company_id", companyId);
      
      if (error) throw error;

      // Sorted by start_date descending to match form structures
      return (data || []).sort((a, b) => {
        const aDate = a.start_date ? new Date(a.start_date).getTime() : 0;
        const bDate = b.start_date ? new Date(b.start_date).getTime() : 0;
        return bDate - aDate;
      });
    }
  });

  const today = startOfDay(new Date());
  const viewStart = addDays(today, offsetDays);
  const viewEnd = addDays(viewStart, viewDays - 1);

  // Build day headers
  const days = useMemo(() => {
    return Array.from({ length: viewDays }, (_, i) => addDays(viewStart, i));
  }, [viewStart, viewDays]);

  // Month groupings for header
  const monthGroups = useMemo(() => {
    const groups = [];
    let cur = null;
    days.forEach((d, i) => {
      const label = format(d, "MMM yyyy");
      if (!cur || cur.label !== label) {
        cur = { label, start: i, count: 0 };
        groups.push(cur);
      }
      cur.count++;
    });
    return groups;
  }, [days]);

  // Filter out completely cancelled files without scheduling boundaries
  const displayProjects = useMemo(() => {
    return projects.filter(p => p.status !== "Cancelled" || p.start_date);
  }, [projects]);

  const getBar = (project) => {
    const start = project.start_date ? parseISO(project.start_date) : null;
    const end = project.target_end_date ? parseISO(project.target_end_date) : null;
    if (!start && !end) return null;

    const effectiveStart = start || end;
    const effectiveEnd = end || start;

    const startOffset = differenceInDays(effectiveStart, viewStart);
    const endOffset = differenceInDays(effectiveEnd, viewStart);

    // Clamp to view viewport
    const clampedStart = Math.max(0, startOffset);
    const clampedEnd = Math.min(viewDays - 1, endOffset);

    if (clampedEnd < 0 || clampedStart >= viewDays) return null; 

    return {
      left: clampedStart * CELL_WIDTH,
      width: Math.max(CELL_WIDTH, (clampedEnd - clampedStart + 1) * CELL_WIDTH),
      partial: clampedStart !== startOffset || clampedEnd !== endOffset,
    };
  };

  const todayOffset = differenceInDays(today, viewStart);

  // Calendar matrix calculations
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = useMemo(() => {
    return eachDayOfInterval({
      start: startDate,
      end: endDate
    });
  }, [startDate, endDate]);

  const getProjectsForDay = (day) => {
    return displayProjects.filter(p => {
      if (!p.start_date && !p.target_end_date) return false;
      const start = p.start_date ? startOfDay(parseISO(p.start_date)) : null;
      const end = p.target_end_date ? startOfDay(parseISO(p.target_end_date)) : null;
      
      const effectiveStart = start || end;
      const effectiveEnd = end || start;
      
      return day >= effectiveStart && day <= effectiveEnd;
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      
      {/* Page Header (Mobile Optimized Stacking) */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-sm z-20">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-amber-500" /> Projects Timeline
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{displayProjects.length} projects total</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={viewMode} onValueChange={setViewMode} className="w-[180px] shrink-0">
            <TabsList className="grid w-full grid-cols-2 h-10 md:h-8">
              <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs">Calendar</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2 ml-auto md:ml-0">
            {viewMode === "timeline" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setOffsetDays(0)} className="text-xs h-10 md:h-8 hidden sm:flex">Today</Button>
                <Button size="icon" variant="outline" className="h-10 w-10 md:h-8 md:w-8 shrink-0" onClick={() => setOffsetDays(o => o - 14)}>
                  <ChevronLeft className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-10 w-10 md:h-8 md:w-8 shrink-0" onClick={() => setOffsetDays(o => o + 14)}>
                  <ChevronRight className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setCurrentMonth(new Date())} className="text-xs h-10 md:h-8 hidden sm:flex">Today</Button>
                <Button size="icon" variant="outline" className="h-10 w-10 md:h-8 md:w-8 shrink-0" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
                <span className="font-semibold text-slate-700 text-sm min-w-[100px] text-center">
                  {format(currentMonth, "MMM yyyy")}
                </span>
                <Button size="icon" variant="outline" className="h-10 w-10 md:h-8 md:w-8 shrink-0" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </>
            )}
          </div>

          <Link to="/PMProjects" className="w-full sm:w-auto mt-2 sm:mt-0">
            <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-xs w-full h-10 md:h-8">
              All Projects <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {isLoading && <div className="flex items-center justify-center flex-1 text-slate-400 text-sm">Loading timeline details...</div>}

      {/* --- CALENDAR VIEW MODE --- */}
      {!isLoading && viewMode === "calendar" && (
        <div className="flex-1 overflow-auto p-2 sm:p-4 md:p-6 bg-slate-50">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-full flex flex-col min-w-[600px]">
            <div className="grid grid-cols-7 gap-px bg-slate-200 border-b border-slate-200 shrink-0">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="bg-slate-50 py-2 text-center text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-slate-200 flex-1 overflow-y-auto">
              {calendarDays.map((day) => {
                const isCurrentMonth = isSameMonth(day, monthStart);
                const isToday = isSameDay(day, today);
                const dayProjects = getProjectsForDay(day);
                
                return (
                  <div 
                    key={day.toString()} 
                    className={`min-h-[100px] sm:min-h-[120px] bg-white p-1.5 sm:p-2 flex flex-col ${!isCurrentMonth ? 'bg-slate-50/80 text-slate-400' : ''} ${isToday ? 'bg-amber-50/30' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-1.5 shrink-0">
                      <span className={`text-sm font-bold h-6 w-6 flex items-center justify-center rounded-full ${isToday ? 'bg-amber-500 text-white' : 'text-slate-700'}`}>
                        {format(day, "d")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 overflow-y-auto pr-1 pb-1" style={{ maxHeight: "calc(100% - 28px)" }}>
                      {dayProjects.map(p => {
                        const bgClass = STATUS_BG[p.status] || "bg-slate-100 border-slate-300";
                        const colorClass = STATUS_COLORS[p.status] || "bg-slate-300";
                        const isStart = p.start_date && isSameDay(day, parseISO(p.start_date));
                        const isEnd = p.target_end_date && isSameDay(day, parseISO(p.target_end_date));
                        
                        return (
                          <Link 
                            key={p.id} 
                            to={`/PMProjectWorkspace?id=${p.id}`}
                            className={`flex items-center px-1.5 py-1 rounded text-[10px] leading-tight border hover:opacity-80 transition-opacity truncate ${bgClass}`}
                          >
                            <div className={`h-1.5 w-1.5 rounded-full shrink-0 mr-1.5 ${colorClass}`} />
                            <span className="truncate font-semibold text-slate-800">
                              {p.name}
                            </span>
                            {(isStart || isEnd) && (
                              <span className="ml-auto text-[9px] font-bold opacity-50 shrink-0 pl-1 hidden sm:inline">
                                {isStart && isEnd ? "1d" : isStart ? "Start" : "End"}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- GANTT/TIMELINE VIEW MODE --- */}
      {!isLoading && viewMode === "timeline" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column: Project Labels */}
          <div className="shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]" style={{ width: labelWidth }}>
            <div style={{ height: ROW_HEIGHT }} className="border-b border-slate-200 bg-slate-50 shrink-0 sticky top-0 z-20" />
            <div className="flex-1 overflow-y-auto">
              {displayProjects.length === 0 && (
                <div className="p-6 text-slate-400 text-sm text-center">No projects scheduled yet.</div>
              )}
              {displayProjects.map((p, i) => (
                <Link
                  key={p.id}
                  to={`/PMProjectWorkspace?id=${p.id}`}
                  className="flex flex-col justify-center px-2 sm:px-3 border-b border-slate-100 hover:bg-amber-50/40 transition-colors group"
                  style={{ height: ROW_HEIGHT, minHeight: ROW_HEIGHT }}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_COLORS[p.status] || "bg-slate-300"}`} />
                    <span className="text-xs sm:text-sm font-bold text-slate-800 truncate group-hover:text-amber-700">{p.name}</span>
                    <ArrowRight className="h-3 w-3 text-slate-300 group-hover:text-amber-500 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
                  </div>
                  {/* MOBILE FIX: Hide address on mobile so project name is visible */}
                  {p.site_address && <p className="hidden sm:block text-[10px] font-medium text-slate-400 ml-4 truncate">{p.site_address}</p>}
                </Link>
              ))}
            </div>
          </div>

          {/* Right Column: Interactive Timeline Map */}
          <div className="flex-1 overflow-auto bg-white">
            <div style={{ width: viewDays * CELL_WIDTH, minWidth: "100%" }}>
              {/* Month bar */}
              <div className="flex border-b border-slate-200 bg-slate-100 sticky top-0 z-10" style={{ height: ROW_HEIGHT / 2 }}>
                {monthGroups.map((g, i) => (
                  <div key={i} className="flex items-center px-2 border-r border-slate-300 text-[11px] font-bold text-slate-600 bg-slate-100" style={{ width: g.count * CELL_WIDTH, minWidth: g.count * CELL_WIDTH }}>
                    {g.label}
                  </div>
                ))}
              </div>
              
              {/* Day numbers bar */}
              <div className="flex border-b border-slate-200 bg-slate-50 sticky top-[24px] z-10" style={{ height: ROW_HEIGHT / 2 }}>
                {days.map((d, i) => {
                  const isToday = differenceInDays(d, today) === 0;
                  const isSun = d.getDay() === 0;
                  const isSat = d.getDay() === 6;
                  return (
                    <div key={i} className={`flex items-center justify-center border-r text-[10px] font-semibold ${isToday ? "bg-amber-400 text-white font-black" : isSun || isSat ? "bg-slate-100 text-slate-400" : "border-slate-200 text-slate-500"}`}
                      style={{ width: CELL_WIDTH, minWidth: CELL_WIDTH }}>
                      {format(d, "d")}
                    </div>
                  );
                })}
              </div>

              {/* Gantt Matrix Rows */}
              <div className="relative">
                {/* Current date indicator line */}
                {todayOffset >= 0 && todayOffset < viewDays && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow" style={{ left: todayOffset * CELL_WIDTH + CELL_WIDTH / 2 - 1 }} />
                )}

                {displayProjects.map((p, i) => {
                  const bar = getBar(p);
                  const colorClass = STATUS_COLORS[p.status] || "bg-slate-300";
                  const bgClass = STATUS_BG[p.status] || "bg-slate-100 border-slate-300";
                  return (
                    <div key={p.id} className={`relative flex items-center border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`} style={{ height: ROW_HEIGHT }}>
                      {/* Weekend shadow bars */}
                      {days.map((d, di) => (
                        (d.getDay() === 0 || d.getDay() === 6) ? (
                          <div key={di} className="absolute top-0 bottom-0 bg-slate-100/40 pointer-events-none" style={{ left: di * CELL_WIDTH, width: CELL_WIDTH }} />
                        ) : null
                      ))}

                      {/* Rendered horizontal schedule bar */}
                      {bar && (
                        <Link to={`/PMProjectWorkspace?id=${p.id}`} className="absolute z-10 shadow-sm rounded-full" style={{ left: bar.left, width: bar.width }}>
                          <div className={`flex items-center h-7 rounded-full border px-2 sm:px-3 cursor-pointer hover:scale-[1.01] hover:shadow transition-all overflow-hidden ${bgClass}`}>
                            <div className={`h-2 w-2 rounded-full shrink-0 mr-1.5 sm:mr-2 ${colorClass}`} />
                            <span className="text-[10px] sm:text-xs font-bold text-slate-800 truncate block">{p.name}</span>
                          </div>
                        </Link>
                      )}

                      {!bar && (
                        <div className="absolute left-3 flex items-center gap-1 z-10 bg-slate-100/80 px-2 py-0.5 rounded-md border border-dashed border-slate-200 pointer-events-none">
                          <span className="text-[10px] text-slate-400 font-medium italic">No target timeline set</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TIMELINE FOOTER LEGEND --- */}
      <div className="bg-white border-t border-slate-200 px-4 md:px-6 py-2.5 flex items-center gap-4 shrink-0 z-20 shadow-sm flex-wrap">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 md:h-2.5 md:w-2.5 rounded-full ${color}`} />
            <span className="text-[10px] md:text-[11px] font-semibold text-slate-500">{status}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto border-l pl-4 md:pl-5 border-slate-200">
          <div className="h-3 w-0.5 bg-amber-400 shadow-sm" />
          <span className="text-[10px] md:text-[11px] font-bold text-slate-600 hidden sm:block">Today Indicator</span>
          <span className="text-[10px] font-bold text-slate-600 sm:hidden">Today</span>
        </div>
      </div>
    </div>
  );
}