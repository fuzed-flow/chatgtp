import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function DataTable({ 
  columns, 
  data = [], 
  searchableFields = [],
  onRowClick,
  actions,
  emptyMessage = "No data available"
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const itemsPerPage = 10;

  const filteredData = search
    ? data.filter(item =>
        searchableFields.some(field =>
          String(item[field] || "").toLowerCase().includes(search.toLowerCase())
        )
      )
    : data;

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );

  return (
    <div className="space-y-4">
      {searchableFields.length > 0 && (
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-slate-400" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm text-xs lg:text-sm h-8 lg:h-9"
          />
        </div>
      )}

      {!isMobile ? (
        <Card className="overflow-hidden border-slate-200/60">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200/60 bg-slate-50/50">
                  {columns.map(col => (
                    <th
                      key={col.key}
                      className="px-3 lg:px-4 py-2 lg:py-3 text-left text-[10px] lg:text-xs font-semibold text-slate-600 uppercase tracking-wider"
                      style={{ width: col.width }}
                    >
                      {col.label}
                    </th>
                  ))}
                  {actions && <th className="px-3 lg:px-4 py-2 lg:py-3 text-right text-[10px] lg:text-xs font-semibold text-slate-600 uppercase">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + (actions ? 1 : 0)} className="px-3 lg:px-4 py-6 lg:py-8 text-center text-xs lg:text-sm text-slate-400">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((row, idx) => (
                    <tr
                      key={row.id || idx}
                      className="border-b border-slate-200/60 hover:bg-slate-50/50 transition-colors cursor-pointer"
                      onClick={() => onRowClick?.(row)}
                    >
                      {columns.map(col => (
                        <td
                          key={col.key}
                          className="px-3 lg:px-4 py-2 lg:py-3 text-xs lg:text-sm text-slate-700"
                        >
                          {col.render ? col.render(row[col.key], row) : row[col.key]}
                        </td>
                      ))}
                      {actions && (
                        <td className="px-3 lg:px-4 py-2 lg:py-3 text-right" onClick={e => e.stopPropagation()}>
                          {actions(row)}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {paginatedData.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400 border-slate-200/60">
              {emptyMessage}
            </Card>
          ) : (
            paginatedData.map((row, idx) => (
              <Card 
                key={row.id || idx} 
                className="p-4 cursor-pointer hover:shadow-md transition-all border-slate-200/60"
                onClick={() => onRowClick?.(row)}
              >
                <div className="space-y-3">
                  <div className="flex flex-col space-y-2">
                    {columns.map((col, cIdx) => (
                      <div key={col.key || cIdx} className="flex justify-between items-start text-sm">
                        <span className="text-slate-500 font-medium pr-2 text-xs">{col.label}:</span>
                        <div className="text-slate-900 text-right">
                          {col.render ? col.render(row[col.key], row) : row[col.key]}
                        </div>
                      </div>
                    ))}
                  </div>
                  {actions && (
                    <div className="pt-3 mt-3 border-t border-slate-100 flex justify-end" onClick={e => e.stopPropagation()}>
                      {actions(row)}
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] lg:text-xs text-slate-500 order-2 sm:order-1">
            {filteredData.length} result{filteredData.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2 order-1 sm:order-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="h-7 lg:h-8"
            >
              <ChevronLeft className="h-3 w-3 lg:h-4 lg:w-4" />
            </Button>
            <span className="text-[10px] lg:text-xs text-slate-600 px-2 whitespace-nowrap">
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="h-7 lg:h-8"
            >
              <ChevronRight className="h-3 w-3 lg:h-4 lg:w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}