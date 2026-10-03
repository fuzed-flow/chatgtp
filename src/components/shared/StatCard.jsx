import React from "react";
import { Card } from "@/components/ui/card";

export default function StatCard({ title, value, icon: Icon, color = "amber", subtitle }) {
  const colorMap = {
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600",
  };
  const c = colorMap[color] || colorMap.amber;

  return (
    <Card className="p-3 lg:p-6 bg-white/80 backdrop-blur-sm border-slate-200/60 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] lg:text-xs font-semibold text-slate-500 uppercase tracking-widest truncate">{title}</p>
          <p className="text-xl lg:text-3xl font-bold text-slate-900 mt-1 lg:mt-2 bg-gradient-to-br from-slate-900 to-slate-700 bg-clip-text text-transparent">{value}</p>
          {subtitle && <p className="text-[10px] lg:text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`h-10 w-10 lg:h-12 lg:w-12 rounded-xl lg:rounded-2xl ${c} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300 shrink-0`}>
            <Icon className="h-5 w-5 lg:h-6 lg:w-6" />
          </div>
        )}
      </div>
    </Card>
  );
}