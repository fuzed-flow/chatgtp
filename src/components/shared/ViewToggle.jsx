import React from "react";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ViewToggle({ view, onViewChange }) {
  return (
    <div className="flex items-center gap-1 border rounded-lg p-1 bg-white">
      <Button
        variant={view === "list" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("list")}
        className={view === "list" ? "bg-slate-900" : ""}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        variant={view === "card" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("card")}
        className={view === "card" ? "bg-slate-900" : ""}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  );
}