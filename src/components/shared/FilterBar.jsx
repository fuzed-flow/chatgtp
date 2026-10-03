import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

export default function FilterBar({ filters = [], onFiltersChange }) {
  const [activeFilters, setActiveFilters] = useState({});

  const handleFilterChange = (filterKey, value) => {
    const newFilters = { ...activeFilters, [filterKey]: value };
    if (value === "" || value === null) {
      delete newFilters[filterKey];
    }
    setActiveFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const handleClearAll = () => {
    setActiveFilters({});
    onFiltersChange({});
  };

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-50/50 rounded-lg border border-slate-200/60">
      {filters.map(filter => (
        <div key={filter.key} className="flex items-center gap-2">
          {filter.type === "text" ? (
            <Input
              placeholder={filter.label}
              value={activeFilters[filter.key] || ""}
              onChange={(e) => handleFilterChange(filter.key, e.target.value)}
              className="w-full sm:w-40 h-9 min-w-[120px]"
            />
          ) : filter.type === "select" ? (
            <Select value={activeFilters[filter.key] || ""} onValueChange={(v) => handleFilterChange(filter.key, v)}>
              <SelectTrigger className="w-full sm:w-40 h-9 min-w-[120px]">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All</SelectItem>
                {filter.options?.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ))}
      
      {Object.keys(activeFilters).length > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleClearAll}
          className="text-slate-600 hover:text-slate-900"
        >
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  );
}