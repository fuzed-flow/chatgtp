import React from "react";
import { Badge } from "@/components/ui/badge";
import { differenceInCalendarDays, parseISO } from "date-fns";

const TYPE_ICONS = { Vacation: "🌴", "Sick Day": "🤒", "Personal Day": "🏠", "Unpaid Leave": "📋" };

const STATUS_STYLES = {
  Approved: { card: "border-green-300 bg-green-50", badge: "bg-green-100 text-green-700" },
  Rejected: { card: "border-red-300 bg-red-50", badge: "bg-red-100 text-red-700" },
  Pending: { card: "border-amber-300 bg-amber-50", badge: "bg-amber-100 text-amber-700" },
};

const calcDays = (s, e) => {
  if (!s || !e) return 0;
  return Math.max(1, differenceInCalendarDays(parseISO(e), parseISO(s)) + 1);
};

export default function VacationLinearView({ entries, profiles }) {
  if (entries.length === 0) {
    return <p className="text-center text-slate-400 text-sm py-8">No time off requests found.</p>;
  }

  return (
    <div className="space-y-6">
      {entries.map(({ user, requests: reqs }) => {
        const profile = profiles.find(p => p.user_email === user.email);
        const vacLeft = profile ? (profile.vacation_days_total || 0) - (profile.vacation_days_used || 0) : null;
        return (
          <div key={user.email}>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-amber-400">{user.full_name?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{user.full_name}</p>
                {profile && (
                  <p className="text-xs text-slate-400">
                    {profile.position || profile.role_trade || "Employee"}
                    {vacLeft !== null ? ` · ${vacLeft} vacation days left` : ""}
                  </p>
                )}
              </div>
              <Badge className="text-[10px] bg-slate-100 text-slate-600">
                {reqs.length} request{reqs.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            <div className="space-y-2 pl-2">
              {reqs.map(req => {
                const style = STATUS_STYLES[req.status] || STATUS_STYLES.Pending;
                const days = calcDays(req.start_date, req.end_date);
                return (
                  <div key={req.id} className={`rounded-xl border p-3 ${style.card}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{TYPE_ICONS[req.type]}</span>
                        <span className="text-sm font-medium text-slate-900">{req.type}</span>
                        <Badge className={`text-[10px] ${style.badge}`}>{req.status}</Badge>
                      </div>
                      <span className="text-xs font-semibold text-slate-700 shrink-0">
                        {days} day{days !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{req.start_date} → {req.end_date}</p>
                    {req.reason && <p className="text-xs text-slate-500 mt-0.5 italic">"{req.reason}"</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}