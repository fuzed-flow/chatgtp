import React from 'react';
import { Shield, Lock, CreditCard, Mail, Phone, ArrowLeft } from 'lucide-react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased selection:bg-amber-100 selection:text-slate-900">
      
      {/* HEADER HERO */}
      <header className="bg-white border-b border-slate-200 py-12 px-4 sm:px-6 lg:px-8 shadow-sm">
        <div className="max-w-4xl mx-auto">
          <button 
            onClick={() => window.history.back()}
            className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 mb-6 transition-colors group"
          >
            <ArrowLeft className="h-4 w-4 mr-1 transform group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
          
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-amber-50 rounded-lg text-amber-500 border border-amber-200">
              <Shield className="h-6 w-6" />
            </div>
            <span className="text-xs font-black text-amber-600 uppercase tracking-widest bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              Legal Compliance
            </span>
          </div>
          
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs font-semibold text-slate-400 mt-2">
            Last Updated: July 12, 2026
          </p>
        </div>
      </header>

      {/* CORE BODY CONTENT */}
      <main className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* INTRO */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
          <p className="text-slate-600 leading-relaxed font-medium">
            Welcome to FuzedFlow (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). We provide a software platform engineered to help home service professionals manage quotes, change orders, invoices, and automated client communications. 
          </p>
          <p className="text-slate-600 leading-relaxed font-medium mt-4">
            This Privacy Policy details how we collect, handle, disclose, and defend your information when you interact with our core website (fuzedflow.com) and access our proprietary software architecture (collectively, the &ldquo;Service&rdquo;). This policy governs operations for both our primary business platform users (contractors) and the end-customers whose properties and billing terms are managed natively through our database layer (homeowners).
          </p>
        </section>

        {/* 1. INFORMATION WE COLLECT */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">01.</span> Information We Collect
          </h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            We track and capture identifiers, logistical tags, operational data points, or transactional criteria that could reasonably be associated with an individual or specific field business entity.
          </p>

          <div className="space-y-4 pt-2">
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">A. Information Provided Natively by Platform Users</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Account initialization metrics including legal name, operational business naming conventions, mobile numbers, structural email addresses, physical office routing locations, and authorized security credentials.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">B. Project and Customer Metrics Uploaded by Users</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                To power automated workflows, our primary business users provide secondary customer data fields including homeowner names, active contact emails, mobile phone lines, target billing layout addresses, and exact site location coordinates.
              </p>
            </div>

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-2">
              <h3 className="font-bold text-blue-950 text-sm flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-blue-600" /> C. Financial Routing and Processing Data (Stripe Connect Protocol)
              </h3>
              <p className="text-blue-900 text-xs leading-relaxed">
                FuzedFlow routes platform financial payloads exclusively using the <strong className="font-black text-blue-950">Stripe Connect</strong> processing ecosystem (&ldquo;FuzedFlow Payments&rdquo;).
              </p>
              <ul className="list-disc list-inside text-blue-900 text-xs space-y-1.5 pl-2 pt-1 font-medium">
                <li>
                  <strong className="text-blue-950">For Contractors:</strong> Banking routing coordinates, active account numbers, and dynamic government identity tags (EIN/SSN) are safely tunneled straight into Stripe via hyper-secure API handshakes. Raw banking tokens and verification attachments never hit or rest on our native application servers.
                </li>
                <li>
                  <strong className="text-blue-950">For Homeowners:</strong> Online invoice liquidations utilize direct cryptographic execution models via Stripe Elements. Raw card metrics, expiration sequences, and security signatures are directly submitted to Stripe. FuzedFlow preserves only tokenized payment reference indicators and basic accounting flags (e.g., transaction status, partial balance metrics) required to resolve database balances.
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">D. Automated Infrastructure Logging</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                System tracking assets collect network variables including incoming IP flags, browser specifications, active operating systems, page interaction flows, and critical device configurations.
              </p>
            </div>
          </div>
        </section>

        {/* 2. HOW WE USE YOUR INFORMATION */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">02.</span> How We Use Your Information
          </h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            We isolate and manage collected application variables exclusively to drive core business mechanisms:
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-bold text-slate-700 pl-2">
            <li className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-lg">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" /> Core platform processing and invoice tracking
            </li>
            <li className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-lg">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" /> Stripe payout management and tracking fees
            </li>
            <li className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-lg">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" /> Automated client notifications (Resend & Twilio)
            </li>
            <li className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-lg">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" /> Database performance tracking and system debugging
            </li>
          </ul>
        </section>

        {/* 3. SHARING AND THIRD-PARTY DISCLOSURES */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">03.</span> Sharing and Third-Party Disclosures
          </h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            FuzedFlow enforces a strict policy against selling, leasing, or trading proprietary platform data structures. Your information is exposed exclusively to specific network vendors foundational to your account execution models:
          </p>
          <div className="space-y-3 pt-2">
            <div className="text-xs border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              <p className="font-black text-slate-900 mb-0.5">Stripe, Inc.</p>
              <p className="text-slate-500 leading-relaxed">Identity verification matrices, bank account anchors, and balance requirements are shared with Stripe to instantiate platform connected accounts, satisfy KYC legal protocols, and authorize live charge events.</p>
            </div>
            <div className="text-xs border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              <p className="font-black text-slate-900 mb-0.5">Resend, Inc.</p>
              <p className="text-slate-500 leading-relaxed">Client text parameters, email metadata addresses, and clean proposal layout formatting values are synchronized with Resend to issue high-deliverability estimate updates and invoice alerts.</p>
            </div>
            <div className="text-xs border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              <p className="font-black text-slate-900 mb-0.5">Twilio, Inc.</p>
              <p className="text-slate-500 leading-relaxed">Mobile contact fields and short notification copies are processed via Twilio structures to handle real-time automated SMS text check-ins and late notice sequences.</p>
            </div>
          </div>
        </section>

        {/* 4. SECURITY CONTROLS */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">04.</span> Data Security & Architecture
          </h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            We maintain strict software guardrails to lock down your data pipelines:
          </p>
          <ul className="list-disc list-inside text-xs text-slate-600 space-y-2 font-medium pl-2">
            <li>All outbound server connections run exclusively across encrypted <strong className="text-slate-900">SSL and TLS transport layers</strong>.</li>
            <li>Database instances apply advanced <strong className="text-slate-900">Row-Level Security (RLS) policies</strong> to completely guarantee distinct isolation rings between competing companies.</li>
            <li>Administrative authorization metrics adhere strictly to zero-trust, least-privilege framework principles.</li>
          </ul>
          <div className="flex gap-2 items-start bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs font-semibold text-slate-500 mt-2">
            <Lock className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <p>While we execute enterprise-grade technical strategies, no cloud architecture can promise flawless absolute protection against edge-case vectors. Users execute interactions acknowledging this structural foundation.</p>
          </div>
        </section>

        {/* 5. USER RIGHTS AND CHOICES */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">05.</span> Your Choices and Rights
          </h2>
          <ul className="list-disc list-inside text-xs text-slate-600 space-y-2 font-medium pl-2">
            <li><strong className="text-slate-900">Account Modifications:</strong> Dashboard operators can dynamically rewrite company profile lines, address fields, and operational identity details inside the profile settings panel at any time.</li>
            <li><strong className="text-slate-900">Data Deletion Inquiries:</strong> Active platforms can request full record deletions by contacting support queues. System metrics linked to transactional records (invoices, past card events) will persist to meet regulatory tax audit timelines.</li>
            <li><strong className="text-slate-900">Client Communication Opt-Outs:</strong> Homeowners can isolate themselves from system automations via native email footer hooks or by executing standard <strong className="text-slate-900">&ldquo;STOP&rdquo;</strong> keywords to text alerts.</li>
          </ul>
        </section>

        {/* 6. POLICY MODIFICATIONS */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-3">
          <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <span className="text-amber-500 font-mono">06.</span> Updates to This Policy
          </h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            We reserve authority to alter this Privacy Policy as our underlying database engines, cloud configurations, and multi-regional billing compliance standards scale. When updates lock in, the revised tracker stamp at the top header will update instantly. Continued app runtime usage constitutes standard structural consent.
          </p>
        </section>

        {/* 7. CONTACT DETAILS */}
        <section className="bg-slate-900 border border-slate-950 rounded-2xl p-6 sm:p-8 text-white shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
              <Mail className="h-5 w-5 text-amber-500" /> Compliance & Support Queue
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              Have security architecture, data isolation, or corporate processing alignment questions?
            </p>
          </div>
          <a 
            href="mailto:support@fuzedflow.com"
            className="inline-flex items-center px-5 py-3 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all hover:scale-[1.02]"
          >
            Contact Support
          </a>
        </section>

      </main>

      {/* FOOTER DISCLOSURE */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs font-bold text-slate-400">
        &copy; {new Date().getFullYear()} FuzedFlow Technologies Inc. All Rights Reserved.
      </footer>

    </div>
  );
}