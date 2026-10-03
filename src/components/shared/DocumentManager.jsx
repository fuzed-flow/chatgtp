import React, { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Trash2, Upload, Loader2, Edit3, ExternalLink } from "lucide-react";

export default function DocumentManager({ 
  title = "Documents", 
  subtitle = "Upload contracts, floor plans, and other records", 
  documents = [], // Expected: [{ id: '...', url: '...', name: '...', description: '...' }]
  onUpload, 
  onDelete, 
  onUpdateDescription,
  isUploading = false 
}) {
  const fileInputRef = useRef(null);
  
  // State for editing a document's description
  const [editingDoc, setEditingDoc] = useState(null);
  const [editDescription, setEditDescription] = useState("");

  const handleEditClick = (doc) => {
    setEditingDoc(doc);
    setEditDescription(doc.description || "");
  };

  const handleSaveDescription = () => {
    if (editingDoc && onUpdateDescription) {
      onUpdateDescription(editingDoc, editDescription);
    }
    setEditingDoc(null);
  };

  return (
    <>
      <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-400" /> {title}
            </h3>
            <p className="text-xs text-slate-500 font-medium">{subtitle}</p>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <input 
              ref={fileInputRef} 
              type="file" 
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" 
              multiple 
              className="hidden" 
              onChange={(e) => {
                if (e.target.files?.length) onUpload(e.target.files);
                e.target.value = ""; // Reset so same file can be selected again
              }} 
            />
            <Button 
              variant="outline" 
              size="sm" 
              className="font-bold border-slate-300 shadow-sm w-full sm:w-auto" 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {isUploading ? "Uploading..." : "Upload Document"}
            </Button>
          </div>
        </div>
        
        {/* Document List */}
        <div className="space-y-2">
          {documents.map((doc, idx) => (
            <div key={doc.id || idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50/50 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors gap-3">
              
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="h-10 w-10 rounded bg-blue-50 flex items-center justify-center border border-blue-100 shrink-0 mt-0.5">
                  <FileText className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-slate-700 hover:text-blue-700 truncate flex items-center gap-1.5 w-fit">
                    <span className="truncate">{doc.name}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                  </a>
                  {doc.description ? (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{doc.description}</p>
                  ) : (
                    <p className="text-xs text-slate-400 italic mt-0.5">No description</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                <Button size="icon" variant="ghost" onClick={() => handleEditClick(doc)} className="text-slate-400 hover:bg-blue-50 hover:text-blue-600 h-8 w-8">
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if(window.confirm("Delete document?")) onDelete(doc); }} className="text-slate-400 hover:bg-red-50 hover:text-red-600 h-8 w-8">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {documents.length === 0 && !isUploading && (
            <p className="text-sm text-slate-500 font-medium italic bg-slate-50 p-6 rounded-lg border border-dashed border-slate-200 text-center">
              No documents uploaded yet.
            </p>
          )}
        </div>
      </Card>

      {/* Description Edit Modal */}
      <Dialog open={!!editingDoc} onOpenChange={(val) => !val && setEditingDoc(null)}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Document Description</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              value={editDescription} 
              onChange={(e) => setEditDescription(e.target.value)} 
              placeholder="e.g., Signed Contract, Revised Floor Plan..."
              className="w-full"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDoc(null)}>Cancel</Button>
            <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={handleSaveDescription}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}