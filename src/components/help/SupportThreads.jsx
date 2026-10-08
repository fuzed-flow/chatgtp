import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ConfirmDeleteDialog from '@/components/shared/ConfirmDeleteDialog';

export default function SupportThreads() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const ticketId = params.get('ticket');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const qc = useQueryClient();
  const scope = ['support-tickets', profile?.company_id, profile?.id];
  const enabled = !!profile?.company_id && !!profile?.id && profile?.is_active !== false;
  const tickets = useQuery({
    queryKey: scope, enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('support_tickets').select('id,subject,status,created_at,updated_at')
        .eq('company_id', profile.company_id).eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    },
  });
  const selected = useQuery({
    queryKey: [...scope, 'selected', ticketId], enabled: enabled && /^[a-f0-9-]{36}$/i.test(ticketId || ''),
    queryFn: async () => {
      const { data, error } = await supabase.from('support_tickets').select('id,subject,status,created_at,updated_at')
        .eq('id', ticketId).eq('company_id', profile.company_id).eq('user_id', profile.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const ticket = selected.data || tickets.data?.find(row => row.id === ticketId);
  const messages = useQuery({
    queryKey: [...scope, ticketId], enabled: enabled && !!ticket,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('support_ticket_messages')
        .select('id,author_name,message,is_support,created_at').eq('company_id', profile.company_id).eq('ticket_id', ticketId)
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      return data || [];
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('submit_support_ticket', {
        p_subject: ticket ? ticket.subject : subject.trim(), p_message: message.trim(), p_ticket: ticket?.id || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: id => {
      setMessage(''); setSubject(''); setFeedback('Your request was saved. A reply will appear here and in your notifications.');
      setParams({ ticket: id }); qc.invalidateQueries({ queryKey: scope });
    },
    onError: error => setFeedback(error.message || 'Could not save your request. Try again or call 1 (855) 904-5509.'),
  });
  const remove = useMutation({
    mutationFn: async request => {
      const { error } = await supabase.from('support_tickets').delete()
        .eq('id', request.id).eq('company_id', profile.company_id).eq('user_id', profile.id);
      if (error) throw error;
      return request.id;
    },
    onSuccess: removedId => {
      setDeleteTarget(null);
      if (ticketId === removedId) select(null);
      setFeedback('Support request deleted.');
      qc.invalidateQueries({ queryKey: scope });
    },
    onError: error => setFeedback(error.message || 'Could not delete this request. Please try again.'),
  });
  function select(id) { setParams(id ? { ticket: id } : {}); setMessage(''); setFeedback(''); }
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-label="Support requests">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">Your support requests</h2>
      <Button variant="outline" className="min-h-12" onClick={() => select(null)}><Plus className="mr-2 h-4 w-4" />New request</Button></div>
    <div className="grid gap-5 md:grid-cols-[minmax(160px,1fr)_minmax(0,2fr)]">
      <nav aria-label="Your support requests" className="max-h-72 space-y-2 overflow-y-auto">
        {tickets.isPending && enabled && <p role="status" className="p-3 text-sm text-slate-500">Loading requests…</p>}
        {tickets.isError && <p role="alert" className="p-3 text-sm text-red-700">Could not load requests. Refresh or call 1 (855) 904-5509.</p>}
        {!tickets.isPending && tickets.data?.length === 0 && <p className="p-3 text-sm text-slate-500">You have no support requests yet.</p>}
        {tickets.data?.map(row => <div key={row.id} className={`flex min-h-12 items-stretch rounded-xl border ${ticketId === row.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
          <button onClick={() => select(row.id)} aria-current={ticketId === row.id ? 'page' : undefined}
            className="min-w-0 flex-1 rounded-l-xl p-3 text-left focus-visible:ring-2 focus-visible:ring-amber-500">
            <span className="block break-words text-sm font-semibold text-slate-800">{row.subject}</span><span className="text-xs text-slate-500">{row.status}</span>
          </button>
          <button type="button" onClick={() => setDeleteTarget(row)} aria-label={`Delete support request: ${row.subject}`}
            className="flex min-w-12 items-center justify-center rounded-r-xl text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-500">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>)}
      </nav>
      <div className="min-w-0 space-y-4">
        {ticket && <><div><h3 className="break-words font-semibold text-slate-900">{ticket.subject}</h3><p className="text-xs text-slate-500">{ticket.status}</p></div>
          <div className="max-h-96 space-y-3 overflow-y-auto" aria-label="Conversation">
            {messages.isPending && <p role="status" className="text-sm text-slate-500">Loading conversation…</p>}
            {messages.isError && <p role="alert" className="text-sm text-red-700">Could not load this conversation.</p>}
            {messages.data?.map(row => <article key={row.id} className={`rounded-xl p-3 ${row.is_support ? 'bg-amber-50' : 'bg-slate-50'}`}>
              <p className="text-sm font-semibold text-slate-800">{row.author_name}</p><time dateTime={row.created_at} className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString()}</time>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{row.message}</p></article>)}
          </div></>}
        {ticketId && !tickets.isPending && !selected.isFetching && !ticket && <p role="alert" className="text-sm text-slate-600">This request is unavailable. Select one of your requests or start a new request.</p>}
        <form onSubmit={event => { event.preventDefault(); if (!send.isPending) send.mutate(); }} className="space-y-3">
          {!ticket && <div><label htmlFor="ticket-subject" className="mb-2 block text-sm font-semibold">Subject</label><Input id="ticket-subject" required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} className="min-h-12 text-base" /></div>}
          <div><label htmlFor="ticket-message" className="mb-2 block text-sm font-semibold">{ticket ? 'Your reply' : 'How can we help?'}</label><Textarea id="ticket-message" required maxLength={10000} rows={5} value={message} onChange={event => setMessage(event.target.value)} className="text-base" />
            <p className="mt-2 text-xs text-slate-500">Include the page and error message. Leave out passwords and payment card details.</p></div>
          <Button type="submit" disabled={!enabled || send.isPending || !message.trim()} className="min-h-12 w-full bg-amber-500 text-white hover:bg-amber-600">{send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{ticket ? 'Send reply' : 'Send support request'}</Button>
          {feedback && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{feedback}</p>}
        </form>
      </div>
    </div>
    <ConfirmDeleteDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !remove.isPending) setDeleteTarget(null); }}
      title="Delete support request?" description={`Delete “${deleteTarget?.subject || 'this support request'}” and its entire conversation? This cannot be undone.`}
      onConfirm={() => deleteTarget && remove.mutate(deleteTarget)} isLoading={remove.isPending} />
  </section>;
}
