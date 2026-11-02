import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Mail, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { communicationText } from '@/lib/clientCommunications';
import { mergePortalMessages } from '@/lib/portalCommunications';

export default function PortalCommunicationPanel({ clientId, access, companyName }) {
  const queryClient=useQueryClient();
  const key=['portal-communications',clientId,access.kind,access.token];
  const [older,setOlder]=useState([]),[hasOlder,setHasOlder]=useState(null),[loadingOlder,setLoadingOlder]=useState(false);
  const [channel,setChannel]=useState('Email'),[subject,setSubject]=useState(''),[message,setMessage]=useState(''),[reply,setReply]=useState(null);
  const [sending,setSending]=useState(false),[sendError,setSendError]=useState(''),[notice,setNotice]=useState(''),[pageError,setPageError]=useState('');
  const intent=useRef(null),inFlight=useRef(false);
  const args={p_client:clientId,p_token:access.token,p_kind:access.kind};
  const {data,isPending,isError,refetch}=useQuery({queryKey:key,refetchInterval:15000,retry:false,
    queryFn:async()=>{const {data,error}=await supabase.rpc('get_client_portal_communications',args);if(error)throw error;return data;}});
  useEffect(()=>{
    if(isError || data?.enabled===false){setOlder([]);setHasOlder(null);}
    if(data?.enabled && !(channel==='Email'?data.email_available:data.sms_available)) setChannel(data.email_available?'Email':'SMS');
  },[data,isError,channel]);
  const messages=mergePortalMessages(older,data?.messages||[]);
  const limit=channel==='SMS'?1600:5000;
  const channelAvailable=channel==='Email'?data?.email_available:data?.sms_available;
  const loadOlder=async()=>{
    const last=messages.at(-1);if(!last || loadingOlder)return;
    setLoadingOlder(true);setPageError('');
    try {
      const {data:page,error}=await supabase.rpc('get_client_portal_communications',{...args,p_before:last.created_at,p_before_id:last.id});
      if(error)throw error;
      if(!page?.enabled){setOlder([]);queryClient.setQueryData(key,page);return;}
      setOlder(current=>mergePortalMessages(current,[...(data?.messages||[]),...(page.messages||[])]));setHasOlder(page.has_more);
    } catch {setPageError('Earlier messages could not be loaded. Please try again.');}
    finally {setLoadingOlder(false);}
  };
  const startReply=row=>{
    setReply(row.id);setChannel(row.type);setSubject(`Re: ${row.subject||'Your message'}`.slice(0,160));setSendError('');setNotice('');
    document.getElementById('portal-message-body')?.focus();
  };
  const send=async event=>{
    event.preventDefault();if(inFlight.current || !message.trim() || !channelAvailable || message.length>limit)return;
    if(channel==='Email'&&!subject.trim())return;
    const signature=JSON.stringify([clientId,channel,subject.trim(),message.trim(),reply]);
    if(intent.current?.signature!==signature)intent.current={signature,requestId:crypto.randomUUID()};
    inFlight.current=true;setSending(true);setSendError('');setNotice('');
    try {
      const {data:result,error}=await supabase.functions.invoke('client-portal-message',{body:{client_id:clientId,token:access.token,token_kind:access.kind,
        request_id:intent.current.requestId,channel,subject:channel==='SMS'?'':subject.trim(),message:message.trim(),reply_id:reply}});
      if(error || result?.success!==true){
        let detail=result?.error;
        try {const payload=await error?.context?.clone().json();detail=payload?.error||detail;}catch { /* Keep draft and stable request ID on network errors. */ }
        throw new Error(detail||'Delivery could not be confirmed. Check history before sending again.');
      }
      intent.current=null;setMessage('');setSubject('');setReply(null);
      setNotice(`${channel} accepted for sending to ${companyName||'your contractor'}.`);
      await queryClient.invalidateQueries({queryKey:key});
    } catch(error){setSendError(error.message||'Your message could not be sent. Your draft is still here.');await refetch();}
    finally {inFlight.current=false;setSending(false);}
  };
  if(isPending)return <div role="status" className="rounded-xl border bg-white p-6">Loading communications…</div>;
  if(isError)return <div role="alert" className="space-y-3 rounded-xl border bg-white p-6"><p>Communication history is unavailable. Use your private portal link or ask your contractor for a fresh link.</p><Button variant="outline" onClick={()=>refetch()}>Try again</Button></div>;
  if(!data?.enabled)return <div role="status" className="rounded-xl border bg-white p-6">Communications are currently unavailable in this portal.</div>;
  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="portal-compose-heading">
      <h2 id="portal-compose-heading" className="text-lg font-bold text-slate-900">{reply?'Reply to your contractor':'Message your contractor'}</h2>
      <p className="mt-1 text-sm text-slate-600">Send to {companyName||'your contractor'} using their saved business contact details.</p>
      <form onSubmit={send} className="mt-5 space-y-4">
        <fieldset disabled={sending} className="flex flex-wrap gap-3"><legend className="mb-2 text-sm font-semibold">Send by</legend>
          {['Email','SMS'].map(type=><label key={type} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 ${!(type==='Email'?data.email_available:data.sms_available)?'opacity-50':''}`}>
            <input type="radio" name="portal-channel" value={type} checked={channel===type} onChange={()=>setChannel(type)} disabled={!(type==='Email'?data.email_available:data.sms_available)} />{type}
          </label>)}
        </fieldset>
        {!channelAvailable&&<p className="text-sm text-slate-600">Your contractor has not configured this contact method.</p>}
        {channel==='Email'&&<div className="space-y-2"><Label htmlFor="portal-message-subject">Subject</Label><Input id="portal-message-subject" required maxLength={160} value={subject} disabled={sending} onChange={e=>setSubject(e.target.value)} /></div>}
        <div className="space-y-2"><Label htmlFor="portal-message-body">Message</Label><Textarea id="portal-message-body" required rows={6} maxLength={limit} value={message} disabled={sending} onChange={e=>setMessage(e.target.value)} aria-describedby="portal-message-count" className="min-h-36 resize-y" />
          <p id="portal-message-count" className="text-right text-xs text-slate-600">{message.length.toLocaleString()} / {limit.toLocaleString()}</p></div>
        {sendError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{sendError} Your draft is still here.</p>}
        {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={sending||!channelAvailable||!message.trim()||message.length>limit||(channel==='Email'&&!subject.trim())} className="min-h-11 bg-amber-400 text-slate-950 hover:bg-amber-500"><Send className="mr-2 h-4 w-4" />{sending?'Sending…':`Send ${channel}`}</Button>
          {(reply||sendError)&&<Button type="button" variant="outline" disabled={sending} className="min-h-11" onClick={()=>{intent.current=null;setReply(null);setSubject('');setSendError('');setNotice('');}}>Start new message</Button>}
        </div>
      </form>
    </section>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="portal-history-heading">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 id="portal-history-heading" className="text-lg font-bold">Communication history</h2><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Refresh communication history" onClick={()=>refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
      {!messages.length&&<p className="py-8 text-center text-sm text-slate-600">No email or SMS messages yet.</p>}
      <div className="space-y-3">{messages.map(row=>{
        const fromYou=String(row.direction).toLowerCase()==='inbound';
        return <article key={row.id} className={`min-w-0 rounded-xl border p-4 ${fromYou?'border-amber-200 bg-amber-50/60':'border-slate-200 bg-slate-50'}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">{row.type==='SMS'?<MessageSquare className="h-4 w-4" />:<Mail className="h-4 w-4" />}<span className="font-semibold">{fromYou?'You':companyName||'Your contractor'}</span><span>{row.type}</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></div>
          {row.subject&&<h3 className="mt-2 break-words font-semibold text-slate-900">{row.subject}</h3>}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{row.type==='Email'&&!fromYou?communicationText(row.message):row.message}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-600">{row.status}</span>{!fromYou&&<Button variant="outline" className="min-h-11 bg-white text-slate-800" disabled={sending||!(row.type==='Email'?data.email_available:data.sms_available)} onClick={()=>startReply(row)}>Reply by {row.type}</Button>}</div>
        </article>;
      })}</div>
      {(hasOlder??data.has_more)&&<Button variant="outline" className="mt-4 min-h-11 w-full" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder?'Loading…':'Load earlier messages'}</Button>}
      {pageError&&<p role="alert" className="mt-3 text-sm text-red-800">{pageError}</p>}
    </section>
  </div>;
}
