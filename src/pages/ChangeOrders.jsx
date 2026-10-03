import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { checkAccess } from '@/lib/planConfig'; 
import UpgradeWall from '@/components/shared/UpgradeWall';
import { Plus, Search, FileText, Trash2, Send, CheckCircle2, Clock } from "lucide-react";
import { createPageUrl } from "../utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "../components/shared/PageHeader";
import StatusBadge from "../components/shared/StatusBadge";
import DataTable from "../components/shared/DataTable";
import ActionMenu from "../components/shared/ActionMenu";
import { format } from "date-fns";
import { toast } from "sonner";

export default function ChangeOrders() {
  const { profile, company } = useAuth(); 
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- QUERIES ---
  const { data: changeOrders = [] } = useQuery({ 
    queryKey: ["change-orders", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("change_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); 
      return data || []; 
    } 
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("clients").select("id, name, first_name, surname, site_address").eq("company_id", companyId); 
      return data || []; 
    } 
  });

  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("projects").select("id, client_id, site_address").eq("company_id", companyId); 
      return data || []; 
    } 
  });

  // 👇 THE GATEKEEPER 👇
  const canAccessChangeOrders = checkAccess(company?.plan_id, 'hasChangeOrders');

  if (!canAccessChangeOrders) {
    return <UpgradeWall featureName="Change Orders" requiredPlan="Professional" />;
  }
  // 👆 ------------------ 👆

  // --- MUTATIONS ---
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("change_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-orders"] });
      toast.success("Change order deleted");
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`)
  });

  // --- DATA PROCESSING ---
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const clientMap = Object.fromEntries(clients.map(c => [
    c.id, 
    {
      name: c.name || `${c.first_name || ''} ${c.surname || ''}`.trim() || "Unknown Client",
      site_address: c.site_address || ""
    }
  ]));

  const enrichedChangeOrders = changeOrders.map(co => {
    const linkedProject = projectMap[co.project_id] || {};
    const resolvedClientId = co.client_id || linkedProject.client_id;
    const linkedClient = clientMap[resolvedClientId] || {};

    return {
      ...co,
      client_name: linkedClient.name || "—",
      // It will look for the address on the Project first, then the Client
      site_address: linkedProject.site_address || linkedClient.site_address || "—"
    };
  });

  const filtered = enrichedChangeOrders.filter(co => {
    const searchLower = search.toLowerCase();
    const matchSearch = !search || 
      co.title?.toLowerCase().includes(searchLower) || 
      co.change_order_number?.toLowerCase().includes(searchLower) ||
      co.client_name.toLowerCase().includes(searchLower);
      
    const matchStatus = statusFilter === "All" || co.status === statusFilter;
    
    return matchSearch && matchStatus;
  });

  // --- METRICS ---
  const totalPending = changeOrders.filter(c => ["Draft", "Sent"].includes(c.status)).reduce((sum, c) => sum + (c.total || 0), 0);
  const totalApproved = changeOrders.filter(c => c.status === "Approved").reduce((sum, c) => sum + (c.total || 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader 
        title="Change Orders" 
        description="Track scope additions, budget impacts, and client approvals." 
        actions={
          <Button onClick={() => window.location.href = createPageUrl("ChangeOrderBuilder")} className="bg-slate-900 hover:bg-slate-800 text-white">
            {/* ⚡ HIDES TEXT ON MOBILE */}
            <Plus className="h-4 w-4 sm:mr-2" /> 
            <span className="hidden sm:inline">New Change Order</span>
          </Button>
        } 
      />

      {/* METRIC CARDS - HIDDEN ON MOBILE */}
      <div className="hidden sm:grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Pending Approval</p>
            <p className="text-2xl font-black text-amber-600 mt-1">${totalPending.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <Clock className="h-10 w-10 text-amber-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Approved</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">${totalApproved.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <CheckCircle2 className="h-10 w-10 text-emerald-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Active Records</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{changeOrders.length}</p>
          </div>
          <FileText className="h-10 w-10 text-slate-100" />
        </Card>
      </div>

      {/* FILTER BAR - Matched to Invoices Layout */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search by title, number, or client..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            className="pl-9 bg-white" 
          />
        </div>
        
        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Statuses</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Sent">Sent</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Declined">Declined</SelectItem>
              <SelectItem value="Invoiced">Invoiced</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <DataTable
          data={filtered}
          emptyMessage="No change orders match your criteria. Create one to get started."
          columns={[
            {
              key: "change_order_number",
              label: "CO #",
              render: (number, co) => (
                <button onClick={() => window.location.href = createPageUrl(`ChangeOrderBuilder?id=${co.id}`)} className="font-bold text-slate-800 hover:text-amber-600 underline">
                  {number || "—"}
                </button>
              )
            },
            { key: "title", label: "Title", render: (title) => <span className="font-medium text-slate-900">{title || "—"}</span> },
            { key: "client_name", label: "Client", render: (name) => <span className="text-slate-600">{name}</span> },
            { key: "site_address", label: "Site Address", render: (address) => <span className="text-slate-600">{address || "—"}</span> },
            { key: "total", label: "Total", render: (total) => <span className="font-bold text-slate-900">${(total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> },
            { key: "status", label: "Status", render: (status) => <StatusBadge status={status || "Draft"} /> },
            { key: "issue_date", label: "Date", render: (date, co) => <span className="text-sm text-slate-500">{date ? format(new Date(date), "MMM d, yyyy") : format(new Date(co.created_at), "MMM d, yyyy")}</span> }
          ]}
          actions={(co) => (
            <ActionMenu
              actions={[
                { label: "Send to Client", icon: Send, onClick: () => toast.info(`Send module for ${co.change_order_number} coming soon!`) },
                { label: "Delete", icon: Trash2, destructive: true, onClick: () => { if(window.confirm("Delete this Change Order?")) deleteMutation.mutate(co.id); } },
              ]}
            />
          )}
        />
      </div>
    </div>
  );
}