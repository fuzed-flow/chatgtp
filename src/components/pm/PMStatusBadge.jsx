import React from "react";

const STATUS_COLORS = {
  // Project statuses
  "Active": "bg-green-100 text-green-800 border-green-200",
  "Lead": "bg-blue-100 text-blue-800 border-blue-200",
  "On Hold": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Completed": "bg-slate-100 text-slate-600 border-slate-200",
  "Cancelled": "bg-red-100 text-red-700 border-red-200",
  // Phase statuses
  "Not Started": "bg-slate-100 text-slate-600 border-slate-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Blocked": "bg-red-100 text-red-700 border-red-200",
  // Milestone
  "Planned": "bg-blue-100 text-blue-800 border-blue-200",
  "At Risk": "bg-orange-100 text-orange-700 border-orange-200",
  // Task
  "Backlog": "bg-slate-100 text-slate-500 border-slate-200",
  "Ready": "bg-sky-100 text-sky-700 border-sky-200",
  "Done": "bg-green-100 text-green-700 border-green-200",
  // Issue severity
  "Low": "bg-slate-100 text-slate-600 border-slate-200",
  "Medium": "bg-yellow-100 text-yellow-700 border-yellow-200",
  "High": "bg-orange-100 text-orange-700 border-orange-200",
  "Critical": "bg-red-100 text-red-700 border-red-200",
  // Issue status
  "Open": "bg-red-100 text-red-700 border-red-200",
  "Investigating": "bg-orange-100 text-orange-700 border-orange-200",
  "Waiting": "bg-yellow-100 text-yellow-700 border-yellow-200",
  "Resolved": "bg-green-100 text-green-700 border-green-200",
  "Closed": "bg-slate-100 text-slate-500 border-slate-200",
  // Material status
  "Ordered": "bg-blue-100 text-blue-700 border-blue-200",
  "Delivered": "bg-green-100 text-green-700 border-green-200",
  "Backordered": "bg-orange-100 text-orange-700 border-orange-200",
  "Installed": "bg-emerald-100 text-emerald-700 border-emerald-200",
  // Sub status
  "Proposed": "bg-slate-100 text-slate-600 border-slate-200",
  "Approved": "bg-blue-100 text-blue-700 border-blue-200",
  "Scheduled": "bg-purple-100 text-purple-700 border-purple-200",
  "On Site": "bg-amber-100 text-amber-700 border-amber-200",
  "Removed": "bg-red-100 text-red-600 border-red-200",
  // Priorities
  "Urgent": "bg-red-100 text-red-700 border-red-200",
};

export default function PMStatusBadge({ status, className = "" }) {
  const colors = STATUS_COLORS[status] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors} ${className}`}>
      {status}
    </span>
  );
}