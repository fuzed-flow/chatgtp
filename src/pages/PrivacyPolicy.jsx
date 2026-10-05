import React from 'react';
import { ArrowLeft, ArrowUpRight, Mail, Shield } from 'lucide-react';

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800 sm:px-6 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <a href="/login" className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
        </a>
        <Shield className="mb-4 h-8 w-8 text-amber-600" aria-hidden="true" />
        <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm font-semibold text-slate-500">Current policy updated <time dateTime="2026-10-05">October 5, 2026</time></p>
        <div className="mt-7 space-y-4 text-base leading-8 text-slate-600">
          <p>The current Fuzed Flow Privacy Policy is published on our main website and applies to this app and its related portals. It explains account and workspace information, service providers, international processing, OpenAI features, ChatGPT development tools, retention and your privacy rights.</p>
          <p>Use the full policy below for current details and privacy-request instructions. You do not need to sign in to read it or contact us.</p>
        </div>
        <a href="https://www.fuzedflow.com/privacy" className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-center font-bold text-slate-950 hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 sm:w-auto">
          Read the full Privacy Policy <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
        </a>
        <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm sm:flex-row sm:justify-between">
          <a href="https://www.fuzedflow.com/terms" className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-slate-700 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-amber-500">Terms &amp; Conditions</a>
          <a href="mailto:support@fuzedflow.com" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-slate-700 focus-visible:ring-2 focus-visible:ring-amber-500"><Mail className="h-4 w-4" aria-hidden="true" /> support@fuzedflow.com</a>
        </div>
      </article>
    </main>
  );
}
