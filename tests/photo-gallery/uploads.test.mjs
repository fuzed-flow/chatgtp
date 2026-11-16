import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmPhotoUploader, prepareCrmPhoto, uploadCrmPhotoObject, saveLeadPhoto, saveClientPhoto, retryPhotoOperation, photoResumableEndpoint, LARGE_PHOTO_BYTES } from '../../src/lib/crmPhotoUploads.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const file = (name, size = 100) => ({ name, size, type: 'image/jpeg' });
const context = { companyId: 'company', recordId: 'record' };

export function photoDb() {
  const state = { photos: ['legacy-original.jpg'], attachments: [], writes: [], failSave: false, conflict: false };
  const client = { from(table) {
    let operation = 'select'; let payload; const filters = [];
    const execute = async () => {
      if (table === 'leads') {
        if (operation === 'select') return { data: { photos: [...state.photos] }, error: null };
        if (state.conflict) { state.conflict = false; state.photos.push('another-tab.jpg'); }
        const expected = filters.find(([column]) => column === 'photos')?.[1];
        if (JSON.stringify(state.photos) !== expected) return { data: null, error: null };
        state.photos = payload.photos;
        state.writes.push({ table, filters, payload });
        return { data: { id: 'record' }, error: null };
      }
      if (operation === 'insert') {
        if (state.failSave) return { data: null, error: { code: '42501', message: 'Photo record could not be saved.', status: 403 } };
        if (state.attachments.some(row => row.id === payload[0].id)) return { data: null, error: { code: '23505', message: 'Duplicate key' } };
        state.attachments.push(payload[0]);
        state.writes.push({ table, payload, filters });
        return { data: payload[0], error: null };
      }
      return { data: state.attachments.find(row => filters.every(([key, value]) => row[key] === value)), error: null };
    };
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push([key, value]); return query; },
      is: (key, value) => { filters.push([key, value]); return query; },
      update: value => { operation = 'update'; payload = value; return query; },
      insert: value => { operation = 'insert'; payload = value; return query; },
      single: execute, maybeSingle: execute,
    };
    return query;
  } };
  return { client, state };
}

test('two-worker uploads show and save successes before the batch finishes', async () => {
  let active = 0; let peak = 0; const finish = new Map(); const saved = [];
  const uploader = createCrmPhotoUploader({ ...context, kind: 'Lead', client: {}, prepare: async f => f,
    upload: async (_client, job) => { peak = Math.max(peak, ++active); await new Promise(resolve => finish.set(job.name, resolve)); active--; return job.name; },
    save: async (_client, _context, job) => { saved.push(job.url); },
  });
  const running = uploader.start(['one', 'two', 'three'].map(name => file(name)));
  await tick();
  assert.equal(peak, 2);
  assert.equal(finish.size, 2);
  finish.get('two')(); await tick();
  assert.deepEqual(saved, ['two']);
  assert.equal(uploader.getSnapshot().active, true);
  assert.equal(uploader.getSnapshot().items.find(item => item.name === 'two').status, 'done');
  assert.equal(finish.size, 3);
  finish.get('one')(); finish.get('three')(); await running;
  assert.equal(peak, 2);
  assert.equal(uploader.getSnapshot().items.filter(item => item.status === 'done').length, 3);
});

test('a failed client save is reported and retries only the save, with the same attachment ID', async () => {
  const db = photoDb(); db.state.failSave = true;
  let uploads = 0;
  const uploader = createCrmPhotoUploader({ ...context, kind: 'Client', client: db.client, prepare: async f => f, upload: async () => { uploads++; return 'uploaded-photo.webp'; } });
  const result = await uploader.start([file('bathroom.jpg')]);
  assert.equal(result.items[0].status, 'error');
  assert.equal(db.state.attachments.length, 0);
  const id = result.items[0].id;
  db.state.failSave = false;
  await uploader.retry();
  assert.equal(uploads, 1);
  assert.equal(db.state.attachments[0].id, id);
  assert.equal(db.state.attachments[0].file_name, 'bathroom.jpg');
  assert.equal(db.state.attachments[0].company_id, 'company');
  assert.equal(uploader.getSnapshot().items[0].status, 'done');
});

test('one failed transfer does not hide other saved photos or retry completed transfers', async () => {
  const db = photoDb(); let fail = true; const calls = [];
  const uploader = createCrmPhotoUploader({ ...context, kind: 'Lead', client: db.client, prepare: async f => f,
    upload: async (_client, job) => { calls.push(job.name); if (job.name === 'failed.jpg' && fail) throw new Error('Connection lost'); return `${job.name}.webp`; },
  });
  await uploader.start([file('good.jpg'), file('failed.jpg')]);
  assert.deepEqual(db.state.photos, ['good.jpg.webp', 'legacy-original.jpg']);
  fail = false; await uploader.retry();
  assert.deepEqual(calls, ['good.jpg', 'failed.jpg', 'failed.jpg']);
  assert.deepEqual(db.state.photos, ['failed.jpg.webp', 'good.jpg.webp', 'legacy-original.jpg']);
});

test('parallel lead saves and concurrent edits retain existing and newly appended photos', async () => {
  const db = photoDb(); db.state.conflict = true;
  await Promise.all(['first.webp', 'second.webp'].map(url => saveLeadPhoto(db.client, context, { url })));
  assert.deepEqual(new Set(db.state.photos), new Set(['legacy-original.jpg', 'another-tab.jpg', 'first.webp', 'second.webp']));
  assert.ok(db.state.writes.every(write => write.filters.some(([key, value]) => key === 'company_id' && value === 'company')));
  await saveLeadPhoto(db.client, context, { url: 'first.webp' });
  assert.equal(db.state.photos.filter(url => url === 'first.webp').length, 1);
});

test('client save is idempotent after a lost database success response', async () => {
  const db = photoDb(); const job = { id: 'same-job', name: 'photo.jpg', prepared: file('photo.webp'), url: 'photo.webp' };
  await saveClientPhoto(db.client, context, job);
  await saveClientPhoto(db.client, context, job);
  assert.equal(db.state.attachments.length, 1);
  assert.equal(db.state.attachments[0].file_name, 'photo.webp', 'Downloads retain a filename matching the optimized format.');
});

test('standard upload retries network errors and recovers a lost success without overwriting', async () => {
  const calls = []; let attempts = 0;
  const storage = {
    upload: async (path, body, options) => { calls.push({ path, body, options }); if (++attempts === 1) throw new TypeError('Failed to fetch'); return { error: { statusCode: '409', message: 'Already exists' } }; },
    info: async () => ({ data: { size: 100 } }),
    getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${path}` } }),
  };
  const result = await uploadCrmPhotoObject({ storage: { from: () => storage } }, { bucket: 'lead_files', path: 'unique-photo.jpg', prepared: file('photo.jpg') }, { sleep: async () => {} });
  assert.equal(result, 'https://storage.example/unique-photo.jpg');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.upsert === false && call.path === 'unique-photo.jpg'));
});

test('permission errors are not retried; temporary failures use bounded retries', async () => {
  let attempts = 0;
  await assert.rejects(retryPhotoOperation(async () => { attempts++; throw { status: 403 }; }, { sleep: async () => {} }));
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryPhotoOperation(async () => { attempts++; throw { status: 503 }; }, { sleep: async () => {} }));
  assert.equal(attempts, 3);
});

test('large originals use authenticated resumable uploads and reuse the job upload URL on retry', async () => {
  const options = []; const headers = []; let failed = true;
  class Upload {
    constructor(_file, config) { this.config = config; this.url = config.uploadUrl || 'https://fixture.storage.supabase.co/upload/job'; options.push(config); }
    async start() {
      await this.config.onBeforeRequest({ setHeader: (...args) => headers.push(args) });
      this.config.onUploadUrlAvailable();
      this.config.onProgress(500, 1000);
      if (failed) this.config.onError(new Error('Connection interrupted')); else this.config.onSuccess();
    }
  }
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-only' } } }) }, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'large-original.heic' } }) }) } };
  const job = { bucket: 'attachments', path: 'record/photo.heic', prepared: file('photo.heic', LARGE_PHOTO_BYTES + 1) };
  const settings = { apiUrl: 'https://fixture.supabase.co', loadTus: async () => ({ Upload }) };
  await assert.rejects(uploadCrmPhotoObject(client, job, settings));
  failed = false; await uploadCrmPhotoObject(client, job, settings);
  assert.equal(options[0].endpoint, 'https://fixture.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(options[1].uploadUrl, job.uploadUrl);
  assert.equal(options[0].chunkSize, 6 * 1024 * 1024);
  assert.equal(options[0].storeFingerprintForResuming, false);
  assert.equal(options[0].metadata.objectName, 'record/photo.heic');
  assert.deepEqual(headers[0], ['authorization', 'Bearer synthetic-only']);
  assert.equal(photoResumableEndpoint('http://localhost:54321'), 'http://localhost:54321/storage/v1/upload/resumable');
});

test('photo preparation preserves small files, animation, and undecodable originals', async () => {
  const small = file('small.jpg');
  assert.equal(await prepareCrmPhoto(small), small);
  const animated = { ...file('animated.gif', 3e6), type: 'image/gif' };
  assert.equal(await prepareCrmPhoto(animated), animated);
  const original = { ...file('original.heic', 7e6), type: 'image/heic' };
  assert.equal(await prepareCrmPhoto(original), original);
});

test('photo preparation bounds dimensions, preserves aspect ratio and uses smaller output only', async () => {
  const previous = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document };
  let closed = 0; let size = 240000; const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob(callback, type, quality) { assert.equal(type, 'image/webp'); assert.equal(quality, 0.84); assert.equal(this.width, 2560); assert.equal(this.height, 1920); callback(new Blob([new Uint8Array(size)], { type })); } };
  globalThis.createImageBitmap = async (_file, options) => { assert.equal(options.imageOrientation, 'from-image'); return { width: 4032, height: 3024, close: () => { closed++; } }; };
  globalThis.document = { createElement: () => canvas };
  try {
    const original = new File([new Uint8Array(4e6)], 'bathroom.jpg', { type: 'image/jpeg', lastModified: 123 });
    const prepared = await prepareCrmPhoto(original);
    assert.equal(prepared.size, 240000);
    assert.equal(prepared.name, 'bathroom.webp');
    assert.equal(prepared.lastModified, 123);
    size = 5e6;
    assert.equal(await prepareCrmPhoto(original), original);
    assert.equal(closed, 2);
    assert.equal(canvas.width, 0, 'Canvas memory is released after preparation.');
  } finally { Object.assign(globalThis, previous); }
});
