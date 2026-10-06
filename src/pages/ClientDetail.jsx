import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { 
  Mail, Phone, ArrowLeft, DollarSign, Calendar, Pencil, 
  LayoutTemplate, Plus, MoreVertical, MessageSquare, CheckSquare, 
  FileText, ChevronDown, ChevronUp, ListChecks, Pin,
  AlertCircle, Flame, Trash2, Edit2, Building2, MapPin,
  FolderKanban, Receipt
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
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
import { useTaskVendors } from "@/hooks/useTaskVendors";

// --- CONSTANTS & HELPERS ---
const STATUSES = ["To Do", "Doing", "Blocked", "Done", "Pending", "Active", "Under Review", "Completed"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

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

export default function ClientDetail() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("id");
  const queryClient = useQueryClient();
  const { vendors, canCreateVendor, createVendor, isCreatingVendor } = useTaskVendors({ companyId, role: profile?.role });
  
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

  const photoInputRef = React.useRef(null);
  const docInputRef = React.useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- QUERIES ---
  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).single();
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

  const { data: projects = [] } = useQuery({
    queryKey: ["client-projects", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("client_id", clientId).eq("company_id", companyId);
      if (error && error.code !== "42P01") throw error;
      return data || [];
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["client-quotes", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("client_id", clientId).eq("company_id", companyId);
      if (error && error.code !== "42P01") throw error;
      return data || [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["client-invoices", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").eq("client_id", clientId).eq("company_id", companyId);
      if (error && error.code !== "42P01") throw error;
      return data || [];
    },
  });

  const { data: changeOrders = [] } = useQuery({
    queryKey: ["client-change-orders", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_orders").select("*").eq("client_id", clientId).eq("company_id", companyId);
      if (error && error.code !== "42P01") throw error;
      return data || [];
    },
  });

  const { data: clientTasks = [] } = useQuery({
    queryKey: ["client-tasks", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_tasks").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["client-attachments", clientId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("attachments").select("*").eq("related_type", "Client").eq("related_id", clientId).eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Supporting maps
  const projectMap = React.useMemo(() => Object.fromEntries(projects.map(p => [p.id, p.name])), [projects]);
  const userMap = React.useMemo(() => Object.fromEntries(users.map(u => [u.id, u.full_name || u.email])), [users]);

  // Derived Attachment Lists
  const clientPhotos = attachments.filter(a => a.caption === "Site Photos/Info" || a.file_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i));
  const clientDocuments = attachments.filter(a => a.caption !== "Site Photos/Info" && !a.file_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i));

  // --- MUTATIONS ---
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("clients").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      setEditDialogOpen(false);
      toast.success("Client updated");
    },
  });

  const handleCreateTaskSubmit = useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from("project_tasks").insert([{
        company_id: companyId,
        client_id: clientId,
        project_id: (!payload.project_id || payload.project_id === "none") ? null : payload.project_id,
        title: payload.title,
        description: payload.description || null,
        priority: payload.priority || "Medium",
        status: payload.status || "To Do",
        due_date_target: payload.due_date || null,
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
        assigned_to: (!payload.assigned_to || payload.assigned_to === "none") ? null : [payload.assigned_to],
        vendor_id: (!payload.vendor_id || payload.vendor_id === "none") ? null : payload.vendor_id,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] });
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
        status: payload.status || "Pending",
        priority: payload.priority || "Medium",
        due_date_target: payload.due_date_target || null,
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
        assigned_to: (!payload.assigned_to || payload.assigned_to === "none") ? null : [payload.assigned_to] 
      };
      const { error } = await supabase.from("project_tasks").update(taskPayload).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] }); 
      setEditTaskOpen(false); 
      toast.success("Task updated!"); 
    },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });

  const updateTaskStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => await supabase.from("project_tasks").update({ status }).eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] }); toast.success("Task status updated"); }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id) => await supabase.from("project_tasks").delete().eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] }); toast.success("Task deleted."); }
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (id) => await supabase.from("attachments").delete().eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client-attachments", clientId] }); toast.success("File removed."); }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ content, type, pinned }) => {
      const { error } = await supabase.from('notes').insert([{
        company_id: companyId,
        related_type: 'Client',
        related_id: clientId,
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

  const updateAttachmentDescMutation = useMutation({
    mutationFn: async ({ id, caption }) => {
      const { error } = await supabase.from("attachments").update({ caption }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-attachments", clientId] });
      toast.success("Description updated");
    }
  });
  
  // --- HANDLERS ---
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingPhoto(true);
    
    try {
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${clientId}/photo-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(fileName);
        
        await supabase.from('attachments').insert([{
          company_id: companyId,
          related_type: "Client",
          related_id: clientId,
          file_url: publicUrl,
          file_name: file.name,
          caption: "Site Photos/Info"
        }]);
      }
      queryClient.invalidateQueries({ queryKey: ["client-attachments", clientId] });
      toast.success("Photo(s) uploaded successfully");
    } catch (error) {
      toast.error("Failed to upload photos: " + error.message);
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleDocUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingDoc(true);
    
    try {
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${clientId}/doc-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(fileName);
        
        await supabase.from('attachments').insert([{
          company_id: companyId,
          related_type: "Client",
          related_id: clientId,
          file_url: publicUrl,
          file_name: file.name,
          caption: "Client Document"
        }]);
      }
      queryClient.invalidateQueries({ queryKey: ["client-attachments", clientId] });
      toast.success("Document(s) uploaded successfully");
    } catch (error) {
      toast.error("Failed to upload documents: " + error.message);
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const handleEdit = () => {
    setFormData({
      name: client?.name || "",
      type: client?.type || "Homeowner",
      primary_contact_name: client?.primary_contact_name || "",
      email: client?.email || "",
      phone: client?.phone || "",
      billing_address: client?.billing_address || "",
      site_address: client?.site_address || "",
      notes: client?.notes || ""
    });
    setEditDialogOpen(true);
  };

  const handleSave = () => {
    updateMutation.mutate({ id: clientId, data: formData });
  };

  const openTaskEditModal = (task) => {
    const assigneeVal = Array.isArray(task.assigned_to) && task.assigned_to.length > 0 ? task.assigned_to[0] : task.assigned_to;
    setEditTaskForm({
      id: task.id,
      title: task.title || "",
      description: task.description || "",
      project_id: task.project_id ? String(task.project_id) : "none",
      status: task.status || "Pending",
      priority: task.priority || "Medium",
      due_date_target: task.due_date_target || task.due_date || "",
      estimated_hours: task.estimated_hours || "",
      assigned_to: (assigneeVal && typeof assigneeVal === "string") ? assigneeVal : "none"
    });
    setEditTaskOpen(true);
  };

  if (!client) return <div className="p-6 text-center text-slate-500 font-medium">Loading client details...</div>;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      
      <Link to="/Clients" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 mb-4 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Clients
      </Link>

      {/* HEADER CARD */}
      <Card className="p-5 sm:p-6 mb-6 border-slate-200/80 shadow-sm bg-white">
        
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between sm:justify-start gap-3 w-full">
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight leading-tight truncate">{client.name}</h1>
              
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
                    <DropdownMenuItem onClick={() => setCreateTaskOpen(true)}><CheckSquare className="h-4 w-4 mr-2"/> Add Task</DropdownMenuItem>
                    <DropdownMenuItem asChild><Link to={`/QuoteBuilder?client_id=${clientId}`}><DollarSign className="h-4 w-4 mr-2"/> Create Quote</Link></DropdownMenuItem>
                    <DropdownMenuItem asChild><Link to={`/InvoiceBuilder?client_id=${clientId}`}><Receipt className="h-4 w-4 mr-2"/> Create Invoice</Link></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="font-medium">
                    <DropdownMenuItem onClick={handleEdit}><Pencil className="h-4 w-4 mr-2"/> Edit Client</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {client.type || "Client"}
              </span>
              {client.primary_contact_name && client.primary_contact_name !== client.name && (
                <span className="text-sm font-medium text-slate-500">· {client.primary_contact_name}</span>
              )}
            </div>
          </div>
          
          {/* Desktop Actions */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
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
                <DropdownMenuItem onClick={() => setCreateTaskOpen(true)}><CheckSquare className="h-4 w-4 mr-2"/> Add Task</DropdownMenuItem>
                <DropdownMenuItem asChild><Link to={`/QuoteBuilder?client_id=${clientId}`}><DollarSign className="h-4 w-4 mr-2"/> Create Quote</Link></DropdownMenuItem>
                <CreateQuoteFromTemplateDialog clientId={clientId}>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}><LayoutTemplate className="h-4 w-4 mr-2"/> Quote from Template</DropdownMenuItem>
                </CreateQuoteFromTemplateDialog>
                <DropdownMenuItem asChild><Link to={`/InvoiceBuilder?client_id=${clientId}`}><Receipt className="h-4 w-4 mr-2"/> Create Invoice</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to={`/PMProjectWorkspace?client_id=${clientId}&new=true`}><FolderKanban className="h-4 w-4 mr-2"/> Create Project</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* METADATA GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-100">
          {client.email && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Mail className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Email</p>
                <p className="text-sm font-semibold text-slate-800 truncate" title={client.email}>{client.email}</p>
              </div>
            </div>
          )}
          
          {client.phone && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Phone className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Phone</p>
                <p className="text-sm font-semibold text-slate-800">{client.phone}</p>
              </div>
            </div>
          )}
          
          {client.billing_address && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <Building2 className="h-4 w-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Billing Address</p>
                <p className="text-sm font-semibold text-slate-800 truncate" title={client.billing_address}>{client.billing_address}</p>
              </div>
            </div>
          )}
          
          {client.site_address && (
            <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <MapPin className="h-4 w-4 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Site Address</p>
                <p className="text-sm font-semibold text-slate-800 truncate" title={client.site_address}>{client.site_address}</p>
              </div>
            </div>
          )}
        </div>

        {/* COLLAPSIBLE INTERNAL NOTES */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div 
            className="flex items-center justify-between cursor-pointer group px-1" 
            onClick={() => setDescExpanded(!descExpanded)}
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-800 transition-colors">Client Internal Notes</p>
            </div>
            {descExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
          
          {descExpanded && (
            <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
              {client.notes ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed bg-amber-50/30 p-4 rounded-xl border border-amber-100/50">{client.notes}</p>
                </div>
              ) : (
                <p className="text-sm italic text-slate-400 pl-1">No internal notes provided.</p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* LOWER SECTIONS */}
      <div className="space-y-6">
        
        {/* NOTES SECTION */}
        <Card className="p-0 sm:p-2 shadow-sm border-slate-200/80 bg-white overflow-hidden rounded-xl [&_.py-12]:py-4 [&_.py-16]:py-4 [&_svg]:max-h-8 [&_svg]:max-w-8">
          <NotesFeed relatedType="Client" relatedId={client.id} clientId={client.id} />
        </Card>

        {/* TASKS / REQUESTS SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Client Action Items ({clientTasks.length})</h3>
              <p className="text-xs text-slate-500 font-medium">Pending actions and to-do list</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreateTaskOpen(true)} className="gap-2 bg-white shadow-sm border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
              <CheckSquare className="h-4 w-4" /> Add Task
            </Button>
          </div>

          <div className="space-y-2">
            {clientTasks.map((t) => {
              const targetDate = t.due_date_target || t.due_date;
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
                          {t.project_id && (
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${isCompleted ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                              {projectMap[t.project_id] || "Project"}
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
                          {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs font-bold">{s}</SelectItem>)}
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
            {clientTasks.length === 0 && (
              <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <ListChecks className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-medium">No active tasks or requests</p>
              </div>
            )}
          </div>
        </Card>

        {/* PROJECTS SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Projects ({projects.length})</h3>
            </div>
            <Link to={`/PMProjectWorkspace?client_id=${clientId}&new=true`}>
              <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm">
                <Plus className="h-4 w-4 mr-1" /> Create Project
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {projects.map(p => (
              <Link key={p.id} to={`/PMProjectWorkspace?id=${p.id}`}>
                <Card className="p-4 flex items-center justify-between hover:border-blue-300 transition-colors bg-slate-50/50">
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="text-sm font-bold text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs font-bold text-slate-500 truncate mt-0.5">{p.project_number}</p>
                  </div>
                  <div className="shrink-0"><StatusBadge status={p.status} /></div>
                </Card>
              </Link>
            ))}
            {projects.length === 0 && <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">No active projects</p>}
          </div>
        </Card>

        {/* QUOTES SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Quotes ({quotes.length})</h3>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <CreateQuoteFromTemplateDialog clientId={clientId}>
                <Button variant="outline" size="sm" className="gap-2 bg-white shadow-sm border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
                  <LayoutTemplate className="h-4 w-4" /> From Template
                </Button>
              </CreateQuoteFromTemplateDialog>
              <Link to={`/QuoteBuilder?client_id=${clientId}`}>
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
            {quotes.length === 0 && <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">No quotes created yet</p>}
          </div>
        </Card>

        {/* INVOICES SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Invoices ({invoices.length})</h3>
            </div>
            <Link to={`/InvoiceBuilder?client_id=${clientId}`}>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm hover:shadow">
                <Plus className="h-4 w-4 mr-1" /> Create Invoice
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {invoices.map(inv => (
              <Card key={inv.id} className="p-4 flex items-center justify-between bg-slate-50/50">
                <div>
                  <p className="text-sm font-bold text-slate-800">{inv.invoice_number}</p>
                  <p className="text-xs text-slate-500 font-medium">Total: ${inv.total?.toLocaleString() || "0"} · Due: ${inv.balance_due?.toLocaleString() || "0"}</p>
                </div>
                <StatusBadge status={inv.status} />
              </Card>
            ))}
            {invoices.length === 0 && <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">No invoices</p>}
          </div>
        </Card>

        {/* CHANGE ORDERS SECTION */}
        <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Change Orders ({changeOrders.length})</h3>
            </div>
            <Link to={`/ChangeOrderBuilder?client_id=${clientId}`}>
              <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm hover:shadow">
                <Plus className="h-4 w-4 mr-1" /> Create Change Order
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {changeOrders.map(co => (
              <Link key={co.id} to={`/ChangeOrderBuilder?id=${co.id}`}>
                <Card className="p-4 flex items-center justify-between hover:border-purple-300 transition-colors bg-slate-50/50">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{co.title || "Untitled Change Order"}</p>
                    <p className="text-xs text-slate-500 font-medium">{co.change_order_number} · ${co.total?.toLocaleString() || "0"}</p>
                  </div>
                  <StatusBadge status={co.status} />
                </Card>
              </Link>
            ))}
            {changeOrders.length === 0 && <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">No change orders</p>}
          </div>
        </Card>

        <PhotoGallery
          title="Client Photos"
          photos={clientPhotos.map(file => ({ id: file.id, url: file.file_url, name: file.file_name }))}
          isUploading={uploadingPhoto}
          onUpload={(files) => handlePhotoUpload({ target: { files } })}
          onDelete={(photo) => {
             if (window.confirm("Delete photo?")) {
               deleteAttachmentMutation.mutate(photo.id);
             }
          }}
        />

        <DocumentManager
          title="Client Documents"
          documents={clientDocuments.map(doc => ({ 
            id: doc.id, 
            url: doc.file_url, 
            name: doc.file_name, 
            description: doc.caption === "Client Document" ? "" : doc.caption // Hide default caption
          }))}
          isUploading={uploadingDoc}
          onUpload={(files) => handleDocUpload({ target: { files } })}
          onDelete={(doc) => deleteAttachmentMutation.mutate(doc.id)}
          onUpdateDescription={(doc, newDescription) => {
            updateAttachmentDescMutation.mutate({ id: doc.id, caption: newDescription || "Client Document" });
          }}
        />
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
        clients={[client]} 
        defaultClientId={client.id}
        projects={projects}
        vendors={vendors}
        users={users}
        onCreateVendor={canCreateVendor ? createVendor : undefined}
        isCreatingVendor={isCreatingVendor}
        isLoading={handleCreateTaskSubmit.isPending}
        onSubmit={(payload) => handleCreateTaskSubmit.mutate(payload)}
      />

      {/* EDIT TASK DIALOG */}
      <Dialog open={editTaskOpen} onOpenChange={setEditTaskOpen}>
        <DialogContent className="sm:max-w-xl w-[95vw] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6 bg-white" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900">Edit Task</DialogTitle></DialogHeader>
          
          <form onSubmit={(e) => { e.preventDefault(); handleEditTaskSubmit.mutate(editTaskForm); }} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
              <Input value={editTaskForm.title || ""} onChange={e => setEditTaskForm({...editTaskForm, title: e.target.value})} className="font-bold border-slate-200" required />
            </div>
            
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
              <Textarea value={editTaskForm.description || ""} onChange={e => setEditTaskForm({...editTaskForm, description: e.target.value})} className="flex min-h-[80px] w-full resize-none font-medium border-slate-200" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Project</Label>
                <Select value={projects.some(p => String(p.id) === String(editTaskForm.project_id)) ? String(editTaskForm.project_id) : "none"} onValueChange={v => setEditTaskForm({...editTaskForm, project_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>{p.name || `Project #${p.project_number}`}</SelectItem>
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
                      <SelectItem key={String(u.id)} value={String(u.id)}>{u.full_name || "Unknown User"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <Select value={STATUSES.includes(editTaskForm.status) ? editTaskForm.status : "Pending"} onValueChange={v => setEditTaskForm({...editTaskForm, status: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date (Optional)</Label>
                <Input type="date" value={editTaskForm.due_date_target || ""} onChange={e => setEditTaskForm({...editTaskForm, due_date_target: e.target.value})} className="font-medium border-slate-200 text-sm block w-full" />
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

      {/* EDIT CLIENT DIALOG */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] rounded-xl p-4 sm:p-6 bg-white" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="text-xl font-black">Edit Client Details</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Company / Client Name *</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="font-medium h-10 border-slate-200" />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Client Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData({...formData, type: v})}>
                  <SelectTrigger className="h-10 font-medium border-slate-200"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Homeowner">Homeowner</SelectItem>
                    <SelectItem value="Builder">Builder</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                    <SelectItem value="Property Manager">Property Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Primary Contact</Label>
                <Input value={formData.primary_contact_name} onChange={e => setFormData({...formData, primary_contact_name: e.target.value})} className="font-medium h-10 border-slate-200" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Email</Label>
                <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="font-medium h-10 border-slate-200" />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Phone</Label>
                <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="font-medium h-10 border-slate-200" />
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Billing Address</Label>
              <AddressAutocomplete
                value={formData.billing_address || ""}
                onChange={(v) => setFormData({ ...formData, billing_address: v })}
                placeholder="Start typing billing address..."
              />
            </div>
            
            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Site Address</Label>
              <AddressAutocomplete
                value={formData.site_address || ""}
                onChange={(v) => setFormData({ ...formData, site_address: v })}
                placeholder="Start typing site/project address..."
              />
            </div>
            
            <div>
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Internal Notes</Label>
              <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={3} className="font-medium bg-slate-50 border-slate-200" />
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="w-full sm:w-auto font-bold border-slate-300 order-2 sm:order-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!formData.name || updateMutation.isPending} className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-bold order-1 sm:order-2 shadow-md">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
