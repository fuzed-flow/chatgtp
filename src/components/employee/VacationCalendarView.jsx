import React, { useState } from "react";
import { parseISO, format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isWithinInterval, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_COLORS = {
  Approved: "bg-green-400",
  Rejected: "bg-red-400",
  Pending: "bg-amber-400",
};

const STATUS_TEXT_COLORS = {
  Approved: "text-green-700",
  Rejected: "text-red-700",
  Pending: "text-amber-700",
};

const USER_COLORS = [
  "bg-blue-400", "bg-purple-400", "bg-pink-400", "bg-indigo-400",
  "bg-teal-400", "bg-orange-400", "bg-cyan-400", "bg-rose-400",
];

export default function VacationCalendarView({ entries, profiles }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad days to start on Sunday
  const startPad = monthStart.getDay(); // 0 = Sunday

  // Build a flat list of all requests with user info
  const allRequests = [];
  entries.forEach(({ user, requests: reqs }, idx) => {
    reqs.forEach(req => {
      allRequests.push({ ...req, user, colorIndex: idx });
    });
  });

  // For each day, find which requests cover it
  const getRequestsForDay = (day) => {
    return allRequests.filter(req => {
      if (!req.start_date || !req.end_date) return false;
      const start = parseISO(req.start_date);
      const end = parseISO(req.end_date);
      return isWithinInterval(day, { start, end });
    });
  };

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft className="h-4 w-4 text-slate-600" />
        </button>
        <h3 className="font-bold text-slate-900 text-base">
          {format(currentMonth, "MMMM yyyy")}
        </h3>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ChevronRight className="h-4 w-4 text-slate-600" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-slate-400 pb-1">{d}</div>
        ))}

        {/* Padding cells */}
        {Array.from({ length: startPad }).map((_, i) => (
          <div key={`pad-${i}`} className="h-16 rounded-lg bg-slate-50 border border-slate-100" />
        ))}

        {/* Day cells */}
        {days.map(day => {
          const dayRequests = getRequestsForDay(day);
          const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
          return (
            <div
              key={day.toISOString()}
              className={`h-16 rounded-lg border p-1 overflow-hidden flex flex-col ${
                isToday ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
              }`}
            >
              <span className={`text-xs font-semibold mb-0.5 ${isToday ? "text-slate-900" : "text-slate-500"}`}>
                {format(day, "d")}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayRequests.slice(0, 3).map((req, i) => (
                  <div
                    key={`${req.id}-${i}`}
                    title={`${req.user.full_name} — ${req.type} (${req.status})`}
                    className={`text-[9px] font-medium text-white rounded px-1 truncate ${STATUS_COLORS[req.status] || "bg-slate-400"}`}
                  >
                    {req.user.full_name?.split(" ")[0]}
                  </div>
                ))}
                {dayRequests.length > 3 && (
                  <span className="text-[9px] text-slate-400">+{dayRequests.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded ${color}`} />
            <span className={`text-xs font-medium ${STATUS_TEXT_COLORS[status]}`}>{status}</span>
          </div>
        ))}
      </div>

      {/* Requests in this month */}
      {(() => {
        const monthRequests = allRequests.filter(req => {
          if (!req.start_date && !req.end_date) return false;
          const start = parseISO(req.start_date);
          const end = parseISO(req.end_date);
          return start <= monthEnd && end >= monthStart;
        });
        if (monthRequests.length === 0) return null;
        return (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">This month</p>
            {monthRequests.map(req => (
              <div key={req.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white border border-slate-200">
                <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[req.status]}`} />
                <span className="text-sm font-medium text-slate-900 truncate flex-1">{req.user.full_name}</span>
                <span className="text-xs text-slate-500">{req.type}</span>
                <span className="text-xs text-slate-400">{req.start_date} → {req.end_date}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}