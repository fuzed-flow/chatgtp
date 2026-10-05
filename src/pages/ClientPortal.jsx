import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, Receipt, Calendar, DollarSign, Eye, 
  Lock, AlertCircle, Image as ImageIcon, Download, 
  ShieldCheck, FilePlus, ChevronDown, Newspaper, DownloadCloud, ClipboardCheck
} from "lucide-react";
import { format } from "date-fns";
import { createPageUrl } from "../utils";
import StatusBadge from "../components/shared/StatusBadge";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import { ClientUpdatePreview } from "@/components/client-updates/ClientUpdatePreviewDialog";
import { generateClientUpdatePDF, generateProjectCloseoutPDF } from "@/components/pdf/PDFGenerator";
import ProjectCloseoutPreview from "@/components/closeouts/ProjectCloseoutPreview";

export default function ClientPortal() {
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("id");
  const requestedUpdateId = params.get("update");
  const requestedCloseoutId = params.get("closeout");

  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState(() => params.get("tab") || "quotes");
  const [lightboxImage, setLightboxImage] = useState(null);

  // --- DATA STATE (Vanilla React) ---
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [client, setClient] = useState(null);
  const [company, setCompany] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [clientUpdates, setClientUpdates] = useState([]);
  const [projectCloseouts, setProjectCloseouts] = useState([]);

  // --- VANILLA DATA FETCHING ---
  useEffect(() => {
    const fetchPortalData = async () => {
      try {
        if (!clientId) {
          setIsError(true);
          setIsLoading(false);
          return;
        }

        const { data: clientData, error: clientError } = await supabase
          .from("clients")
          .select("*")
          .eq("id", clientId)
          .maybeSingle();

        if (clientError || !clientData) {
          setIsError(true);
          setIsLoading(false);
          return;
        }
        
        setClient(clientData);

        const [companyRes, quotesRes, coRes, invoicesRes, updatesRes, closeoutsRes] = await Promise.all([
          supabase.from("companies").select("*").eq("id", clientData.company_id).maybeSingle(),
          supabase.from("quotes").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
          supabase.from("change_orders").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
          supabase.from("invoices").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
          supabase.rpc("get_client_portal_updates", { p_client: clientId }),
          supabase.rpc("get_client_portal_closeouts", { p_client: clientId })
        ]);

        if (companyRes.data) setCompany(companyRes.data);
        if (quotesRes.data) setQuotes(quotesRes.data);
        if (invoicesRes.data) setInvoices(invoicesRes.data);
        if (updatesRes.data && !updatesRes.error) setClientUpdates(updatesRes.data);
        if (closeoutsRes.data && !closeoutsRes.error) setProjectCloseouts(closeoutsRes.data);
        
        if (coRes.data && !coRes.error) {
          setChangeOrders(coRes.data);
        }

      } catch (err) {
        console.error("Portal Error:", err);
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPortalData();
  }, [clientId]);

  // --- EXTRACT PORTAL SETTINGS ---
  const portalSettings = company?.settings?.client_portal || {};
  const showQuotes = portalSettings.show_quotes !== false;
  const showCOs = portalSettings.show_change_orders !== false;
  const showInvoices = portalSettings.show_invoices !== false;
  const showDocs = portalSettings.show_documents !== false;
  const showPortfolio = portalSettings.show_portfolio !== false;
  const showUpdates = portalSettings.show_client_updates !== false;
  const showCloseouts = portalSettings.show_project_closeouts !== false;

  // Set the initial active tab based on what is actually enabled
  useEffect(() => {
    if (!company) return;
    const available = [showUpdates && "updates", showCloseouts && "closeouts", showQuotes && "quotes", showCOs && "change_orders", showInvoices && "invoices", showDocs && "documents", showPortfolio && "photos"].filter(Boolean);
    if (!available.includes(activeTab)) setActiveTab(available[0] || "updates");
  }, [company, showUpdates, showCloseouts, showQuotes, showCOs, showInvoices, showDocs, showPortfolio, activeTab]);

  // --- EXTRACT DOCUMENTS & PHOTOS ---
  const allDocuments = quotes.flatMap(q => 
    (q.documents || []).map(doc => ({ ...doc, quote_number: q.quote_number, quote_title: q.title }))
  );

  const allPhotos = quotes.flatMap(q => {
    const photos = [];
    if (q.hero_image_url) photos.push({ url: q.hero_image_url, source: `Quote ${q.quote_number}` });
    if (q.end_photos && q.end_photos.length > 0) {
      q.end_photos.forEach(url => photos.push({ url, source: `Past Work - Quote ${q.quote_number}` }));
    }
    return photos;
  });

  // --- UI: LOADING STATE ---
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 font-bold tracking-wide">Decrypting Portal...</p>
        </div>
      </div>
    );
  }

  // --- UI: INVALID LINK / NO CLIENT ---
  if (isError || !client) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Card className="p-8 text-center max-w-md shadow-2xl border-slate-800 bg-slate-900">
          <AlertCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Invalid Secure Link</h2>
          <p className="text-slate-400 mb-6">We couldn't find a client account associated with this encrypted portal link.</p>
          <p className="text-sm text-slate-500 border-t border-slate-800 pt-4">Please contact your contractor for a fresh portal link.</p>
        </Card>
      </div>
    );
  }

  // --- UI: PORTAL DISABLED ---
  if (company && portalSettings.portal_active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Card className="p-8 text-center max-w-md shadow-2xl border-slate-800 bg-slate-900">
          <Lock className="h-16 w-16 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Portal Unavailable</h2>
          <p className="text-slate-400 mb-6">This client portal is currently inactive or has been disabled.</p>
          <p className="text-sm text-slate-500 border-t border-slate-800 pt-4">Please contact your contractor for assistance.</p>
        </Card>
      </div>
    );
  }
  
  const contractorName = company?.name || "Your Contractor";

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans pb-12 flex flex-col">
      {/* 🚀 PREMIUM FUZEDFLOW HEADER */}
      <div className="bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <img 
              src="https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzed-flow-logo.png" 
              alt="FuzedFlow Logo" 
              className="h-8 w-auto object-contain"
            />
            <div className="h-6 w-px bg-slate-700 mx-2 hidden sm:block"></div>
            <span className="text-white text-xl font-light tracking-wide hidden sm:block">
              Client <span className="font-bold">Portal</span>
            </span>
          </div>

          <div className="text-center md:text-right flex flex-col md:items-end">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">
              Provided By <span className="text-amber-500 font-bold">{contractorName}</span>
            </p>
            <div className="flex items-center justify-center md:justify-end gap-2 text-white">
              <Lock className="w-4 h-4 text-emerald-400" />
              <span className="text-lg font-black tracking-tight">{client.name}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 🧭 MAIN CONTENT AREA */}
      <div className="max-w-6xl mx-auto px-4 mt-8 flex-1 w-full">
        
        {/* 💬 CUSTOM WELCOME MESSAGE */}
        {portalSettings.welcome_message && (
          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 mb-8 flex gap-4 items-start">
            <div className="h-10 w-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0 border border-amber-200 shadow-inner">
              <span className="text-amber-600 font-black text-lg">👋</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Welcome to your Portal</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{portalSettings.welcome_message}</p>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          
          {/* 📱 MOBILE DROPDOWN NAVIGATION */}
          <div className="sm:hidden relative">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              className="w-full appearance-none bg-white border border-slate-200 text-slate-900 text-sm font-bold py-3.5 pl-5 pr-12 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
            >
              {showUpdates && <option value="updates">Project Updates ({clientUpdates.length})</option>}
              {showCloseouts && <option value="closeouts">Project Closeouts ({projectCloseouts.length})</option>}
              {showQuotes && <option value="quotes">Quotes ({quotes.length})</option>}
              {showCOs && <option value="change_orders">Change Orders ({changeOrders.length})</option>}
              {showInvoices && <option value="invoices">Invoices ({invoices.length})</option>}
              {showDocs && <option value="documents">Documents ({allDocuments.length})</option>}
              {showPortfolio && <option value="photos">Past Project Portfolio ({allPhotos.length})</option>}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-amber-500">
              <ChevronDown className="h-5 w-5" />
            </div>
          </div>

          {/* 💻 DESKTOP PILLS NAVIGATION */}
          <TabsList className="hidden sm:flex bg-white border border-slate-200 shadow-sm p-1.5 rounded-full flex-wrap h-auto justify-center gap-2">
            {showUpdates && (
              <TabsTrigger value="updates" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <Newspaper className="w-4 h-4 mr-2" /> Updates ({clientUpdates.length})
              </TabsTrigger>
            )}
            {showCloseouts && (
              <TabsTrigger value="closeouts" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <ClipboardCheck className="w-4 h-4 mr-2" /> Closeouts ({projectCloseouts.length})
              </TabsTrigger>
            )}
            {showQuotes && (
              <TabsTrigger value="quotes" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <FileText className="w-4 h-4 mr-2" /> Quotes ({quotes.length})
              </TabsTrigger>
            )}

            {showCOs && (
              <TabsTrigger value="change_orders" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <FilePlus className="w-4 h-4 mr-2" /> Change Orders ({changeOrders.length})
              </TabsTrigger>
            )}
            
            {showInvoices && (
              <TabsTrigger value="invoices" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <Receipt className="w-4 h-4 mr-2" /> Invoices ({invoices.length})
              </TabsTrigger>
            )}
            
            {showDocs && (
              <TabsTrigger value="documents" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <Download className="w-4 h-4 mr-2" /> Documents ({allDocuments.length})
              </TabsTrigger>
            )}
            
            {showPortfolio && (
              <TabsTrigger value="photos" className="rounded-full px-5 py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:bg-slate-50 transition-all">
                <ImageIcon className="w-4 h-4 mr-2" /> Portfolio ({allPhotos.length})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="updates" className="focus:outline-none">
            <div className="space-y-6">
              {clientUpdates.length === 0 ? (
                <Card className="border-0 p-12 text-center shadow-xl ring-1 ring-slate-100">
                  <Newspaper className="mx-auto mb-3 h-12 w-12 text-slate-200" />
                  <p className="font-medium text-slate-500">No project updates have been published yet.</p>
                </Card>
              ) : clientUpdates.map(update => {
                const project = { id: update.project_id, name: update.project_name, project_number: update.project_number, site_address: update.site_address };
                return (
                  <div key={update.id} id={`client-update-${update.id}`} className={requestedUpdateId === update.id ? "rounded-2xl ring-4 ring-amber-300 ring-offset-4" : ""}>
                    <ClientUpdatePreview update={update} project={project} client={client} company={company} />
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" onClick={() => generateClientUpdatePDF(update, project, client, company)} className="bg-white font-bold"><DownloadCloud className="mr-2 h-4 w-4" />Download PDF</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="closeouts" className="focus:outline-none">
            <div className="space-y-6">
              {projectCloseouts.length === 0 ? (
                <Card className="border-0 p-12 text-center shadow-xl ring-1 ring-slate-100">
                  <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-slate-200" />
                  <p className="font-medium text-slate-500">No project closeouts have been published yet.</p>
                </Card>
              ) : projectCloseouts.map(closeout => {
                const project = { id: closeout.project_id, name: closeout.project_name, project_number: closeout.project_number, site_address: closeout.site_address };
                const items = Array.isArray(closeout.items) ? closeout.items : [];
                return (
                  <div key={closeout.id} id={`project-closeout-${closeout.id}`} className={requestedCloseoutId === closeout.id ? "rounded-2xl ring-4 ring-amber-300 ring-offset-4" : ""}>
                    <ProjectCloseoutPreview closeout={closeout} items={items} project={project} client={client} company={company} compact />
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" onClick={() => generateProjectCloseoutPDF(closeout, items, project, client, company)} className="bg-white font-bold"><DownloadCloud className="mr-2 h-4 w-4" />Download PDF</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* 📄 QUOTES TAB */}
          <TabsContent value="quotes" className="focus:outline-none">
            <Card className="border-0 shadow-xl bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
              <CardHeader className="bg-slate-50 border-b border-slate-100 py-5">
                <CardTitle className="text-xl font-black text-slate-900 flex items-center">
                  Project Quotes
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {quotes.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <FileText className="w-12 h-12 text-slate-200 mb-3" />
                    <p className="text-slate-500 font-medium">No quotes currently available.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {quotes.map((quote) => (
                      <div key={quote.id} className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-amber-50/30 transition-colors">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm font-black text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-md">
                              {quote.quote_number}
                            </span>
                            <StatusBadge status={quote.status} />
                          </div>
                          <p className="text-lg font-bold text-slate-900">{quote.title}</p>
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm text-slate-500 font-medium">
                            <span className="flex items-center"><Calendar className="w-4 h-4 mr-1.5 text-slate-400" /> {format(new Date(quote.created_at), "MMMM d, yyyy")}</span>
                            <span className="flex items-center text-slate-700 font-bold"><DollarSign className="w-4 h-4 mr-1 text-slate-400" /> {formatCurrencyUSD(quote.total || 0)}</span>
                          </div>
                        </div>
                        <Button 
                          onClick={() => window.open(createPageUrl(`PublicQuoteView?id=${quote.id}`), "_blank")}
                          className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-md rounded-lg h-11 px-6"
                        >
                          <Eye className="w-4 h-4 mr-2" /> View & Accept Quote
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 🚨 CHANGE ORDERS TAB */}
          <TabsContent value="change_orders" className="focus:outline-none">
            <Card className="border-0 shadow-xl bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
              <CardHeader className="bg-slate-50 border-b border-slate-100 py-5">
                <CardTitle className="text-xl font-black text-slate-900 flex items-center">
                  Change Orders
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {changeOrders.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <FilePlus className="w-12 h-12 text-slate-200 mb-3" />
                    <p className="text-slate-500 font-medium">No change orders currently available.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {changeOrders.map((co) => (
                      <div key={co.id} className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-amber-50/30 transition-colors">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm font-black text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-md">
                              {co.co_number || `CO-${co.id.slice(0,6).toUpperCase()}`}
                            </span>
                            <StatusBadge status={co.status} />
                          </div>
                          <p className="text-lg font-bold text-slate-900">{co.title}</p>
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm text-slate-500 font-medium">
                            <span className="flex items-center"><Calendar className="w-4 h-4 mr-1.5 text-slate-400" /> {format(new Date(co.created_at), "MMMM d, yyyy")}</span>
                            <span className="flex items-center text-slate-700 font-bold"><DollarSign className="w-4 h-4 mr-1 text-slate-400" /> {formatCurrencyUSD(co.total || 0)}</span>
                          </div>
                        </div>
                        <Button 
                          onClick={() => window.open(createPageUrl(`PublicChangeOrderView?id=${co.id}`), "_blank")}
                          className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-md rounded-lg h-11 px-6"
                        >
                          <Eye className="w-4 h-4 mr-2" /> View & Accept
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 🧾 INVOICES TAB */}
          <TabsContent value="invoices" className="focus:outline-none">
            <Card className="border-0 shadow-xl bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
              <CardHeader className="bg-slate-50 border-b border-slate-100 py-5">
                <CardTitle className="text-xl font-black text-slate-900">Billing & Invoices</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {invoices.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <Receipt className="w-12 h-12 text-slate-200 mb-3" />
                    <p className="text-slate-500 font-medium">No invoices available.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {invoices.map((invoice) => (
                      <div key={invoice.id} className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-amber-50/30 transition-colors">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm font-black text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-md">
                              {invoice.invoice_number}
                            </span>
                            <StatusBadge status={invoice.status} />
                          </div>
                          <p className="font-bold text-slate-700 text-lg">Total: {formatCurrencyUSD(invoice.total || 0)}</p>
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm font-medium">
                            <span className="flex items-center text-slate-500"><Calendar className="w-4 h-4 mr-1.5 text-slate-400" /> Due: {format(new Date(invoice.due_date), "MMM d, yyyy")}</span>
                            <span className="flex items-center text-rose-600 font-bold"><AlertCircle className="w-4 h-4 mr-1 text-rose-500" /> Balance: {formatCurrencyUSD(invoice.balance_due || 0)}</span>
                          </div>
                        </div>
                        <Button onClick={() => window.open(createPageUrl(`PublicInvoiceView?id=${invoice.id}`), "_blank")} variant="outline" className="w-full sm:w-auto font-bold border-slate-300 hover:bg-slate-50 rounded-lg h-11 px-6 shadow-sm">
                          <Eye className="w-4 h-4 mr-2 text-slate-400" /> View Invoice
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 📎 DOCUMENTS TAB */}
          <TabsContent value="documents" className="focus:outline-none">
            <Card className="border-0 shadow-xl bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
              <CardHeader className="bg-slate-50 border-b border-slate-100 py-5">
                <CardTitle className="text-xl font-black text-slate-900">Project Documents</CardTitle>
              </CardHeader>
              <CardContent className="p-5 sm:p-6">
                {allDocuments.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <Download className="w-12 h-12 text-slate-200 mb-3" />
                    <p className="text-slate-500 font-medium">No documents attached to your projects.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {allDocuments.map((doc, idx) => (
                      <a 
                        key={idx} 
                        href={doc.file_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center p-4 rounded-xl border border-slate-200 bg-white hover:border-amber-400 hover:ring-1 hover:ring-amber-400 hover:shadow-md transition-all group"
                      >
                        <div className="bg-slate-50 p-3 rounded-lg mr-4 group-hover:bg-amber-100 transition-colors border border-slate-100">
                          <FileText className="h-6 w-6 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-900 truncate">{doc.file_name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-1 truncate">Source: {doc.quote_title}</p>
                        </div>
                        <Download className="h-5 w-5 text-slate-300 group-hover:text-amber-500 ml-2 transition-colors" />
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 🖼️ PAST PROJECT PORTFOLIO TAB */}
          <TabsContent value="photos" className="focus:outline-none">
            <Card className="border-0 shadow-xl bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
              <CardHeader className="bg-slate-50 border-b border-slate-100 py-5 flex flex-row items-center justify-between">
                <CardTitle className="text-xl font-black text-slate-900">Past Project Portfolio</CardTitle>
              </CardHeader>
              <CardContent className="p-5 sm:p-6">
                {allPhotos.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <ImageIcon className="w-12 h-12 text-slate-200 mb-3" />
                    <p className="text-slate-500 font-medium">No portfolio photos available yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {allPhotos.map((photo, idx) => (
                      <div 
                        key={idx} 
                        className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl hover:ring-2 hover:ring-amber-400 transition-all cursor-pointer" 
                        onClick={() => setLightboxImage(photo.url)}
                      >
                        <img 
                          src={photo.url} 
                          alt="Project Work" 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out" 
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                          <p className="text-white text-xs font-bold truncate leading-relaxed">
                            {photo.source}
                          </p>
                          <div className="flex items-center gap-1 mt-1 text-amber-400">
                            <Eye className="w-3 h-3" /> <span className="text-[10px] font-bold uppercase tracking-wider">View Full</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* 🔐 SECURE FOOTER */}
      <div className="max-w-6xl mx-auto px-4 mt-12 text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 rounded-full border border-emerald-100 mb-4">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-bold text-emerald-800 uppercase tracking-widest">256-Bit Encrypted Portal</span>
        </div>
        <p className="text-xs font-medium text-slate-400">
          Secure Client Access • Last Updated: {format(new Date(), "MMM d, yyyy")} • © {new Date().getFullYear()} FuzedFlow
        </p>
      </div>

      {/* 🔍 LIGHTBOX FOR PHOTOS */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 p-4 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <img 
            src={lightboxImage} 
            alt="Enlarged view" 
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()} 
          />
          <button 
            onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 bg-white/10 hover:bg-amber-500 border border-white/20 hover:border-amber-500 text-white rounded-full w-12 h-12 flex items-center justify-center text-2xl font-light transition-all shadow-lg"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
