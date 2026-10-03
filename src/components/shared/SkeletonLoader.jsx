import React from "react";
import { Card } from "@/components/ui/card";

export default function SkeletonLoader({ type = "card", count = 1 }) {
  if (type === "card") {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className="p-4 border-slate-200/60 animate-pulse">
            <div className="h-4 bg-slate-200 rounded mb-3" />
            <div className="h-3 bg-slate-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-slate-100 rounded w-1/2" />
          </Card>
        ))}
      </>
    );
  }

  if (type === "table-row") {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <tr key={i} className="border-b border-slate-200/60">
            <td colSpan="5" className="px-4 py-3">
              <div className="space-y-2">
                <div className="h-3 bg-slate-200 rounded animate-pulse" />
                <div className="h-3 bg-slate-100 rounded w-3/4 animate-pulse" />
              </div>
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-200 rounded animate-pulse" />
      ))}
    </div>
  );
}