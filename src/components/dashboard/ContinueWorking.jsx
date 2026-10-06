import React from "react";
import { useNavigate } from "react-router-dom";
import { Play, FileText, Receipt, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDocumentContactName } from "@/lib/documentContact";
import StatusBadge from "../shared/StatusBadge";

export default function ContinueWorking({ quotes = [], invoices = [], clients = [], leads = [] }) {
  const navigate = useNavigate();

  // Formatters
  const formatCurrency = (val) => val ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val) : '$0.00';

  // Filter for the 3 most recent drafts
  const draftQuotes = quotes.filter(q => ["Draft", "Sent", "Pending"].includes(q.status)).slice(0, 3);
  const draftInvoices = invoices.filter(i => ["Draft", "Pending", "Unpaid"].includes(i.status)).slice(0, 3);

  // If there's absolutely nothing to continue working on, hide the section entirely
  if (draftQuotes.length === 0 && draftInvoices.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      
      {/* QUOTES PANEL */}
      <Card className="p-5 border-2 border-slate-200 shadow-sm bg-gradient-to-br from-slate-50 to-white flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-500" /> Resume Quotes
          </h3>
          <Button variant="link" size="sm" onClick={() => navigate('/Quotes')} className="text-slate-500 hover:text-slate-900 h-auto p-0">
            View All <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        
        <div className="space-y-2 flex-1">
          {draftQuotes.map(quote => (
            <div key={quote.id} className="group bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer" onClick={() => navigate(`/QuoteBuilder?id=${quote.id}`)}>
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-slate-900 truncate">{quote.title || `Quote #${quote.quote_number}`}</span>
                  <StatusBadge status={quote.status} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span className="truncate">{getDocumentContactName(quote, clients, leads)}</span>
                  <span className="shrink-0 font-bold text-slate-700">{formatCurrency(quote.total_amount || quote.subtotal)}</span>
                </div>
              </div>
              <Button size="icon" className="shrink-0 h-8 w-8 bg-slate-100 text-slate-600 hover:bg-amber-400 hover:text-slate-900 group-hover:scale-105 transition-all rounded-full">
                <Play className="h-3.5 w-3.5 ml-0.5" fill="currentColor" />
              </Button>
            </div>
          ))}
          {draftQuotes.length === 0 && (
            <div className="text-center py-6">
              <p className="text-xs text-slate-400 font-medium italic">No draft quotes pending.</p>
            </div>
          )}
        </div>
      </Card>

      {/* INVOICES PANEL */}
      <Card className="p-5 border-2 border-slate-200 shadow-sm bg-gradient-to-br from-slate-50 to-white flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-blue-500" /> Resume Invoices
          </h3>
          <Button variant="link" size="sm" onClick={() => navigate('/Invoices')} className="text-slate-500 hover:text-slate-900 h-auto p-0">
            View All <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        
        <div className="space-y-2 flex-1">
          {draftInvoices.map(invoice => (
            <div key={invoice.id} className="group bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer" onClick={() => navigate(`/InvoiceBuilder?id=${invoice.id}`)}>
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-slate-900 truncate">Invoice #{invoice.invoice_number}</span>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span className="truncate">{getDocumentContactName(invoice, clients, leads)}</span>
                  <span className="shrink-0 font-bold text-slate-700">{formatCurrency(invoice.total_amount || invoice.subtotal)}</span>
                </div>
              </div>
              <Button size="icon" className="shrink-0 h-8 w-8 bg-slate-100 text-slate-600 hover:bg-blue-500 hover:text-white group-hover:scale-105 transition-all rounded-full">
                <Play className="h-3.5 w-3.5 ml-0.5" fill="currentColor" />
              </Button>
            </div>
          ))}
          {draftInvoices.length === 0 && (
            <div className="text-center py-6">
              <p className="text-xs text-slate-400 font-medium italic">No draft invoices pending.</p>
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
