import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

const downloadCSV = (data, filename) => {
  if (!data || data.length === 0) {
    toast.error("No data found for this date range.");
    return;
  }
  const headers = Object.keys(data[0]);
  const csvRows = data.map(row => 
    headers.map(fieldName => `"${String(row[fieldName] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csvContent = [headers.join(','), ...csvRows].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
};

export default function AdvancedReporting() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportType, setReportType] = useState("projects");
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const handleGenerateReport = async () => {
    if (!companyId) return toast.error("Company profile missing.");
    
    setIsGenerating(true);
    toast.loading("Gathering data from database...");

    try {
      let query;
      let dateColumn = "created_at";

      switch (reportType) {
        case "projects":
          query = supabase.from("projects").select("*").eq("company_id", companyId);
          break;
        case "quotes":
          query = supabase.from("quotes").select("*").eq("company_id", companyId);
          dateColumn = "issue_date";
          break;
        case "invoices":
          query = supabase.from("invoices").select("*").eq("company_id", companyId);
          dateColumn = "issue_date";
          break;
        case "time_entries":
          query = supabase.from("time_entries").select("*").eq("company_id", companyId);
          dateColumn = "date";
          break;
        case "inventory":
          query = supabase.from("inventory_transactions").select("*").eq("company_id", companyId);
          break;
        default:
          throw new Error("Invalid report type selected.");
      }

      if (dateFrom) query = query.gte(dateColumn, dateFrom);
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setDate(endOfDay.getDate() + 1);
        query = query.lte(dateColumn, endOfDay.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        toast.dismiss();
        toast.error("No records found in this date range.");
        setIsGenerating(false);
        return;
      }

      const cleanedData = data.map(item => {
        const { id, company_id, updated_at, ...rest } = item;
        return rest;
      });

      downloadCSV(cleanedData, `${reportType.toUpperCase()}_Report_${dateFrom}_to_${dateTo}.csv`);
      toast.dismiss();
      toast.success("Report generated successfully!");
      setOpen(false);

    } catch (err) {
      toast.dismiss();
      toast.error(`Report generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-white font-bold text-slate-700 shadow-sm border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-all">
          <FileSpreadsheet className="h-4 w-4 mr-2 text-blue-600" /> Custom Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-black text-xl text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" /> Export Raw Data
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Report Data Source</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger className="font-bold bg-white border-slate-200 shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="projects" className="font-bold">Projects & Jobs</SelectItem>
                <SelectItem value="quotes" className="font-bold">Estimates & Quotes</SelectItem>
                <SelectItem value="invoices" className="font-bold">Invoices & Billing</SelectItem>
                <SelectItem value="time_entries" className="font-bold">Employee Timesheets</SelectItem>
                <SelectItem value="inventory" className="font-bold">Material Usage Logs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Date From</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="font-bold bg-white border-slate-200 shadow-sm" />
            </div>
            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Date To</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="font-bold bg-white border-slate-200 shadow-sm" />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-bold border-slate-300">Cancel</Button>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black shadow-md"
              onClick={handleGenerateReport}
              disabled={isGenerating}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              {isGenerating ? "Extracting..." : "Download CSV"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}