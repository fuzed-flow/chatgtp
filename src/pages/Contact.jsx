import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Mail, Phone, Clock, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SupportThreads from '@/components/help/SupportThreads';

const SUPPORT_EMAIL = 'support@fuzedflow.com';

export default function Contact() {
  const { profile, company } = useAuth();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  function openEmail(event) {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) { setStatus('Please enter a subject and message.'); return; }
    const body = `${message.trim()}\n\nFrom: ${profile?.full_name || ''}\nCompany: ${company?.name || ''}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(body)}`;
    setStatus('Your email app will open with a draft. Review it and tap Send there. If it does not open, copy the email address below.');
  }
  async function copyEmail() {
    try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopied(true); }
    catch { setStatus(`Email us at ${SUPPORT_EMAIL}.`); }
  }
  return <main className="mx-auto max-w-4xl space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
    <Link to="/FAQ" className="inline-flex min-h-12 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 focus-visible:ring-2 focus-visible:ring-amber-500"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to help</Link>
    <header className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><MessageCircle className="h-6 w-6" aria-hidden="true" /></div><div><h1 className="text-2xl font-black text-slate-900 sm:text-3xl">Contact support</h1><p className="mt-1 text-sm leading-relaxed text-slate-500">Tell us what you were trying to do and where you got stuck.</p></div></header>
    <SupportThreads />
    <div className="grid gap-5 md:grid-cols-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 md:col-span-2"><h2 className="mb-4 text-lg font-semibold text-slate-900">Email our team</h2><form onSubmit={openEmail} className="space-y-4">
        <div><label htmlFor="support-subject" className="mb-2 block text-sm font-semibold text-slate-700">Subject</label><Input id="support-subject" required maxLength={120} value={subject} onChange={event => setSubject(event.target.value)} placeholder="What do you need help with?" className="h-12 text-base focus-visible:ring-amber-500" /></div>
        <div><label htmlFor="support-message" className="mb-2 block text-sm font-semibold text-slate-700">Message</label><Textarea id="support-message" required maxLength={2000} rows={7} value={message} onChange={event => setMessage(event.target.value)} placeholder="Include the page name and any error you saw." className="min-h-40 text-base focus-visible:ring-amber-500" /><p className="mt-2 text-xs text-slate-500">Please leave out passwords and payment card details.</p></div>
        <Button type="submit" className="h-12 w-full rounded-xl bg-amber-500 font-semibold text-white hover:bg-amber-600">Open email app<Mail className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
        <p className="text-sm leading-relaxed text-slate-500">This prepares a draft in your email app. You send it from there.</p>
        {status && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">{status}</p>}
      </form></section>
      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 font-semibold text-slate-900"><Mail className="h-5 w-5 text-amber-600" aria-hidden="true" />Email</h2><a href={`mailto:${SUPPORT_EMAIL}`} className="mt-2 flex min-h-12 items-center break-all text-sm font-medium text-amber-800 underline underline-offset-4">{SUPPORT_EMAIL}</a><Button type="button" variant="outline" className="h-12 w-full" onClick={copyEmail}>{copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied ? 'Email copied' : 'Copy email address'}</Button></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 font-semibold text-slate-900"><Phone className="h-5 w-5 text-amber-600" aria-hidden="true" />Call us</h2><a href="tel:+18554003000" className="mt-2 flex min-h-12 items-center text-base font-medium text-amber-800 underline underline-offset-4">1-855-400-3000</a></section>
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h2 className="flex items-center gap-2 font-semibold text-slate-900"><Clock className="h-5 w-5 text-amber-600" aria-hidden="true" />Support hours</h2><p className="mt-3 text-sm leading-relaxed text-slate-600">Monday–Friday<br />8 AM–5 PM Mountain Time</p></section>
      </aside>
    </div>
  </main>;
}
