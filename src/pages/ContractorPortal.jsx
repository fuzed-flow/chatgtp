import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { FileText, Building2, MapPin, Download, ExternalLink, Info, Mail, ClipboardList, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function ContractorPortal() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId");

  // --- SUPABASE QUERIES ---
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["pm_project_public", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id,company_id,name,site_address,description").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: portalFiles = [], isLoading: loadingFiles } = useQuery({
    queryKey: ["contractor_portal_files_public", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contractor_portal_files")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: quoteContact, isLoading: loadingContact } = useQuery({
    queryKey: ["contractor_quote_contact", project?.company_id],
    enabled: !!project?.company_id,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("email:settings->>email")
        .eq("id", project.company_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const contactEmail = typeof quoteContact?.email === "string" ? quoteContact.email.trim() : "";
  const emailLocalPart = contactEmail.split("@")[0];
  const hasQuoteContact = contactEmail.length <= 254
    && emailLocalPart.length <= 64
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(contactEmail)
    && !emailLocalPart.startsWith(".") && !emailLocalPart.endsWith(".") && !emailLocalPart.includes("..");
  const quoteEmailUrl = hasQuoteContact
    ? `mailto:${encodeURIComponent(contactEmail).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Quote Submission: ${project?.name || "Project"}`)}`
    : null;

  // FORCED DIRECT LOCAL FILE BLOB DOWNLOAD
  const triggerFileDownload = async (url, filename) => {
    toast.loading("Downloading file...");
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || "document";
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.dismiss();
    } catch (err) {
      toast.dismiss();
      console.error("Forced download failed:", err);
      window.open(url, "_blank"); // Fallback
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 font-medium">No project specified in the link.</p>
      </div>
    );
  }

  if (loadingProject || loadingFiles) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 font-medium">Project not found or link has expired.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      
      {/* ----------------- HEADER ----------------- */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-5 flex items-center gap-3 sm:gap-4 shadow-md sticky top-0 z-50">
        <div className="h-10 w-10 shrink-0">
          <img
            src="https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzedflow_logo_black_bg_optimized.svg"
            alt="Fuzed Flow Logo"
            className="h-full w-full object-contain"
          />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight">Contractor Bid Portal</h1>
          <p className="text-slate-400 text-xs font-medium">Fuzed Flow</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* ----------------- WELCOME INSTRUCTIONS ----------------- */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 md:p-6 shadow-sm flex gap-4 items-start">
          <div className="bg-amber-100 text-amber-600 p-2.5 rounded-full shrink-0 mt-0.5">
            <Info className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-amber-900 mb-1">Invitation to Quote</h2>
            <p className="text-sm text-amber-800/80 leading-relaxed">
              You have been invited to review the scope and provide a quote for the project below. 
              Please review the project details, download the attached bid package documents, and submit your pricing when ready.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* ----------------- LEFT COLUMN: PROJECT DETAILS ----------------- */}
          <div className="md:col-span-2 space-y-8">
            
            {/* Step 1: Scope */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center gap-2">
                <span className="bg-slate-800 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">1</span>
                <h3 className="font-bold text-slate-800">Review Project Scope</h3>
              </div>
              <div className="p-5 md:p-6">
                <div className="flex items-start gap-4 mb-6">
                  <div className="h-12 w-12 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="h-6 w-6 text-amber-600" />
                  </div>
                  <div className="pt-1">
                    <h2 className="text-2xl font-black text-slate-900 leading-tight break-words">{project.name}</h2>
                    {project.site_address && (
                      <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5 mt-2">
                        <MapPin className="h-4 w-4 text-slate-400" /> {project.site_address}
                      </p>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-5 border border-slate-100">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <ClipboardList className="h-4 w-4" /> Scope of Work Overview
                  </h4>
                  {project.description ? (
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{project.description}</p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">No additional scope details provided.</p>
                  )}
                </div>
              </div>
            </section>

            {/* Step 2: Files */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center gap-2">
                <span className="bg-slate-800 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">2</span>
                <h3 className="font-bold text-slate-800">Download Bid Package</h3>
              </div>
              <div className="p-5 md:p-6">
                {portalFiles.length === 0 ? (
                  <div className="text-center py-10 bg-slate-50 border border-slate-200 border-dashed rounded-xl">
                    <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-600">No documents have been attached yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {portalFiles.map(f => (
                      <div key={f.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-slate-200 rounded-xl hover:bg-amber-50/30 hover:border-amber-200 transition-colors group">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="bg-amber-100 p-2 rounded-lg shrink-0">
                            <FileText className="h-5 w-5 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <p className="text-sm font-bold text-slate-900 truncate">{f.file_name}</p>
                            {f.description && <p className="text-xs font-medium text-slate-500 mt-1 line-clamp-2 leading-relaxed">{f.description}</p>}
                          </div>
                        </div>

                        <div className="flex gap-2 shrink-0 border-t border-slate-100 sm:border-0 pt-3 sm:pt-0">
                          <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-1.5 text-xs text-amber-700 font-bold px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 hover:bg-amber-100 hover:text-amber-800 transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" /> View
                          </a>
                          <button 
                            onClick={() => triggerFileDownload(f.file_url, f.file_name)}
                            className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-1.5 text-xs text-slate-700 font-bold px-3 py-2 rounded-lg bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* ----------------- RIGHT COLUMN: CTA ----------------- */}
          <div className="space-y-6">
            
            {/* Step 3: Submit Quote */}
            <section className="bg-slate-900 rounded-xl shadow-lg text-white overflow-hidden sticky top-24">
              <div className="bg-slate-800/50 px-5 py-4 flex items-center gap-2 border-b border-white/10">
                <span className="bg-amber-500 text-slate-900 text-xs font-black w-6 h-6 rounded-full flex items-center justify-center shrink-0">3</span>
                <h3 className="font-bold text-white">Submit Your Quote</h3>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-300 leading-relaxed mb-6">
                  Once you have reviewed the scope and documents, send your formal quote or estimate to the project contact who invited you.
                </p>

                {loadingContact ? (
                  <p role="status" className="text-sm text-slate-300">Loading quote contact...</p>
                ) : quoteEmailUrl ? (
                  <>
                    <a
                      href={quoteEmailUrl}
                      className="w-full min-h-11 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3.5 px-4 rounded-lg transition-all shadow-md hover:shadow-lg"
                    >
                      <Mail className="h-5 w-5" /> Email Your Quote
                    </a>
                    <p className="text-xs text-slate-300 mt-3 break-all">Send to: {contactEmail}</p>
                  </>
                ) : (
                  <p className="text-sm text-amber-200 leading-relaxed">
                    Reply to the project contact who sent your invitation to submit your quote.
                  </p>
                )}

                <div className="mt-6 pt-5 border-t border-white/10">
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">Have questions?</p>
                  <p className="text-sm text-slate-300 flex items-center gap-2">
                    <ArrowRight className="h-3 w-3 text-amber-500" /> Reply to your main contact directly.
                  </p>
                </div>
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs font-medium text-slate-400 pt-8 pb-8">
          Powered by Fuzed Flow • Secure Contractor Portal
        </p>
      </div>
    </div>
  );
}