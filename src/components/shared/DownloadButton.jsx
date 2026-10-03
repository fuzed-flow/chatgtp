import React from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function DownloadButton({ data, filename, columns }) {
  const downloadCSV = () => {
    if (!data || data.length === 0) return;
    
    // Create CSV headers
    const headers = columns.map(col => col.label).join(",");
    
    // Create CSV rows
    const rows = data.map(item => {
      return columns.map(col => {
        const value = col.getValue ? col.getValue(item) : item[col.key];
        // Escape commas and quotes in values
        const escaped = String(value || "").replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(",");
    });
    
    const csv = [headers, ...rows].join("\n");
    
    // Create download
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadExcel = () => {
    if (!data || data.length === 0) return;
    
    // For Excel, we'll create a CSV but with .xlsx extension
    // Most spreadsheet apps can open CSV files
    const headers = columns.map(col => col.label).join(",");
    const rows = data.map(item => {
      return columns.map(col => {
        const value = col.getValue ? col.getValue(item) : item[col.key];
        const escaped = String(value || "").replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(",");
    });
    
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.xlsx`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={downloadCSV}>
          Download as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadExcel}>
          Download as Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}