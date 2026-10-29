import React, { useEffect, useState } from 'react';
import { ImageIcon, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { galleryViewerUrl, preloadGalleryImage, cachedGalleryImage, canPreloadGalleryImages, productThumbnailUrl } from '@/lib/galleryImages';

export default function ProductImage({ src, name = 'Product', className = 'h-16 w-16', eager = false }) {
  const thumbnail = productThumbnailUrl(src);
  const [source, setSource] = useState(thumbnail);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [large, setLarge] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [largeFailed, setLargeFailed] = useState(false);
  useEffect(() => { setSource(thumbnail); setFailed(false); setLarge(null); }, [thumbnail]);
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    setLargeFailed(false);
    setZoom(false);
    const url = galleryViewerUrl(src);
    const cached = cachedGalleryImage(url) || cachedGalleryImage(src);
    setLarge(cached?.src || null);
    if (cached) return () => { cancelled = true; };
    void (async () => {
      let image = await preloadGalleryImage(url, 'high');
      if (!image && url !== src) image = await preloadGalleryImage(src, 'high');
      if (!cancelled) { setLarge(image?.src || null); setLargeFailed(!image); }
    })();
    return () => { cancelled = true; };
  }, [open, src]);
  const warm = () => { if (src && canPreloadGalleryImages()) void preloadGalleryImage(galleryViewerUrl(src)); };
  return <>
    <button type="button" onClick={() => src && setOpen(true)} onPointerEnter={warm} onFocus={warm}
      aria-label={src ? `Open full-screen photo for ${name}` : `No photo for ${name}`} disabled={!src}
      className={`${className} shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-60 ${src ? 'cursor-zoom-in' : ''}`}>
      {src && !failed ? <img src={source} alt={name} width="160" height="160" loading={eager ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-contain"
        onError={() => { if (source !== src) setSource(src); else setFailed(true); }} /> : <ImageIcon className="m-auto h-6 w-6 text-slate-500" />}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showAIHelp={false} aria-describedby={undefined} className="!inset-0 !flex !h-[100dvh] !max-h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 flex-col !rounded-none border-0 bg-slate-950 p-4 text-white sm:p-6" closeButtonClassName="!right-4 !top-4 !flex !h-11 !w-11 !items-center !justify-center !rounded-full !bg-slate-800 !text-white !opacity-100">
        <div className="flex min-h-12 items-start gap-3 pr-14"><DialogTitle className="min-w-0 flex-1 break-words text-base leading-6 text-white">{name}</DialogTitle>
          <button type="button" aria-label={zoom ? 'Zoom out' : 'Zoom in'} onClick={() => setZoom(v => !v)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-800 focus-visible:ring-4 focus-visible:ring-amber-400">{zoom ? <ZoomOut /> : <ZoomIn />}</button></div>
        <div className={`min-h-0 flex-1 overflow-auto ${zoom ? "block" : "flex items-center justify-center"}`} style={{touchAction:'pan-x pan-y pinch-zoom'}} aria-busy={!large && !largeFailed}>
          <img src={large || source} alt={name} className={zoom ? 'max-w-none w-[180%] shrink-0 self-start object-contain' : 'max-h-full max-w-full object-contain'} />
        </div>
        {!large && <p role="status" className="flex shrink-0 items-center justify-center gap-2 text-sm text-slate-200">{largeFailed ? 'The full-size photo could not load. Showing the available preview.' : <><Loader2 className="h-4 w-4 animate-spin" /> Loading detailed photo…</>}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
