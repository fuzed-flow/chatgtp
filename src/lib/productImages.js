// Create a bounded web thumbnail source on upload without changing legacy URLs.
export async function prepareProductImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  if (typeof createImageBitmap !== 'function' || /gif|svg/.test(file.type)) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {type:'image/webp'}) : file;
  } finally { bitmap?.close(); }
}
