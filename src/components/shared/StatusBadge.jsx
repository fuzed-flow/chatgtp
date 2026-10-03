import React from "react";
import { Badge } from "@/components/ui/badge";
import { getStatusColor } from "./themeHelper";

export default function StatusBadge({ status, className = "" }) {
  const colors = getStatusColor(status);
  return (
    <Badge variant="outline" className={`${colors} text-xs font-medium ${className}`}>
      {status}
    </Badge>
  );
}