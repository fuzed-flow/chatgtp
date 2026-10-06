import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Save, Mail, MessageSquare, Info, Receipt, Zap, Building2, FileText } from 'lucide-react';

const DEFAULT_INVOICE_EMAIL = "Hi {{client_name}},\n\nYour invoice {{invoice_number}} for ${{balance_due}} is ready to review.\n\nUse the private secure link below to view the detailed invoice and payment options.";

// --- CUSTOM TEMPLATE EDITOR WITH QUICK-INSERT TOKENS ---
const TemplateEditor = ({ value, onChange, tokens, rows = 4 }) => {
  const textareaRef = useRef(null);

  const insertToken = (tag) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // Inject the tag exactly where the cursor is
    const newValue = value.substring(0, start) + tag + value.substring(end);
    onChange(newValue);
    
    // Restore focus and put cursor right after the newly inserted tag
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  return (
    <div className="space-y-1.5 flex flex-col h-full">
      {tokens && tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1 bg-slate-100/50 p-1.5 rounded-t-lg border-x border-t border-slate-200">
          <span className="text-[10px] font-bold text-slate-400 uppercase mr-1 flex items-center">Insert:</span>
          {tokens.map(t => (
            <button
              key={t.tag}
              type="button"
              onClick={() => insertToken(t.tag)}
              className="bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-700 border border-slate-200 hover:border-amber-300 px-1.5 py-0.5 rounded shadow-sm text-[10px] font-bold font-mono transition-all"
              title={`Insert ${t.label}`}
            >
              + {t.label}
            </button>
          ))}
        </div>
      )}
      <Textarea 
        ref={textareaRef}
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        rows={rows} 
        className={`bg-slate-50/50 text-sm font-medium ${tokens && tokens.length > 0 ? 'rounded-t-none border-t-0' : ''}`} 
      />
    </div>
  );
};

export default function MessageTemplatesSettings() {
  const { company, settings } = useAuth();
  const queryClient = useQueryClient();

  // --- TEMPLATE STATES ---
  const [quoteEmail, setQuoteEmail] = useState('');
  const [quoteSms, setQuoteSms] = useState('');
  const [invoiceEmail, setInvoiceEmail] = useState('');
  const [invoiceSms, setInvoiceSms] = useState('');
  const [changeOrderEmail, setChangeOrderEmail] = useState('');
  const [changeOrderSms, setChangeOrderSms] = useState('');
  
  // Purchase orders only use email
  const [poEmail, setPoEmail] = useState('');
  
  const [emailSignature, setEmailSignature] = useState('');

  // --- TOKEN DEFINITIONS ---
  const quoteTokens = [
    { label: 'Client Name', tag: '{{client_name}}' },
    { label: 'Quote #', tag: '{{quote_number}}' },
    { label: 'Quote Title', tag: '{{quote_title}}' }
  ];

  const invoiceTokens = [
    { label: 'Client Name', tag: '{{client_name}}' },
    { label: 'Invoice #', tag: '{{invoice_number}}' },
    { label: 'Balance Due', tag: '{{balance_due}}' }
  ];

  const coTokens = [
    { label: 'Client Name', tag: '{{client_name}}' },
    { label: 'CO #', tag: '{{co_number}}' }
  ];

  const poTokens = [
    { label: 'Vendor Name', tag: '{{vendor_name}}' },
    { label: 'PO #', tag: '{{po_number}}' }
  ];

  const signatureTokens = [
    { label: 'My Name (Sender)', tag: '{{my_name}}' },
    { label: 'Company Name', tag: '{{company_name}}' }
  ];

  // --- INITIALIZE DEFAULTS OR SAVED VALUES ---
  useEffect(() => {
    if (settings?.templates) {
      const t = settings.templates;
      setQuoteEmail(t.quote_email_body || "Hi {{client_name}},\n\nPlease find attached your project quote {{quote_number}} for {{quote_title}}.\n\nYou can review the line items, choose optional additions, and securely sign off on the package using the interactive link below.");
      setQuoteSms(t.quote_sms || "Hi {{client_name}}, your project quote {{quote_number}} is ready for review! Click the link to view the details and approve online:");
      
      setInvoiceEmail(t.invoice_email_body || DEFAULT_INVOICE_EMAIL);
      setInvoiceSms(t.invoice_sms || "Hi {{client_name}}, your invoice {{invoice_number}} for ${{balance_due}} is ready. Tap the link below to view and pay securely.");
      
      setChangeOrderEmail(t.co_email_body || "Hi {{client_name}},\n\nWe have submitted a scope modification request, Change Order {{co_number}}, for your project.\n\nPlease tap the link below to review the adjustment details and sign off on the variation.");
      setChangeOrderSms(t.co_sms || "Hi {{client_name}}, Change Order {{co_number}} has been requested for your project. Tap the link to authorize the adjustment:");
      
      setPoEmail(t.po_email_body || "Hello {{vendor_name}},\n\nPlease find attached Purchase Order {{po_number}} from our team.\n\nPlease confirm receipt of this order and reply with an estimated delivery or fulfillment date.");
      
      setEmailSignature(t.email_signature || "Thank you for your business,\n{{my_name}}\n{{company_name}}");
    } else {
      // Hard Fallbacks if the object doesn't exist yet
      setQuoteEmail("Hi {{client_name}},\n\nPlease find attached your project quote {{quote_number}} for {{quote_title}}.\n\nYou can review the line items, choose optional additions, and securely sign off on the package using the interactive link below.");
      setQuoteSms("Hi {{client_name}}, your project quote {{quote_number}} is ready for review! Click the link to view the details and approve online:");
      setInvoiceEmail(DEFAULT_INVOICE_EMAIL);
      setInvoiceSms("Hi {{client_name}}, your invoice {{invoice_number}} for ${{balance_due}} is ready. Tap the link below to view and pay securely.");
      setChangeOrderEmail("Hi {{client_name}},\n\nWe have submitted a scope modification request, Change Order {{co_number}}, for your project.\n\nPlease tap the link below to review the adjustment details and sign off on the variation.");
      setChangeOrderSms("Hi {{client_name}}, Change Order {{co_number}} has been requested for your project. Tap the link to authorize the adjustment:");
      setPoEmail("Hello {{vendor_name}},\n\nPlease find attached Purchase Order {{po_number}} from our team.\n\nPlease confirm receipt of this order and reply with an estimated delivery or fulfillment date.");
      setEmailSignature("Thank you for your business,\n{{my_name}}\n{{company_name}}");
    }
  }, [settings]);

  // --- SAVE MUTATION ---
  const saveTemplatesMutation = useMutation({
    mutationFn: async () => {
      const updatedTemplates = {
        quote_email_body: quoteEmail,
        quote_sms: quoteSms,
        invoice_email_body: invoiceEmail,
        invoice_sms: invoiceSms,
        co_email_body: changeOrderEmail,
        co_sms: changeOrderSms,
        po_email_body: poEmail,
        email_signature: emailSignature
      };

      const { error } = await supabase
        .from('companies')
        .update({ settings: { ...settings, templates: updatedTemplates } })
        .eq('id', company.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['company', company.id]);
      toast.success('Message Templates updated successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to save templates: ${error.message}`);
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      {/* Dynamic Placeholder Guide */}
      <Card className="p-4 bg-blue-50 border border-blue-200 text-blue-900 flex gap-3 items-start shadow-sm">
        <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-sm">Safe Token Insertion</p>
          <p className="font-medium text-blue-800">To prevent broken links or typos, use the <span className="font-mono bg-white px-1 py-0.5 rounded border border-blue-200">+ Insert</span> buttons attached to each text box.</p>
          <p className="text-blue-700">These buttons will perfectly inject dynamic variables (like the client's name or quote number) exactly where your cursor is placed.</p>
        </div>
      </Card>

      {/* --- QUOTES TEMPLATES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b pb-2">
          <FileText className="h-4 w-4 text-slate-500" /> Project Quote Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Body</Label>
            <TemplateEditor value={quoteEmail} onChange={setQuoteEmail} tokens={quoteTokens} rows={6} />
          </div>
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Text Message (SMS)</Label>
            <TemplateEditor value={quoteSms} onChange={setQuoteSms} tokens={quoteTokens} rows={6} />
          </div>
        </div>
      </Card>

      {/* --- INVOICES TEMPLATES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b pb-2">
          <Receipt className="h-4 w-4 text-slate-500" /> Invoice Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Body</Label>
            <TemplateEditor value={invoiceEmail} onChange={setInvoiceEmail} tokens={invoiceTokens} rows={6} />
          </div>
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Text Message (SMS)</Label>
            <TemplateEditor value={invoiceSms} onChange={setInvoiceSms} tokens={invoiceTokens} rows={6} />
          </div>
        </div>
      </Card>

      {/* --- CHANGE ORDERS TEMPLATES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b pb-2">
          <Zap className="h-4 w-4 text-slate-500" /> Change Order Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Body</Label>
            <TemplateEditor value={changeOrderEmail} onChange={setChangeOrderEmail} tokens={coTokens} rows={6} />
          </div>
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Text Message (SMS)</Label>
            <TemplateEditor value={changeOrderSms} onChange={setChangeOrderSms} tokens={coTokens} rows={6} />
          </div>
        </div>
      </Card>

      {/* --- PURCHASE ORDERS TEMPLATES --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b pb-2">
          <Building2 className="h-4 w-4 text-slate-500" /> Purchase Order Templates
        </h3>
        <div className="w-full">
          <div className="flex flex-col">
            <Label className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Body</Label>
            <TemplateEditor value={poEmail} onChange={setPoEmail} tokens={poTokens} rows={6} />
          </div>
        </div>
      </Card>

      {/* --- UNIVERSAL EMAIL SIGNATURE --- */}
      <Card className="p-6 border-slate-200 shadow-sm space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2 border-b pb-2">
          <Mail className="h-4 w-4 text-slate-500" /> Universal Email Signature
        </h3>
        <div className="flex flex-col">
          <Label className="text-xs font-bold text-slate-500 mb-1.5 block">Appended to the bottom of all outbound dispatch emails</Label>
          <TemplateEditor value={emailSignature} onChange={setEmailSignature} tokens={signatureTokens} rows={3} />
        </div>
      </Card>

      {/* MASTER STICKY SAVE BAR */}
      <div className="flex justify-end pt-2">
        <Button 
          onClick={() => saveTemplatesMutation.mutate()} 
          disabled={saveTemplatesMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md px-8 h-11"
        >
          {saveTemplatesMutation.isPending ? "Saving Templates..." : <><Save className="h-4 w-4 mr-2" /> Save All Templates</>}
        </Button>
      </div>

    </div>
  );
}
