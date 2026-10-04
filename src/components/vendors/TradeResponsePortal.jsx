import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export default function TradeResponsePortal({ requestId, token }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const responseLock = useRef(false);
  const submitResponse = action => { if (responseLock.current) return; responseLock.current = true; respond.mutate(action, { onSettled: () => { responseLock.current = false; } }); };
  const { data: request, isLoading, error } = useQuery({ queryKey: ['trade-response', requestId, token], retry: false,
    queryFn: async () => { const { data, error: err } = await supabase.rpc('process_vendor_response', { p_request: requestId, p_token: token, p_action: 'view' }); if (err) throw err; return data; } });
  const respond = useMutation({ mutationFn: async action => { if (action === 'quoted' && (!amount || !Number.isFinite(Number(amount)) || Number(amount) < 0)) throw new Error('Enter your quote amount.'); const { data, error: err } = await supabase.rpc('process_vendor_response', { p_request: requestId, p_token: token, p_action: action, p_amount: action === 'quoted' ? Number(amount) : null, p_message: message.trim() || null }); if (err) throw err; return data; },
    onSuccess: data => { qc.setQueryData(['trade-response', requestId, token], data); toast.success('Your response has been sent to the project team.'); }, onError: err => toast.error(err.message) });
  const closed = ['approved', 'rejected', 'cancelled', 'quote approved', 'quote declined'].includes((request?.status || '').toLowerCase());
  return <div className="min-h-screen bg-slate-50 px-4 py-8"><main className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
    <header className="bg-slate-900 p-5 sm:p-8 border-b-4 border-amber-500"><p className="text-amber-400 font-bold text-sm">Fuzed Flow · Trade request</p><h1 className="mt-2 text-xl sm:text-2xl font-bold text-white">{request?.title || 'Quote invitation'}</h1>{request && <p className="mt-2 text-sm text-slate-300">From {request.company_name}{request.project_name ? ` · ${request.project_name}` : ''}</p>}</header>
    <div className="p-5 sm:p-8 space-y-5">{isLoading ? <p role="status">Loading invitation…</p> : error ? <p role="alert" className="text-red-700">This invitation is unavailable or expired. Contact the company that invited you for a new link.</p> : request && <>
      <p className="text-sm text-slate-600">For {request.vendor_name} · Status: <strong>{request.status || 'Awaiting response'}</strong>{request.due_date ? ` · Quote due ${request.due_date}` : ''}</p>
      <section><h2 className="font-bold mb-2">Scope of work</h2><p className="whitespace-pre-wrap break-words text-slate-700">{request.scope_of_work || 'Please review the scope with your project contact.'}</p></section>
      {Array.isArray(request.attachments) && request.attachments.length > 0 && <section><h2 className="font-bold mb-2">Documents</h2><ul className="space-y-2">{request.attachments.filter(url => typeof url === 'string' && /^https:\/\//i.test(url)).map((url, i) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-amber-800 underline">Open document {i + 1}</a></li>)}</ul></section>}
      {request.response_amount != null && <p className="rounded-lg bg-amber-50 p-3">Quote received: <strong>${Number(request.response_amount).toFixed(2)}</strong>{request.response_message ? ` · ${request.response_message}` : ''}</p>}
      {closed ? <p className="font-medium text-slate-700">This request has been closed by the project team. Please contact them to discuss changes.</p> : <form className="space-y-4 border-t border-slate-200 pt-5" onSubmit={e => { e.preventDefault(); submitResponse('quoted'); }}>
        <div><Label htmlFor="trade-quote-amount">Quote amount</Label><Input id="trade-quote-amount" type="number" min="0" step="0.01" max="1000000000" className="mt-1 min-h-11" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div><Label htmlFor="trade-response-message">Message / quote details</Label><Textarea id="trade-response-message" rows={5} maxLength={10000} className="mt-1" value={message} onChange={e => setMessage(e.target.value)} placeholder="Availability, scope, exclusions and tax details" /></div>
        <div className="flex flex-col sm:flex-row gap-2"><Button type="submit" className="min-h-11 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={respond.isPending}>{respond.isPending ? 'Sending…' : 'Submit quote'}</Button><Button type="button" variant="outline" className="min-h-11" disabled={respond.isPending} onClick={() => submitResponse('accepted')}>Accept invitation</Button><Button type="button" variant="outline" className="min-h-11 text-red-700" disabled={respond.isPending} onClick={() => submitResponse('declined')}>Decline invitation</Button></div>
        <p className="text-xs text-slate-500">Accepting confirms your interest. It does not approve your quote or commit you to a contract. Include the tax basis in your quote details.</p>
      </form>}
    </> }</div>
  </main><p className="text-center text-xs text-slate-500 mt-6">Powered by Fuzed Flow</p></div>;
}
