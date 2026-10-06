import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Camera, BookOpen, Trash2, X, FileText, CloudSun, AlertTriangle, Hammer, Briefcase, AlignLeft, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import DailyLogWorkflowFields from "@/components/pm/DailyLogWorkflowFields";
import { useAuth } from "@/lib/AuthContext";

const WEATHER = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Hot", "Cold"];
const MAX_LOG_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_LOG_PHOTOS = 12;
const LOG_PHOTO_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export default function EPDailyLogs({ currentUser, companyId }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const actorId = profile?.id;
  const activeCompanyId = profile?.company_id;
  const identityReady = !!actorId && actorId === currentUser?.id && !!activeCompanyId && activeCompanyId === companyId;
  const [open, setOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const notificationLog = new URLSearchParams(window.location.search).get("notificationLog");
  const { data: notifiedLog } = useQuery({
    queryKey: ["notifiedDailyLog", activeCompanyId, actorId, notificationLog],
    enabled: !!notificationLog && identityReady,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_notified_daily_log", { p_log: notificationLog });
      if (error) throw error;
      return data || null;
    },
  });
  useEffect(() => { if (notifiedLog) setSelectedLog(notifiedLog); }, [notifiedLog]);
  const [uploading, setUploading] = useState(false);
  
  // THE FIX: default project_id is now empty, forcing them to pick one!
  const defaultForm = { 
    date: format(new Date(), "yyyy-MM-dd"), 
    project_id: "", 
    summary: "", 
    blockers: "", 
    safety_concerns: "", 
    materials_used: "", 
    weather: "Sunny", 
    category: "Work Completed",
    weather_delay: false,
    photos: [] 
  };
  
  const [form, setForm] = useState(defaultForm);

  // 1. Fetch Projects
  const projectsQuery = useQuery({
    queryKey: ["daily_log_assigned_projects", activeCompanyId, actorId],
    enabled: identityReady,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_staff").select("project_id,projects!inner(id,name,company_id)").eq("company_id", activeCompanyId).eq("projects.company_id", activeCompanyId).eq("user_id", actorId).or("is_active.is.null,is_active.eq.true");
      if (error) throw error;
      return [...new Map((data || []).filter(item => item.projects).map(item => [item.project_id, item.projects])).values()];
    } 
  });
  const projects = projectsQuery.data || [];

  // 2. Fetch My Daily Logs
  const logsQuery = useQuery({
    queryKey: ["daily_logs_mine", activeCompanyId, actorId],
    enabled: identityReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_daily_logs")
        .select("id,company_id,project_id,user_id,date,weather,summary,blockers,safety_concerns,materials_used,photos,category,weather_delay,safety_status,blocker_status,created_at")
        .eq("company_id", activeCompanyId)
        .eq("user_id", actorId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });
  const logs = logsQuery.data || [];

  // 3. Create Mutation
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      if (!identityReady) throw new Error("Your company profile is unavailable. Sign in again before submitting a log.");
      if (!projects.some(project => project.id === payload.project_id)) throw new Error("Choose a project currently assigned to you.");
      const dbPayload = {
        company_id: activeCompanyId,
        user_id: actorId,
        project_id: payload.project_id, // Directly pass the selected project ID
        date: payload.date,
        weather: payload.weather,
        category: payload.category || "General",
        weather_delay: !!payload.weather_delay,
        summary: payload.summary,
        blockers: payload.blockers || null,
        safety_concerns: payload.safety_concerns || null,
        materials_used: payload.materials_used || null,
        photos: payload.photos || []
      };

      const { data, error } = await supabase.from("project_daily_logs").insert([dbPayload]).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("The project note was not saved. Refresh Project Notes and try again.");
      return data[0];
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["daily_logs_mine"] }); 
      setOpen(false); 
      setForm(defaultForm);
      toast.success("Project note submitted successfully!"); 
    },
    onError: (err) => {
      console.error("Save Error:", err);
      toast.error(err.message || "Could not save the daily log. Please retry.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!identityReady) throw new Error("Your company profile is unavailable. Sign in again before deleting a note.");
      const { data, error } = await supabase
        .from("project_daily_logs")
        .delete()
        .eq("company_id", activeCompanyId)
        .eq("user_id", actorId)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("This project note changed or is no longer available. Refresh Project Notes and try again.");
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["daily_logs_mine"] });
      setSelectedLog(current => current?.id === id ? null : current);
      toast.success("Project note deleted.");
    },
    onError: error => toast.error(error.message || "Could not delete the project note. Please retry."),
  });

  // 4. Photo Uploader
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (!identityReady) {
      e.target.value = "";
      toast.error("Your employee profile is unavailable. Sign in again before uploading photos.");
      return;
    }
    if (form.photos.length + files.length > MAX_LOG_PHOTOS) {
      e.target.value = "";
      toast.error(`Attach up to ${MAX_LOG_PHOTOS} photos to one project note.`);
      return;
    }
    const invalidType = files.find(file => !LOG_PHOTO_EXTENSIONS.has(String(file.type || "").toLowerCase()));
    if (invalidType) {
      e.target.value = "";
      toast.error("Upload JPG, PNG, WebP, HEIC, or HEIF photos only.");
      return;
    }
    const invalidSize = files.find(file => file.size <= 0 || file.size > MAX_LOG_PHOTO_BYTES);
    if (invalidSize) {
      e.target.value = "";
      toast.error("Each site photo must be smaller than 10 MB.");
      return;
    }

    setUploading(true);
    const urls = [...form.photos];
    
    try {
      for (const file of files) {
        const mimeType = String(file.type).toLowerCase();
        const fileExt = LOG_PHOTO_EXTENSIONS.get(mimeType);
        const uploadId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const filePath = `${activeCompanyId}/${actorId}/${uploadId}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage.from('daily_logs').upload(filePath, file, { cacheControl: '3600', contentType: mimeType, upsert: false });
        if (uploadError) throw uploadError;
        
        const { data } = supabase.storage.from('daily_logs').getPublicUrl(filePath);
        if (!data?.publicUrl) throw new Error("A photo was uploaded but its link could not be created.");
        urls.push(data.publicUrl);
      }
      setForm(previous => ({ ...previous, photos: urls }));
      toast.success(`${files.length} photo(s) uploaded!`);
    } catch (err) {
      console.error("Upload Error:", err);
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removePhoto = (indexToRemove) => {
    setForm({ ...form, photos: form.photos.filter((_, i) => i !== indexToRemove) });
  };

  const isLoading = logsQuery.isLoading || projectsQuery.isLoading;
  const loadError = logsQuery.error || projectsQuery.error;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>Project Notes could not be loaded. Check your connection and try again.</p>
        <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => { projectsQuery.refetch(); logsQuery.refetch(); }}>Retry</Button>
      </div>
    );
  }

  // --- RENDER TABLE ROW ---
  const renderLogRow = (log) => {
    const proj = projects.find(p => p.id === log.project_id);
    const photoCount = log.photos?.length || 0;
    
    return (
      <tr key={log.id} className="border-b last:border-0 border-slate-100 hover:bg-slate-50 transition-colors">
        <td className="px-4 py-3 align-middle whitespace-nowrap">
          <span className="font-black text-slate-900">{log.date}</span>
        </td>

        <td className="px-4 py-3 align-middle min-w-[180px]">
          <div className="flex flex-col items-start gap-1.5">
            {proj ? (
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] uppercase tracking-wider">
                {proj.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-slate-500 border-slate-200 text-[10px] uppercase tracking-wider">
                Old General Note
              </Badge>
            )}
            {log.weather && (
              <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                <CloudSun className="h-3 w-3" /> {log.weather}
              </span>
            )}
          </div>
        </td>

        <td className="px-4 py-3 align-middle min-w-[250px] w-full">
          <p className="text-sm font-medium text-slate-700 truncate max-w-[250px] md:max-w-md">
            {log.summary}
          </p>
          <div className="flex gap-2 mt-1">
            {log.blockers && <span className="text-[10px] font-bold text-orange-600 uppercase">Issues Reported</span>}
            {log.safety_concerns && <span className="text-[10px] font-bold text-red-600 uppercase">Safety Incident</span>}
          </div>
        </td>

        <td className="px-4 py-3 align-middle text-center whitespace-nowrap">
          {photoCount > 0 ? (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs font-bold">
              <Camera className="h-3 w-3 mr-1" /> {photoCount}
            </Badge>
          ) : (
            <span className="text-xs text-slate-300 italic">—</span>
          )}
        </td>

        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSelectedLog(log)}
              className="text-slate-500 hover:text-amber-700 hover:bg-amber-50 font-bold"
            >
              <FileText className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Details</span>
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => { if(confirm("Delete this daily log?")) deleteMutation.mutate(log.id); }}
              className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
              disabled={deleteMutation.isPending}
              aria-label={`Delete project note from ${log.date}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-amber-500" /> Project Notes
          </h3>
          <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">
            {logs.length} Daily Field Logs
          </p>
        </div>
        <Button 
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
          onClick={() => setOpen(true)}
          disabled={!identityReady}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Submit New Log
        </Button>
      </div>

      <div className="space-y-4">
        {logs.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
            <BookOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">You haven't submitted any project notes yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">My Log History</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50/50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Summary</th>
                    <th className="px-4 py-3 text-center">Media</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(renderLogRow)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedLog && (
        <Dialog open={!!selectedLog} onOpenChange={(val) => !val && setSelectedLog(null)}>
          <DialogContent className="max-w-xl bg-white border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <div className="flex items-start justify-between pr-6 border-b border-slate-100 pb-4">
                <div>
                  <DialogTitle className="font-black text-2xl text-slate-900 mb-1">
                    Log: {selectedLog.date}
                  </DialogTitle>
                  <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
                    <CloudSun className="h-4 w-4" /> Weather: {selectedLog.weather || "Not recorded"}
                  </p>
                </div>
                {projects.find(p => p.id === selectedLog.project_id) && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 mt-1">
                    <Briefcase className="h-3.5 w-3.5 mr-1.5" />
                    {projects.find(p => p.id === selectedLog.project_id)?.name}
                  </Badge>
                )}
              </div>
            </DialogHeader>
            
            <div className="space-y-6 pt-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <AlignLeft className="h-4 w-4" /> Work Completed Today
                </h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {selectedLog.summary}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedLog.blockers && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500 flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="h-4 w-4" /> Issues / Delays
                    </h4>
                    <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 text-sm text-orange-900 whitespace-pre-wrap">
                      {selectedLog.blockers}
                    </div>
                  </div>
                )}
                {selectedLog.safety_concerns && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5 mb-2">
                      <ShieldAlert className="h-4 w-4" /> Safety Concerns
                    </h4>
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100 text-sm text-red-900 whitespace-pre-wrap">
                      {selectedLog.safety_concerns}
                    </div>
                  </div>
                )}
              </div>

              {selectedLog.materials_used && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <Hammer className="h-4 w-4" /> Materials Used
                  </h4>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700">
                    {selectedLog.materials_used}
                  </div>
                </div>
              )}

              {selectedLog.photos && selectedLog.photos.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <Camera className="h-4 w-4" /> Attached Photos ({selectedLog.photos.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {selectedLog.photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block group overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <img src={url} alt={`Log attachment ${i+1}`} className="w-full h-32 object-cover transition-transform group-hover:scale-105" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={open} onOpenChange={(val) => !val && setOpen(false)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-slate-50" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl">New Project Note</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</label>
                <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 bg-white font-medium" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Weather</label>
                <Select value={form.weather} onValueChange={v => setForm({ ...form, weather: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            
            <div>
              {/* THE FIX: Changed Label to indicate requirement and removed General Note option */}
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Project Location *</label>
              <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select a project..." /></SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <SelectItem value="none" disabled>No projects available</SelectItem>
                  ) : (
                    projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <DailyLogWorkflowFields value={form} onChange={setForm} disabled={createMutation.isPending} />
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed Today *</label>
              <Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={3} className="mt-1 bg-white" placeholder="Describe the work done..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-orange-600">Issues / Delays</label>
                <Textarea value={form.blockers} onChange={e => setForm({ ...form, blockers: e.target.value })} rows={2} className="mt-1 bg-white border-orange-200" placeholder="Any blockers?" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-red-600">Safety Concerns</label>
                <Textarea value={form.safety_concerns} onChange={e => setForm({ ...form, safety_concerns: e.target.value })} rows={2} className="mt-1 bg-white border-red-200" placeholder="Incidents/hazards?" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Materials Used</label>
              <Input value={form.materials_used} onChange={e => setForm({ ...form, materials_used: e.target.value })} className="mt-1 bg-white" placeholder="e.g., 5 bags concrete, 10 2x4s" />
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between mb-3">
                <span>Site Photos</span>
                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded">{form.photos.length} attached</span>
              </label>
              {form.photos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {form.photos.map((url, i) => (
                    <div key={i} className="relative group">
                      <img src={url} alt="Upload preview" className="h-14 w-14 object-cover rounded-lg border border-slate-300" />
                      <button onClick={() => removePhoto(i)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 px-3 py-4 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl cursor-pointer hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 transition-colors">
                {uploading ? (
                  <div className="h-5 w-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                ) : (
                  <>
                    <Camera className="h-5 w-5 text-slate-400 group-hover:text-amber-500" />
                    <span className="text-sm font-bold text-slate-600">Upload Photos</span>
                  </>
                )}
                <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
              </label>
            </div>
            <div className="flex gap-2 pt-4 border-t border-slate-200 mt-4">
              <Button variant="outline" className="flex-1 font-bold" onClick={() => setOpen(false)}>Cancel</Button>
              <Button 
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md shadow-amber-500/20" 
                onClick={() => createMutation.mutate(form)} 
                /* THE FIX: Disabled unless a specific project_id is actually selected */
                disabled={!identityReady || !form.summary || !form.project_id || form.project_id === "none" || uploading || createMutation.isPending}
              >
                {createMutation.isPending ? "Saving..." : "Submit Log"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
