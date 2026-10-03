import React from "react";

export default function LoadingSpinner({ size = "md", label = "Loading..." }) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-3"
  };

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <div className={`${sizeClasses[size]} border-slate-300 border-t-amber-500 rounded-full animate-spin`} />
      {label && <p className="text-sm text-slate-500">{label}</p>}
    </div>
  );
}