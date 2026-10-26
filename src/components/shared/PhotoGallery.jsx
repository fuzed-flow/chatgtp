import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Trash2, Upload, Loader2, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cachedGalleryImage, canPreloadGalleryImages, galleryThumbnailUrl, galleryViewerUrl, preloadGalleryImage } from "@/lib/galleryImages";

export { galleryThumbnailUrl } from "@/lib/galleryImages";

// ⚡ PERFORMANCE FIX: Individual Image Component with progressive loading
const INITIAL_PHOTO_COUNT = 5;
const PRELOAD_PHOTO_COUNT = 15;

const GalleryViewer = ({ photo, onReady }) => {
  const viewerUrl = galleryViewerUrl(photo.url);
  const [image, setImage] = useState(() => cachedGalleryImage(viewerUrl));
  const [previewUrl, setPreviewUrl] = useState(() => galleryThumbnailUrl(photo.url));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let loaded = await preloadGalleryImage(viewerUrl, "high");
      if (cancelled) return;
      // Only the selected image may fall back to the original if resizing fails.
      if (!loaded && viewerUrl !== photo.url) loaded = await preloadGalleryImage(photo.url, "high");
      if (cancelled) return;
      if (loaded) {
        setImage(loaded);
        onReady(photo.url);
      } else {
        setFailed(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [viewerUrl, photo.url, onReady]);

  return (
    <div className="relative flex min-h-[240px] w-full items-center justify-center" aria-busy={!image && !failed} data-gallery-viewer>
      <img
        src={image?.src || previewUrl}
        width={image?.naturalWidth}
        height={image?.naturalHeight}
        loading="eager"
        decoding="async"
        alt={photo.name || "Full screen view"}
        onError={() => {
          if (!image && previewUrl !== photo.url) setPreviewUrl(photo.url);
        }}
        className="max-w-full max-h-[85vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
      />
      {!image && (
        <div className="absolute bottom-4 rounded-lg bg-black/70 px-3 py-2 text-sm text-white" role={failed ? "alert" : "status"}>
          {failed ? "Unable to load this photo. Try opening the original." : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading photo…</span>}
        </div>
      )}
    </div>
  );
};

const GalleryImage = ({ photo, onClick, onDelete, eager = false }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const thumbnailUrl = useMemo(() => galleryThumbnailUrl(photo.url), [photo.url]);
  const [source, setSource] = useState(thumbnailUrl);

  useEffect(() => {
    setIsLoaded(false);
    setSource(thumbnailUrl);
  }, [thumbnailUrl]);

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
        src={source}
        alt={photo.name || "Gallery image"}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (source !== photo.url) setSource(photo.url);
          else setIsLoaded(true);
        }}
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
  const [visibleCount, setVisibleCount] = useState(INITIAL_PHOTO_COUNT);
  const [readyPhotoUrl, setReadyPhotoUrl] = useState(null);
  // Parent pages build photo objects on each render; keep preload work stable.
  const photoUrlKey = JSON.stringify(photos.map(photo => photo.url));
  const photoUrls = useMemo(() => JSON.parse(photoUrlKey), [photoUrlKey]);
  const activePhoto = viewingIndex === null ? null : photos[viewingIndex];
  const handlePhotoReady = useCallback(url => setReadyPhotoUrl(url), []);

  useEffect(() => {
    setVisibleCount(current => Math.min(Math.max(current, INITIAL_PHOTO_COUNT), Math.max(photos.length, INITIAL_PHOTO_COUNT)));
  }, [photos.length]);

  useEffect(() => {
    if (viewingIndex !== null || !canPreloadGalleryImages()) return;
    let cancelled = false;
    const preload = async () => {
      const thumbnails = photoUrls.slice(0, PRELOAD_PHOTO_COUNT).map(url => galleryThumbnailUrl(url));
      const viewers = photoUrls.slice(0, INITIAL_PHOTO_COUNT).map(url => galleryViewerUrl(url)).filter((url, index) => url !== photoUrls[index]);
      for (const url of [...thumbnails, ...viewers]) {
        if (cancelled) break;
        await preloadGalleryImage(url);
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => { cancelled = true; window.cancelIdleCallback(handle); };
    }
    const handle = window.setTimeout(preload, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [photoUrls, viewingIndex]);

  useEffect(() => {
    if (viewingIndex === null || readyPhotoUrl !== photoUrls[viewingIndex] || photoUrls.length < 2 || !canPreloadGalleryImages()) return;
    let cancelled = false;
    const preloadNeighbours = async () => {
      const neighbours = new Set([photoUrls[(viewingIndex + 1) % photoUrls.length], photoUrls[(viewingIndex - 1 + photoUrls.length) % photoUrls.length]]);
      for (const original of neighbours) {
        if (cancelled) break;
        const url = galleryViewerUrl(original);
        if (url !== original) await preloadGalleryImage(url);
      }
    };
    void preloadNeighbours();
    return () => { cancelled = true; };
  }, [photoUrls, viewingIndex, readyPhotoUrl]);

  const visiblePhotos = photos.slice(0, visibleCount);

  return (
    <>
      <Card className="p-5 border-slate-200/80 shadow-sm bg-white rounded-xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-slate-400" /> {title} ({photos.length})
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
           {visiblePhotos.map((photo, i) => (
             <GalleryImage 
               key={photo.id || i} 
               photo={photo} 
               onClick={() => { setReadyPhotoUrl(null); setViewingIndex(i); }}
               onDelete={onDelete} 
               eager={i < INITIAL_PHOTO_COUNT}
             />
           ))}
           {photos.length === 0 && !isUploading && (
             <div className="col-span-full py-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
               <ImageIcon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
               <p className="text-sm font-medium text-slate-500">No photos uploaded yet.</p>
             </div>
           )}
        </div>

        {photos.length > INITIAL_PHOTO_COUNT && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 border-t border-slate-100 pt-4">
            {visibleCount < Math.min(PRELOAD_PHOTO_COUNT, photos.length) && (
              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount(Math.min(PRELOAD_PHOTO_COUNT, photos.length))}>
                <ChevronDown className="mr-1 h-4 w-4" /> See {Math.min(10, photos.length - visibleCount)} more
              </Button>
            )}
            {visibleCount >= Math.min(PRELOAD_PHOTO_COUNT, photos.length) && visibleCount < photos.length && (
              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount(photos.length)}>
                <ChevronDown className="mr-1 h-4 w-4" /> See all ({photos.length})
              </Button>
            )}
            {visibleCount > INITIAL_PHOTO_COUNT && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(INITIAL_PHOTO_COUNT)}>
                <ChevronUp className="mr-1 h-4 w-4" /> Show less
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Internal Full-Screen Lightbox */}
      <Dialog open={viewingIndex !== null} onOpenChange={(val) => !val && setViewingIndex(null)}>
        <DialogContent className="max-w-5xl w-[95vw] p-1 bg-transparent border-none shadow-none" aria-describedby={undefined}>
          <DialogTitle className="sr-only">View Photo</DialogTitle>
          <div className="relative flex items-center justify-center group">
             {activePhoto && (
               <a href={activePhoto.url} target="_blank" rel="noopener noreferrer" className="absolute top-2 left-2 z-50 rounded-lg bg-black/60 px-3 py-2 text-sm font-medium text-white hover:bg-black/80">Open original</a>
             )}
             <Button aria-label="Close photo" variant="ghost" size="icon" className="absolute top-2 right-2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm" onClick={() => setViewingIndex(null)}>
               <X className="h-5 w-5"/>
             </Button>
             
             {photos.length > 1 && (
               <>
                 <Button aria-label="Previous photo" variant="ghost" size="icon" className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm h-10 w-10 sm:h-12 sm:w-12 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setReadyPhotoUrl(null); setViewingIndex(prev => prev > 0 ? prev - 1 : photos.length - 1); }}>
                   <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
                 </Button>
                 <Button aria-label="Next photo" variant="ghost" size="icon" className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white bg-black/50 hover:bg-black/80 rounded-full z-50 backdrop-blur-sm h-10 w-10 sm:h-12 sm:w-12 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setReadyPhotoUrl(null); setViewingIndex(prev => prev < photos.length - 1 ? prev + 1 : 0); }}>
                   <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
                 </Button>
               </>
             )}

             {activePhoto && (
               <GalleryViewer key={activePhoto.url} photo={activePhoto} onReady={handlePhotoReady} />
             )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
