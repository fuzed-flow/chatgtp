import React, { useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { Button } from "@/components/ui/button";
import { Upload, Trash2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LeadFilesSection({ lead, onUpdate }) {
  const docInputRef = useRef();
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Safely parse JSONB array or fallback to empty array
  const documents = lead?.documents || [];

  const handleDocUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingDoc(true);
    
    try {
      const uploadedDocs = [];
      for (const file of files) {
        // Create a unique file name
        const fileExt = file.name.split('.').pop();
        const fileName = `${lead.id}/doc-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('lead_files')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: { publicUrl } } = supabase.storage
          .from('lead_files')
          .getPublicUrl(fileName);

        uploadedDocs.push({ file_url: publicUrl, file_name: file.name });
      }

      // Update the Lead record
      const updatedDocs = [...documents, ...uploadedDocs];
      await onUpdate({ documents: updatedDocs });
      toast.success("Document(s) uploaded successfully");
      
    } catch (error) {
      toast.error("Failed to upload documents: " + error.message);
    } finally {
      setUploadingDoc(false);
      e.target.value = "";
    }
  };

  const removeDoc = async (idx) => {
    const updated = documents.filter((_, i) => i !== idx);
    await onUpdate({ documents: updated });
    toast.success("Document removed");
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-end mb-3">
        <Button size="sm" variant="outline" className="font-bold border-slate-300 shadow-sm" onClick={() => docInputRef.current?.click()} disabled={uploadingDoc}>
          {uploadingDoc ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {uploadingDoc ? "Uploading..." : "Upload Document"}
        </Button>
        <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple className="hidden" onChange={handleDocUpload} />
      </div>

      {documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
              <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-slate-700 hover:text-blue-700 font-bold truncate pr-4">
                <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="truncate">{doc.file_name}</span>
              </a>
              <Button size="icon" variant="ghost" onClick={() => removeDoc(idx)} className="text-slate-400 hover:bg-red-100 hover:text-red-700 h-8 w-8 shrink-0">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500 font-medium italic bg-slate-50 p-6 rounded-lg border border-dashed border-slate-200 text-center">
          No documents uploaded yet.
        </p>
      )}
    </div>
  );
}