import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Search, FileText, Trash2, ExternalLink, Briefcase, UploadCloud, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";

const ITEMS_PER_PAGE = 10; // Maximum documents per page

export default function ClientForms() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  
  const [form, setForm] = useState({ 
    name: "", 
    project_id: "none" 
  });

  // 1. Fetch Projects (for the optional dropdown)
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId);
      return data || [];
    } 
  });

  // 2. Fetch Uploaded Resources
  const { data: resources = [], isLoading } = useQuery({ 
    queryKey: ["company_resources", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_resources")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
        
      if (error) throw error;
      return data || [];
    } 
  });

  // 3. Upload Mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please select a file to upload");
      
      setUploading(true);
      
      const fileExt = file.name.split('.').pop();
      const safeName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${companyId}/${safeName}`;
      
      const { error: uploadError } = await supabase.storage.from('resources').upload(filePath, file);
      if (uploadError) throw new Error("STORAGE_ERROR: " + uploadError.message);
      
      const { data: urlData } = supabase.storage.from('resources').getPublicUrl(filePath);
      
      const dbPayload = {
        company_id: companyId,
        project_id: form.project_id === "none" ? null : form.project_id,
        name: form.name,
        file_name: file.name,
        file_url: urlData.publicUrl
      };

      const { error: dbError } = await supabase.from("company_resources").insert([dbPayload]);
      if (dbError) throw new Error("DATABASE_ERROR: " + dbError.message);
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["company_resources"] }); 
      setDialogOpen(false); 
      setForm({ name: "", project_id: "none" });
      setFile(null);
      setUploading(false);
      setCurrentPage(1); // Reset to first page so they see their new upload
      toast.success("Document uploaded successfully!");
    },
    onError: (err) => {
      setUploading(false);
      console.error("Upload Error:", err);
      alert(`🚨 UPLOAD FAILED 🚨\n\n${err.message}\n\nPlease copy this exact message and send it to me!`);
    }
  });

  // 4. Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("company_resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_resources"] });
      toast.success("Document removed");
      
      // Auto-adjust page if we delete the last item on the current page
      if (currentItems.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
    }
  });

  // --- FILTER & PAGINATION LOGIC ---
  
  // Update search and reset back to page 1 instantly
  const handleSearch = (e) => {
    setSearch(e.target.value);
    setCurrentPage(1);
  };

  // 1. Filter out the search results first
  const filteredResources = resources.filter(res => 
    res.name.toLowerCase().includes(search.toLowerCase()) || 
    res.file_name.toLowerCase().includes(search.toLowerCase())
  );

  // 2. Calculate Pagination
  const totalPages = Math.ceil(filteredResources.length / ITEMS_PER_PAGE);
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  
  // 3. Get just the 10 items for the current page
  const currentItems = filteredResources.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      {/* HEADER & SEARCH */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Resource Library</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Upload and manage company flyers, licenses, and blank forms.</p>
        </div>
        
        <div className="flex w-full md:w-auto items-center gap-3">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search documents..." 
              value={search}
              onChange={handleSearch}
              className="pl-9 bg-white border-slate-200"
            />
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 shadow-md shrink-0 font-black">
            <Plus className="h-4 w-4 mr-1.5" /> Upload File
          </Button>
        </div>
      </div>

      {/* DOCUMENT LIST */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex justify-center items-center p-12">
            <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="text-center py-16 px-4">
            <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-700">No documents found</h3>
            <p className="text-sm text-slate-500 mt-1">
              {search ? "No results match your search." : "Upload your first flyer, warranty, or form to get started."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-500 tracking-wider">
                <tr>
                  <th className="px-6 py-4">Document Name</th>
                  <th className="px-6 py-4">Linked Project</th>
                  <th className="px-6 py-4">Date Uploaded</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentItems.map(res => (
                  <tr key={res.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 align-middle">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-amber-50 flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{res.name}</p>
                          <p className="text-[10px] font-medium text-slate-400">{res.file_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-middle">
                      {res.project_id && projects.find(p => p.id === res.project_id) ? (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-white">
                          <Briefcase className="h-3 w-3 mr-1" /> {projects.find(p => p.id === res.project_id)?.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400 italic">General / All</span>
                      )}
                    </td>
                    <td className="px-6 py-4 align-middle font-medium text-slate-600">
                      {res.created_at ? format(new Date(res.created_at), "MMM d, yyyy") : "Unknown"}
                    </td>
                    <td className="px-6 py-4 align-middle text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" asChild className="h-8 shadow-sm">
                          <a href={res.file_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View
                          </a>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => { if(confirm("Delete this document?")) deleteMutation.mutate(res.id); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINATION CONTROLS */}
        {!isLoading && filteredResources.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 hidden sm:inline-block">
              Showing <span className="font-bold text-slate-900">{indexOfFirstItem + 1}</span> to <span className="font-bold text-slate-900">{Math.min(indexOfLastItem, filteredResources.length)}</span> of <span className="font-bold text-slate-900">{filteredResources.length}</span> documents
            </span>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 bg-white"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <span className="text-xs font-bold text-slate-600 sm:hidden">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 bg-white"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || totalPages === 0}
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="h-4 w-4 sm:ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* UPLOAD DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !uploading && setDialogOpen(v)}>
        <DialogContent className="max-w-md bg-white border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">Upload New Resource</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Document Name *</Label>
              <Input 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                placeholder="e.g., 2026 Price Sheet, WCB Certificate..."
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Link to Project (Optional)</Label>
              <Select value={form.project_id} onValueChange={v => setForm({...form, project_id: v})}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General Document (Available for all)</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Attachment *</Label>
              <label className="mt-1 flex flex-col items-center justify-center gap-2 px-3 py-6 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl cursor-pointer hover:bg-amber-50 hover:border-amber-300 transition-colors">
                <UploadCloud className="h-6 w-6 text-slate-400" />
                <div className="text-center">
                  <span className="text-sm font-bold text-amber-600">Click to browse</span>
                  <p className="text-xs text-slate-500 mt-1">{file ? file.name : "PDF, DOCX, or Images"}</p>
                </div>
                <input type="file" className="hidden" onChange={e => setFile(e.target.files[0])} />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={uploading}>Cancel</Button>
              <Button 
                onClick={() => uploadMutation.mutate()} 
                disabled={!form.name || !file || uploading}
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold"
              >
                {uploading ? "Uploading..." : "Save Document"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}