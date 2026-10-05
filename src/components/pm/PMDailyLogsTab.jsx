import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { BookOpen, CloudSun, Users, AlertTriangle, ChevronRight, Image as ImageIcon, Calendar, Pencil, Trash2, Hammer, ShieldAlert, Plus, X, Loader2 } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import DailyLogWorkflowFields from "@/components/pm/DailyLogWorkflowFields";

const WEATHER = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Hot", "Cold"];

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

export default function PMDailyLogsTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  
  const [selectedLog, setSelectedLog] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  
  const [createOpen, setCreateOpen] = useState(false);
  const defaultCreateForm = {
    date: format(new Date(), "yyyy-MM-dd"),
    weather: "",
    category: "Work Completed",
    weather_delay: false,
    safety_status: "Open",
    blocker_status: "Open",
    crew_on_site: "",
    summary: "",
    blockers: "",
    safety_concerns: "",
    materials_used: ""
  };
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  // 👇 ADD THIS UPLOAD LOGIC 👇
  const [isUploading, setIsUploading] = useState(false);

  const handlePhotoUpload = async (e, formState, setFormState) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setIsUploading(true);
    const uploadedUrls = [];

    try {
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `daily-logs/${project.id}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

        // 🚨 Make sure your Supabase bucket is named "project_files" (or change it here)
        const { error: uploadError } = await supabase.storage
          .from("project_files")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from("project_files")
          .getPublicUrl(fileName);

        uploadedUrls.push(data.publicUrl);
      }

      setFormState({
        ...formState,
        photos: [...(formState.photos || []), ...uploadedUrls]
      });
      toast.success("Photos attached successfully!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(`Failed to upload photos: ${error.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = null; // Clear input so you can upload the same file again if needed
    }
  };

  const removePhoto = (index, formState, setFormState) => {
    const newPhotos = [...(formState.photos || [])];
    newPhotos.splice(index, 1);
    setFormState({ ...formState, photos: newPhotos });
  };
  // 👆 END OF UPLOAD LOGIC 👆

  // --- FINAL BULLETPROOF FETCH WITH SECURE LOOKUP ---
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["project_daily_logs", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const companyId = profile?.company_id || project?.company_id;

      // 1. Fetch the logs for this specific project
      const { data: logsData, error: logsError } = await supabase
        .from("project_daily_logs")
        .select("*")
        .eq("project_id", project.id)
        .order("date", { ascending: false });
        
      if (logsError) {
        console.error("PM Fetch Error:", logsError.message);
        return [];
      }

      if (!logsData || logsData.length === 0) return [];

      // 2. Securely fetch user names by passing the company_id to bypass RLS blocks
      let allUsers = [];
      if (companyId) {
        const { data: usersData } = await supabase.from("users").select("id, full_name, email").eq("company_id", companyId);
        const { data: profilesData } = await supabase.from("profiles").select("id, full_name").eq("company_id", companyId);
        allUsers = [...(usersData || []), ...(profilesData || [])];
      }

      // 3. Attach the real name to each log
      return logsData.map(log => {
        const author = allUsers.find(u => u.id === log.user_id);
        return {
          ...log,
          employee_name: author ? (author.full_name || author.email || "Unnamed User") : "Unknown Employee"
        };
      });
    },
  });

  // --- SUPABASE MUTATIONS ---
  // 3. Create Mutation
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const dbPayload = {
        // 👇 Fixed: Now pulling securely from the payload
        company_id: payload.company_id, 
        user_id: payload.user_id,
        project_id: payload.project_id, 
        date: payload.date,
        weather: payload.weather,
        category: payload.category || "General",
        weather_delay: !!payload.weather_delay,
        safety_status: payload.safety_status || "Open",
        blocker_status: payload.blocker_status || "Open",
        // 👇 Fixed: Added the missing crew_on_site field
        crew_on_site: payload.crew_on_site || null,
        summary: payload.summary,
        blockers: payload.blockers || null,
        safety_concerns: payload.safety_concerns || null,
        materials_used: payload.materials_used || null,
        photos: payload.photos || []
      };

      const { data, error } = await supabase.from("project_daily_logs").insert([dbPayload]);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      setCreateOpen(false);
      setCreateForm(defaultCreateForm);
      toast.success("Project note added successfully!");
    },
    onError: (err) => toast.error(`Failed to add note: ${err.message}`)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Strip out the custom employee_name field before updating the database
      const { employee_name, ...cleanData } = data; 
      const { error } = await supabase.from("project_daily_logs").update(cleanData).eq("id", id);
      if (error) throw error;
      return data; 
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      setSelectedLog(updated);
      setEditOpen(false);
      toast.success("Project note updated successfully");
    },
    onError: (err) => toast.error(`Failed to update note: ${err.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_daily_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      setSelectedLog(null); 
      toast.success("Project note permanently deleted!");
    },
    onError: (err) => toast.error(`Failed to delete note: ${err.message}`)
  });

  const openEdit = (log) => {
    setEditForm({ ...log });
    setEditOpen(true);
  };

  const handleCreate = () => {
    if (!createForm.date) {
      toast.error("Date is required");
      return;
    }
    createMutation.mutate({
      ...createForm,
      project_id: project.id,
      company_id: profile?.company_id || project?.company_id,
      user_id: profile?.id
    });
  };

  const handleSave = () => {
    if (!editForm.date) {
      toast.error("Date is required");
      return;
    }
    updateMutation.mutate({ id: editForm.id, data: editForm });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 flex flex-col md:flex-row gap-6 max-w-7xl mx-auto h-[calc(100vh-140px)]">
      
      {/* LEFT COLUMN: LOG LIST */}
      <div className="w-full md:w-80 shrink-0 flex flex-col h-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><BookOpen className="h-4 w-4 text-blue-500" /> Site Diary</h3>
            <Button 
  size="sm" 
  onClick={() => { setCreateForm(defaultCreateForm); setCreateOpen(true); }} 
  className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold text-xs h-7 px-2"
>
  <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
</Button>
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{logs.length} entries recorded</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-4 text-center">
              <BookOpen className="h-8 w-8 mb-2 opacity-30 text-blue-500" />
              <p className="font-medium text-slate-600 text-sm">No notes yet</p>
            </div>
          ) : (
            logs.map(log => {
              const dateObj = safeParseDate(log.date);
              
              return (
                <button
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                    selectedLog?.id === log.id
                      ? "bg-amber-50 border-amber-200 shadow-sm"
                      : "bg-white border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Calendar className={`h-4 w-4 shrink-0 ${selectedLog?.id === log.id ? 'text-amber-600' : 'text-slate-400'}`} />
                      <span className={`text-sm font-bold ${selectedLog?.id === log.id ? 'text-amber-900' : 'text-slate-700'}`}>
                        {dateObj ? format(dateObj, "MMM d, yyyy") : "No Date"}
                      </span>
                    </div>
                    <ChevronRight className={`h-4 w-4 ${selectedLog?.id === log.id ? 'text-amber-500' : 'text-slate-300'}`} />
                  </div>
                  
                  {log.summary && (
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mt-1">{log.summary}</p>
                  )}
                  
                  <div className="flex items-center gap-2 mt-2">
                    {log.weather && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        <CloudSun className="h-3 w-3" />{log.weather}
                      </span>
                    )}
                    <span className="text-[10px] font-medium text-slate-400 truncate border-l border-slate-200 pl-2">
                      By {log.employee_name}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: LOG DETAIL VIEW */}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        {selectedLog ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
            
            {/* Detail Header */}
            <div className="flex flex-wrap items-center justify-between border-b border-slate-100 p-5 bg-slate-50/30 shrink-0 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center border border-blue-200 shrink-0">
                  <BookOpen className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {safeParseDate(selectedLog.date) ? format(safeParseDate(selectedLog.date), "EEEE, MMMM d, yyyy") : "Project Note"}
                  </h2>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">
                    Logged by <span className="font-bold text-slate-700">{selectedLog.employee_name}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(selectedLog)} className="font-bold text-slate-600 hover:text-amber-700 hover:bg-amber-50 focus-visible:text-amber-700 focus-visible:bg-amber-50 focus-visible:ring-amber-600 border-slate-200">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                {/* HIGH VISIBILITY DELETE BUTTON */}
                <Button size="sm" variant="destructive" className="font-bold shadow-md bg-red-600 hover:bg-red-700 text-white"
                  disabled={deleteMutation.isPending}
                  onClick={() => { if (window.confirm("Are you sure you want to permanently delete this log?")) deleteMutation.mutate(selectedLog.id); }}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> {deleteMutation.isPending ? "Deleting..." : "Delete Log"}
                </Button>
              </div>
            </div>

            {/* Detail Content (Scrollable) */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedLog.weather && (
                  <div className="flex items-start gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <CloudSun className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Weather Conditions</p>
                      <p className="text-sm font-black text-slate-700">{selectedLog.weather}</p>
                    </div>
                  </div>
                )}
                {selectedLog.crew_on_site && (
                  <div className="flex items-start gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <Users className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Crew on Site</p>
                      <p className="text-sm font-black text-slate-700">{selectedLog.crew_on_site}</p>
                    </div>
                  </div>
                )}
              </div>

              {selectedLog.summary && (
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2 border-b border-slate-100 pb-1.5">Work Completed Today</p>
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-medium">{selectedLog.summary}</p>
                </div>
              )}

              {selectedLog.materials_used && (
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2 border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                    <Hammer className="h-3.5 w-3.5" /> Materials Used
                  </p>
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-100">{selectedLog.materials_used}</p>
                </div>
              )}

              {selectedLog.blockers && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-800 font-black uppercase tracking-wider">Issues / Delays</p>
                  </div>
                  <p className="text-sm text-orange-900 whitespace-pre-wrap font-medium">{selectedLog.blockers}</p>
                </div>
              )}

              {selectedLog.safety_concerns && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" />
                    <p className="text-xs text-red-800 font-black uppercase tracking-wider">Safety Concerns / Incidents</p>
                  </div>
                  <p className="text-sm text-red-900 whitespace-pre-wrap font-medium">{selectedLog.safety_concerns}</p>
                </div>
              )}

              {selectedLog.photos?.length > 0 && (
                <div className="pt-2">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-blue-500" /> Attached Media ({selectedLog.photos.length})
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {selectedLog.photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all group bg-slate-50">
                        <img src={url} alt={`Site Photo ${i + 1}`} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-white rounded-xl border border-slate-200 shadow-sm m-0 md:m-0">
            <BookOpen className="h-16 w-16 mb-4 text-slate-200" />
            <p className="text-base font-bold text-slate-500">Select a note to view details</p>
            <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Choose from the list on the left</p>
          </div>
        )}
      </div>

      {/* CREATE DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-xl max-h-[90vh] overflow-y-auto bg-slate-50">
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2"><Plus className="h-5 w-5 text-blue-600"/> Add Daily Log</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <DailyLogWorkflowFields value={createForm} onChange={setCreateForm} canReview disabled={createMutation.isPending} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date *</Label>
                <Input type="date" className="mt-1 bg-white font-medium" value={createForm.date || ""} onChange={e => setCreateForm({ ...createForm, date: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Weather</Label>
                <Select value={createForm.weather || ""} onValueChange={v => setCreateForm({ ...createForm, weather: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Crew on Site</Label>
              <Input className="mt-1 bg-white font-medium" placeholder="E.g. John, Mike, Sarah (or total count)" value={createForm.crew_on_site || ""} onChange={e => setCreateForm({ ...createForm, crew_on_site: e.target.value })} />
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed Today</Label>
              <Textarea className="mt-1 bg-white font-medium" rows={3} placeholder="Describe the work done..." value={createForm.summary || ""} onChange={e => setCreateForm({ ...createForm, summary: e.target.value })} />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-orange-600">Issues / Delays</Label>
                <Textarea className="mt-1 bg-white border-orange-200" rows={2} placeholder="Any blockers?" value={createForm.blockers || ""} onChange={e => setCreateForm({ ...createForm, blockers: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-red-600">Safety Concerns</Label>
                <Textarea className="mt-1 bg-white border-red-200" rows={2} placeholder="Any incidents?" value={createForm.safety_concerns || ""} onChange={e => setCreateForm({ ...createForm, safety_concerns: e.target.value })} />
              </div>
            </div>
            
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Materials Used</Label>
              <Input className="mt-1 bg-white font-medium" placeholder="E.g. 5 sheets of drywall" value={createForm.materials_used || ""} onChange={e => setCreateForm({ ...createForm, materials_used: e.target.value })} />
            </div>
            
            <div className="flex gap-2 pt-4 border-t border-slate-200 mt-4">
              <Button variant="outline" className="flex-1 font-bold" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md focus-visible:ring-amber-600" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Add Log"}
              </Button>
            </div>
            {/* 👇 NEW UPLOAD FIELD 👇 */}
            <div className="pt-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Attach Site Photos
              </Label>
              <Input 
                type="file" 
                accept="image/*" 
                multiple 
                disabled={isUploading}
                onChange={(e) => handlePhotoUpload(e, createForm, setCreateForm)}
                className="bg-white font-medium cursor-pointer file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber-500 file:text-slate-900 hover:file:bg-amber-600 focus-visible:ring-amber-600"
              />
              
              {isUploading && (
                <div className="flex items-center gap-2 mt-2 text-xs font-bold text-blue-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading photos...
                </div>
              )}

              {createForm.photos?.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {createForm.photos.map((url, i) => (
                    <div key={i} className="relative group">
                      <img src={url} alt="Upload preview" className="h-16 w-16 object-cover rounded-lg border border-slate-200 shadow-sm" />
                      <button 
                        type="button" 
                        onClick={() => removePhoto(i, createForm, setCreateForm)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      {editForm && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-xl max-h-[90vh] overflow-y-auto bg-slate-50">
            <DialogHeader><DialogTitle className="text-xl font-black text-slate-900">Edit Project Note</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</Label>
                  <Input type="date" className="mt-1 bg-white font-medium" value={editForm.date || ""} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Weather</Label>
                  <Select value={editForm.weather || ""} onValueChange={v => setEditForm({ ...editForm, weather: v })}>
                    <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Crew on Site</Label>
                <Input className="mt-1 bg-white font-medium" value={editForm.crew_on_site || ""} onChange={e => setEditForm({ ...editForm, crew_on_site: e.target.value })} />
              </div>

              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed Today</Label>
                <Textarea className="mt-1 bg-white font-medium" rows={3} value={editForm.summary || ""} onChange={e => setEditForm({ ...editForm, summary: e.target.value })} />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-orange-600">Issues / Delays</Label>
                  <Textarea className="mt-1 bg-white border-orange-200" rows={2} value={editForm.blockers || ""} onChange={e => setEditForm({ ...editForm, blockers: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-red-600">Safety Concerns</Label>
                  <Textarea className="mt-1 bg-white border-red-200" rows={2} value={editForm.safety_concerns || ""} onChange={e => setEditForm({ ...editForm, safety_concerns: e.target.value })} />
                </div>
              </div>
              
              <div>
                <DailyLogWorkflowFields value={editForm} onChange={setEditForm} canReview disabled={updateMutation.isPending} />
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Materials Used</Label>
                <Input className="mt-1 bg-white font-medium" value={editForm.materials_used || ""} onChange={e => setEditForm({ ...editForm, materials_used: e.target.value })} />
              </div>
              
              <div className="flex gap-2 pt-4 border-t border-slate-200 mt-4">
                <Button variant="outline" className="flex-1 font-bold" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md focus-visible:ring-amber-600" onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
              {/* 👇 NEW UPLOAD FIELD 👇 */}
            <div className="pt-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Attach Site Photos
              </Label>
              <Input 
                type="file" 
                accept="image/*" 
                multiple 
                disabled={isUploading}
                onChange={(e) => handlePhotoUpload(e, createForm, setCreateForm)}
                className="bg-white font-medium cursor-pointer file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber-500 file:text-slate-900 hover:file:bg-amber-600 focus-visible:ring-amber-600"
              />
              
              {isUploading && (
                <div className="flex items-center gap-2 mt-2 text-xs font-bold text-blue-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading photos...
                </div>
              )}

              {createForm.photos?.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {createForm.photos.map((url, i) => (
                    <div key={i} className="relative group">
                      <img src={url} alt="Upload preview" className="h-16 w-16 object-cover rounded-lg border border-slate-200 shadow-sm" />
                      <button 
                        type="button" 
                        onClick={() => removePhoto(i, createForm, setCreateForm)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
