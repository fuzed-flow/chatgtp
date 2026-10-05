import React from "react";
import { Card } from "@/components/ui/card";

const TONES = {
  amber: { icon: "bg-amber-100 text-amber-700", value: "text-amber-700", ring: "hover:border-amber-300 focus-visible:ring-amber-400" },
  blue: { icon: "bg-blue-100 text-blue-700", value: "text-blue-700", ring: "hover:border-blue-300 focus-visible:ring-blue-400" },
  emerald: { icon: "bg-emerald-100 text-emerald-700", value: "text-emerald-700", ring: "hover:border-emerald-300 focus-visible:ring-emerald-400" },
  slate: { icon: "bg-slate-100 text-slate-700", value: "text-slate-900", ring: "hover:border-slate-400 focus-visible:ring-slate-400" },
};

export default function ApprovalSummaryCard({ icon: Icon, label, count, value, detail, tone = "slate", onClick }) {
  const colors = TONES[tone] || TONES.slate;
  return (
    <Card className={`overflow-hidden border-slate-200 bg-white shadow-sm transition-colors ${colors.ring}`}>
      <button type="button" onClick={onClick} className="w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-2xl font-black ${colors.value}`}>{count}</span>
              <span className="text-xs font-semibold text-slate-500">item{count === 1 ? "" : "s"}</span>
            </div>
            {value && <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>}
            {detail && <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>}
          </div>
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors.icon}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
      </button>
    </Card>
  );
}
