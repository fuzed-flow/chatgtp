export const MAX_PROJECT_PHOTOS = 10;
export const MAX_PROJECT_PHOTO_BYTES = 25 * 1024 * 1024;

export const PROJECT_PHOTO_LIMIT_HINT = `Up to ${MAX_PROJECT_PHOTOS} photos. ${MAX_PROJECT_PHOTO_BYTES / (1024 * 1024)} MB maximum per photo.`;

export function validateProjectPhotoUpload(files, existingCount = 0) {
  const selectedFiles = Array.from(files || []);

  if (!selectedFiles.length) {
    return { files: [], error: "Choose at least one photo to upload." };
  }

  if (existingCount >= MAX_PROJECT_PHOTOS) {
    return {
      files: [],
      error: `A project photo gallery can contain up to ${MAX_PROJECT_PHOTOS} photos. Remove one before adding another.`,
    };
  }

  if (selectedFiles.length + existingCount > MAX_PROJECT_PHOTOS) {
    const available = MAX_PROJECT_PHOTOS - existingCount;
    return {
      files: [],
      error: `You can add ${available} more project photo${available === 1 ? "" : "s"}. The limit is ${MAX_PROJECT_PHOTOS}.`,
    };
  }

  if (selectedFiles.some((file) => !file.type?.startsWith("image/"))) {
    return { files: [], error: "Project photos must be image files." };
  }

  if (selectedFiles.some((file) => file.size > MAX_PROJECT_PHOTO_BYTES)) {
    return {
      files: [],
      error: `Each project photo must be ${MAX_PROJECT_PHOTO_BYTES / (1024 * 1024)} MB or smaller.`,
    };
  }

  return { files: selectedFiles, error: null };
}
