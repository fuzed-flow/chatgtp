import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { accountingBase, adminDb, clientCredentials, companyAdmin, corsHeaders, respond } from '../_shared/qboSandbox.ts';
import type { QboEnvironment } from '../_shared/qboSandbox.ts';

const money = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;
const validId = (value: unknown) => typeof value === 'string' && /^[0-9]+$/.test(value);
const safeName = (value: unknown) => String(value || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const { companyId, userId } = await companyAdmin(req);
    const input = await req.json();
    const { action, environment: requestedEnvironment } = input;
    const environment: QboEnvironment = requestedEnvironment || 'sandbox';
    if (environment !== 'sandbox' && environment !== 'production') return respond({ error: 'Invalid QuickBooks environment.' }, 400);
    const db = adminDb();
    if (action === 'status') {
      const table = environment === 'production' ? 'qbo_production_connections' : 'qbo_connections';
      const { data, error } = await db.from(table).select('company_id').eq('company_id', companyId).maybeSingle();
      if (error) throw new Error('QuickBooks connection status is unavailable.');
      return respond({ connected: Boolean(data), environment });
    }
    const { data: credentials, error } = await db.rpc(environment === 'production' ? 'qbo_read_production_tokens' : 'qbo_read_tokens', { p_company: companyId });
    const saved = credentials?.[0];
    if (error || !saved?.access_token || !saved?.refresh_token || !saved?.realm_id) {
      return respond({ error: `QuickBooks ${environment} is not connected for this company.` }, 400);
    }
    let accessToken = saved.access_token;
    if (new Date(saved.access_expires_at).getTime() < Date.now() + 60_000) {
      const { id, secret } = clientCredentials(environment);
      const refresh = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token }),
      });
      const token = await refresh.json();
      if (!refresh.ok || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string'
        || !Number.isFinite(Number(token.expires_in))) throw new Error(`QuickBooks ${environment} needs to be reconnected.`);
      const stored = await db.rpc(environment === 'production' ? 'qbo_store_production_tokens' : 'qbo_store_tokens', { p_company: companyId, p_realm: saved.realm_id,
        p_actor: userId, p_access: token.access_token, p_refresh: token.refresh_token,
        p_expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() });
      if (stored.error) throw new Error('QuickBooks token refresh could not be saved.');
      accessToken = token.access_token;
    }
    const realm = encodeURIComponent(saved.realm_id);
    const base = `${accountingBase(environment)}/${realm}`;
    const api = async (path: string, payload?: object) => {
      const response = await fetch(`${base}/${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body?.Fault?.Error?.[0]?.Message;
        throw new Error(`QuickBooks rejected the request${detail ? `: ${String(detail).slice(0, 180)}` : '.'}`);
      }
      return body;
    };
    const query = async (statement: string) => (await api(`query?query=${encodeURIComponent(statement)}&minorversion=75`)).QueryResponse || {};
    const requireInvoice = async () => {
      if (typeof input.invoiceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.invoiceId)) throw new Error('Choose an invoice.');
      const { data, error: invoiceError } = await db.from('invoices').select('*').eq('company_id', companyId).eq('id', input.invoiceId).single();
      if (invoiceError || !data) throw new Error('Invoice not found in this company.');
      return data;
    };
    const requireClient = async (clientId: string) => {
      const { data, error: clientError } = await db.from('clients').select('id,name,email,phone,billing_address').eq('company_id', companyId).eq('id', clientId).single();
      if (clientError || !data) throw new Error('Client not found in this company.');
      return data;
    };
    if (action === 'get_company_info') {
      const body = await api(`companyinfo/${realm}`);
      return respond({ success: true, company_name: body.CompanyInfo?.CompanyName || null, realm_id: saved.realm_id });
    }
    if (action === 'invoice_catalog') {
      const invoice = await requireInvoice();
      const [customers, items, taxCodes, taxRates, companyInfo, preferences, link, exportRow] = await Promise.all([
        query('SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM Item WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM TaxRate WHERE Active = true MAXRESULTS 1000'),
        api(`companyinfo/${realm}`), api('preferences'),
        db.from('qbo_customer_links').select('qbo_customer_id,realm_id').eq('company_id', companyId).eq('environment', environment).eq('client_id', invoice.client_id).maybeSingle(),
        db.from('qbo_invoice_exports').select('status,qbo_invoice_id,error_message').eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).maybeSingle(),
      ]);
      if (link.error || exportRow.error) throw new Error('QuickBooks mappings unavailable.');
      const homeCurrency = preferences.Preferences?.CurrencyPrefs?.HomeCurrency?.value || 'USD';
      return respond({
        country: companyInfo.CompanyInfo?.Country || null, currency: homeCurrency,
        customers: (customers.Customer || []).map((c: Record<string, unknown>) => ({ id: c.Id, name: c.DisplayName, email: (c.PrimaryEmailAddr as { Address?: string })?.Address })),
        items: (items.Item || []).filter((i: Record<string, unknown>) => ['Service', 'NonInventory'].includes(String(i.Type)))
          .map((i: Record<string, unknown>) => ({ id: i.Id, name: i.Name })),
        taxCodes: (taxCodes.TaxCode || []).map((c: Record<string, unknown>) => ({ id: c.Id, name: c.Name, taxable: c.Taxable,
          rates: ((c.SalesTaxRateList as { TaxRateDetail?: { TaxRateRef?: { value?: string } }[] })?.TaxRateDetail || [])
            .map(d => ({ id: d.TaxRateRef?.value, rate: (taxRates.TaxRate || []).find((r: { Id: string }) => r.Id === d.TaxRateRef?.value)?.RateValue })) })),
        linkedCustomerId: link.data?.realm_id === saved.realm_id ? link.data.qbo_customer_id : null,
        export: exportRow.data,
      });
    }
    if (action !== 'export_invoice') return respond({ error: 'Unknown QuickBooks action.' }, 400);
    const invoice = await requireInvoice();
    if (invoice.status === 'Draft' || money(invoice.amount_paid) !== 0 || ['Paid', 'Partial'].includes(invoice.status)) {
      throw new Error('Send the invoice first. Paid, partially paid, and draft invoices cannot be exported.');
    }
    if (!invoice.client_id || !invoice.invoice_number || !invoice.issue_date || !invoice.due_date || !money(invoice.total)) {
      throw new Error('Invoice must have a client, number, dates, and a positive total.');
    }
    if (invoice.invoice_number.length > 21) throw new Error('Invoice number exceeds QuickBooks 21-character limit.');
    if (!validId(input.itemId) || !validId(input.taxCodeId) || !['new', 'existing'].includes(input.customerChoice)) {
      throw new Error('Choose a QuickBooks product, tax code, and customer.');
    }
    const [client, linesResult, companyResult, linkedResult, prefs, companyInfo, item, taxCode, taxRates] = await Promise.all([
      requireClient(invoice.client_id),
      db.from('invoice_line_items').select('name,description,quantity,unit_price,line_total,taxable').eq('company_id', companyId).eq('invoice_id', invoice.id),
      db.from('companies').select('settings').eq('id', companyId).single(),
      db.from('qbo_customer_links').select('qbo_customer_id,realm_id').eq('company_id', companyId).eq('environment', environment).eq('client_id', invoice.client_id).maybeSingle(),
      api('preferences'), api(`companyinfo/${realm}`),
      query(`SELECT * FROM Item WHERE Id = '${input.itemId}'`),
      query(`SELECT * FROM TaxCode WHERE Id = '${input.taxCodeId}'`),
      query('SELECT * FROM TaxRate WHERE Active = true MAXRESULTS 1000'),
    ]);
    if (linesResult.error || companyResult.error || linkedResult.error) throw new Error('Invoice details unavailable.');
    const companyCurrency = companyResult.data?.settings?.currency || 'CAD';
    const qboCurrency = prefs.Preferences?.CurrencyPrefs?.HomeCurrency?.value || 'USD';
    if (prefs.Preferences?.CurrencyPrefs?.MultiCurrencyEnabled) {
      throw new Error('Multicurrency QuickBooks companies need per-customer currency mapping before export.');
    }
    if (companyCurrency !== qboCurrency) throw new Error(`Currency mismatch: FuzedFlow ${companyCurrency}, QuickBooks ${qboCurrency}.`);
    if (companyInfo.CompanyInfo?.Country === 'US') throw new Error('US automated sales tax needs a separate mapping before export.');
    const selectedItem = item.Item?.[0];
    const selectedCode = taxCode.TaxCode?.[0];
    if (!selectedItem?.Active || !['Service', 'NonInventory'].includes(selectedItem.Type) || !selectedCode?.Active) {
      throw new Error('Selected QuickBooks item or tax code is inactive.');
    }
    const sourceLines = linesResult.data || [];
    if (!sourceLines.length || sourceLines.some(l => l.taxable === false || money(l.line_total) <= 0)) {
      throw new Error('Only invoices with positive, fully taxable line items are supported.');
    }
    const rawSubtotal = money(sourceLines.reduce((sum, l) => sum + Number(l.line_total || 0), 0));
    if (rawSubtotal <= 0 || money(invoice.subtotal) <= 0 || money(invoice.subtotal) > rawSubtotal ||
      Math.abs(money(invoice.subtotal) + money(invoice.tax) - money(invoice.total)) > 0.01) {
      throw new Error('Invoice amounts are inconsistent. Review the FuzedFlow invoice before export.');
    }
    const rateDetails = selectedCode.SalesTaxRateList?.TaxRateDetail || [];
    const rate = rateDetails.reduce((sum: number, detail: { TaxRateRef?: { value?: string } }) => {
      const matched = (taxRates.TaxRate || []).find((r: { Id: string }) => r.Id === detail.TaxRateRef?.value);
      return sum + Number(matched?.RateValue ?? NaN);
    }, 0);
    if (!rateDetails.length || !Number.isFinite(rate) || Math.abs(money(money(invoice.subtotal) * rate / 100) - money(invoice.tax)) > 0.02) {
      throw new Error('Selected QuickBooks tax rate does not match the FuzedFlow invoice tax.');
    }
    const existing = await query(`SELECT * FROM Invoice WHERE DocNumber = '${esc(invoice.invoice_number)}' MAXRESULTS 10`);
    if ((existing.Invoice || []).length) throw new Error('QuickBooks already has this invoice number. Link or resolve it in QuickBooks before exporting.');
    let customerId = linkedResult.data?.realm_id === saved.realm_id ? linkedResult.data.qbo_customer_id : null;
    if (customerId && input.customerChoice === 'existing' && customerId !== input.customerId) {
      throw new Error('This client is already linked to a different QuickBooks customer.');
    }
    if (customerId && input.customerChoice === 'new') throw new Error('This client is already linked to QuickBooks.');
    if (!customerId && input.customerChoice === 'existing') {
      if (!validId(input.customerId)) throw new Error('Select a QuickBooks customer.');
      const found = await query(`SELECT * FROM Customer WHERE Id = '${input.customerId}'`);
      if (!found.Customer?.[0]?.Active) throw new Error('QuickBooks customer is inactive or missing.');
      customerId = input.customerId;
    }
    const requestId = crypto.randomUUID();
    const claim = await db.rpc('qbo_claim_invoice_export', { p_company: companyId, p_environment: environment,
      p_invoice: invoice.id, p_realm: saved.realm_id, p_request: requestId });
    if (claim.error) throw new Error('Could not reserve invoice export.');
    if (!claim.data?.[0]?.claimed) throw new Error(`Invoice already ${claim.data?.[0]?.export_status || 'being exported'} in QuickBooks. Review its export status before retrying.`);
    try {
      if (!customerId) {
        const name = safeName(client.name);
        if (!name) throw new Error('Client name is required.');
        const names = await query(`SELECT * FROM Customer WHERE DisplayName = '${esc(name)}'`);
        if (names.Customer?.length) throw new Error('A QuickBooks customer already has this name. Select that customer explicitly.');
        const created = await api(`customer?requestid=${encodeURIComponent(requestId)}-customer`, {
          DisplayName: name, ...(client.email ? { PrimaryEmailAddr: { Address: client.email } } : {}),
          ...(client.phone ? { PrimaryPhone: { FreeFormNumber: client.phone } } : {}),
        });
        customerId = created.Customer?.Id;
        if (!customerId) throw new Error('QuickBooks did not return a customer ID.');
      }
      const linked = await db.from('qbo_customer_links').upsert({ company_id: companyId, environment, client_id: client.id,
        realm_id: saved.realm_id, qbo_customer_id: customerId }, { onConflict: 'company_id,environment,client_id', ignoreDuplicates: true });
      if (linked.error) throw new Error('Customer was created or selected, but the local link could not be saved. Contact support before retrying.');
      const verified = await db.from('qbo_customer_links').select('realm_id,qbo_customer_id')
        .eq('company_id', companyId).eq('environment', environment).eq('client_id', client.id).single();
      if (verified.error || verified.data?.realm_id !== saved.realm_id || verified.data?.qbo_customer_id !== customerId) {
        throw new Error('Client link changed during export. Review the QuickBooks customer before trying again.');
      }
      const factor = money(invoice.subtotal) / rawSubtotal;
      let allocated = 0;
      const quickBooksLines = sourceLines.map((line, index) => {
        const amount = index === sourceLines.length - 1 ? money(money(invoice.subtotal) - allocated) : money(money(line.line_total) * factor);
        allocated = money(allocated + amount);
        if (amount <= 0) throw new Error('Discount leaves a non-positive line item. Review the invoice.');
        return { Amount: amount, DetailType: 'SalesItemLineDetail', Description: [line.name, line.description].filter(Boolean).join(' — ').slice(0, 4000),
          SalesItemLineDetail: { ItemRef: { value: input.itemId }, Qty: 1, UnitPrice: amount, TaxCodeRef: { value: input.taxCodeId } } };
      });
      const created = await api(`invoice?requestid=${encodeURIComponent(requestId)}`, {
        CustomerRef: { value: customerId }, DocNumber: invoice.invoice_number, TxnDate: invoice.issue_date,
        DueDate: invoice.due_date, GlobalTaxCalculation: 'TaxExcluded', Line: quickBooksLines,
        CustomerMemo: { value: `Created from FuzedFlow invoice ${invoice.invoice_number}` },
      });
      const qboInvoice = created.Invoice;
      if (!qboInvoice?.Id) throw new Error('QuickBooks did not return an invoice ID.');
      const exact = Math.abs(money(qboInvoice.TotalAmt) - money(invoice.total)) <= 0.02
        && qboInvoice.DocNumber === invoice.invoice_number;
      const savedExport = await db.from('qbo_invoice_exports').update({ qbo_invoice_id: qboInvoice.Id, qbo_customer_id: customerId,
        status: exact ? 'exported' : 'review_required', error_message: exact ? null : `QuickBooks returned number ${qboInvoice.DocNumber || 'unknown'} and total ${qboInvoice.TotalAmt}; expected ${invoice.invoice_number} and ${invoice.total}.`,
        completed_at: new Date().toISOString() }).eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).eq('request_id', requestId).select('status').single();
      if (savedExport.error || !savedExport.data) throw new Error('QuickBooks invoice was created but export status could not be saved. Contact support.');
      return respond({ success: exact, reviewRequired: !exact, qbo_invoice_id: qboInvoice.Id, qbo_total: qboInvoice.TotalAmt,
        fuzedflow_total: invoice.total });
    } catch (writeError) {
      await db.from('qbo_invoice_exports').update({ status: 'review_required', error_message: writeError instanceof Error ? writeError.message.slice(0, 240) : 'Export needs review.' })
        .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).eq('request_id', requestId).eq('status', 'processing');
      throw writeError;
    }
  } catch (error) {
    console.error('QuickBooks request failed', error instanceof Error ? error.message : 'Unknown error');
    return respond({ error: error instanceof Error ? error.message : 'QuickBooks request failed.' }, 400);
  }
});
