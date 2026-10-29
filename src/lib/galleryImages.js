const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";
const MAX_CACHED_IMAGES = 16;
const imageCache = new Map();

function transformedUrl(url, size, resize, quality) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith(PUBLIC_OBJECT_PATH) && !parsed.pathname.startsWith(PUBLIC_RENDER_PATH)) return url;
    parsed.pathname = parsed.pathname.replace(PUBLIC_OBJECT_PATH, PUBLIC_RENDER_PATH);
    parsed.searchParams.set("width", String(size));
    parsed.searchParams.set("height", String(size));
    parsed.searchParams.set("resize", resize);
    parsed.searchParams.set("quality", String(quality));
    return parsed.toString();
  } catch {
    return url;
  }
}

export const galleryThumbnailUrl = (url, size = 480) => transformedUrl(url, size, "cover", 72);
export const galleryViewerUrl = (url) => transformedUrl(url, 1920, "contain", 80);
export const productThumbnailUrl = (url) => transformedUrl(url, 240, "contain", 76);

export function canPreloadGalleryImages() {
  if (typeof navigator === "undefined") return false;
  const connection = navigator.connection;
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType);
}

function trimCache() {
  for (const [url, entry] of imageCache) {
    if (imageCache.size <= MAX_CACHED_IMAGES) break;
    if (entry.ready) imageCache.delete(url);
  }
}

export function cachedGalleryImage(url) {
  const entry = imageCache.get(url);
  if (!entry?.ready) return null;
  // Keep the images being viewed near the end of the bounded cache.
  imageCache.delete(url);
  imageCache.set(url, entry);
  return entry.image;
}

// Share in-flight requests and retain decoded images for instant repeat opens.
// Failed transforms never start an original download in the background.
export function preloadGalleryImage(url, priority = "low") {
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  const existing = imageCache.get(url);
  if (existing) {
    if (priority === "high") existing.image.fetchPriority = "high";
    return existing.promise;
  }

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority;
  const entry = { image, ready: false, promise: null };
  entry.promise = new Promise(resolve => {
    image.onload = async () => {
      // decode() can reject for an otherwise usable image in some browsers.
      try { await image.decode?.(); } catch { /* onload already succeeded */ }
      entry.ready = true;
      image.onload = null;
      image.onerror = null;
      trimCache();
      resolve(image);
    };
    image.onerror = () => {
      imageCache.delete(url);
      image.onload = null;
      image.onerror = null;
      resolve(null);
    };
  });
  imageCache.set(url, entry);
  image.src = url;
  return entry.promise;
}
