import React from "react";

export function SkeletonLine({ width = "w-full", height = "h-4" }) {
  return <div className={`${width} ${height} bg-slate-200 rounded animate-pulse`} />;
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="p-4 border border-slate-200/60 rounded-lg bg-white space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="border border-slate-200/60 rounded-lg overflow-hidden">
      <div className="grid bg-slate-50/50 border-b border-slate-200/60 p-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} width="w-20" height="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid p-4 border-b border-slate-200/60 last:border-b-0" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, colIdx) => (
            <SkeletonLine key={colIdx} width={colIdx === cols - 1 ? "w-16" : "w-full"} height="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonAvatar() {
  return <div className="h-10 w-10 bg-slate-200 rounded-lg animate-pulse" />;
}