// Local browser QA only. These operations never contact a real backend.
export const qa = { photos: [], attachments: [], objects: new Map(), failClientSave: false, uploads: [], peak: 0, active: 0 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const supabase = {
  storage: { from: bucket => ({
    async upload(path, file) {
      qa.peak = Math.max(qa.peak, ++qa.active);
      qa.uploads.push({ bucket, path, size: file.size, type: file.type });
      await delay(1500);
      qa.active--;
      qa.objects.set(path, URL.createObjectURL(file));
      return { data: { path }, error: null };
    },
    getPublicUrl: path => ({ data: { publicUrl: qa.objects.get(path) } }),
  }) },
  from(table) {
    const filters = []; let op = 'select'; let payload;
    const run = async () => {
      await delay(100);
      if (table === 'leads') {
        if (op === 'select') return { data: { photos: [...qa.photos] } };
        if (JSON.stringify(qa.photos) !== filters.find(([key]) => key === 'photos')?.[1]) return { data: null };
        qa.photos = payload.photos;
        return { data: { id: 'lead-preview' } };
      }
      if (op === 'insert') {
        if (qa.failClientSave && !qa.attachments.length) return { error: { status: 403, code: '42501', message: 'The photo was uploaded, but its record could not be saved. Retry to finish saving it.' } };
        qa.attachments.push(payload[0]);
        return { data: payload[0] };
      }
      return { data: qa.attachments };
    };
    const query = {
      select: () => query, eq: (key, value) => { filters.push([key, value]); return query; },
      is: (key, value) => { filters.push([key, value]); return query; },
      update: value => { op = 'update'; payload = value; return query; },
      insert: value => { op = 'insert'; payload = value; return query; },
      single: run, maybeSingle: run,
    };
    return query;
  },
};
