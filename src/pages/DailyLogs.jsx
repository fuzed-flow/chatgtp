import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { format, parseISO } from "date-fns";
import { 
  BookOpen, Search, Plus, FileText, Trash2, Edit2, Camera, CloudSun, AlertTriangle, ShieldAlert, X, ChevronLeft, ChevronRight, Hammer, Briefcase, AlignLeft, Users, Target
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const WEATHER = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Hot", "Cold"];
const ITEMS_PER_PAGE = 15;

export default function DailyLogs() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("all"); 
  const [currentPage, setCurrentPage] = useState(1);

  // --- MODAL STATES ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedViewLog, setSelectedViewLog] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  const defaultForm = { id: null, date: format(new Date(), "yyyy-MM-dd"), project_id: "none", client_id: "none", lead_id: "none", summary: "", blockers: "", safety_concerns: "", materials_used: "", weather: "Sunny", photos: [] };
  const [form, setForm] = useState(defaultForm);

  // --- QUERIES ---
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId); return data || []; } 
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients_lookup", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("clients").select("id, name").eq("company_id", companyId); return data || []; }
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["leads_lookup", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("leads").select("id, contact_name").eq("company_id", companyId); return data || []; }
  });

  const { data: users = [] } = useQuery({
    queryKey: ["company_users", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data: u } = await supabase.from("users").select("id, full_name, email").eq("company_id", companyId);
      const { data: p } = await supabase.from("profiles").select("id, full_name").eq("company_id", companyId);
      return [...(u || []), ...(p || [])];
    }
  });

  const { data: allLogs = [], isLoading } = useQuery({ 
    queryKey: ["project_daily_logs", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_daily_logs").select("*").eq("company_id", companyId).order("date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    } 
  });

  // --- MUTATIONS ---
  const saveLogMutation = useMutation({
    mutationFn: async (payload) => {
      const dbPayload = {
        company_id: companyId,
        project_id: payload.project_id !== "none" ? payload.project_id : null,
        client_id: payload.client_id !== "none" ? payload.client_id : null,
        lead_id: payload.lead_id !== "none" ? payload.lead_id : null,
        date: payload.date,
        weather: payload.weather,
        summary: payload.summary,
        blockers: payload.blockers || null,
        safety_concerns: payload.safety_concerns || null,
        materials_used: payload.materials_used || null,
        photos: payload.photos || []
      };

      if (!payload.id) {
        dbPayload.user_id = profile.id;
      }

      const { error } = payload.id 
        ? await supabase.from("project_daily_logs").update(dbPayload).eq("id", payload.id)
        : await supabase.from("project_daily_logs").insert([dbPayload]);
        
      if (error) throw error;

      // --- PROPAGATE PHOTOS TO LEAD / CLIENT ---
      if (payload.photos && payload.photos.length > 0) {
        let targetLeadId = payload.lead_id !== "none" ? payload.lead_id : null;
        let targetClientId = payload.client_id !== "none" ? payload.client_id : null;

        // Auto-resolve client if a project is selected
        if (!targetClientId && payload.project_id && payload.project_id !== "none") {
          const project = projects.find(p => p.id === payload.project_id);
          if (project?.client_id) targetClientId = project.client_id;
        }

        // Add to Lead
        if (targetLeadId) {
          const { data: leadData } = await supabase.from("leads").select("photos").eq("id", targetLeadId).single();
          const existingPhotos = leadData?.photos || [];
          const newPhotos = [...new Set([...existingPhotos, ...payload.photos])];
          await supabase.from("leads").update({ photos: newPhotos }).eq("id", targetLeadId);
        }

        // Add to Client
        if (targetClientId) {
          const { data: existingAtt } = await supabase.from("attachments")
            .select("file_url")
            .eq("related_type", "Client")
            .eq("related_id", targetClientId);
          const existingUrls = existingAtt?.map(a => a.file_url) || [];
          
          const newAttachments = payload.photos
            .filter(url => !existingUrls.includes(url))
            .map(url => ({
              company_id: companyId,
              related_type: "Client",
              related_id: targetClientId,
              file_url: url,
              file_name: url.split('?')[0].split('/').pop() || `photo-${Date.now()}.jpg`,
              caption: "Site Photos/Info"
            }));
            
          if (newAttachments.length > 0) {
            await supabase.from("attachments").insert(newAttachments);
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      toast.success(form.id ? "Log updated!" : "Log submitted!");
      setIsFormOpen(false);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`)
  });
  
  // --- HANDLERS ---
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const urls = [...form.photos];
    try {
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `${profile.id}/${fileName}`;
        const { error } = await supabase.storage.from('daily_logs').upload(filePath, file);
        if (error) throw error;
        const { data } = supabase.storage.from('daily_logs').getPublicUrl(filePath);
        urls.push(data.publicUrl);
      }
      setForm({ ...form, photos: urls });
      toast.success(`${files.length} photo(s) uploaded!`);
    } catch (err) { toast.error(`Upload failed: ${err.message}`); } finally { setUploading(false); }
  };

  const openEdit = (log) => {
    setForm({ 
      ...log, 
      project_id: log.project_id || "none",
      client_id: log.client_id || "none",
      lead_id: log.lead_id || "none" 
    });
    setIsFormOpen(true);
  };

  // --- FILTER & PAGINATION ---
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const leadMap = Object.fromEntries(leads.map(l => [l.id, l.contact_name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.full_name || u.email]));

  const filteredLogs = allLogs.filter(log => {
    const matchSearch = !search || log.summary?.toLowerCase().includes(search.toLowerCase()) || log.blockers?.toLowerCase().includes(search.toLowerCase());
    const matchProject = filterProject === "all" || log.project_id === filterProject;
    return matchSearch && matchProject;
  });

  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentItems = filteredLogs.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-end">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 md:h-7 md:w-7 text-amber-500" /> Daily Field Logs
          </h1>
          <p className="text-xs md:text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">{filteredLogs.length} records found</p>
        </div>
        <Button onClick={() => { setForm(defaultForm); setIsFormOpen(true); }} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shrink-0 w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> Submit New Log
        </Button>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder="Search descriptions or issues..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-9 w-full bg-white font-medium h-10" />
        </div>
        <div className="w-full sm:w-[250px]">
          <Select value={filterProject} onValueChange={v => { setFilterProject(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-full bg-white font-bold h-10"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* RESPONSIVE LOGS WRAPPER */}
      <Card className="overflow-hidden border-slate-200 shadow-sm bg-white flex flex-col">
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16 px-4">
            <BookOpen className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-700">No logs found</h3>
            <p className="text-sm text-slate-500 mt-1">Adjust your filters or submit a new field log.</p>
          </div>
        ) : (
          <div className="w-full flex-1">
            
            {/* 🖥️ DESKTOP VIEW (Table) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Date & Author</th>
                    <th className="px-4 py-3">Relation & Weather</th>
                    <th className="px-4 py-3 min-w-[250px]">Summary & Issues</th>
                    <th className="px-4 py-3 text-center">Media</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                  {currentItems.map(log => {
                    let displayTag = "General";
                    if (log.project_id) displayTag = `Project: ${projectMap[log.project_id] || "Unknown"}`;
                    else if (log.client_id) displayTag = `Client: ${clientMap[log.client_id] || "Unknown"}`;
                    else if (log.lead_id) displayTag = `Lead: ${leadMap[log.lead_id] || "Unknown"}`;

                    return (
                      <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{log.date}</p>
                          <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{userMap[log.user_id] || "Unknown"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] uppercase mb-1">{displayTag}</Badge>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase"><CloudSun className="h-3 w-3" /> {log.weather}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-normal">
                          <p className="text-sm font-medium text-slate-700 line-clamp-2">{log.summary}</p>
                          <div className="flex gap-2 mt-1">
                            {log.blockers && <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded uppercase">Issues</span>}
                            {log.safety_concerns && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase">Safety</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {log.photos?.length > 0 ? (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Camera className="h-3 w-3 mr-1" /> {log.photos.length}</Badge>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setSelectedViewLog(log)} className="text-slate-400 hover:text-amber-600 hover:bg-amber-50"><FileText className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(log)} className="text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => { if(confirm("Delete this log?")) deleteLogMutation.mutate(log.id); }} className="text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 📱 MOBILE VIEW (Cards) */}
            <div className="md:hidden flex flex-col divide-y divide-slate-100">
              {currentItems.map(log => {
                let displayTag = "General";
                if (log.project_id) displayTag = `Project: ${projectMap[log.project_id] || "Unknown"}`;
                else if (log.client_id) displayTag = `Client: ${clientMap[log.client_id] || "Unknown"}`;
                else if (log.lead_id) displayTag = `Lead: ${leadMap[log.lead_id] || "Unknown"}`;

                return (
                  <div key={log.id} className="p-4 flex flex-col gap-3 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-black text-slate-900">{log.date}</p>
                        <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{userMap[log.user_id] || "Unknown"}</p>
                      </div>
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md shadow-sm">
                        <Button variant="ghost" size="icon" onClick={() => setSelectedViewLog(log)} className="h-8 w-8 text-slate-400 hover:text-amber-600 hover:bg-amber-50"><FileText className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(log)} className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if(confirm("Delete this log?")) deleteLogMutation.mutate(log.id); }} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div>
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] uppercase mb-1">{displayTag}</Badge>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase"><CloudSun className="h-3 w-3" /> {log.weather}</div>
                        {log.photos?.length > 0 && <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 uppercase ml-2"><Camera className="h-3 w-3" /> {log.photos.length}</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700 line-clamp-2">{log.summary}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {log.blockers && <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded uppercase">Issues Noted</span>}
                        {log.safety_concerns && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase">Safety Concern</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PAGINATION */}
        {!isLoading && filteredLogs.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 md:px-6 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 hidden sm:inline-block">
              Showing <span className="font-bold text-slate-900">{indexOfFirstItem + 1}</span> to <span className="font-bold text-slate-900">{Math.min(indexOfLastItem, filteredLogs.length)}</span> of <span className="font-bold text-slate-900">{filteredLogs.length}</span>
            </span>
            <div className="flex items-center justify-between w-full sm:w-auto gap-2">
              <Button variant="outline" size="sm" className="h-8 bg-white font-bold" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Previous</span></Button>
              <span className="text-xs font-bold text-slate-600 sm:hidden">Pg {currentPage} of {totalPages || 1}</span>
              <Button variant="outline" size="sm" className="h-8 bg-white font-bold" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages || totalPages === 0}><span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4 sm:ml-1" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* CREATE / EDIT FORM MODAL */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl">{form.id ? "Edit Log" : "New Field Log / Note"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 bg-white font-medium" /></div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Weather</Label>
                <Select value={form.weather} onValueChange={v => setForm({ ...form, weather: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Project</Label>
                <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="No Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Client</Label>
                <Select disabled={(form.project_id !== "none" && !!form.project_id) || (form.lead_id !== "none" && !!form.lead_id)} value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger className={`mt-1 font-medium ${(form.project_id !== "none" && !!form.project_id) || (form.lead_id !== "none" && !!form.lead_id) ? "bg-slate-50 opacity-60" : "bg-white"}`}><SelectValue placeholder="No Client" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Lead</Label>
                <Select disabled={(form.project_id !== "none" && !!form.project_id) || (form.client_id !== "none" && !!form.client_id)} value={form.lead_id} onValueChange={v => setForm({ ...form, lead_id: v })}>
                  <SelectTrigger className={`mt-1 font-medium ${(form.project_id !== "none" && !!form.project_id) || (form.client_id !== "none" && !!form.client_id) ? "bg-slate-50 opacity-60" : "bg-white"}`}><SelectValue placeholder="No Lead" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.contact_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed / Note *</Label>
              <Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={3} className="mt-1 bg-white min-h-[100px]" placeholder="Describe the work done or details..." />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Issues / Delays</Label>
                <Textarea value={form.blockers} onChange={e => setForm({ ...form, blockers: e.target.value })} rows={2} className="mt-1 bg-white border-orange-200 min-h-[60px]" placeholder="Any blockers?" />
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Safety Concerns</Label>
                <Textarea value={form.safety_concerns} onChange={e => setForm({ ...form, safety_concerns: e.target.value })} rows={2} className="mt-1 bg-white border-red-200 min-h-[60px]" placeholder="Incidents/hazards?" />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Materials Used</Label>
              <Input value={form.materials_used} onChange={e => setForm({ ...form, materials_used: e.target.value })} className="mt-1 bg-white" placeholder="e.g., 5 bags concrete, 10 2x4s" />
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between mb-3">
                <span>Site Photos</span><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded">{form.photos.length} attached</span>
              </Label>
              {form.photos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {form.photos.map((url, i) => (
                    <div key={i} className="relative group">
                      <img src={url} alt="Upload preview" className="h-16 w-16 object-cover rounded-lg border border-slate-300" />
                      <button onClick={() => setForm({ ...form, photos: form.photos.filter((_, idx) => idx !== i) })} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 px-3 py-4 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl cursor-pointer hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 transition-colors">
                {uploading ? <div className="h-5 w-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" /> : <><Camera className="h-5 w-5 text-slate-400" /><span className="text-sm font-bold text-slate-600">Upload Photos</span></>}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
              </label>
            </div>
            <DialogFooter className="pt-4 border-t border-slate-200 mt-4 flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" className="font-bold w-full sm:w-auto order-2 sm:order-1" onClick={() => setIsFormOpen(false)}>Cancel</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md w-full sm:w-auto order-1 sm:order-2" onClick={() => saveLogMutation.mutate(form)} disabled={!form.summary || uploading || saveLogMutation.isPending || (form.project_id === "none" && form.client_id === "none" && form.lead_id === "none")}>
                {saveLogMutation.isPending ? "Saving..." : "Save Log"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* VIEW DETAILS MODAL */}
      {selectedViewLog && (
        <Dialog open={!!selectedViewLog} onOpenChange={() => setSelectedViewLog(null)}>
          <DialogContent className="max-w-xl bg-white border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <div className="flex items-start justify-between pr-6 border-b border-slate-100 pb-4">
                <div>
                  <DialogTitle className="font-black text-2xl text-slate-900 mb-1">Log: {selectedViewLog.date}</DialogTitle>
                  <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5"><CloudSun className="h-4 w-4" /> Weather: {selectedViewLog.weather}</p>
                </div>
                {projects.find(p => p.id === selectedViewLog.project_id) && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 mt-1"><Briefcase className="h-3.5 w-3.5 mr-1.5" />{projects.find(p => p.id === selectedViewLog.project_id)?.name}</Badge>
                )}
              </div>
            </DialogHeader>
            <div className="space-y-6 pt-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2"><AlignLeft className="h-4 w-4" /> Work Completed Today</h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap">{selectedViewLog.summary}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedViewLog.blockers && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500 flex items-center gap-1.5 mb-2"><AlertTriangle className="h-4 w-4" /> Issues / Delays</h4>
                    <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 text-sm text-orange-900 whitespace-pre-wrap">{selectedViewLog.blockers}</div>
                  </div>
                )}
                {selectedViewLog.safety_concerns && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5 mb-2"><ShieldAlert className="h-4 w-4" /> Safety Concerns</h4>
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100 text-sm text-red-900 whitespace-pre-wrap">{selectedViewLog.safety_concerns}</div>
                  </div>
                )}
              </div>
              {selectedViewLog.materials_used && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2"><Hammer className="h-4 w-4" /> Materials Used</h4>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700">{selectedViewLog.materials_used}</div>
                </div>
              )}
              {selectedViewLog.photos && selectedViewLog.photos.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2"><Camera className="h-4 w-4" /> Attached Photos ({selectedViewLog.photos.length})</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {selectedViewLog.photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block group overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <img src={url} alt={`Log attachment ${i}`} className="w-full h-32 object-cover transition-transform group-hover:scale-105" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}