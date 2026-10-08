import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { 
  HardHat, AlertTriangle, CloudSun, ShieldAlert, FileText,
  Camera, X, Hammer, Briefcase, AlignLeft, Maximize2, ChevronLeft, ChevronRight,
  MoreVertical, Eye, Edit, Trash2, ChevronDown, ChevronUp
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem 
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

const WEATHER = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Hot", "Cold"];

export default function DashboardNotes({ openSubmitModal, setOpenSubmitModal }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  // --- MODAL & FORM STATES ---
  const [localOpenSubmit, setLocalOpenSubmit] = useState(false);
  const [isFeedCollapsed, setIsFeedCollapsed] = useState(false);
  
  // Tie the internal modal open state to the prop if provided, else use local state
  const openSubmit = openSubmitModal !== undefined ? openSubmitModal : localOpenSubmit;
  const setOpenSubmit = setOpenSubmitModal || setLocalOpenSubmit;
  
  const [selectedViewLog, setSelectedViewLog] = useState(null);
  const [lightbox, setLightbox] = useState({ isOpen: false, photos: [], index: 0 });
  const [uploading, setUploading] = useState(false);
  
  const defaultForm = { 
    id: null,
    date: format(new Date(), "yyyy-MM-dd"), 
    project_id: "none", 
    client_id: "none", 
    lead_id: "none", 
    summary: "", 
    blockers: "", 
    safety_concerns: "", 
    materials_used: "", 
    weather: "Sunny", 
    photos: [] 
  };
  const [form, setForm] = useState(defaultForm);

  // --- QUERIES ---
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("projects").select("id, name, client_id").eq("company_id", companyId); return data || []; } 
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], enabled: !!companyId,
    queryFn: async () => { const { data, error } = await supabase.from("clients").select("id, name, first_name, surname").eq("company_id", companyId); if(error) throw error; return data || []; } 
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

  const { data: recentLogs = [], isLoading } = useQuery({
    queryKey: ["project_daily_logs", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_daily_logs").select("*").eq("company_id", companyId).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(15); 
      if (error) throw error; return data || [];
    }
  });

  // --- MUTATIONS ---
  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const dbPayload = {
        company_id: companyId, 
        user_id: profile.id, 
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
      
      const { data, error } = payload.id 
        ? await supabase.from("project_daily_logs").update(dbPayload).eq("id", payload.id).select().single()
        : await supabase.from("project_daily_logs").insert([dbPayload]).select().single();
        
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
          const newPhotos = [...new Set([...existingPhotos, ...payload.photos])]; // Prevent duplicates
          await supabase.from("leads").update({ photos: newPhotos }).eq("id", targetLeadId);
        }

        // Add to Client (via Attachments table)
        if (targetClientId) {
          const { data: existingAtt } = await supabase.from("attachments")
            .select("file_url")
            .eq("related_type", "Client")
            .eq("related_id", targetClientId);
          const existingUrls = existingAtt?.map(a => a.file_url) || [];
          
          const newAttachments = payload.photos
            .filter(url => !existingUrls.includes(url)) // Prevent duplicates
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

      return data;
    },
    onSuccess: (data, variables) => { 
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] }); 
      setOpenSubmit(false); 
      setForm(defaultForm);
      toast.success(variables.id ? "Note updated successfully!" : "Project note submitted successfully!"); 
    },
    onError: (err) => toast.error(`Failed to save note: ${err.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_daily_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      toast.success("Note deleted successfully.");
    },
    onError: (err) => toast.error(`Failed to delete note: ${err.message}`)
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

  const nextPhoto = (e) => {
    e.stopPropagation();
    setLightbox(prev => ({ ...prev, index: Math.min(prev.index + 1, prev.photos.length - 1) }));
  };

  const prevPhoto = (e) => {
    e.stopPropagation();
    setLightbox(prev => ({ ...prev, index: Math.max(prev.index - 1, 0) }));
  };

  const handleEditClick = (log) => {
    setForm({
      id: log.id,
      date: log.date || format(new Date(), "yyyy-MM-dd"),
      project_id: log.project_id || "none",
      client_id: log.client_id || "none",
      lead_id: log.lead_id || "none",
      summary: log.summary || "",
      blockers: log.blockers || "",
      safety_concerns: log.safety_concerns || "",
      materials_used: log.materials_used || "",
      weather: log.weather || "Sunny",
      photos: log.photos || []
    });
    setOpenSubmit(true);
  };

  // --- MAPS ---
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name || `${c.first_name || ''} ${c.surname || ''}`.trim()]));
  const leadMap = Object.fromEntries(leads.map(l => [l.id, l.contact_name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.full_name || u.email]));

  const getNoteTitle = (log) => {
    if (log.project_id && projectMap[log.project_id]) {
      const project = projectMap[log.project_id];
      const clientName = clientMap[project.client_id];
      return clientName ? `${project.name} - ${clientName}` : project.name;
    }
    if (log.client_id && clientMap[log.client_id]) return clientMap[log.client_id];
    if (log.lead_id && leadMap[log.lead_id]) return leadMap[log.lead_id];
    return "General Update";
  };

  return (
    <>
      <Card className={`flex flex-col border-slate-200 shadow-sm bg-white overflow-hidden relative md:h-full ${isFeedCollapsed ? '' : 'h-full'}`}>
        
        {/* HEADER */}
        <div 
          className="p-5 md:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 cursor-pointer md:cursor-default hover:bg-slate-100/50 md:hover:bg-slate-50/50 transition-colors"
          onClick={() => setIsFeedCollapsed(!isFeedCollapsed)}
        >
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <HardHat className="h-5 w-5 text-amber-500" /> Recent Daily Logs
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1">Updates from the job sites</p>
          </div>
          
          {/* Toggle Icon (Hidden on Desktop) */}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-700 md:hidden pointer-events-none">
            {isFeedCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
          </Button>
        </div>

        {/* FEED CONTENT & FOOTER */}
        <div className={`${isFeedCollapsed ? 'hidden md:flex' : 'flex'} flex-col flex-1 min-h-0`}>
          <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-10"><div className="h-6 w-6 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div></div>
            ) : recentLogs.length === 0 ? (
              <div className="text-center py-10">
                <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-700">No field logs submitted yet.</p>
                <p className="text-xs text-slate-500 mt-1">When your crew submits daily logs, they will appear here.</p>
              </div>
            ) : (
              recentLogs.map((log) => {
                const hasBlocker = log.blockers && log.blockers.trim().length > 0;
                const hasSafety = log.safety_concerns && log.safety_concerns.trim().length > 0;
                const hasPhotos = log.photos && log.photos.length > 0;
                const logDate = log.date ? parseISO(log.date) : parseISO(log.created_at);

                return (
                  <div key={log.id} className="relative pl-4 border-l-2 border-slate-200 pb-2 group">
                    {/* Timeline Dot */}
                    <div className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full border-4 border-white ${hasBlocker || hasSafety ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    
                    {/* Clickable Feed Card */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer relative">
                      
                      {/* Meta Data */}
                      <div className="flex items-start justify-between mb-2 pr-8" onClick={() => setSelectedViewLog(log)}>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">
                            {getNoteTitle(log)}
                          </h4>
                          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mt-0.5">
                            {format(logDate, "MMM d, yyyy")} • By {userMap[log.user_id] || "Unknown User"}
                          </p>
                        </div>
                        {log.weather && (
                          <div className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded-md border border-slate-100 shadow-sm" title="Weather">
                            <CloudSun className="h-3 w-3 text-amber-500" /> {log.weather}
                          </div>
                        )}
                      </div>

                      {/* Summary */}
                      <p className="text-sm text-slate-700 line-clamp-2" onClick={() => setSelectedViewLog(log)}>
                        {log.summary || <span className="italic text-slate-400">No summary provided.</span>}
                      </p>

                      {/* Visual Photo Thumbnails directly on Dashboard */}
                      {hasPhotos && (
                        <div className="flex gap-2 mt-3 pt-2">
                          {log.photos.slice(0, 3).map((url, i) => (
                            <div 
                              key={i} 
                              onClick={(e) => { e.stopPropagation(); setLightbox({ isOpen: true, photos: log.photos, index: i }); }}
                              className="h-12 w-12 rounded-md overflow-hidden border border-slate-200 shadow-sm bg-white hover:opacity-80 transition-opacity"
                            >
                              <img src={url} alt="Thumbnail" className="h-full w-full object-cover" />
                            </div>
                          ))}
                          {log.photos.length > 3 && (
                            <div 
                              onClick={(e) => { e.stopPropagation(); setLightbox({ isOpen: true, photos: log.photos, index: 3 }); }}
                              className="h-12 w-12 rounded-md bg-slate-200 border border-slate-300 flex items-center justify-center text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-300 transition-colors"
                            >
                              +{log.photos.length - 3}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Badges for Blockers / Safety */}
                      {(hasBlocker || hasSafety) && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-200/60" onClick={() => setSelectedViewLog(log)}>
                          {hasBlocker && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-1 rounded-md">
                              <AlertTriangle className="h-3 w-3" /> BLOCKER
                            </div>
                          )}
                          {hasSafety && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded-md">
                              <ShieldAlert className="h-3 w-3" /> SAFETY CONCERN
                            </div>
                          )}
                        </div>
                      )}

                      {/* ⚡ ALWAYS VISIBLE ACTION MENU */}
                      <div className="absolute right-2 top-3 opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                              <MoreVertical className="h-4 w-4 text-slate-500" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => setSelectedViewLog(log)}>
                              <Eye className="h-4 w-4 mr-2" /> View Full Note
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEditClick(log)}>
                              <Edit className="h-4 w-4 mr-2" /> Edit Note
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => {
                              if(window.confirm("Are you sure you want to delete this note?")) {
                                deleteMutation.mutate(log.id);
                              }
                            }}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete Note
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          {/* FOOTER */}
          {recentLogs.length > 0 && (
            <div className="p-4 border-t border-slate-100 bg-slate-50 text-center">
              <Button variant="link" size="sm" className="text-slate-500 hover:text-slate-900" onClick={() => navigate('/DailyLogs')}>
                View All Field Logs
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* --- QUICK VIEW DETAILS MODAL --- */}
      {selectedViewLog && (
        <Dialog open={!!selectedViewLog} onOpenChange={() => setSelectedViewLog(null)}>
          <DialogContent className="max-w-xl bg-slate-50 border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader className="min-h-12 pr-24 text-left">
              <div className="flex flex-col items-start gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:justify-between">
                <div>
                  <DialogTitle className="font-black text-2xl text-slate-900 mb-1">
                    Log: {selectedViewLog.date}
                  </DialogTitle>
                  <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
                    <CloudSun className="h-4 w-4" /> Weather: {selectedViewLog.weather || "Not recorded"}
                  </p>
                </div>
                
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 mt-1 shadow-sm text-right max-w-[200px]">
                  <Briefcase className="h-3.5 w-3.5 mr-1.5 inline-block" />
                  <span className="truncate align-middle">{getNoteTitle(selectedViewLog)}</span>
                </Badge>
              </div>
            </DialogHeader>
            
            <div className="space-y-6 pt-2 pb-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <AlignLeft className="h-4 w-4" /> Work Completed Today
                </h4>
                <div className="bg-white p-4 rounded-xl border border-slate-200 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap shadow-sm">
                  {selectedViewLog.summary || <span className="italic text-slate-400">No summary provided.</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-orange-500 flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="h-4 w-4" /> Issues / Delays
                  </h4>
                  <div className={`p-3 rounded-xl border text-sm whitespace-pre-wrap shadow-sm ${selectedViewLog.blockers ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-slate-100/50 border-slate-200 text-slate-400 italic'}`}>
                    {selectedViewLog.blockers || "None recorded"}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5 mb-2">
                    <ShieldAlert className="h-4 w-4" /> Safety Concerns
                  </h4>
                  <div className={`p-3 rounded-xl border text-sm whitespace-pre-wrap shadow-sm ${selectedViewLog.safety_concerns ? 'bg-red-50 border-red-200 text-red-900' : 'bg-slate-100/50 border-slate-200 text-slate-400 italic'}`}>
                    {selectedViewLog.safety_concerns || "None recorded"}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <Hammer className="h-4 w-4" /> Materials Used
                </h4>
                <div className={`p-3 rounded-xl border text-sm shadow-sm ${selectedViewLog.materials_used ? 'bg-white border-slate-200 font-medium text-slate-700' : 'bg-slate-100/50 border-slate-200 text-slate-400 italic'}`}>
                  {selectedViewLog.materials_used || "None recorded"}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <Camera className="h-4 w-4" /> Attached Photos
                </h4>
                {selectedViewLog.photos && selectedViewLog.photos.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {selectedViewLog.photos.map((url, i) => (
                      <div 
                        key={i} 
                        onClick={() => setLightbox({ isOpen: true, photos: selectedViewLog.photos, index: i })} 
                        className="relative block group overflow-hidden rounded-xl border border-slate-200 bg-white cursor-pointer shadow-sm"
                      >
                        <img src={url} alt={`Log attachment ${i+1}`} className="w-full h-32 object-cover transition-transform group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <Maximize2 className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md h-6 w-6" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-100/50 border border-slate-200 p-3 rounded-xl text-sm text-slate-400 italic shadow-sm">
                    No photos attached
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* --- UPGRADED FULLSCREEN IMAGE LIGHTBOX GALLERY --- */}
      {lightbox.isOpen && lightbox.photos.length > 0 && (
        <div 
          className="fixed inset-0 z-[270] bg-slate-950/98 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200"
          onClick={() => setLightbox({ isOpen: false, photos: [], index: 0 })}
        >
          <button 
            className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/50 hover:text-white bg-black/20 hover:bg-black/50 rounded-full p-3 transition-all"
            onClick={(e) => { e.stopPropagation(); setLightbox({ isOpen: false, photos: [], index: 0 }); }}
          >
            <X className="h-6 w-6 sm:h-8 sm:w-8" />
          </button>
          {lightbox.index > 0 && (
            <button 
              className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/50 hover:text-white bg-black/20 hover:bg-black/50 rounded-full p-2 sm:p-4 transition-all"
              onClick={prevPhoto}
            >
              <ChevronLeft className="h-8 w-8 sm:h-10 sm:w-10" />
            </button>
          )}
          <img 
            src={lightbox.photos[lightbox.index]} 
            alt={`Field photo ${lightbox.index + 1}`} 
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-300" 
            onClick={(e) => e.stopPropagation()} 
          />
          {lightbox.index < lightbox.photos.length - 1 && (
            <button 
              className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/50 hover:text-white bg-black/20 hover:bg-black/50 rounded-full p-2 sm:p-4 transition-all"
              onClick={nextPhoto}
            >
              <ChevronRight className="h-8 w-8 sm:h-10 sm:w-10" />
            </button>
          )}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/40 text-white font-bold text-sm tracking-widest px-4 py-2 rounded-full">
            {lightbox.index + 1} / {lightbox.photos.length}
          </div>
        </div>
      )}

      {/* --- SUBMIT / EDIT LOG FORM MODAL --- */}
      <Dialog open={openSubmit} onOpenChange={(val) => {
        if (!val) {
          setOpenSubmit(false);
          setForm(defaultForm);
        }
      }}>
        <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50" aria-describedby={undefined}>
          <DialogHeader className="min-h-12 pr-24 text-left"><DialogTitle className="font-black text-xl">{form.id ? "Edit Note/Photo" : "New Note/Photo"}</DialogTitle></DialogHeader>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Project</label>
                <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="No Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium">{p.name}</span>
                          {clientMap[p.client_id] && (
                            <span className="text-[10px] text-slate-400 font-normal leading-none mt-1">
                              {clientMap[p.client_id]}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Client</label>
                <Select disabled={(form.project_id !== "none" && !!form.project_id) || (form.lead_id !== "none" && !!form.lead_id)} value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger className={`mt-1 font-medium ${(form.project_id !== "none" && !!form.project_id) || (form.lead_id !== "none" && !!form.lead_id) ? "bg-slate-50 opacity-60" : "bg-white"}`}>
                    <SelectValue placeholder="No Client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name || `${c.first_name || ''} ${c.surname || ''}`.trim()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Lead</label>
                <Select disabled={(form.project_id !== "none" && !!form.project_id) || (form.client_id !== "none" && !!form.client_id)} value={form.lead_id} onValueChange={v => setForm({ ...form, lead_id: v })}>
                  <SelectTrigger className={`mt-1 font-medium ${(form.project_id !== "none" && !!form.project_id) || (form.client_id !== "none" && !!form.client_id) ? "bg-slate-50 opacity-60" : "bg-white"}`}>
                    <SelectValue placeholder="No Lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.contact_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed / Note *</label>
              <Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={3} className="mt-1 bg-white min-h-[100px]" placeholder="Describe the work done or details..." />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Issues / Delays</label>
                <Textarea value={form.blockers} onChange={e => setForm({ ...form, blockers: e.target.value })} rows={2} className="mt-1 bg-white border-orange-200 min-h-[60px]" placeholder="Any blockers?" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Safety Concerns</label>
                <Textarea value={form.safety_concerns} onChange={e => setForm({ ...form, safety_concerns: e.target.value })} rows={2} className="mt-1 bg-white border-red-200 min-h-[60px]" placeholder="Incidents/hazards?" />
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
              <Button type="button" variant="outline" className="font-bold w-full sm:w-auto order-2 sm:order-1" onClick={() => { setOpenSubmit(false); setForm(defaultForm); }}>Cancel</Button>
              <Button 
                className="bg-black hover:bg-slate-900 text-white font-black shadow-md w-full sm:w-auto order-1 sm:order-2" 
                onClick={() => saveMutation.mutate(form)} 
                disabled={!form.summary || uploading || saveMutation.isPending || (form.project_id === "none" && form.client_id === "none" && form.lead_id === "none")}
              >
                {saveMutation.isPending ? "Saving..." : (form.id ? "Update Note" : "Submit Project Note and Photo")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
