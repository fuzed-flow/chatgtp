import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

async function functionErrorMessage(requestError, data, fallback) {
  if (data?.error) return data.error;
  try {
    const response = requestError?.context;
    if (response && typeof response.json === 'function') {
      const body = await response.json();
      if (typeof body?.error === 'string') return body.error;
    }
  } catch { /* Keep the transport error below. */ }
  return requestError?.message || fallback;
}

export default function QuickBooksExportDialog({ invoice, onClose }) {
  const [environment, setEnvironment] = useState('production');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [customerChoice, setCustomerChoice] = useState('new');
  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [paymentMethodIds, setPaymentMethodIds] = useState({});
  const [paymentsConfirmed, setPaymentsConfirmed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const eligible = invoice && ['Sent', 'Viewed', 'Overdue', 'Partial', 'Paid'].includes(invoice.status);

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    setCatalog(null);
    setLoading(true);
    setError('');
    setConfirmed(false);
    setPaymentsConfirmed(false);
    setItemId('');
    setTaxCodeId('');
    setDepositAccountId('');
    setPaymentMethodIds({});
    if (!eligible) {
      setLoading(false);
      return;
    }
    const load = async () => {
      const { data, error: requestError } = await supabase.functions.invoke('qbo-api', {
        body: { action: 'invoice_catalog', environment, invoiceId: invoice.id },
      });
      if (cancelled) return;
      if (requestError || data?.error) setError(await functionErrorMessage(requestError, data, 'QuickBooks catalog unavailable.'));
      else {
        setCatalog(data);
        setPaymentMethodIds(Object.fromEntries([...new Set((data.payments || []).map(p => p.method || 'Other'))]
          .map(method => [method, data.paymentMethods?.find(m => m.name.toLowerCase() === method.toLowerCase())?.id || ''])));
        if (data.linkedCustomerId) {
          setCustomerChoice('existing');
          setCustomerId(data.linkedCustomerId);
        } else {
          setCustomerChoice('new');
          setCustomerId('');
        }
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [invoice?.id, invoice?.status, invoice?.amount_paid, environment]);

  const selectedTax = catalog?.taxCodes?.find(code => code.id === taxCodeId);
  const rate = selectedTax?.rates?.reduce((sum, row) => sum + Number(row.rate || 0), 0);
  const taxMatches = Number.isFinite(rate) && Math.abs(Math.round(Number(invoice?.subtotal || 0) * rate) / 100 - Number(invoice?.tax || 0)) <= 0.02;
  const resumePayments = catalog?.export?.status === 'exported' && catalog?.export?.payment_sync_status === 'pending';
  const exportLocked = Boolean(catalog?.export) && !resumePayments;
  const paymentTypes = [...new Set((catalog?.payments || []).map(p => p.method || 'Other'))];
  const paymentReady = !catalog?.payments?.length || (depositAccountId && paymentsConfirmed && paymentTypes.every(method => paymentMethodIds[method]));
  const ready = eligible && !loading && !sending && !exportLocked && !error && catalog && paymentReady && confirmed &&
    (resumePayments || (itemId && taxCodeId && taxMatches && (customerChoice === 'new' || Boolean(customerId))));
  const exportInvoice = async () => {
    setSending(true);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('qbo-api', {
      body: { action: resumePayments ? 'sync_payments' : 'export_invoice', environment, invoiceId: invoice.id,
        customerChoice, customerId, itemId, taxCodeId, depositAccountId, paymentMethodIds,
        previewSignature: catalog.previewSignature },
    });
    setSending(false);
    if (requestError || data?.error || data?.reviewRequired) {
      const message = data?.reviewRequired
        ? `QuickBooks created invoice ${data.qbo_invoice_id}, but the total differs. Review it in QuickBooks before taking further action.`
        : await functionErrorMessage(requestError, data, 'QuickBooks export failed.');
      setError(message);
      toast.error(message);
      return;
    }
    toast.success(`QuickBooks invoice ${data.qbo_invoice_id}${data.payment_count ? ` and ${data.payment_count} payments` : ''} exported.`);
    onClose();
  };

  return <Dialog open={Boolean(invoice)} onOpenChange={open => { if (!open && !sending) onClose(); }}>
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" showAIHelp={false}>
      <DialogHeader>
        <DialogTitle>Export invoice {invoice?.invoice_number} to QuickBooks</DialogTitle>
        <DialogDescription>Choose the customer, product, tax code, and any payment mappings in the connected QuickBooks company. This creates accounting records but does not email the client.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div><label className="font-semibold">Environment</label>
          <Select value={environment} onValueChange={setEnvironment}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="production">QuickBooks Live</SelectItem><SelectItem value="sandbox">QuickBooks Sandbox</SelectItem>
          </SelectContent></Select>
        </div>
        {loading && <p>Loading QuickBooks customers, products, and tax codes…</p>}
        {!eligible && <p className="rounded bg-amber-50 p-3 text-amber-900">This invoice must be issued in FuzedFlow before it can be exported to QuickBooks.</p>}
        {catalog && <>
          <p className="rounded bg-slate-50 p-3">Client: {invoice?.client_name}. FuzedFlow invoice: ${Number(invoice?.subtotal || 0).toFixed(2)} before tax + ${Number(invoice?.tax || 0).toFixed(2)} tax = <strong>${Number(invoice?.total || 0).toFixed(2)}</strong>. QuickBooks currency: {catalog.currency}; country: {catalog.country || 'unknown'}.</p>
          {exportLocked ? <p className="rounded bg-amber-50 p-3 text-amber-900">Invoice export: {catalog.export.status}. Payment sync: {catalog.export.payment_sync_status || 'not applicable'}. {catalog.export.qbo_invoice_id ? `QuickBooks invoice ID: ${catalog.export.qbo_invoice_id}.` : 'Review QuickBooks before trying this invoice again.'} {catalog.export.error_message} {catalog.payments?.filter(p => p.export?.status === 'review_required').map(p => `Payment ${p.date} needs review: ${p.export.error_message}`).join(' ')}</p> : <>
            {resumePayments && <p className="rounded bg-amber-50 p-3 text-amber-900">Invoice {catalog.export.qbo_invoice_id} is already in QuickBooks. Continue only the remaining payments after checking QuickBooks for any payments already entered.</p>}
            {!resumePayments && <>
            <div><label className="font-semibold">Customer</label>
              {catalog.linkedCustomerId ? <p className="rounded bg-slate-50 p-2">Linked QuickBooks customer ID: {catalog.linkedCustomerId}</p> : <Select value={customerChoice === 'new' ? 'new' : customerId} onValueChange={value => { setCustomerChoice(value === 'new' ? 'new' : 'existing'); setCustomerId(value === 'new' ? '' : value); setConfirmed(false); }}>
                <SelectTrigger><SelectValue placeholder="Select or create a customer" /></SelectTrigger><SelectContent>
                  <SelectItem value="new">Create a new QuickBooks customer</SelectItem>
                  {catalog.customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</SelectItem>)}
                </SelectContent></Select>}
              {customerChoice === 'new' && <p className="text-slate-600 mt-1">Creating a customer with the same name as an existing QuickBooks customer is blocked.</p>}
            </div>
            <div><label className="font-semibold">QuickBooks product or service</label><Select value={itemId} onValueChange={value => { setItemId(value); setConfirmed(false); }}>
              <SelectTrigger><SelectValue placeholder="Choose where invoice lines are recorded" /></SelectTrigger><SelectContent>
                {catalog.items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent></Select></div>
            <div><label className="font-semibold">QuickBooks sales tax code</label><Select value={taxCodeId} onValueChange={value => { setTaxCodeId(value); setConfirmed(false); }}>
              <SelectTrigger><SelectValue placeholder="Choose the matching tax code" /></SelectTrigger><SelectContent>
                {catalog.taxCodes.map(c => <SelectItem key={c.id} value={c.id}>{c.name} {c.rates?.length ? `(${c.rates.reduce((sum, row) => sum + Number(row.rate || 0), 0)}%)` : ''}</SelectItem>)}
              </SelectContent></Select></div>
            {taxCodeId && <p className={taxMatches ? 'text-emerald-700' : 'text-red-700'}>{taxMatches ? 'Tax rate matches this invoice.' : 'Tax rate does not match this invoice. Choose a matching code.'}</p>}
            </>}
            {catalog.payments?.length > 0 && <div className="rounded border border-slate-200 p-3 space-y-3">
              <p className="font-semibold">Recorded payments to apply in QuickBooks</p>
              {catalog.payments.map(p => <p key={p.id}>{p.date} · {p.method || 'Other'} · ${Number(p.amount).toFixed(2)} {p.export?.status === 'exported' ? '✓ Already exported' : ''}</p>)}
              <div><label className="font-semibold">QuickBooks deposit account</label>
                <Select value={depositAccountId} onValueChange={value => { setDepositAccountId(value); setConfirmed(false); }}>
                  <SelectTrigger><SelectValue placeholder="Choose the account for these payments" /></SelectTrigger><SelectContent>
                    {catalog.depositAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                  </SelectContent></Select></div>
              {paymentTypes.map(method => <div key={method}><label className="font-semibold">QuickBooks method for “{method}”</label>
                <Select value={paymentMethodIds[method] || ''} onValueChange={value => { setPaymentMethodIds(previous => ({ ...previous, [method]: value })); setConfirmed(false); }}>
                  <SelectTrigger><SelectValue placeholder="Choose a payment method" /></SelectTrigger><SelectContent>
                    {catalog.paymentMethods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent></Select></div>)}
              <label className="flex items-start gap-2"><input type="checkbox" checked={paymentsConfirmed} onChange={e => setPaymentsConfirmed(e.target.checked)} className="mt-1" />
                <span>I checked QuickBooks for these payments. I understand this will add {catalog.payments.filter(p => p.export?.status !== 'exported').length} payment record(s) and apply them to this invoice.</span></label>
            </div>}
            <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
              <span>I reviewed the invoice, currency, tax, and payment mappings. I understand this creates accounting records in QuickBooks {environment === 'production' ? 'Live' : 'Sandbox'}.</span></label>
          </>}
        </>}
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={sending}>Close</Button>
        <Button onClick={exportInvoice} disabled={!ready} className="bg-amber-500 text-slate-900 hover:bg-amber-400">{sending ? 'Exporting…' : resumePayments ? 'Sync remaining payments' : catalog?.payments?.length ? 'Export invoice and payments' : 'Export invoice'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
