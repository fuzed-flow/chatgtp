import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";
import { 
  MessageSquare, Pin, Clock, Send, Trash2, MoreVertical, Edit2, Phone, Mail, Users, AlertCircle, FolderOpen, Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import EmptyState from "@/components/shared/EmptyState";

// --- CATEGORY CONFIGURATION ---
const CATEGORIES = [
  { value: "General", label: "General", icon: MessageSquare, color: "text-slate-600 bg-slate-100 border-slate-200" },
  { value: "Email", label: "Email", icon: Mail, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { value: "Call", label: "Call", icon: Phone, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  { value: "Meeting", label: "Meeting", icon: Users, color: "text-purple-600 bg-purple-50 border-purple-200" },
  { value: "Issue", label: "Issue", icon: AlertCircle, color: "text-red-600 bg-red-50 border-red-200" },
];

export default function NotesFeed({ relatedType = "Project", relatedId = null, clientId = null }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  // --- NEW NOTE STATE ---
  const [newNote, setNewNote] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [category, setCategory] = useState("General");
  const [linkedProject, setLinkedProject] = useState("none");
  const [linkedClient, setLinkedClient] = useState("none");
  const [linkedLead, setLinkedLead] = useState("none");

  // --- EDIT NOTE STATE ---
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ summary: "", category: "General" });

  // Local Storage state for pinned notes tracking
  const [pinnedNoteIds, setPinnedNoteIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`pinned_notes_${relatedId || 'global'}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(`pinned_notes_${relatedId || 'global'}`, JSON.stringify(pinnedNoteIds));
  }, [pinnedNoteIds, relatedId]);

  // --- QUERIES ---
  const { data: projects = [] } = useQuery({
    queryKey: ["projects_lookup", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId);
      return data || [];
    }
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients_lookup", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name").eq("company_id", companyId);
      return data || [];
    }
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["leads_lookup", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, contact_name").eq("company_id", companyId);
      return data || [];
    }
  });

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes", companyId, relatedType, relatedId],
    enabled: !!companyId && !!relatedId,
    queryFn: async () => {
      let query = supabase
        .from("project_daily_logs")
        .select(`*, user:profiles!project_daily_logs_user_id_fkey(id, full_name)`)
        .eq("company_id", companyId);

      if (relatedType === "Project") {
        query = query.eq("project_id", relatedId);
      } else if (relatedType === "Lead") {
        query = query.eq("lead_id", relatedId);
      } else if (relatedType === "Client") {
        query = query.eq("client_id", relatedId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // --- MUTATIONS ---
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      if (!newNote.trim()) throw new Error("Note cannot be empty.");

      const payload = {
        company_id: companyId,
        user_id: profile?.id,
        summary: newNote.trim(), 
        category: category,
        date: format(new Date(), "yyyy-MM-dd"),
        project_id: relatedType === "Project" ? relatedId : (linkedProject !== "none" ? linkedProject : null),
        lead_id: relatedType === "Lead" ? relatedId : (linkedLead !== "none" ? linkedLead : null),
        client_id: relatedType === "Client" ? relatedId : (linkedClient !== "none" ? linkedClient : clientId || null)
      };

      const { data, error } = await supabase.from("project_daily_logs").insert([payload]).select().single();
      if (error) throw error;

      if (isPinned && data?.id) {
        setPinnedNoteIds(prev => [...prev, data.id]);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", companyId] });
      setNewNote("");
      setIsPinned(false);
      setCategory("General");
      setLinkedProject("none");
      setLinkedClient("none");
      setLinkedLead("none");
      toast.success("Note saved successfully.");
      scrollToBottom();
    },
    onError: (err) => toast.error(err.message)
  });

  const editNoteMutation = useMutation({
    mutationFn: async () => {
      if (!editForm.summary.trim()) throw new Error("Note cannot be empty.");
      const { error } = await supabase.from("project_daily_logs").update({ summary: editForm.summary.trim(), category: editForm.category }).eq("id", editingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", companyId] });
      setEditingId(null);
      toast.success("Note updated.");
    },
    onError: (err) => toast.error(err.message)
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_daily_logs").delete().eq("id", id);
      if (error) throw error;
      setPinnedNoteIds(prev => prev.filter(pId => pId !== id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", companyId] });
      toast.success("Note removed.");
    }
  });

  // --- HELPERS ---
  const handleTogglePin = (noteId) => {
    setPinnedNoteIds(prev => prev.includes(noteId) ? prev.filter(id => id !== noteId) : [...prev, noteId]);
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      const feedContainer = document.getElementById("notes-feed-list");
      if (feedContainer) feedContainer.scrollTop = feedContainer.scrollHeight;
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [notes.length]);

  const sortedNotes = [...notes].sort((a, b) => {
    const aPinned = pinnedNoteIds.includes(a.id);
    const bPinned = pinnedNoteIds.includes(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const getCategoryConfig = (catName) => CATEGORIES.find(c => c.value === catName) || CATEGORIES[0];

  if (isLoading) return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">Loading notes...</div>;

  return (
    <div className="flex flex-col h-full w-full">
      
      {/* FEED LIST */}
      <div id="notes-feed-list" className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
        {sortedNotes.length === 0 ? (
          <div className="pt-12">
            <EmptyState icon={MessageSquare} title="No Notes Yet" description="Use the input below to start logging updates, communications, and notes." />
          </div>
        ) : (
          sortedNotes.map(note => {
            const isNotePinned = pinnedNoteIds.includes(note.id);
            const isEditing = editingId === note.id;
            const CatConfig = getCategoryConfig(note.category);
            
            const mappedProjectName = projects.find(p => p.id === note.project_id)?.name;
            const mappedClientName = clients.find(c => c.id === note.client_id)?.name;
            const mappedLeadName = leads.find(l => l.id === note.lead_id)?.contact_name;

            return (
              <div key={note.id} className={`p-4 rounded-xl border relative transition-all ${isNotePinned ? 'bg-amber-50/60 border-amber-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                
                {isNotePinned && (
                  <div className="absolute -top-2 -right-2 bg-amber-100 text-amber-700 p-1.5 rounded-full shadow-sm">
                    <Pin className="h-3 w-3 fill-amber-700" />
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                      <span className="text-xs font-bold text-slate-600">{note.user?.full_name?.charAt(0) || "U"}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-900">{note.user?.full_name || "Unknown User"}</p>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${CatConfig.color}`}>
                          <CatConfig.icon className="h-2.5 w-2.5" />
                          {CatConfig.label}
                        </span>
                      </div>
                      <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1 mt-0.5 flex-wrap">
                        <Clock className="h-3 w-3" />
                        {format(new Date(note.created_at), "MMM d, h:mm a")}
                        
                        {mappedProjectName && relatedType !== "Project" && (
                          <><span className="mx-1">•</span><FolderOpen className="h-3 w-3 text-slate-400" /><span className="text-slate-500 font-bold truncate max-w-[120px]">{mappedProjectName}</span></>
                        )}
                        {mappedClientName && !mappedProjectName && relatedType !== "Client" && (
                          <><span className="mx-1">•</span><Users className="h-3 w-3 text-slate-400" /><span className="text-slate-500 font-bold truncate max-w-[120px]">{mappedClientName}</span></>
                        )}
                        {mappedLeadName && !mappedProjectName && !mappedClientName && relatedType !== "Lead" && (
                          <><span className="mx-1">•</span><Target className="h-3 w-3 text-slate-400" /><span className="text-slate-500 font-bold truncate max-w-[120px]">{mappedLeadName}</span></>
                        )}
                      </p>
                    </div>
                  </div>

                  {!isEditing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => handleTogglePin(note.id)} className="cursor-pointer font-bold text-slate-700">
                          <Pin className="h-4 w-4 mr-2" /> {isNotePinned ? "Unpin Note" : "Pin to Top"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setEditingId(note.id); setEditForm({ summary: note.summary, category: note.category || "General" }); }} className="cursor-pointer font-bold text-blue-600">
                          <Edit2 className="h-4 w-4 mr-2" /> Edit Note
                        </DropdownMenuItem>
                        <div className="h-px bg-slate-100 my-1" />
                        <DropdownMenuItem onClick={() => { if(window.confirm("Delete this note?")) deleteNoteMutation.mutate(note.id); }} className="cursor-pointer font-bold text-red-600 focus:text-red-600">
                          <Trash2 className="h-4 w-4 mr-2" /> Delete Note
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* NOTE CONTENT OR EDIT MODE */}
                {isEditing ? (
                  <div className="mt-4 space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <Select value={editForm.category} onValueChange={v => setEditForm({...editForm, category: v})}>
                      <SelectTrigger className="h-8 text-xs bg-white w-full sm:w-[150px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Textarea 
                      value={editForm.summary}
                      onChange={e => setEditForm({...editForm, summary: e.target.value})}
                      className="text-sm min-h-[80px] bg-white"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingId(null)} className="h-7 text-xs font-bold bg-white">Cancel</Button>
                      <Button size="sm" onClick={() => editNoteMutation.mutate()} disabled={editNoteMutation.isPending || !editForm.summary.trim()} className="h-7 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-900 shadow-sm">
                        {editNoteMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed break-words">
                    {note.summary}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* INPUT AREA */}
      <div className="shrink-0 pt-4 border-t border-slate-200 mt-2 bg-slate-50">
        <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-400 transition-all flex flex-col">
          
          <Textarea 
            placeholder="Log an update, email summary, call notes..." 
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            className="border-0 focus-visible:ring-0 resize-none min-h-[80px] text-sm p-3 w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                addNoteMutation.mutate();
              }
            }}
          />
          
          <div className="bg-slate-50 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-100 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div onClick={() => setIsPinned(!isPinned)} className="flex items-center gap-1.5 cursor-pointer group select-none shrink-0 mr-1">
                <div className={`h-4 w-4 rounded flex items-center justify-center border transition-colors ${isPinned ? 'bg-amber-500 border-amber-500' : 'border-slate-300 bg-white group-hover:border-amber-400'}`}>
                  {isPinned && <Pin className="h-3 w-3 text-white fill-white" />}
                </div>
                <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors hidden sm:inline-block">Pin</span>
              </div>

              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-[10px] bg-white w-[110px] border-slate-200 font-medium">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>
                      <div className="flex items-center gap-1.5"><c.icon className="h-3 w-3 text-slate-500" /><span>{c.label}</span></div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {relatedType !== "Project" && (
                <Select value={linkedProject} onValueChange={setLinkedProject}>
                  <SelectTrigger className="h-8 text-[10px] bg-white w-[110px] border-slate-200 font-medium">
                    <SelectValue placeholder="Project..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id} className="text-[10px]">{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              {relatedType !== "Client" && (
                <Select disabled={linkedProject !== "none" || linkedLead !== "none"} value={linkedClient} onValueChange={setLinkedClient}>
                  <SelectTrigger className={`h-8 text-[10px] w-[110px] border-slate-200 font-medium ${linkedProject !== "none" || linkedLead !== "none" ? "bg-slate-50 opacity-60" : "bg-white"}`}>
                    <SelectValue placeholder="Client..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id} className="text-[10px]">{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              {relatedType !== "Lead" && (
                <Select disabled={linkedProject !== "none" || linkedClient !== "none"} value={linkedLead} onValueChange={setLinkedLead}>
                  <SelectTrigger className={`h-8 text-[10px] w-[110px] border-slate-200 font-medium ${linkedProject !== "none" || linkedClient !== "none" ? "bg-slate-50 opacity-60" : "bg-white"}`}>
                    <SelectValue placeholder="Lead..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    {leads.map(l => <SelectItem key={l.id} value={l.id} className="text-[10px]">{l.contact_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Button 
              size="sm" 
              onClick={() => addNoteMutation.mutate()} 
              disabled={addNoteMutation.isPending || !newNote.trim()}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold h-8 px-4 w-full sm:w-auto shrink-0"
            >
              {addNoteMutation.isPending ? "Saving..." : <><Send className="h-3.5 w-3.5 mr-2" /> Post Note</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}