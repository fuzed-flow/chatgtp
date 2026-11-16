export const PHOTO_UPLOAD_CONCURRENCY = 2;
export const LARGE_PHOTO_BYTES = 6 * 1024 * 1024;
const OPTIMIZE_ABOVE_BYTES = 1024 * 1024;
const MAX_PHOTO_DIMENSION = 2560;

// Decode one camera image at a time to bound memory use on phones. Uploads can
// continue while the next image is being prepared.
let preparationTail = Promise.resolve();
export function prepareCrmPhoto(file) {
  const work = preparationTail.then(() => optimizePhoto(file));
  preparationTail = work.catch(() => {});
  return work;
}

async function optimizePhoto(file) {
  if (file.size <= OPTIMIZE_ABOVE_BYTES || /gif|svg/i.test(file.type)) return file;
  let source;
  let canvas;
  try {
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try the browser decoder */ }
    }
    if (!source) {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo decoder unavailable.')); };
        image.src = url;
      });
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(width, height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    if (!blob || blob.size >= file.size) return file;
    const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
    if (!extension) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type, lastModified: file.lastModified });
  } catch {
    // HEIC and other formats depend on browser support. Preserve the original
    // rather than preventing a photo from being uploaded.
    return file;
  } finally {
    source?.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

function statusOf(error) {
  return Number(error?.statusCode || error?.status || error?.originalResponse?.getStatus?.() || 0);
}

export function isTransientPhotoError(error) {
  const status = statusOf(error);
  if (status) return status === 408 || status === 429 || status >= 500;
  if (error?.name === 'AbortError') return false;
  if (error?.code && /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(error.code)) return ['40001', '40P01', '53300', '57P01'].includes(error.code);
  return true;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function retryPhotoOperation(operation, { onRetry = () => {}, sleep = pause } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (attempt >= 2 || !isTransientPhotoError(error)) throw error;
      onRetry();
      await sleep([500, 1500][attempt]);
    }
  }
}

export function photoResumableEndpoint(apiUrl) {
  const url = new URL(apiUrl);
  if (/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  url.pathname = '/storage/v1/upload/resumable';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function uploadCrmPhotoObject(client, job, { apiUrl, onChange = () => {}, loadTus = () => import('tus-js-client'), sleep } = {}) {
  const storage = client.storage.from(job.bucket);
  const file = job.prepared;
  if (file.size > LARGE_PHOTO_BYTES) {
    const { Upload } = await loadTus();
    await new Promise((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: photoResumableEndpoint(apiUrl),
        uploadUrl: job.uploadUrl || undefined,
        chunkSize: LARGE_PHOTO_BYTES,
        retryDelays: [0, 1000, 3000],
        uploadDataDuringCreation: true,
        // Resume this job in memory, without leaving cross-account upload URLs
        // or credentials in local storage.
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: job.bucket, objectName: job.path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
        onBeforeRequest: async request => {
          const { data, error } = await client.auth.getSession();
          if (error) throw error;
          if (!data.session?.access_token) throw Object.assign(new Error('Please sign in again to upload this photo.'), { status: 401 });
          request.setHeader('authorization', `Bearer ${data.session.access_token}`);
        },
        onUploadUrlAvailable: () => { job.uploadUrl = upload.url; },
        onProgress: (sent, total) => onChange({ status: 'uploading', percent: total ? Math.min(99, Math.round(sent / total * 100)) : 0 }),
        onShouldRetry: error => {
          const retry = statusOf(error) === 409 || isTransientPhotoError(error);
          if (retry) onChange({ status: 'retrying' });
          return retry;
        },
        onError: reject,
        onSuccess: resolve,
      });
      upload.start();
    });
  } else {
    await retryPhotoOperation(async () => {
      onChange({ status: 'uploading' });
      const { error } = await storage.upload(job.path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (!error) return;
      // A lost success response can leave the object saved. Confirm this job's
      // unique path and size instead of overwriting it or making a duplicate.
      if (statusOf(error) === 409 || /already exists|duplicate/i.test(error.message || '')) {
        const { data, error: infoError } = await storage.info(job.path);
        if (!infoError && Number(data?.size) === file.size) return;
      }
      throw error;
    }, { onRetry: () => onChange({ status: 'retrying' }), sleep });
  }
  return storage.getPublicUrl(job.path).data.publicUrl;
}

export async function saveLeadPhoto(client, { companyId, recordId }, job) {
  // Compare-and-swap also protects against another tab adding photos while
  // this two-worker queue is saving. Keep all existing URLs as they are.
  for (let attempt = 0; attempt < 5; attempt++) {
    const query = () => client.from('leads').select('photos').eq('id', recordId).eq('company_id', companyId);
    const { data: lead, error } = await query().single();
    if (error) throw error;
    const photos = Array.isArray(lead.photos) ? lead.photos : [];
    if (photos.includes(job.url)) return photos;
    const next = [job.url, ...photos];
    let update = client.from('leads').update({ photos: next }).eq('id', recordId).eq('company_id', companyId);
    update = lead.photos == null ? update.is('photos', null) : update.eq('photos', JSON.stringify(lead.photos));
    const result = await update.select('id').maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return next;
  }
  throw new Error('Photos changed while saving. Please retry this photo.');
}

export async function saveClientPhoto(client, { companyId, recordId }, job) {
  const row = { id: job.id, company_id: companyId, related_type: 'Client', related_id: recordId, file_url: job.url, file_name: job.name, caption: 'Site Photos/Info' };
  const result = await client.from('attachments').insert([row]).select('*').single();
  if (!result.error) return result.data;
  if (result.error.code === '23505') {
    const existing = await client.from('attachments').select('*').eq('id', job.id).eq('company_id', companyId).eq('related_type', 'Client').eq('related_id', recordId).single();
    if (!existing.error && existing.data?.file_url === job.url) return existing.data;
  }
  throw result.error;
}

export function createCrmPhotoUploader({ client, kind, recordId, companyId, apiUrl, onSaved = () => {}, onFinished = () => {}, prepare = prepareCrmPhoto, upload = uploadCrmPhotoObject, save, sleep }) {
  let jobs = [];
  let active = false;
  let snapshot = { active, items: [] };
  const listeners = new Set();
  const publish = () => {
    snapshot = { active, items: jobs.map(({ id, name, status, percent, error }) => ({ id, name, status, percent, error })) };
    listeners.forEach(listener => listener());
  };
  const persist = save || (kind === 'Lead' ? saveLeadPhoto : saveClientPhoto);
  const run = async selected => {
    active = true;
    publish();
    let cursor = 0;
    const worker = async () => {
      while (cursor < selected.length) {
        const job = selected[cursor++];
        const change = updates => {
          if (Object.entries(updates).every(([key, value]) => job[key] === value)) return;
          Object.assign(job, updates); publish();
        };
        try {
          if (!job.prepared) {
            change({ status: 'preparing' });
            job.prepared = await prepare(job.file);
          }
          const ext = job.prepared.name.split('.').pop().toLowerCase();
          job.path ||= `${recordId}/photo-${job.id}.${/^[a-z0-9]{1,10}$/.test(ext) ? ext : 'jpg'}`;
          if (!job.url) {
            change({ status: 'uploading', percent: 0 });
            job.url = await upload(client, job, { apiUrl, onChange: change, sleep });
          }
          change({ status: 'saving', percent: 99 });
          const saved = await retryPhotoOperation(() => persist(client, { companyId, recordId }, job), { onRetry: () => change({ status: 'saving' }), sleep });
          onSaved(saved, job);
          change({ status: 'done', percent: 100, error: null });
          job.file = null;
          job.prepared = null;
        } catch (error) {
          const message = statusOf(error) === 401 ? 'Please sign in again, then retry this photo.'
            : statusOf(error) === 413 ? 'This photo is too large. Please choose a smaller photo.'
            : job.url ? 'The photo uploaded but could not be saved. Retry to finish saving it.'
            : 'The upload was interrupted. Check your connection and retry.';
          change({ status: 'error', error: message });
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(PHOTO_UPLOAD_CONCURRENCY, selected.length) }, worker)); }
    finally { active = false; publish(); onFinished(snapshot); }
    return snapshot;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start: files => {
      if (active || !recordId || !companyId) return Promise.resolve(snapshot);
      const selected = Array.from(files || []).map(file => ({ id: crypto.randomUUID(), name: file.name, file, bucket: kind === 'Lead' ? 'lead_files' : 'attachments', status: 'queued', percent: 0 }));
      if (!selected.length) return Promise.resolve(snapshot);
      jobs = [...jobs.filter(job => job.status === 'error'), ...selected];
      return run(selected);
    },
    retry: () => {
      if (active) return Promise.resolve(snapshot);
      const selected = jobs.filter(job => job.status === 'error');
      selected.forEach(job => { job.status = 'queued'; job.error = null; });
      return selected.length ? run(selected) : Promise.resolve(snapshot);
    },
  };
}
