import React, { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Trash2, Upload, Loader2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// ⚡ PERFORMANCE FIX: Individual Image Component with progressive loading
const GalleryImage = ({ photo, onClick, onDelete }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50 relative group shadow-sm">
      {/* Skeleton Placeholder - Shows instantly, prevents UI lag */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 animate-pulse">
          <ImageIcon className="h-6 w-6 text-slate-300" />
        </div>
      )}
      
      {/* Actual Image - Downloads in background, fades in when ready */}
      <img
        src={photo.url}
        alt={photo.name || "Gallery image"}
        loading="lazy" // Tells browser not to load off-screen images
        onLoad={() => setIsLoaded(true)}
        onClick={onClick}
        className={`h-full w-full object-cover cursor-zoom-in group-hover:scale-110 transition-all duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
      
      {isLoaded && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(photo); }}
          className="absolute top-1.5 right-1.5 bg-red-600/90 hover:bg-red-600 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export default function PhotoGallery({ 
  title = "Photos", 
  subtitle = "Site photos, inspiration, or condition references", 
  photos = [], // Expected format: [{ id: '1', url: '...', name: '...' }]
  onUpload, 
  onDelete, 
  isUploading = false 
}) {
  const fileInputRef = useRef(null);
  const [viewingIndex, setViewingIndex] = useState(null);

  return (
    <>
      <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-slate-400" /> {title}
            </h3>
            <p className="text-xs text-slate-500 font-medium">{subtitle}</p>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <input 
              ref={fileInputRef} 
              type="file" 
              accept="image/*" 
              multiple 
              className="hidden" 
              onChange={(e) => {
                if (e.target.files?.length) onUpload(e.target.files);
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
              {isUploading ? "Uploading..." : "Upload Photos"}
            </Button>
          </div>
        </div>
        
        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 min-h-[100px]">
           {photos.map((photo, i) => (
             <GalleryImage 
               key={photo.id || i} 
               photo={photo} 
               onClick={() => setViewingIndex(i)} 
               onDelete={onDelete} 
             />
           ))}
           {photos.length === 0 && !isUploading && (
             <div className="col-span-full py-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
               <ImageIcon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
               <p className="text-sm font-medium text-slate-500">No photos uploaded yet.</p>
             </div>
           )}
        </div>
      </Card>

      {/* Internal Full-Screen Lightbox */}
      <Dialog open={viewingIndex !== null} onOpenChange={(val) => !val && setViewingIndex(null)}>
        <DialogContent className="max-w-5xl w-[95vw] p-1 bg-transparent border-none shadow-none" aria-describedby={undefined}>
          <DialogTitle className="sr-only">View Photo</DialogTitle>
          <div className="relative flex items-center justify-center group">
             <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm" onClick={() => setViewingIndex(null)}>
               <X className="h-5 w-5"/>
             </Button>
             
             {photos.length > 1 && (
               <>
                 <Button variant="ghost" size="icon" className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm h-10 w-10 sm:h-12 sm:w-12 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setViewingIndex(prev => prev > 0 ? prev - 1 : photos.length - 1); }}>
                   <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
                 </Button>
                 <Button variant="ghost" size="icon" className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm h-10 w-10 sm:h-12 sm:w-12 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setViewingIndex(prev => prev < photos.length - 1 ? prev + 1 : 0); }}>
                   <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
                 </Button>
               </>
             )}

             {viewingIndex !== null && photos[viewingIndex] && (
               <img src={photos[viewingIndex].url} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" alt={`Full screen view`} />
             )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}