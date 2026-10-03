import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { 
  Mail, Phone, ArrowLeft, DollarSign, Calendar, Pencil, UserCheck, 
  LayoutTemplate, Plus, MoreVertical, MessageSquare, CheckSquare, 
  FileText, ChevronDown, ChevronUp, Image as ImageIcon, X, ListChecks, Pin,
  AlertCircle, Flame, Trash2, Edit2, Upload, Loader2, ChevronLeft, ChevronRight
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import LeadFilesSection from "../components/leads/LeadFilesSection";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import StatusBadge from "../components/shared/StatusBadge";
import NotesFeed from "../components/shared/NotesFeed";
import { format, parseISO, isValid } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AddressAutocomplete from "../components/shared/AddressAutocomplete";
import CreateQuoteFromTemplateDialog from "../components/shared/CreateQuoteFromTemplateDialog";
import CreateTaskDialog from "../components/tasks/CreateTaskDialog";
import PhotoGallery from "../components/shared/PhotoGallery";
import DocumentManager from "../components/shared/DocumentManager";

// --- CONSTANTS & HELPERS ---
const STATUSES = ["To Do", "Doing", "Blocked", "Done", "Pending", "Active", "Under Review", "Completed"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TASK_TYPES = ["General", "Request for Quote", "Request for Pricing", "Site Visit", "Follow Up", "Administrative", "Other"];

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

const normalizeStatus = (dbStatus) => {
  const s = dbStatus?.toLowerCase() || "";
  if (s.includes("to do") || s === "pending") return "Pending";
  if (s.includes("progress") || s.includes("active") || s.includes("doing")) return "Active";
  if (s.includes("review") || s.includes("blocked")) return "Under Review";
  if (s.includes("done") || s.includes("complete")) return "Completed";
  return "Pending";
};

const getPriorityColor = (priority) => {
  switch (priority?.toLowerCase()) {
    case "urgent": return "text-white bg-red-600 border-red-700 shadow-md ring-2 ring-red-200 animate-pulse";
    case "high": return "text-red-800 bg-red-100 border-red-300";
    case "medium": return "text-amber-800 bg-amber-100 border-amber-300";
    case "low": return "text-green-800 bg-green-100 border-green-300";
    default: return "text-slate-600 bg-slate-100 border-slate-200";
  }
};

const getClientName = (c) => {
  if (!c) return "Unknown Client";
  if (c.name && c.name.trim() !== "") return c.name;
  const fullName = [c.first_name, c.surname].filter(Boolean).join(" ");
  return fullName || c.primary_contact_name || "Unnamed Client";
};

const getProjectName = (p) => {
  if (!p) return "Unknown Project";
  if (p.name && p.name.trim() !== "") return p.name;
  if (p.project_number) return `Project #${p.project_number}`;
  return "Unnamed Project";
};

export default function LeadDetail() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const params = new URLSearchParams(window.location.search);
  const leadId = params.get("id");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  // UI States
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  
  const [formData, setFormData] = useState({});
  const [editTaskForm, setEditTaskForm] = useState({});
  const [newNote, setNewNote] = useState("");
  const [noteType, setNoteType] = useState("General");
  const [isPinned, setIsPinned] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [viewingPhotoIndex, setViewingPhotoIndex] = useState(null);

  // Photo Uploader States (Safely inside the component now!)
  const photoInputRef = React.useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- QUERIES ---
  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["lead-quotes", leadId],
    enabled: !!leadId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("lead_id", leadId).eq("company_id", companyId);
      if (error && error.code !== "42P01") throw error;
      return data || [];
    },
  });

  const { data: leadTasks = [] } = useQuery({
    queryKey: ["lead-tasks", leadId],
    enabled: !!leadId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Supporting Dropdown Data for Tasks
  const { data: clients = [] } = useQuery({ queryKey: ["clients", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("clients").select("id, name, first_name, surname").eq("company_id", companyId)).data || [] });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("projects").select("id, name, client_id").eq("company_id", companyId)).data || [] });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("vendors").select("id, name").eq("company_id", companyId)).data || [] });

  // --- MUTATIONS ---
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("leads").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads", companyId] }); 
      setEditDialogOpen(false);
    },
  });

  const convertToClientMutation = useMutation({
    mutationFn: async (leadData) => {
      const { data: clientRef, error: clientError } = await supabase.from("clients").insert([{
        company_id: companyId,
        name: leadData.contact_name || "Unnamed Client",
        primary_contact_name: leadData.contact_name || "",
        email: leadData.contact_email || "",
        phone: leadData.contact_phone || "",
        site_address: leadData.site_address || "",
        billing_address: leadData.site_address || "",
        notes: [leadData.description, leadData.notes].filter(Boolean).join("\n\n") || "",
        tags: [leadData.source].filter(Boolean),
        type: "Residential"
      }]).select().single();
      
      if (clientError) throw clientError;

      const { error: leadError } = await supabase.from("leads").update({ pipeline_stage: "Won" }).eq("id", leadId);
      if (leadError) throw leadError;

      const { data: leadNotes } = await supabase.from("notes").select("*").eq("related_type", "Lead").eq("related_id", leadId);
      if (leadNotes && leadNotes.length > 0) {
        const copiedNotes = leadNotes.map(note => {
          const { id, created_at, updated_at, ...noteDataToCopy } = note; 
          return { ...noteDataToCopy, related_type: "Client", related_id: clientRef.id };
        });
        await supabase.from("notes").insert(copiedNotes);
      }

      await supabase.from('quotes').update({ client_id: clientRef.id, lead_id: null }).eq('lead_id', leadId);
      
      // Migrate Photos
      if (leadData.photos && leadData.photos.length > 0) {
        const migratedPhotos = leadData.photos.map(url => ({
          company_id: companyId,
          related_type: "Client",
          related_id: clientRef.id,
          file_url: url,
          file_name: url.substring(url.lastIndexOf('/') + 1), // Extract file name from URL
          caption: "Site Photos/Info" 
        }));
        await supabase.from("attachments").insert(migratedPhotos);
      }

      // Migrate Documents
      if (leadData.documents && leadData.documents.length > 0) {
        const migratedDocs = leadData.documents.map(doc => ({
          company_id: companyId,
          related_type: "Client",
          related_id: clientRef.id,
          file_url: doc.file_url,
          file_name: doc.file_name || "Document",
          caption: "Lead Document"
        }));
        await supabase.from("attachments").insert(migratedDocs);
      }

      return clientRef;
    },
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Lead successfully converted to Client!");
      navigate(`/ClientDetail?id=${newClient.id}`);
    },
  });

  const handleCreateTaskSubmit = useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from("tasks").insert([{ ...payload, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
      setCreateTaskOpen(false);
      toast.success("Task created successfully!");
    },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });

  const handleEditTaskSubmit = useMutation({
    mutationFn: async (payload) => {
      const taskPayload = {
        title: payload.title,
        description: payload.description || null,
        project_id: (!payload.project_id || payload.project_id === "none") ? null : payload.project_id,
        client_id: (!payload.client_id || payload.client_id === "none") ? null : payload.client_id,
        lead_id: (!payload.lead_id || payload.lead_id === "none") ? null : payload.lead_id,
        vendor_id: (!payload.vendor_id || payload.vendor_id === "none") ? null : payload.vendor_id,
        task_type: payload.task_type || "General",
        status: payload.status || "To Do",
        priority: payload.priority || "Medium",
        due_date: payload.due_date || null,
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
        assigned_to: (!payload.assigned_to || payload.assigned_to === "none") ? null : payload.assigned_to 
      };
      const { error } = await supabase.from("tasks").update(taskPayload).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["lead-tasks", leadId] }); 
      setEditTaskOpen(false); 
      toast.success("Task updated!"); 
    },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });

  const updateTaskStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => await supabase.from("tasks").update({ status }).eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["lead-tasks", leadId] }); toast.success("Task status updated"); }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id) => await supabase.from("tasks").delete().eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["lead-tasks", leadId] }); toast.success("Task deleted."); }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ content, type, pinned }) => {
      const { error } = await supabase.from('notes').insert([{
        company_id: companyId,
        related_type: 'Lead',
        related_id: leadId,
        content: content,
        category: type,
        is_pinned: pinned,
        author_name: profile?.full_name || 'Team Member'
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setAddNoteOpen(false);
      setNewNote("");
      setNoteType("General");
      setIsPinned(false);
      toast.success("Note added successfully");
    },
    onError: (err) => toast.error(`Error adding note: ${err.message}`)
  });
  
  // --- HANDLERS ---
 const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingPhoto(true);
    
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${lead.id}/photo-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Fixed: Changed bucket name from 'leads' to 'lead_files'
        const { error: uploadError } = await supabase.storage.from('lead_files').upload(fileName, file);
        if (uploadError) throw uploadError;

        // Fixed: Changed bucket name from 'leads' to 'lead_files'
        const { data: { publicUrl } } = supabase.storage.from('lead_files').getPublicUrl(fileName);
        uploadedUrls.push(publicUrl);
      }

      // Update the Lead record with the new combined photo array
      const currentPhotos = lead.photos || [];
      const updatedPhotos = [...currentPhotos, ...uploadedUrls];
      
      await updateMutation.mutateAsync({ id: lead.id, data: { photos: updatedPhotos } });
      toast.success("Photo(s) uploaded successfully");
      
    } catch (error) {
      toast.error("Failed to upload photos: " + error.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  const removePhoto = async (photoUrlToRemove) => {
    if(!window.confirm("Delete this photo?")) return;
    const currentPhotos = lead.photos || [];
    const updatedPhotos = currentPhotos.filter(url => url !== photoUrlToRemove);
    await updateMutation.mutateAsync({ id: lead.id, data: { photos: updatedPhotos } });
    toast.success("Photo removed");
  };

  const handleEdit = () => {
    const nameParts = lead.contact_name ? lead.contact_name.split(" ") : ["", ""];
    const firstName = nameParts[0] || "";
    const surname = nameParts.slice(1).join(" ") || "";
    
    setFormData({
      first_name: firstName,
      surname: surname,
      contact_email: lead.contact_email || "",
      contact_phone: lead.contact_phone || "",
      source: lead.source || "Referral",
      pipeline_stage: lead.pipeline_stage || "New",
      value_estimate: lead.value_estimate || "",
      priority: lead.priority || "Medium",
      next_follow_up_date: lead.next_follow_up_date || "",
      assigned_to: lead.assigned_to || "",
      site_address: lead.site_address || "",
      description: lead.description || "",
      notes: lead.notes || ""
    });
    setEditDialogOpen(true);
  };

  const handleSave = () => {
    const fullName = `${formData.first_name} ${formData.surname}`.trim();
    const { first_name, surname, ...rest } = formData;
    const data = { ...rest, contact_name: fullName };
    
    if (data.value_estimate !== "" && data.value_estimate !== null && data.value_estimate !== undefined) {
      data.value_estimate = parseFloat(data.value_estimate);
    } else {
      data.value_estimate = null;
    }
    
    if (!data.next_follow_up_date) data.next_follow_up_date = null;
    updateMutation.mutate({ id: leadId, data });
  };

  const [uploadingDoc, setUploadingDoc] = useState(false);

  const handleLeadDocUpload = async (files) => {
    const filesArray = Array.from(files);
    if (!filesArray.length) return;
    setUploadingDoc(true);
    
    try {
      const newDocs = [];
      for (const file of filesArray) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${lead.id}/doc-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from('lead_files').upload(fileName, file);
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('lead_files').getPublicUrl(fileName);
        newDocs.push({ id: Date.now().toString(), file_url: publicUrl, file_name: file.name, description: "" });
      }

      const currentDocs = lead.documents || [];
      await updateMutation.mutateAsync({ id: lead.id, data: { documents: [...currentDocs, ...newDocs] } });
      toast.success("Document(s) uploaded successfully");
    } catch (error) {
      toast.error("Failed to upload: " + error.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleLeadDocDelete = async (docToDelete) => {
    const currentDocs = lead.documents || [];
    const updatedDocs = currentDocs.filter(d => d.file_url !== docToDelete.url);
    await updateMutation.mutateAsync({ id: lead.id, data: { documents: updatedDocs } });
  };

  const handleLeadDocUpdateDesc = async (docToUpdate, newDesc) => {
    const currentDocs = lead.documents || [];
    const updatedDocs = currentDocs.map(d => 
      d.file_url === docToUpdate.url ? { ...d, description: newDesc } : d
    );
    await updateMutation.mutateAsync({ id: lead.id, data: { documents: updatedDocs } });
  };

  const openTaskEditModal = (task) => {
    const assigneeVal = Array.isArray(task.assigned_to) && task.assigned_to.length > 0 ? task.assigned_to[0] : task.assigned_to;
    setEditTaskForm({
      id: task.id,
      title: task.title || "",
      description: task.description || "",
      project_id: task.project_id ? String(task.project_id) : "none",
      client_id: task.client_id ? String(task.client_id) : "none",
      lead_id: task.lead_id ? String(task.lead_id) : "none",
      vendor_id: task.vendor_id ? String(task.vendor_id) : "none",
      task_type: task.task_type || "General",
      status: task.status || "Pending",
      priority: task.priority || "Medium",
      due_date: task.due_date || task.due_date_target || "",
      estimated_hours: task.estimated_hours || "",
      assigned_to: (assigneeVal && typeof assigneeVal === "string") ? assigneeVal : "none"
    });
    setEditTaskOpen(true);
  };

  if (!lead) return <div className="p-6 text-center text-slate-500 font-medium">Loading lead details...</div>;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-20">
      
      <Link to="/LeadTracker" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 mb-4 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Leads
      </Link>

      {/* HEADER CARD */}
      <Card className="p-5 sm:p-6 mb-6 border-slate-200/80 shadow-sm bg-white">
        
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between sm:justify-start gap-3 w-full">
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight leading-tight truncate">{lead.contact_name}</h1>
              
              {/* Mobile Actions Dropdowns */}
              <div className="flex sm:hidden items-center gap-1 shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 bg-blue-50/50 hover:bg-blue-100 rounded-full">
                      <Plus className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 font-medium">
                    <DropdownMenuItem onClick={() => setAddNoteOpen(true)}><MessageSquare className="h-4 w-4 mr-2"/> Add Note</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCreateTaskOpen(true)}><CheckSquare className="h-4 w-4 mr-2"/> Add Task / Request</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/QuoteBuilder?lead_id=${leadId}`)}><DollarSign className="h-4 w-4 mr-2"/> Quote</DropdownMenuItem>
                    <CreateQuoteFromTemplateDialog leadId={leadId}>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}><LayoutTemplate className="h-4 w-4 mr-2"/> Quote from Template</DropdownMenuItem>
                    </CreateQuoteFromTemplateDialog>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="font-medium">
                    <DropdownMenuItem onClick={handleEdit}><Pencil className="h-4 w-4 mr-2"/> Edit Lead</DropdownMenuItem>
                    <DropdownMenuItem className="text-emerald-600" onClick={() => convertToClientMutation.mutate(lead)}><UserCheck className="h-4 w-4 mr-2"/> Convert to Client</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={lead.pipeline_stage} />
              <StatusBadge status={lead.priority} />
            </div>
          </div>
          
          {/* Desktop Actions */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <Button onClick={() => convertToClientMutation.mutate(lead)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm" disabled={convertToClientMutation.isPending}>
              <UserCheck className="h-4 w-4 mr-2" /> Convert to Client
            </Button>
            <Button onClick={handleEdit} variant="outline" className="font-bold text-slate-700 border-slate-300 hover:bg-slate-50">
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm">
                  <Plus className="h-4 w-4 mr-1" /> Create
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 font-medium">
                <DropdownMenuItem onClick={() => setAddNoteOpen(true)}><MessageSquare className="h-4 w-4 mr-2"/> Add Note</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateTaskOpen(true)}><CheckSquare className="h-4 w-4 mr-2"/> Add Task / Request</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/QuoteBuilder?lead_id=${leadId}`)}><DollarSign className="h-4 w-4 mr-2"/> Quote</DropdownMenuItem>
                <CreateQuoteFromTemplateDialog leadId={leadId}>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}><LayoutTemplate className="h-4 w-4 mr-2"/> Quote from Template</DropdownMenuItem>
                </CreateQuoteFromTemplateDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* METADATA GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-100">
          {lead.contact_email && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Mail className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Email</p>
                <p className="text-sm font-semibold text-slate-800 truncate" title={lead.contact_email}>{lead.contact_email}</p>
              </div>
            </div>
          )}
          
          {lead.contact_phone && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Phone className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Phone</p>
                <p className="text-sm font-semibold text-slate-800">{lead.contact_phone}</p>
              </div>
            </div>
          )}
          
          {lead.value_estimate && (
            <div className="flex items-start gap-3 bg-amber-50/50 p-3 rounded-xl border border-amber-100/50">
              <div className="bg-white p-2 rounded-lg border border-amber-200 shadow-sm shrink-0">
                <DollarSign className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-amber-600/70 uppercase tracking-wider mb-0.5">Est. Value</p>
                <p className="text-sm font-black text-amber-700">${Number(lead.value_estimate).toLocaleString()}</p>
              </div>
            </div>
          )}
          
          {lead.next_follow_up_date && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Calendar className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Follow Up</p>
                <p className="text-sm font-semibold text-slate-800">{format(new Date(lead.next_follow_up_date), "MMM d, yyyy")}</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-100">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Lead Source</p>
            <p className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg inline-block">{lead.source || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Assigned To</p>
            <p className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg inline-block">{lead.assigned_to || "Unassigned"}</p>
          </div>
          {lead.site_address && (
            <div className="sm:col-span-2 lg:col-span-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Site Address</p>
              <p className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">{lead.site_address}</p>
            </div>
          )}
        </div>

        {/* COLLAPSIBLE INTERNAL NOTES & DESCRIPTION */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div 
            className="flex items-center justify-between cursor-pointer group px-1" 
            onClick={() => setDescExpanded(!descExpanded)}
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-800 transition-colors">Internal Notes & Description</p>
            </div>
            {descExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
          
          {descExpanded && (
            <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
              {lead.description && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Description</p>
                  <p className="text-sm font-medium text-slate-700 leading-relaxed bg-slate-50/50 p-4 rounded-xl border border-slate-100">{lead.description}</p>
                </div>
              )}
              {lead.notes && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notes</p>
                  <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed bg-amber-50/30 p-4 rounded-xl border border-amber-100/50">{lead.notes}</p>
                </div>
              )}
              {!lead.description && !lead.notes && (
                <p className="text-sm italic text-slate-400 pl-1">No description or internal notes provided.</p>
              )}
            </div>
          )}
        </div>

      </Card>

      {/* LOWER SECTIONS */}
      <div className="space-y-6">
        
        {/* NOTES SECTION */}
        <Card className="p-0 sm:p-2 shadow-sm border-slate-200/80 bg-white overflow-hidden rounded-xl [&_.py-12]:py-4 [&_.py-16]:py-4 [&_svg]:max-h-8 [&_svg]:max-w-8">
          <NotesFeed relatedType="Lead" relatedId={lead?.id} clientId={lead?.client_id} />
        </Card>

        {/* TASKS / REQUESTS SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Tasks & Requests ({leadTasks.length})</h3>
              <p className="text-xs text-slate-500 font-medium">Pending actions for this lead</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreateTaskOpen(true)} className="gap-2 bg-white shadow-sm border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
              <CheckSquare className="h-4 w-4" /> Add Task
            </Button>
          </div>

          <div className="space-y-2">
            {leadTasks.map((t) => {
              const targetDate = t.due_date || t.due_date_target;
              const dueDateObj = safeParseDate(targetDate);
              const isCompleted = normalizeStatus(t.status) === "Completed";
              const isOverdue = dueDateObj && dueDateObj < new Date() && !isCompleted;
              const isUrgent = t.priority?.toLowerCase() === "urgent" && !isCompleted;
              const isHigh = t.priority?.toLowerCase() === "high" && !isCompleted;

              let cardClass = "bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden";
              if (isCompleted) cardClass = "bg-slate-50 p-4 rounded-xl border border-slate-200 opacity-70 relative overflow-hidden";
              else if (isOverdue) cardClass = "bg-rose-50 p-4 rounded-xl border border-rose-200 shadow-sm relative overflow-hidden";
              else if (isUrgent) cardClass = "bg-red-50 p-4 rounded-xl border border-red-200 shadow-sm relative overflow-hidden";
              else if (isHigh) cardClass = "bg-orange-50/50 p-4 rounded-xl border border-orange-200 shadow-sm relative overflow-hidden";

              return (
                <div key={t.id} className={cardClass}>
                  {!isCompleted && (isOverdue || isUrgent) && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600"></div>}
                  {!isCompleted && isHigh && !isOverdue && <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400"></div>}

                  <div className="pl-2">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col items-start pr-2 w-full text-left">
                        <div className="flex items-center gap-2">
                          {!isCompleted && isUrgent && <Flame className="h-4 w-4 text-red-600 fill-red-600 animate-bounce shrink-0" />}
                          <h3 className={`font-bold text-base line-clamp-2 ${isCompleted ? 'text-slate-500 line-through' : (isUrgent || isOverdue) ? 'text-red-900 font-extrabold' : 'text-slate-900'}`}>{t.title}</h3>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {t.task_type && t.task_type !== "General" && (
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${isCompleted ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                              {t.task_type}
                            </span>
                          )}
                          {t.description && <span className={`text-xs line-clamp-1 ${(isUrgent || isOverdue) ? 'text-red-700/80 font-medium' : 'text-slate-500'}`}>{t.description}</span>}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openTaskEditModal(t)} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if(window.confirm("Delete this task?")) deleteTaskMutation.mutate(t.id); }} className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-3 mt-1">
                      {t.priority && <Badge variant="outline" className={`text-[10px] uppercase tracking-wider font-black ${getPriorityColor(t.priority)}`}>{t.priority}</Badge>}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100/50 pt-3" onClick={e => e.stopPropagation()}>
                      <Select value={normalizeStatus(t.status)} onValueChange={v => updateTaskStatusMutation.mutate({ id: t.id, status: v })}>
                        <SelectTrigger className={`w-[110px] h-8 text-xs font-bold ${isCompleted ? 'bg-green-50 text-green-700 border-green-200' : (isUrgent || isOverdue) ? 'bg-white border-red-300 text-red-900' : 'bg-white'}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["Pending", "Active", "Under Review", "Completed"].map(s => <SelectItem key={s} value={s} className="text-xs font-bold">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>

                      {dueDateObj ? (
                        isOverdue ? (
                          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 border border-red-300 text-[10px] font-black animate-pulse"><AlertCircle className="h-3 w-3 stroke-[3]" />DUE {format(dueDateObj, "MMM d")}</div>
                        ) : (
                          <div className={`flex items-center gap-1.5 text-xs font-bold ${isUrgent ? 'text-red-800' : 'text-slate-600'}`}><Calendar className={`h-3.5 w-3.5 ${isUrgent ? 'text-red-500' : 'text-slate-400'}`} />{format(dueDateObj, "MMM d, yyyy")}</div>
                        )
                      ) : <span className="text-[10px] text-slate-400 italic">No date</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {leadTasks.length === 0 && (
              <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <ListChecks className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-medium">No active tasks or requests</p>
              </div>
            )}
          </div>
        </Card>

        {/* QUOTES SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Quotes ({quotes.length})</h3>
              <p className="text-xs text-slate-500 font-medium">Quotes created for this lead</p>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <CreateQuoteFromTemplateDialog leadId={leadId}>
                <Button variant="outline" size="sm" className="gap-2 bg-white shadow-sm border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
                  <LayoutTemplate className="h-4 w-4" /> From Template
                </Button>
              </CreateQuoteFromTemplateDialog>
              <Link to={`/QuoteBuilder?lead_id=${leadId}`}>
                <Button size="sm" className="bg-gradient-to-br from-amber-500 to-amber-600 text-slate-900 font-bold shadow-sm hover:shadow">
                  <Plus className="h-4 w-4 mr-1" /> Create Quote
                </Button>
              </Link>
            </div>
          </div>

          <div className="space-y-2">
            {quotes.map((q) => (
              <Link key={q.id} to={`/QuoteBuilder?id=${q.id}`}>
                <Card className="p-4 flex items-center justify-between hover:border-amber-300 transition-colors bg-slate-50/50">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{q.title}</p>
                    <p className="text-xs text-slate-500 font-medium">{q.quote_number} · ${q.total?.toLocaleString() || "0"}</p>
                  </div>
                  <StatusBadge status={q.status} />
                </Card>
              </Link>
            ))}
            {quotes.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                No quotes created for this lead yet
              </p>
            )}
          </div>
        </Card>

        <PhotoGallery
          title="Lead Photos"
          photos={(lead?.photos || []).map((url, i) => ({ id: url, url: url, name: `Photo ${i+1}` }))}
          isUploading={uploadingPhoto}
          onUpload={(files) => handlePhotoUpload({ target: { files } })} // Adapt to your existing handler
          onDelete={(photo) => removePhoto(photo.url)}
        />

        {/* DOCUMENTS SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="mb-4">
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-400" /> Documents
            </h3>
            <p className="text-xs text-slate-500 font-medium">Upload contracts, floor plans, and other lead documents</p>
          </div>
          <DocumentManager
          title="Lead Documents"
          documents={(lead?.documents || []).map((doc, i) => ({ 
            id: doc.id || i, 
            url: doc.file_url, 
            name: doc.file_name, 
            description: doc.description 
          }))}
          isUploading={uploadingDoc}
          onUpload={handleLeadDocUpload}
          onDelete={handleLeadDocDelete}
          onUpdateDescription={handleLeadDocUpdateDesc}
        />
        </Card>
      </div>

      {/* ----------------- DIALOGS & MODALS ----------------- */}

      {/* ADD NOTE MODAL */}
      <Dialog open={addNoteOpen} onOpenChange={setAddNoteOpen}>
        <DialogContent className="sm:max-w-lg w-[95vw] rounded-xl p-4 sm:p-6 bg-white" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">Add Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            
            <div className="flex flex-col sm:flex-row gap-4 mb-2">
              <div className="flex-1">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Note Type</Label>
                <Select value={noteType} onValueChange={setNoteType}>
                  <SelectTrigger className="font-bold border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["General", "Call", "Email", "Meeting", "Update"].map(t => <SelectItem key={t} value={t} className="font-medium">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:mt-6">
                <input 
                  type="checkbox" 
                  id="pin-note" 
                  checked={isPinned} 
                  onChange={e => setIsPinned(e.target.checked)} 
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600 h-4 w-4" 
                />
                <Label htmlFor="pin-note" className="text-sm font-bold text-slate-700 cursor-pointer flex items-center gap-1.5">
                  <Pin className="h-3.5 w-3.5 text-slate-400" /> Pin to top
                </Label>
              </div>
            </div>

            <Textarea 
              value={newNote} 
              onChange={(e) => setNewNote(e.target.value)} 
              placeholder="Type your internal note here..." 
              className="min-h-[120px] font-medium border-slate-200 resize-none" 
            />
            
            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddNoteOpen(false)} className="font-bold border-slate-300 w-full sm:w-auto">Cancel</Button>
              <Button 
                onClick={() => addNoteMutation.mutate({ content: newNote, type: noteType, pinned: isPinned })} 
                disabled={!newNote.trim() || addNoteMutation.isPending} 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold w-full sm:w-auto shadow-sm"
              >
                {addNoteMutation.isPending ? "Saving..." : "Save Note"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>


      {/* CREATE TASK DIALOG */}
      <CreateTaskDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        leads={[lead]} 
        defaultLeadId={lead.id}
        clients={clients}
        projects={projects}
        vendors={vendors}
        users={users}
        isLoading={handleCreateTaskSubmit.isPending}
        onSubmit={(payload) => handleCreateTaskSubmit.mutate(payload)}
      />

      {/* EDIT TASK DIALOG */}
      <Dialog open={editTaskOpen} onOpenChange={setEditTaskOpen}>
        <DialogContent className="sm:max-w-xl w-[95vw] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6 bg-white" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900">Edit Task</DialogTitle></DialogHeader>
          
          <form onSubmit={(e) => { e.preventDefault(); handleEditTaskSubmit.mutate(editTaskForm); }} className="space-y-4 pt-2">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
                <Input value={editTaskForm.title || ""} onChange={e => setEditTaskForm({...editTaskForm, title: e.target.value})} className="font-bold border-slate-200" required />
              </div>
              
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
                <Textarea value={editTaskForm.description || ""} onChange={e => setEditTaskForm({...editTaskForm, description: e.target.value})} className="flex min-h-[80px] w-full resize-none font-medium border-slate-200" />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Type</Label>
                <Select value={TASK_TYPES.includes(editTaskForm.task_type) ? editTaskForm.task_type : "General"} onValueChange={v => setEditTaskForm({...editTaskForm, task_type: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select type..." /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Project</Label>
                <Select value={projects.some(p => String(p.id) === String(editTaskForm.project_id)) ? String(editTaskForm.project_id) : "none"} onValueChange={v => setEditTaskForm({...editTaskForm, project_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map((p) => {
                      const projectClient = clients.find(c => String(c.id) === String(p.client_id));
                      const clientName = projectClient ? getClientName(projectClient) : "";
                      return (
                        <SelectItem key={String(p.id)} value={String(p.id)}>
                          {getProjectName(p)} {clientName ? `— ${clientName}` : ""}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Client</Label>
                <Select disabled={editTaskForm.project_id !== "none"} value={clients.some(c => String(c.id) === String(editTaskForm.client_id)) ? String(editTaskForm.client_id) : "none"} onValueChange={v => setEditTaskForm({...editTaskForm, client_id: v})}>
                  <SelectTrigger className={`font-medium border-slate-200 text-sm ${editTaskForm.project_id !== "none" ? 'bg-slate-50 opacity-70' : ''}`}>
                    <SelectValue placeholder="Select Client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {getClientName(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lead (Optional)</Label>
                <Select value={String(editTaskForm.lead_id || "none")} onValueChange={v => setEditTaskForm({...editTaskForm, lead_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Lead" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    <SelectItem value={String(lead.id)}>{lead.contact_name || "Unnamed Lead"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Vendor / Subcontractor</Label>
                <Select value={vendors.some(v => String(v.id) === String(editTaskForm.vendor_id)) ? String(editTaskForm.vendor_id) : "none"} onValueChange={v => setEditTaskForm({...editTaskForm, vendor_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Vendor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Vendor</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={String(v.id)} value={String(v.id)}>
                        {v.name || "Unnamed Vendor"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assignee</Label>
                <Select value={users.some(u => String(u.id) === String(editTaskForm.assigned_to)) ? String(editTaskForm.assigned_to) : "none"} onValueChange={v => setEditTaskForm({...editTaskForm, assigned_to: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={String(u.id)} value={String(u.id)}>
                        {u.full_name || "Unknown User"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Priority</Label>
                <Select value={PRIORITIES.includes(editTaskForm.priority) ? editTaskForm.priority : "Medium"} onValueChange={v => setEditTaskForm({...editTaskForm, priority: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
                <Select value={STATUSES.includes(editTaskForm.status) ? editTaskForm.status : "To Do"} onValueChange={v => setEditTaskForm({...editTaskForm, status: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date (Optional)</Label>
                <Input type="date" value={editTaskForm.due_date || ""} onChange={e => setEditTaskForm({...editTaskForm, due_date: e.target.value})} className="font-medium border-slate-200 text-sm block w-full" />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. Hours</Label>
                <Input type="number" min="0" step="0.5" value={editTaskForm.estimated_hours || ""} onChange={(e) => setEditTaskForm({ ...editTaskForm, estimated_hours: e.target.value })} className="font-medium border-slate-200 text-sm" />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-100 flex-col sm:flex-row gap-2 sm:gap-0 mt-4">
              <Button type="button" variant="outline" onClick={() => setEditTaskOpen(false)} className="w-full sm:w-auto font-bold border-slate-300 order-2 sm:order-1">Cancel</Button>
              <Button type="submit" disabled={handleEditTaskSubmit.isPending} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md order-1 sm:order-2">
                {handleEditTaskSubmit.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT LEAD DIALOG */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] rounded-xl p-4 sm:p-6" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="text-xl font-black">Edit Lead</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">First Name *</Label>
                <Input value={formData.first_name} onChange={e => setFormData({...formData, first_name: e.target.value})} className="font-medium h-10" />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Surname *</Label>
                <Input value={formData.surname} onChange={e => setFormData({...formData, surname: e.target.value})} className="font-medium h-10" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Email</Label>
                <Input type="email" value={formData.contact_email} onChange={e => setFormData({...formData, contact_email: e.target.value})} className="font-medium h-10" />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Phone</Label>
                <Input value={formData.contact_phone} onChange={e => setFormData({...formData, contact_phone: e.target.value})} className="font-medium h-10" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Lead Source</Label>
                <Select value={formData.source} onValueChange={v => setFormData({...formData, source: v})}>
                  <SelectTrigger className="h-10 font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Facebook", "Instagram", "Google", "Referral", "Website", "Kijiji", "Other"].map(s => (
                      <SelectItem key={s} value={s} className="font-medium">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Priority Level</Label>
                <Select value={formData.priority} onValueChange={v => setFormData({...formData, priority: v})}>
                  <SelectTrigger className="h-10 font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low", "Medium", "High", "Urgent"].map(p => (
                      <SelectItem key={p} value={p} className="font-medium">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pipeline Stage</Label>
              <Select value={formData.pipeline_stage} onValueChange={v => setFormData({...formData, pipeline_stage: v})}>
                <SelectTrigger className="h-10 font-medium bg-slate-50 border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["New", "Contacted", "Booked Visit", "Quoted", "Negotiation", "Won", "Lost"].map(s => (
                    <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Value Estimate ($)</Label>
                <Input type="number" value={formData.value_estimate} onChange={e => setFormData({...formData, value_estimate: e.target.value})} className="font-medium h-10" />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Next Follow Up Date</Label>
                <Input type="date" value={formData.next_follow_up_date || ""} onChange={e => setFormData({...formData, next_follow_up_date: e.target.value})} className="font-medium h-10 block w-full" />
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Assign Team Member</Label>
              <Select value={formData.assigned_to} onValueChange={v => setFormData({...formData, assigned_to: v})}>
                <SelectTrigger className="h-10 font-medium"><SelectValue placeholder="Select team member" /></SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.full_name || user.name || "Unknown User"} className="font-medium">
                      {user.full_name || user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Site / Project Address</Label>
              <AddressAutocomplete
                value={formData.site_address || ""}
                onChange={v => setFormData({...formData, site_address: v})}
                placeholder="Start typing an address..."
              />
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Description</Label>
              <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} rows={3} className="font-medium bg-slate-50" />
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Internal Notes</Label>
              <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={3} className="font-medium bg-slate-50" />
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="w-full sm:w-auto font-bold border-slate-300 order-2 sm:order-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!formData.first_name || !formData.surname || updateMutation.isPending} className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-bold order-1 sm:order-2 shadow-md">
                {updateMutation.isPending ? "Saving..." : "Update Lead"}
              </Button>
            </div>
            
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}