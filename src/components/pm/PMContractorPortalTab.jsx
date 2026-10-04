import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Upload, Trash2, FileText, Copy, ExternalLink, CheckCircle2, Globe, Lock, FolderPlus, FileImage, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function PMContractorPortalTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);
  
  // Existing files sharing state
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedToShare, setSelectedToShare] = useState([]);

  // Scope of Work state
  const [isEditingScope, setIsEditingScope] = useState(false);
  const [scopeText, setScopeText] = useState(project?.description || "");

  // Keep scope in sync if project prop updates
  useEffect(() => {
    setScopeText(project?.description || "");
  }, [project?.description]);

  const portalUrl = `${window.location.origin}/contractor-portal?projectId=${project.id}`;

  // --- SUPABASE QUERIES ---
  const { data: portalFiles = [] } = useQuery({
    queryKey: ["contractor_portal_files", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("contractor_portal_files").select("*").eq("project_id", project.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: existingDocs = [] } = useQuery({
    queryKey: ["project_documents", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data } = await supabase.from("project_documents").select("*").eq("project_id", project.id);
      return data || [];
    },
  });

  const { data: existingPlans = [] } = useQuery({
    queryKey: ["project_drawings", project?.id],
    enabled: !!project?.id,
    queryFn: async () => {
      const { data } = await supabase.from("project_drawings").select("*").eq("project_id", project.id);
      return data || [];
    },
  });

  // --- SUPABASE MUTATIONS ---
  const updateScope = useMutation({
    mutationFn: async (newScope) => {
      const { error, data } = await supabase
        .from("projects")
        .update({ description: newScope })
        .eq("id", project.id)
        .select(); // Added .select() to force Postgres to confirm the save

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No permissions to update this project.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm_project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Scope of Work updated!");
      setIsEditingScope(false);
    },
    onError: (err) => {
      // Changed to a loud alert so we can read the exact error!
      alert(`Failed to update scope: ${err.message}`); 
    }
  });

  const createFile = useMutation({
    mutationFn: async (d) => {
      const payload = { ...d, company_id: companyId, project_id: project.id };
      const { error } = await supabase.from("contractor_portal_files").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contractor_portal_files", project.id] }),
  });

  const deleteFile = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("contractor_portal_files").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contractor_portal_files", project.id] });
      toast.success("Document removed from portal");
    }
  });

  // NATIVE SUPABASE STORAGE BULK UPLOADER
  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    toast.loading(`Uploading ${files.length} document(s)...`);
    
    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `${project.id}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage.from('contractor_portal').upload(filePath, file);
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from('contractor_portal').getPublicUrl(filePath);

        await createFile.mutateAsync({
          file_url: publicData.publicUrl,
          file_name: file.name,
          description: description || "",
        });
      }
      
      setDescription("");
      toast.dismiss();
      toast.success("Document(s) successfully uploaded to portal!");
    } catch (err) {
      toast.dismiss();
      alert(`Upload Error: ${err.message || "Failed to upload file(s)."}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // SHARE EXISTING FILES LOGIC
  const handleShareExisting = async () => {
    if (selectedToShare.length === 0) return;
    toast.loading(`Adding ${selectedToShare.length} files to portal...`);
    try {
      for (const file of selectedToShare) {
        await createFile.mutateAsync({
          file_url: file.file_url,
          file_name: file.file_name || file.title,
          description: file.source === 'Plan' ? `Drawing: ${file.drawing_type}` : `Doc: ${file.doc_type}`,
        });
      }
      setShareOpen(false);
      setSelectedToShare([]);
      toast.dismiss();
      toast.success("Files shared to portal successfully!");
    } catch (err) {
      toast.dismiss();
      alert(`Database Error: ${err.message || "Unknown error occurred"}`);
      console.error("Full error:", err);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const portalUrls = portalFiles.map(pf => pf.file_url);
  const unsharedFiles = [
    ...existingDocs.map(d => ({ ...d, source: 'Doc' })),
    ...existingPlans.map(p => ({ ...p, source: 'Plan' }))
  ].filter(f => !portalUrls.includes(f.file_url));

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* 1. Portal Link Card */}
      <Card className="border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-amber-900 text-sm mb-1">Public Contractor Portal Link</p>
              <p className="text-xs text-amber-700/80 mb-3 leading-relaxed max-w-xl">
                Share this unique link with bidding sub-contractors or temporary workers so they can view the scope of work and site files without needing an account.
              </p>
              <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
                <input
                  readOnly
                  value={portalUrl}
                  className="flex-1 w-full sm:w-auto text-xs font-medium bg-white border border-amber-300 rounded-md px-3 py-2 text-slate-700 truncate focus:outline-none"
                />
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button size="sm" variant="outline" onClick={copyLink} className="flex-1 sm:flex-none border-amber-300 text-amber-800 hover:bg-amber-100/50">
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none border-amber-300 text-amber-800 hover:bg-amber-100/50" onClick={() => window.open(portalUrl, "_blank")}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Scope of Work Editor */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardContent className="p-5">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Scope of Work</h3>
              <p className="text-xs text-slate-500 mt-0.5">Define the project details and expectations for your contractors.</p>
            </div>
            {!isEditingScope && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setIsEditingScope(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Scope
              </Button>
            )}
          </div>

          {isEditingScope ? (
            <div className="space-y-3 mt-4">
              <textarea
                className="w-full min-h-[150px] p-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-y"
                placeholder="Type your detailed scope of work, instructions, and expectations here..."
                value={scopeText}
                onChange={(e) => setScopeText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIsEditingScope(false); setScopeText(project?.description || ""); }}>
                  Cancel
                </Button>
                <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white" disabled={updateScope.isPending} onClick={() => updateScope.mutate(scopeText)}>
                  {updateScope.isPending ? "Saving..." : "Save Scope"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 mt-3">
              {scopeText ? (
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{scopeText}</p>
              ) : (
                <p className="text-sm text-slate-400 italic">No scope of work defined yet. Click edit to add instructions for contractors.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Upload & Select Existing Section */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <h3 className="text-sm font-bold text-slate-800">Add Documents to Portal</h3>
          <Button variant="outline" size="sm" className="bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 w-full sm:w-auto" onClick={() => setShareOpen(true)}>
            <FolderPlus className="h-4 w-4 mr-2 text-amber-600" /> Choose Existing Files
          </Button>
        </div>
        
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div>
            <Label className="text-xs font-semibold text-slate-600">New File Description (Optional)</Label>
            <Input
              className="mt-1"
              placeholder="e.g. Redlined Floor Plan..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <label className={`flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploading ? 'border-amber-300 bg-amber-50' : 'border-slate-300 hover:border-amber-400 hover:bg-slate-50'}`}>
            <input type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
            <Upload className={`h-6 w-6 ${uploading ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`} />
            <span className="text-sm font-semibold text-slate-700">
              {uploading ? "Uploading to portal..." : "Click to upload a brand new file"}
            </span>
            <span className="text-xs text-slate-500">Supports PDF, Images, DOCX</span>
          </label>
        </div>
      </div>

      {/* 4. Document List */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-800">Files Visible to Contractors</h3>
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{portalFiles.length} Total</span>
        </div>
        
        {portalFiles.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <Lock className="h-8 w-8 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600">No documents uploaded yet.</p>
            <p className="text-xs mt-1">Upload or share documents above for them to appear in the portal.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {portalFiles.map(f => (
              <div key={f.id} className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:border-amber-300 hover:shadow-sm transition-all group">
                <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0 border border-amber-100">
                  <FileText className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <a 
                    href={f.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-sm font-bold text-slate-900 truncate block hover:text-blue-600 hover:underline"
                    title="Open document"
                  >
                    {f.file_name}
                  </a>
                  {f.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{f.description}</p>}
                </div>
                <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600" onClick={() => {
                    if (window.confirm("Remove this document from the contractor portal?")) deleteFile.mutate(f.id);
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Share Existing Files Dialog */}
      <Dialog open={shareOpen} onOpenChange={(v) => { setShareOpen(v); if(!v) setSelectedToShare([]); }}>
        <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Share Existing Project Files</DialogTitle>
            <p className="text-xs text-slate-500">Select files from your internal Quotes & Documents or Plans tabs to share publicly.</p>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto mt-2 space-y-2 border border-slate-100 rounded-lg p-2 bg-slate-50">
            {unsharedFiles.length === 0 ? (
              <p className="text-center text-slate-400 py-10 text-sm">All existing files have already been shared to the portal!</p>
            ) : (
              unsharedFiles.map((file, i) => {
                const isSelected = selectedToShare.some(s => s.id === file.id);
                const Icon = file.source === 'Plan' ? FileImage : FileText;
                return (
                  <div 
                    key={i} 
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white border-slate-200 hover:border-amber-300'}`}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedToShare(prev => prev.filter(s => s.id !== file.id));
                      } else {
                        setSelectedToShare(prev => [...prev, file]);
                      }
                    }}
                  >
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                      {isSelected && <CheckCircle2 className="h-3 w-3 text-slate-900" />}
                    </div>
                    <div className="h-8 w-8 bg-slate-100 rounded flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{file.file_name || file.title}</p>
                      <p className="text-[10px] font-bold uppercase text-slate-400">{file.source === 'Plan' ? `Plan: ${file.drawing_type}` : `Doc: ${file.doc_type}`}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t mt-2">
            <span className="text-sm font-semibold text-slate-600">{selectedToShare.length} selected</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShareOpen(false)}>Cancel</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={selectedToShare.length === 0} onClick={handleShareExisting}>
                Share to Portal
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
