import React, { useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { parseISO, format, differenceInDays, addDays, startOfDay, isValid } from "date-fns";
import { ChevronLeft, ChevronRight, HardHat, Package, ChevronDown, ChevronRight as ChevronRightIcon, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const PHASE_COLORS = {
  "Not Started": { bar: "bg-slate-300 border-slate-400", dot: "bg-slate-400" },
  "In Progress":  { bar: "bg-blue-200 border-blue-400", dot: "bg-blue-500" },
  "Blocked":      { bar: "bg-red-200 border-red-400", dot: "bg-red-500" },
  "Completed":    { bar: "bg-emerald-200 border-emerald-400", dot: "bg-emerald-500" },
};

const SUB_COLORS = {
  "Proposed":  "bg-slate-100 border-slate-300",
  "Approved":  "bg-blue-100 border-blue-300",
  "Scheduled": "bg-amber-100 border-amber-300",
  "On Site":   "bg-green-100 border-green-400",
  "Completed": "bg-emerald-100 border-emerald-400",
  "Removed":   "bg-red-100 border-red-300",
};

const MAT_COLORS = {
  "Not Planned":  "bg-slate-100 border-slate-300",
  "Planned":      "bg-blue-100 border-blue-300",
  "Ordered":      "bg-amber-100 border-amber-300",
  "Delivered":    "bg-green-100 border-green-400",
  "Backordered":  "bg-red-100 border-red-300",
  "Installed":    "bg-emerald-100 border-emerald-400",
  "Cancelled":    "bg-slate-100 border-slate-200",
};

const CELL_WIDTH = 32;
const ROW_HEIGHT = 44;
const MIN_LABEL_WIDTH = 100;
const DEFAULT_LABEL_WIDTH = 220;

// Safe date parsing helper
const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

// Formatter for mobile tap notifications
const formatFriendly = (dateString) => {
  if (!dateString) return "TBD";
  const parsed = parseISO(dateString);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy") : "TBD";
};

function calcBar(start, end, viewStart, viewDays) {
  if (!start && !end) return null;
  const s = start || end;
  const e = end || start;
  const startOffset = differenceInDays(s, viewStart);
  const endOffset = differenceInDays(e, viewStart);
  const clampedStart = Math.max(0, startOffset);
  const clampedEnd = Math.min(viewDays - 1, endOffset);
  
  if (clampedEnd < 0 || clampedStart >= viewDays) return null;
  return {
    left: clampedStart * CELL_WIDTH,
    width: Math.max(CELL_WIDTH, (clampedEnd - clampedStart + 1) * CELL_WIDTH),
  };
}

export default function PMScheduleTrackerTab({ project }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [offsetDays, setOffsetDays] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [dragging, setDragging] = useState(false);

  // --- SCROLL SYNC REFS ---
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);

  // Sync scrolling logic
  const handleScrollSync = (e, targetRef) => {
    if (targetRef.current && targetRef.current.scrollTop !== e.target.scrollTop) {
      targetRef.current.scrollTop = e.target.scrollTop;
    }
  };

  const [labelWidth, setLabelWidth] = useState(() => 
    typeof window !== "undefined" && window.innerWidth < 768 ? 120 : DEFAULT_LABEL_WIDTH
  );
  
  const viewDays = 60;

  const handleDragStart = (e) => {
    setDragging(true);
    const startX = e.clientX;
    const startW = labelWidth;
    const onMove = (ev) => setLabelWidth(Math.max(MIN_LABEL_WIDTH, startW + ev.clientX - startX));
    const onUp = () => { setDragging(false); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // --- SUPABASE QUERIES ---
  const { data: phases = [] } = useQuery({
    queryKey: ["pm_phases", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_phases").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: projectSubs = [] } = useQuery({
    queryKey: ["pm_project_subs", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_subcontractors").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: subcontractors = [] } = useQuery({
    queryKey: ["subcontractors", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("subcontractors").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["pm_materials", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_materials").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    }
  });

  const subMap = Object.fromEntries(subcontractors.map(s => [s.id, s]));
  const today = startOfDay(new Date());
  const viewStart = addDays(today, offsetDays);
  const todayOffset = differenceInDays(today, viewStart);

  const days = useMemo(() => Array.from({ length: viewDays }, (_, i) => addDays(viewStart, i)), [viewStart]);

  const monthGroups = useMemo(() => {
    const groups = [];
    let cur = null;
    days.forEach(d => {
      const label = format(d, "MMM yyyy");
      if (!cur || cur.label !== label) { cur = { label, count: 0 }; groups.push(cur); }
      cur.count++;
    });
    return groups;
  }, [days]);

  const sorted = [...phases].sort((a, b) => (a.phase_order || 0) - (b.phase_order || 0));

  const subsForPhase = (phaseId) => projectSubs.filter(ps => ps.phase_id === phaseId);
  const materialsForPhase = (phaseId) => materials.filter(m => m.phase_id === phaseId);

  const rows = useMemo(() => {
    const result = [];
    sorted.forEach(ph => {
      const phaseSubs = subsForPhase(ph.id);
      const phaseMats = materialsForPhase(ph.id);
      const hasChildren = phaseSubs.length > 0 || phaseMats.length > 0;
      
      result.push({ type: "phase", data: ph, hasChildren });
      
      if (expanded[ph.id] && hasChildren) {
        phaseSubs.forEach(ps => result.push({ type: "sub", data: ps, sub: subMap[ps.subcontractor_id] }));
        phaseMats.forEach(m => result.push({ type: "material", data: m }));
      }
    });
    return result;
  }, [sorted, expanded, projectSubs, materials, subMap]);

  const renderBar = (row) => {
    if (row.type === "phase") {
      const ph = row.data;
      const colors = PHASE_COLORS[ph.status] || PHASE_COLORS["Not Started"];
      const bar = calcBar(safeParseDate(ph.start_date_target), safeParseDate(ph.end_date_target), viewStart, viewDays);
      
      if (!bar) return <span className="text-[10px] text-slate-400 italic absolute left-2 top-1/2 -translate-y-1/2">No dates</span>;
      
      return (
        <div className={`absolute flex items-center h-7 rounded-full border px-3 shadow-sm cursor-pointer ${colors.bar}`}
          style={{ left: bar.left, width: bar.width }}
          title={`${ph.start_date_target || "?"} → ${ph.end_date_target || "?"}`}
          onClick={() => toast.info(ph.name, { description: `${formatFriendly(ph.start_date_target)} to ${formatFriendly(ph.end_date_target)}` })}
        >
          <div className={`h-2 w-2 rounded-full shrink-0 mr-2 ${colors.dot}`} />
          <span className="text-xs font-semibold text-slate-800 truncate">{ph.name}</span>
        </div>
      );
    }

    if (row.type === "sub") {
      const ps = row.data;
      const colors = SUB_COLORS[ps.status] || "bg-slate-100 border-slate-300";
      const bar = calcBar(safeParseDate(ps.scheduled_start), safeParseDate(ps.scheduled_end), viewStart, viewDays);
      
      if (!bar) return <span className="text-[10px] text-slate-400 italic absolute left-2 top-1/2 -translate-y-1/2">No dates</span>;
      
      const name = row.sub?.company_name || "Unknown";
      
      return (
        <div className={`absolute flex items-center h-6 rounded-full border px-3 shadow-sm cursor-pointer ${colors}`}
          style={{ left: bar.left, width: bar.width }}
          title={`${ps.scheduled_start || "?"} → ${ps.scheduled_end || "?"}`}
          onClick={() => toast.info(name, { description: `${formatFriendly(ps.scheduled_start)} to ${formatFriendly(ps.scheduled_end)}` })}
        >
          <HardHat className="h-3 w-3 shrink-0 mr-1.5 text-amber-600" />
          <span className="text-[11px] font-medium text-slate-700 truncate">{name}</span>
        </div>
      );
    }

    if (row.type === "material") {
      const m = row.data;
      const colors = MAT_COLORS[m.status] || "bg-slate-100 border-slate-300";
      const date = safeParseDate(m.needed_by_date);
      const bar = calcBar(date, date, viewStart, viewDays);
      
      if (!bar) return <span className="text-[10px] text-slate-400 italic absolute left-2 top-1/2 -translate-y-1/2">No date</span>;
      
      return (
        <div className={`absolute flex items-center h-6 rounded-full border px-3 shadow-sm cursor-pointer ${colors}`}
          style={{ left: bar.left, width: Math.max(bar.width, 100) }}
          title={`Needed by: ${m.needed_by_date}`}
          onClick={() => toast.info(m.custom_material_name || "Material", { description: `Needed by: ${formatFriendly(m.needed_by_date)}` })}
        >
          <Package className="h-3 w-3 shrink-0 mr-1.5 text-blue-500" />
          <span className="text-[11px] font-medium text-slate-700 truncate">{m.custom_material_name || "Material"}</span>
        </div>
      );
    }
    return null;
  };

  const renderLabel = (row) => {
    if (row.type === "phase") {
      const ph = row.data;
      const colors = PHASE_COLORS[ph.status] || PHASE_COLORS["Not Started"];
      return (
        <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 h-full cursor-pointer select-none"
          onClick={() => row.hasChildren && setExpanded(e => ({ ...e, [ph.id]: !e[ph.id] }))}>
          {row.hasChildren
            ? (expanded[ph.id]
              ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              : <ChevronRightIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />)
            : <div className="w-3.5 shrink-0" />
          }
          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${colors.dot}`} />
          <span className="text-xs md:text-sm font-semibold text-slate-800 truncate">{ph.name}</span>
        </div>
      );
    }
    if (row.type === "sub") {
      const name = row.sub?.company_name || "Unknown Subcontractor";
      const trade = row.sub?.trade;
      return (
        <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 pl-7 md:pl-9 h-full">
          <HardHat className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <span className="text-[11px] md:text-xs font-medium text-slate-700 truncate block">{name}</span>
            <span className="hidden md:block text-[10px] text-slate-400 truncate">{trade}</span>
          </div>
        </div>
      );
    }
    if (row.type === "material") {
      const m = row.data;
      return (
        <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 pl-7 md:pl-9 h-full">
          <Package className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <span className="text-[11px] md:text-xs font-medium text-slate-700 truncate block">{m.custom_material_name || "Material"}</span>
            <span className="hidden md:block text-[10px] text-slate-400 truncate">{m.quantity} {m.unit} · {m.status}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 print-container">
      
      {/* --- CSS FOR PRINTING --- */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          body * { visibility: hidden; }
          .print-container, .print-container * { visibility: visible; }
          .print-container { 
            position: absolute; 
            left: 0; 
            top: 0; 
            width: 100%; 
            height: auto !important;
            overflow: visible !important;
          }
          .no-print { display: none !important; }
          /* Force Gantt chart colors and backgrounds to render correctly */
          * { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
          }
          /* Allow grid to expand fully for printing */
          .gantt-scroll-area {
            overflow: visible !important;
            max-height: none !important;
          }
        }
      `}</style>

      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 shadow-sm z-20">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Project Gantt Schedule</h2>
          <p className="text-xs text-slate-500 mt-1">{sorted.length} phases · {projectSubs.length} subcontractors · {materials.length} materials</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto w-full sm:w-auto justify-between sm:justify-start">
          
          <Button size="sm" variant="outline" className="text-xs hidden sm:flex font-bold no-print" onClick={() => setOffsetDays(0)}>
            Today
          </Button>

          <Button size="sm" variant="outline" className="text-xs font-bold no-print border-slate-300 hover:bg-slate-50 text-slate-700" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Print Chart
          </Button>
          
          <div className="flex items-center gap-2 no-print">
            <Button size="icon" variant="outline" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => setOffsetDays(o => o - 14)}>
              <ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => setOffsetDays(o => o + 14)}>
              <ChevronRight className="h-5 w-5 sm:h-4 sm:w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative gantt-scroll-area">
        {/* Left Column (Labels) */}
        <div 
          ref={leftScrollRef}
          onScroll={(e) => handleScrollSync(e, rightScrollRef)}
          className="shrink-0 bg-white border-r border-slate-200 overflow-y-auto relative z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] custom-scrollbar" 
          style={{ width: labelWidth }}
        >
          <div style={{ height: ROW_HEIGHT }} className="border-b border-slate-200 bg-slate-100/50 sticky top-0 z-20" />
          {rows.length === 0 && <div className="p-6 text-slate-400 text-sm text-center">No phases scheduled yet.</div>}
          {rows.map((row, i) => (
            <div key={`${row.type}-${row.data.id}-${i}`}
              className={`border-b border-slate-100 ${row.type === "phase" ? "bg-white hover:bg-slate-50/50" : "bg-slate-50"}`}
              style={{ height: ROW_HEIGHT }}>
              {renderLabel(row)}
            </div>
          ))}
          <div
            className={`hidden md:block absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-amber-400/60 transition-colors z-30 ${dragging ? "bg-amber-400" : ""}`}
            onMouseDown={handleDragStart}
          />
        </div>

        {/* Right Area (Gantt grid) */}
        <div 
          ref={rightScrollRef}
          onScroll={(e) => handleScrollSync(e, leftScrollRef)}
          className="flex-1 overflow-auto bg-white custom-scrollbar"
        >
          <div style={{ width: viewDays * CELL_WIDTH, minWidth: "100%" }}>
            
            {/* Timeline Header (Sticky) */}
            <div className="sticky top-0 z-20 bg-white shadow-sm">
              <div className="flex border-b border-slate-200 bg-slate-100/80 backdrop-blur-sm" style={{ height: ROW_HEIGHT / 2 }}>
                {monthGroups.map((g, i) => (
                  <div key={i} className="flex items-center px-2 border-r border-slate-300 text-[11px] font-bold text-slate-700"
                    style={{ width: g.count * CELL_WIDTH, minWidth: g.count * CELL_WIDTH }}>{g.label}</div>
                ))}
              </div>
              <div className="flex border-b border-slate-200 bg-slate-50/90 backdrop-blur-sm" style={{ height: ROW_HEIGHT / 2 }}>
                {days.map((d, i) => {
                  const isToday = differenceInDays(d, today) === 0;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={i} className={`flex items-center justify-center border-r text-[10px] font-medium ${isToday ? "bg-amber-400 text-white font-bold" : isWeekend ? "bg-slate-100/80 text-slate-400" : "border-slate-200 text-slate-500"}`}
                      style={{ width: CELL_WIDTH, minWidth: CELL_WIDTH }}>{format(d, "d")}</div>
                  );
                })}
              </div>
            </div>

            {/* Grid Rows */}
            <div className="relative">
              {todayOffset >= 0 && todayOffset < viewDays && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-amber-400/80 z-10 pointer-events-none" style={{ left: todayOffset * CELL_WIDTH + CELL_WIDTH / 2 - 1 }} />
              )}
              
              {rows.map((row, i) => (
                <div key={`${row.type}-${row.data.id}-${i}`}
                  className={`relative flex items-center border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${row.type === "phase" ? (i % 2 === 0 ? "bg-white" : "bg-slate-50/30") : "bg-slate-50/80"}`}
                  style={{ height: ROW_HEIGHT }}>
                  
                  {days.map((d, di) => (
                    (d.getDay() === 0 || d.getDay() === 6)
                      ? <div key={di} className="absolute top-0 bottom-0 bg-slate-100/40 pointer-events-none" style={{ left: di * CELL_WIDTH, width: CELL_WIDTH }} />
                      : null
                  ))}
                  
                  {renderBar(row)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend Footer */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-4 flex-wrap shrink-0 z-20 shadow-[0_-2px_10px_rgba(0,0,0,0.02)] no-print">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Phases:</span>
          {Object.entries(PHASE_COLORS).map(([s, c]) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full shadow-sm ${c.dot}`} />
              <span className="text-[10px] sm:text-[11px] font-medium text-slate-600">{s}</span>
            </div>
          ))}
        </div>

        <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Items:</span>
          <div className="flex items-center gap-1.5">
            <HardHat className="h-3 w-3 text-amber-500" /><span className="text-[10px] sm:text-[11px] font-medium text-slate-600">Subcontractor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Package className="h-3 w-3 text-blue-500" /><span className="text-[10px] sm:text-[11px] font-medium text-slate-600">Material</span>
          </div>
        </div>
      </div>
    </div>
  );
}