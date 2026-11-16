import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import PhotoGallery from '../../../src/components/shared/PhotoGallery.jsx';
import { useCrmPhotoUploads } from '../../../src/hooks/useCrmPhotoUploads.js';
import { prepareCrmPhoto } from '../../../src/lib/crmPhotoUploads.js';
import { qa } from './mockDb.js';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
queryClient.setQueryData(['lead', 'preview-company', 'lead-preview'], { photos: [] });
queryClient.setQueryData(['client-attachments', 'client-preview'], []);
let sample;
async function sampleFile(name = 'site-photo.jpg') {
  sample ||= fetch('/sample.jpg').then(response => response.blob());
  return new File([await sample], name, { type: 'image/jpeg' });
}
function Gallery({ kind }) {
  const id = `${kind.toLowerCase()}-preview`;
  const uploader = useCrmPhotoUploads({ kind, recordId: id, companyId: 'preview-company' });
  const [fail, setFail] = React.useState(false);
  const { data } = useQuery({ queryKey: kind === 'Lead' ? ['lead', 'preview-company', id] : ['client-attachments', id], enabled: false });
  const photos = kind === 'Lead' ? (data?.photos || []).map(url => ({ id: url, url, name: 'Site photo' })) : (data || []).map(row => ({ id: row.id, url: row.file_url, name: row.file_name }));
  return <section className="space-y-3">
    <button className="rounded-lg bg-amber-400 px-4 py-2 font-bold" disabled={uploader.active} onClick={async () => uploader.start(await Promise.all([1, 2, 3].map(index => sampleFile(`${kind} bathroom ${index}.jpg`))))}>Test {kind.toLowerCase()} batch</button>
    {kind === 'Client' && <button className="ml-3 rounded-lg border border-slate-300 px-3 py-2" onClick={() => { qa.failClientSave = !qa.failClientSave; setFail(qa.failClientSave); }}>Save failure: {fail ? 'on' : 'off'}</button>}
    <PhotoGallery title={`${kind} Photos`} photos={photos} isUploading={uploader.active} uploadItems={uploader.items} onUpload={uploader.start} onRetryUpload={uploader.retry} onDelete={() => {}} />
  </section>;
}
function App() {
  const [measurement, setMeasurement] = React.useState(null);
  return <QueryClientProvider client={queryClient}><main className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
    <div><h1 className="text-2xl font-black">Photo uploads</h1><p className="text-sm text-slate-500">Local QA · isolated storage and records</p><a href="/mobile.html" className="text-sm underline">Mobile preview</a></div>
    <button className="rounded-lg border border-slate-300 px-4 py-2 font-bold" onClick={async () => { const original = await sampleFile(); const start = performance.now(); const optimized = await prepareCrmPhoto(original); const bitmap = await createImageBitmap(optimized); const data = { original: original.size, optimized: optimized.size, width: bitmap.width, height: bitmap.height, prepareMs: Math.round(performance.now() - start) }; bitmap.close(); setMeasurement(data); window.photoMeasurement = data; }}>Measure photo preparation</button>
    {measurement && <pre className="overflow-auto rounded-xl bg-slate-100 p-3 text-xs">{JSON.stringify(measurement, null, 2)}</pre>}
    <Gallery kind="Lead" /><Gallery kind="Client" />
  </main></QueryClientProvider>;
}
window.photoQa = qa;
createRoot(document.getElementById('root')).render(<App />);
