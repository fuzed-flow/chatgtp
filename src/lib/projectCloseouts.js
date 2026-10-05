export const DEFICIENCY_TYPES = [
  "Painting", "Drywall", "Tile", "Flooring", "Plumbing", "Electrical",
  "HVAC", "Millwork", "Carpentry", "Doors & Trim", "Cleaning", "Exterior", "General",
];

export const DEFICIENCY_STATUSES = ["Open", "In Progress", "Ready for Review", "Complete"];

export const MAX_DEFICIENCY_PHOTOS = 10;

export function deficiencyPhotoUrls(item) {
  const urls = Array.isArray(item?.photo_urls) ? item.photo_urls : [];
  const withLegacyFallback = urls.length ? urls : [item?.photo_url];
  return [...new Set(withLegacyFallback
    .map(value => String(value || "").trim())
    .filter(Boolean))];
}

export function projectCloseoutPortalUrl(origin, clientId, closeoutId) {
  return `${origin}/ClientPortal?id=${encodeURIComponent(clientId)}&tab=closeouts&closeout=${encodeURIComponent(closeoutId)}`;
}

export function matchesProjectCloseout(closeout, project, client, search) {
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) return true;
  return [closeout?.title, closeout?.notes, project?.name, project?.project_number, client?.name]
    .filter(Boolean).some(value => String(value).toLowerCase().includes(needle));
}

export function isDeficiencyPhotoFile(file) {
  return Boolean(file?.type?.startsWith("image/") || /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(file?.name || ""));
}

export async function compressDeficiencyPhoto(file, maxDimension = 1800, quality = 0.82) {
  if (!isDeficiencyPhotoFile(file)) throw new Error("Choose a photo from your camera or photo library.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a photo smaller than 25 MB.");

  const openWithImageElement = () => new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be opened.")); };
    image.src = url;
  });
  let source;
  if (typeof createImageBitmap === "function") {
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      source = await openWithImageElement();
    }
  } else {
    source = await openWithImageElement();
  }
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("This photo could not be prepared. Try another photo.");
  return new File([blob], `${crypto.randomUUID()}.jpg`, { type: "image/jpeg" });
}

export function storagePathFromPublicUrl(url) {
  const marker = "/storage/v1/object/public/project-closeouts/";
  const index = String(url || "").indexOf(marker);
  return index >= 0 ? decodeURIComponent(String(url).slice(index + marker.length)) : null;
}
