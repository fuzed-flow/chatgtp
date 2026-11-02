import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import CommunicationPanel from '../../../src/components/clients/CommunicationPanel';
import { fixture } from './mockDb';
import '../../../src/index.css';

const params = new URLSearchParams(window.location.search);
function Content() {
  return <div className="p-4 sm:p-6"><h1 className="mb-1 text-2xl font-bold text-slate-900">{fixture.name}</h1><p className="mb-5 text-sm text-slate-600">Communication</p><CommunicationPanel {...(fixture.kind === 'lead' ? { leadId: 'sample-lead' } : { clientId: 'sample-client' })} clientName={fixture.name} clientPhone={fixture.phone} clientEmail="sample@example.invalid" /></div>;
}
function Preview() {
  const [kind, setKind] = useState('lead');
  const [phone, setPhone] = useState(false);
  return <div className="min-h-screen bg-slate-100"><header className="bg-slate-900 px-5 py-6 text-white"><p className="text-sm font-bold text-amber-400">FUZED FLOW · SMS PREVIEW</p><h1 className="mt-2 text-2xl font-bold">Text leads and clients from their conversation.</h1><p className="mt-2 text-sm text-slate-200">Interactive sample data. The Send SMS button here never sends a real text.</p></header><nav aria-label="Preview controls" className="flex flex-wrap justify-center gap-2 p-4">{['lead','client'].map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`min-h-11 rounded-lg border px-5 font-semibold ${kind === value ? 'bg-amber-400 text-slate-900' : 'bg-white'}`}>{value === 'lead' ? 'Lead detail' : 'Client detail'}</button>)}<button onClick={() => setPhone(!phone)} className="min-h-11 rounded-lg border bg-white px-5 font-semibold">{phone ? 'Switch to desktop' : 'Switch to phone'}</button></nav><iframe title={`${kind} communication preview`} src={`/sms-preview/index.html?embedded=1&kind=${kind}`} style={{ display: 'block', width: phone ? 390 : 'min(1200px,100%)', maxWidth: '100%', height: 'calc(100dvh - 225px)', minHeight: 620, margin: '0 auto', background: 'white', border: '1px solid #cbd5e1', borderRadius: phone ? 24 : 12 }} /></div>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{params.has('embedded') ? <Content /> : <Preview />}<Toaster /></QueryClientProvider>);
