import React, { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { format, parseISO } from "date-fns";
import { 
  ImageIcon, X, ChevronLeft, ChevronRight, ZoomIn, 
  Calendar, Download, Loader2, Camera, ArrowLeft 
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ClientProjectPhotos({ projectId, onClose }) {
  // --- LIGHTBOX STATE ---
  const [lightbox, setLightbox] = useState({
    isOpen: false,
    photos: [],
    currentIndex: 0
  });

  // Touch handling state for swipe functionality on mobile
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Minimum swipe distance threshold (in px)
  const minSwipeDistance = 50;

  // --- FETCH PHOTOS ---
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["client_project_photos", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_daily_logs")
        .select("id, date, summary, photos")
        .eq("project_id", projectId)
        .order("date", { ascending: false });
        
      if (error) throw error;
      return data || [];
    }
  });

  // --- FLATTEN PHOTOS FOR GALLERY ---
  const allPhotos = useMemo(() => {
    const flattened = [];
    logs.forEach(log => {
      if (log.photos && Array.isArray(log.photos)) {
        log.photos.forEach(photoUrl => {
          flattened.push({
            url: photoUrl,
            date: log.date,
            caption: log.summary || "Project update",
            logId: log.id
          });
        });
      }
    });
    return flattened;
  }, [logs]);

  // Prevent background body scrolling when lightbox is active on mobile
  useEffect(() => {
    if (lightbox.isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [lightbox.isOpen]);

  // --- LIGHTBOX HANDLERS ---
  const openLightbox = (index) => {
    setLightbox({ isOpen: true, photos: allPhotos, currentIndex: index });
  };

  const closeLightbox = () => {
    setLightbox({ isOpen: false, photos: [], currentIndex: 0 });
  };

  const nextPhoto = (e) => {
    if (e) e.stopPropagation();
    setLightbox(prev => ({ 
      ...prev, 
      currentIndex: Math.min(prev.currentIndex + 1, prev.photos.length - 1) 
    }));
  };

  const prevPhoto = (e) => {
    if (e) e.stopPropagation();
    setLightbox(prev => ({ 
      ...prev, 
      currentIndex: Math.max(prev.currentIndex - 1, 0) 
    }));
  };

  // --- MOBILE SWIPE CONTROLS ---
  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && lightbox.currentIndex < lightbox.photos.length - 1) {
      nextPhoto();
    }
    if (isRightSwipe && lightbox.currentIndex > 0) {
      prevPhoto();
    }
  };

  const downloadPhoto = async (url, e) => {
    e.stopPropagation();
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `project-photo-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Failed to download image", err);
    }
  };

  if (!projectId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 overflow-hidden w-full min-h-[300px]">
        <Loader2 className="h-10 w-10 animate-spin mb-4 text-amber-500" />
        <p className="font-medium">Loading project photos...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden p-3 sm:p-6 space-y-4">
      
      {/* MOBILE BACK / CLOSE BAR */}
      {onClose && (
        <div className="flex items-center justify-between pb-2 border-b border-slate-200 sm:hidden">
          <button 
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm font-bold text-slate-700 active:text-amber-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Project
          </button>
          <button 
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 active:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6 text-amber-500 shrink-0" /> Project Gallery
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            Visual updates and progress from your job site.
          </p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
          <div className="bg-slate-100 text-slate-600 font-bold px-3 py-1.5 rounded-lg text-xs sm:text-sm border border-slate-200 shadow-sm inline-flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" /> {allPhotos.length} Photos
          </div>
          {/* DESKTOP CLOSE BUTTON */}
          {onClose && (
            <Button onClick={onClose} variant="ghost" className="hidden sm:flex bg-slate-200 hover:bg-slate-300 text-slate-700 h-9 px-3">
              <X className="h-4 w-4 mr-1" /> Close
            </Button>
          )}
        </div>
      </div>

      {/* PHOTO GRID */}
      {allPhotos.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-slate-200 shadow-sm border-dashed bg-slate-50">
          <div className="mx-auto h-12 w-12 sm:h-16 sm:w-16 bg-white rounded-full flex items-center justify-center border border-slate-200 shadow-sm mb-3">
            <ImageIcon className="h-6 w-6 sm:h-8 sm:w-8 text-slate-300" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-1">No Photos Yet</h3>
          <p className="text-xs sm:text-sm text-slate-500">Photos will appear here as updates are uploaded.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {allPhotos.map((photo, index) => (
            <div 
              key={`${photo.logId}-${index}`}
              className="group relative aspect-square rounded-lg sm:rounded-xl overflow-hidden bg-slate-100 cursor-pointer shadow-sm border border-slate-200"
              onClick={() => openLightbox(index)}
            >
              <img 
                src={photo.url} 
                alt={photo.caption} 
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-70"></div>
              
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-full text-white">
                  <ZoomIn className="h-5 w-5" />
                </div>
              </div>

              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 text-white/90">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-[10px] sm:text-xs font-bold tracking-wide truncate">
                  {photo.date ? format(parseISO(photo.date), "MMM d, yyyy") : "Unknown Date"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FULLSCREEN TOUCH-ENABLED LIGHTBOX */}
      {lightbox.isOpen && (
        <div 
          className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex items-center justify-center w-full h-[100dvh] overflow-hidden select-none"
          onClick={closeLightbox}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* OVERLAY CONTROLS */}
          <div className="absolute top-3 left-3 right-3 flex justify-between items-center z-20 pointer-events-none">
            <div className="bg-black/50 backdrop-blur-md text-white/90 px-3 py-1.5 rounded-lg pointer-events-auto max-w-[65%]">
              <p className="font-bold text-xs sm:text-sm flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                {lightbox.photos[lightbox.currentIndex]?.date 
                  ? format(parseISO(lightbox.photos[lightbox.currentIndex].date), "MMMM d, yyyy") 
                  : "Date Unknown"}
              </p>
              {lightbox.photos[lightbox.currentIndex]?.caption && (
                <p className="text-[10px] sm:text-xs text-white/70 mt-0.5 truncate">
                  {lightbox.photos[lightbox.currentIndex].caption}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              <button 
                onClick={(e) => downloadPhoto(lightbox.photos[lightbox.currentIndex].url, e)}
                className="text-white/80 hover:text-white bg-white/15 active:bg-white/30 rounded-full p-2.5 transition-all backdrop-blur-md"
                title="Download Photo"
              >
                <Download className="h-5 w-5" />
              </button>
              <button 
                onClick={closeLightbox}
                className="text-white/80 hover:text-white bg-white/15 active:bg-white/30 rounded-full p-2.5 transition-all backdrop-blur-md"
                title="Close Gallery"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* DESKTOP PREVIOUS BUTTON */}
          {lightbox.currentIndex > 0 && (
            <button 
              className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-3 transition-all backdrop-blur-sm z-20"
              onClick={prevPhoto}
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {/* IMAGE CONTAINER */}
          <div className="w-full h-full p-2 sm:p-10 flex items-center justify-center">
            <img 
              src={lightbox.photos[lightbox.currentIndex].url} 
              alt="Project full view" 
              className="max-w-full max-h-[82dvh] object-contain rounded-md shadow-2xl transition-transform duration-200" 
              onClick={(e) => e.stopPropagation()} 
            />
          </div>

          {/* DESKTOP NEXT BUTTON */}
          {lightbox.currentIndex < lightbox.photos.length - 1 && (
            <button 
              className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-3 transition-all backdrop-blur-sm z-20"
              onClick={nextPhoto}
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          {/* COUNTER BADGE */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md text-white font-bold text-xs tracking-widest px-3 py-1.5 rounded-full z-20 pointer-events-none">
            {lightbox.currentIndex + 1} / {lightbox.photos.length}
          </div>
        </div>
      )}
    </div>
  );
}