import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { accountingBase, adminDb, clientCredentials, companyAdmin, corsHeaders, respond } from '../_shared/qboSandbox.ts';
import type { QboEnvironment } from '../_shared/qboSandbox.ts';

const money = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;
const validId = (value: unknown) => typeof value === 'string' && /^[0-9]+$/.test(value);
const safeName = (value: unknown) => String(value || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const duplicateNameError = (message: unknown) => typeof message === 'string' &&
  /Duplicate Name Exists Error/i.test(message);
const invoiceSignature = async (invoice: Record<string, unknown>, payments: { id: string; amount: unknown; payment_date?: string; payment_method?: string }[]) => {
  const snapshot = [invoice.id, invoice.client_id, invoice.invoice_number, invoice.issue_date, invoice.due_date,
    invoice.status, money(invoice.subtotal), money(invoice.tax), money(invoice.total),
    money(invoice.amount_paid), money(invoice.balance_due), payments.map(p =>
      [p.id, money(p.amount), p.payment_date, p.payment_method || 'Other'])];
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const { companyId, userId } = await companyAdmin(req);
    const input = await req.json();
    const { action, environment: requestedEnvironment } = input;
    const environment: QboEnvironment = requestedEnvironment || 'sandbox';
    if (environment !== 'sandbox' && environment !== 'production') return respond({ error: 'Invalid QuickBooks environment.' }, 400);
    if (action === 'export_invoice' || action === 'sync_payments') {
      return respond({ error: 'QuickBooks invoice and payment exports are coming soon.' }, 403);
    }
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
    const readPayments = async (invoiceId: string) => {
      const { data, error: paymentError } = await db.from('payments')
        .select('id,amount,payment_date,payment_method,notes')
        .eq('company_id', companyId).eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: true }).order('id', { ascending: true });
      if (paymentError) throw new Error('Invoice payments are unavailable.');
      return data || [];
    };
    const checkPayments = (invoice: Record<string, unknown>, payments: { amount: unknown; payment_date?: string }[]) => {
      const totalPaid = money(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
      if (money(invoice.amount_paid) !== totalPaid || Math.abs(money(invoice.total) - totalPaid - money(invoice.balance_due)) > 0.02 ||
        totalPaid > money(invoice.total) || payments.some(p => money(p.amount) <= 0 || !p.payment_date)) {
        throw new Error('FuzedFlow payment totals or dates are inconsistent. Review the invoice before exporting.');
      }
      return totalPaid;
    };
    const paymentSettings = async (payments: { payment_method?: string }[]) => {
      if (!payments.length) return null;
      if (!validId(input.depositAccountId) || !input.paymentMethodIds || typeof input.paymentMethodIds !== 'object') {
        throw new Error('Choose a QuickBooks deposit account and payment method for every payment.');
      }
      const methods = [...new Set(payments.map(p => p.payment_method || 'Other'))];
      const ids = methods.map(method => input.paymentMethodIds[method]);
      if (ids.some(id => !validId(id))) throw new Error('Choose a QuickBooks payment method for every recorded method.');
      const [account, availableMethods] = await Promise.all([
        query(`SELECT * FROM Account WHERE Id = '${input.depositAccountId}'`),
        query('SELECT * FROM PaymentMethod WHERE Active = true MAXRESULTS 1000'),
      ]);
      if (!account.Account?.[0]?.Active || !['Bank','Other Current Asset'].includes(account.Account[0].AccountType) ||
        ids.some(id => !(availableMethods.PaymentMethod || []).some((m: { Id: string; Active: boolean }) => m.Id === id && m.Active))) {
        throw new Error('Selected QuickBooks deposit account or payment method is inactive or unavailable.');
      }
      return { depositAccountId: input.depositAccountId as string, methodIds: input.paymentMethodIds as Record<string, string> };
    };
    const checkExistingPayments = async (customerId: string, payments: { amount: number; payment_date: string }[]) => {
      for (const payment of payments) {
        const existing = await query(`SELECT * FROM Payment WHERE CustomerRef = '${customerId}' AND TxnDate = '${payment.payment_date}' MAXRESULTS 1000`);
        if ((existing.Payment || []).some((candidate: { TotalAmt: number }) => Math.abs(money(candidate.TotalAmt) - money(payment.amount)) <= 0.01)) {
          throw new Error(`A QuickBooks payment on ${payment.payment_date} matches ${money(payment.amount)}. Review it before exporting payments.`);
        }
      }
    };
    const syncPayments = async (
      invoice: { id: string; total: number; balance_due: number }, payments: { id: string; amount: number; payment_date: string; payment_method?: string; notes?: string }[],
      qboInvoiceId: string, customerId: string, settings: { depositAccountId: string; methodIds: Record<string, string> },
    ) => {
      const { data: previous, error: previousError } = await db.from('qbo_payment_exports')
        .select('payment_id,status,qbo_payment_id').eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id);
      if (previousError) throw new Error('QuickBooks payment export status unavailable.');
      if (previous?.some((row: { status: string }) => row.status === 'processing' || row.status === 'review_required')) {
        throw new Error('A QuickBooks payment needs manual review. No further payments were posted.');
      }
      const remoteInvoice = (await api(`invoice/${encodeURIComponent(qboInvoiceId)}`)).Invoice;
      const alreadyExported = payments.filter(p => previous?.some((row: { payment_id: string; status: string }) =>
        row.payment_id === p.id && row.status === 'exported'));
      const expectedBalance = money(Number(invoice.total) - alreadyExported.reduce((sum, p) => sum + Number(p.amount), 0));
      if (remoteInvoice?.CustomerRef?.value !== customerId || Math.abs(money(remoteInvoice?.TotalAmt) - money(invoice.total)) > 0.02 ||
        Math.abs(money(remoteInvoice?.Balance) - expectedBalance) > 0.02) {
        throw new Error('QuickBooks invoice balance or customer changed. Review its payments before continuing.');
      }
      await checkExistingPayments(customerId, payments.filter(p => !alreadyExported.some(exported => exported.id === p.id)));
      for (const payment of payments) {
        if (previous?.some((row: { payment_id: string; status: string }) => row.payment_id === payment.id && row.status === 'exported')) continue;
        const requestId = crypto.randomUUID();
        const claim = await db.rpc('qbo_claim_payment_export', { p_company: companyId, p_environment: environment,
          p_invoice: invoice.id, p_payment: payment.id, p_realm: saved.realm_id,
          p_remote_invoice: qboInvoiceId, p_request: requestId });
        if (claim.error || !claim.data?.[0]?.claimed) throw new Error('Payment already being exported or needs review in QuickBooks.');
        try {
          const amount = money(payment.amount);
          const body = await api(`payment?requestid=${encodeURIComponent(requestId)}`, {
            CustomerRef: { value: customerId }, TotalAmt: amount, TxnDate: payment.payment_date,
            PaymentMethodRef: { value: settings.methodIds[payment.payment_method || 'Other'] },
            DepositToAccountRef: { value: settings.depositAccountId }, ProcessPayment: false,
            PrivateNote: `FuzedFlow payment ${payment.id}${payment.notes ? ` — ${payment.notes}` : ''}`.slice(0, 4000),
            Line: [{ Amount: amount, LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }] }],
          });
          const remote = body.Payment;
          const applied = remote?.Line?.some((line: { LinkedTxn?: { TxnId: string; TxnType: string }[] }) =>
            line.LinkedTxn?.some(link => link.TxnId === qboInvoiceId && link.TxnType === 'Invoice'));
          if (!remote?.Id || Math.abs(money(remote.TotalAmt) - amount) > 0.01 ||
            Math.abs(money(remote.UnappliedAmt)) > 0.01 || !applied) {
            throw new Error('QuickBooks returned a payment that does not reconcile to the invoice. Review it there.');
          }
          const recorded = await db.from('qbo_payment_exports').update({ status: 'exported', qbo_payment_id: remote.Id,
            completed_at: new Date().toISOString() }).eq('company_id', companyId).eq('environment', environment)
            .eq('payment_id', payment.id).eq('request_id', requestId).select('status').single();
          if (recorded.error || !recorded.data) throw new Error('QuickBooks payment posted but its local link could not be saved. Contact support.');
        } catch (paymentError) {
          await db.from('qbo_payment_exports').update({ status: 'review_required',
            error_message: paymentError instanceof Error ? paymentError.message.slice(0, 240) : 'Payment needs review.' })
            .eq('company_id', companyId).eq('environment', environment).eq('payment_id', payment.id).eq('request_id', requestId).eq('status', 'processing');
          await db.from('qbo_invoice_exports').update({ payment_sync_status: 'review_required' })
            .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id);
          throw paymentError;
        }
      }
      const result = await db.from('qbo_invoice_exports').update({ payment_sync_status: 'complete' })
        .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).select('payment_sync_status').single();
      if (result.error || !result.data) throw new Error('Payments were posted, but reconciliation status could not be saved. Contact support.');
      return respond({ success: true, qbo_invoice_id: qboInvoiceId, payment_count: payments.length,
        total_paid: money(payments.reduce((sum, p) => sum + Number(p.amount), 0)), balance_due: money(invoice.balance_due) });
    };
    if (action === 'get_company_info') {
      const body = await api(`companyinfo/${realm}`);
      return respond({ success: true, company_name: body.CompanyInfo?.CompanyName || null, realm_id: saved.realm_id });
    }
    if (action === 'invoice_catalog') {
      const invoice = await requireInvoice();
      const [customers, items, taxCodes, taxRates, companyInfo, preferences, link, exportRow, payments] = await Promise.all([
        query('SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM Item WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM TaxRate WHERE Active = true MAXRESULTS 1000'),
        api(`companyinfo/${realm}`), api('preferences'),
        db.from('qbo_customer_links').select('qbo_customer_id,realm_id').eq('company_id', companyId).eq('environment', environment).eq('client_id', invoice.client_id).maybeSingle(),
        db.from('qbo_invoice_exports').select('status,qbo_invoice_id,qbo_customer_id,realm_id,error_message,payment_sync_status').eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).maybeSingle(),
        readPayments(invoice.id),
      ]);
      if (link.error || exportRow.error) throw new Error('QuickBooks mappings unavailable.');
      checkPayments(invoice, payments);
      const needsPayments = payments.length > 0;
      const [methods, accounts, exportedPayments] = needsPayments ? await Promise.all([
        query('SELECT * FROM PaymentMethod WHERE Active = true MAXRESULTS 1000'),
        query('SELECT * FROM Account WHERE Active = true MAXRESULTS 1000'),
        db.from('qbo_payment_exports').select('payment_id,status,qbo_payment_id,error_message')
          .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id),
      ]) : [{}, {}, { data: [], error: null }];
      if (exportedPayments.error) throw new Error('QuickBooks payment mappings unavailable.');
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
        previewSignature: await invoiceSignature(invoice, payments),
        export: exportRow.data,
        retryableNameConflict: exportRow.data?.status === 'review_required' &&
          !exportRow.data.qbo_invoice_id && !exportRow.data.qbo_customer_id &&
          exportRow.data.realm_id === saved.realm_id && exportRow.data.payment_sync_status === 'not_applicable' &&
          duplicateNameError(exportRow.data.error_message) &&
          !(exportedPayments.data || []).length,
        payments: payments.map(p => ({ id: p.id, amount: p.amount, date: p.payment_date, method: p.payment_method || 'Other',
          export: (exportedPayments.data || []).find(x => x.payment_id === p.id) || null })),
        paymentMethods: (methods.PaymentMethod || []).map((m: { Id: string; Name: string }) => ({ id: m.Id, name: m.Name })),
        depositAccounts: (accounts.Account || []).filter((a: { AccountType?: string }) => ['Bank','Other Current Asset'].includes(a.AccountType || ''))
          .map((a: { Id: string; Name: string; AccountType: string }) => ({ id: a.Id, name: a.Name, type: a.AccountType })),
      });
    }
    if (!['export_invoice','sync_payments'].includes(action)) return respond({ error: 'Unknown QuickBooks action.' }, 400);
    const invoice = await requireInvoice();
    if (invoice.status === 'Draft' || !['Sent','Viewed','Overdue','Partial','Paid'].includes(invoice.status)) {
      throw new Error('Send the invoice first. Only issued invoices can be exported.');
    }
    const payments = await readPayments(invoice.id);
    const totalPaid = checkPayments(invoice, payments);
    if (input.previewSignature !== await invoiceSignature(invoice, payments)) {
      throw new Error('Invoice or payments changed since the QuickBooks review. Close and reopen export to review current amounts.');
    }
    if (!invoice.client_id || !invoice.invoice_number || !invoice.issue_date || !invoice.due_date || !money(invoice.total)) {
      throw new Error('Invoice must have a client, number, dates, and a positive total.');
    }
    if (invoice.invoice_number.length > 21) throw new Error('Invoice number exceeds QuickBooks 21-character limit.');
    if (action === 'sync_payments') {
      if (!payments.length || !totalPaid) throw new Error('There are no recorded payments to sync.');
      const { data: exported, error: exportError } = await db.from('qbo_invoice_exports')
        .select('status,qbo_invoice_id,qbo_customer_id,realm_id,payment_sync_status')
        .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).single();
      if (exportError || exported?.status !== 'exported' || exported.realm_id !== saved.realm_id ||
        !validId(exported.qbo_invoice_id) || !validId(exported.qbo_customer_id) || exported.payment_sync_status !== 'pending') {
        throw new Error('Invoice payments cannot be synced automatically. Review its QuickBooks export status.');
      }
      const settings = await paymentSettings(payments);
      return await syncPayments(invoice, payments, exported.qbo_invoice_id, exported.qbo_customer_id, settings!);
    }
    const settings = await paymentSettings(payments);
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
    const customerName = safeName(input.customerDisplayName || client.name);
    if (input.customerChoice === 'new' && (!customerName || customerName.includes(':'))) {
      throw new Error('Enter a QuickBooks customer display name without a colon.');
    }
    if (!customerId && input.customerChoice === 'existing') {
      if (!validId(input.customerId)) throw new Error('Select a QuickBooks customer.');
      const found = await query(`SELECT * FROM Customer WHERE Id = '${input.customerId}'`);
      if (!found.Customer?.[0]?.Active) throw new Error('QuickBooks customer is inactive or missing.');
      customerId = input.customerId;
    }
    if (customerId && payments.length) await checkExistingPayments(customerId, payments);
    const requestId = crypto.randomUUID();
    const claim = await db.rpc('qbo_claim_invoice_export', { p_company: companyId, p_environment: environment,
      p_invoice: invoice.id, p_realm: saved.realm_id, p_request: requestId });
    if (claim.error) throw new Error('Could not reserve invoice export.');
    if (!claim.data?.[0]?.claimed) {
      const { data: previous, error: previousError } = await db.from('qbo_invoice_exports')
        .select('request_id,status,realm_id,qbo_invoice_id,qbo_customer_id,error_message,payment_sync_status')
        .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).single();
      if (previousError || previous?.status !== 'review_required' || previous.realm_id !== saved.realm_id ||
        previous.qbo_invoice_id || previous.qbo_customer_id || previous.payment_sync_status !== 'not_applicable' ||
        !duplicateNameError(previous.error_message)) {
        throw new Error(`Invoice already ${claim.data?.[0]?.export_status || 'being exported'} in QuickBooks. Review its export status before retrying.`);
      }
      if (input.customerChoice === 'new' && customerName.toLowerCase() === safeName(client.name).toLowerCase()) {
        throw new Error('QuickBooks already uses this name. Choose an existing customer or enter a distinct QuickBooks display name.');
      }
      const { data: mappedPayments, error: mappingError } = await db.from('qbo_payment_exports')
        .select('payment_id').eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).limit(1);
      if (mappingError || mappedPayments?.length) throw new Error('An accounting payment may exist. Review QuickBooks before retrying.');
      // The remote invoice-number check above ran before this compare-and-swap. Only the
      // exact pre-invoice name conflict can release its own reservation.
      const released = await db.from('qbo_invoice_exports').update({ status: 'processing', request_id: requestId,
        error_message: null, created_at: new Date().toISOString() })
        .eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id)
        .eq('realm_id', saved.realm_id).eq('request_id', previous.request_id)
        .eq('status', 'review_required').eq('error_message', previous.error_message)
        .is('qbo_invoice_id', null).is('qbo_customer_id', null)
        .select('request_id').single();
      if (released.error || released.data?.request_id !== requestId) {
        throw new Error('The invoice export state changed. Reopen this dialog before trying again.');
      }
    }
    try {
      if (!customerId) {
        const names = await query(`SELECT * FROM Customer WHERE DisplayName = '${esc(customerName)}'`);
        if (names.Customer?.length) throw new Error('A QuickBooks customer already has this name. Select that customer explicitly.');
        const created = await api(`customer?requestid=${encodeURIComponent(requestId)}-customer`, {
          DisplayName: customerName, ...(client.email ? { PrimaryEmailAddr: { Address: client.email } } : {}),
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
        payment_sync_status: exact && payments.length ? 'pending' : 'not_applicable',
        completed_at: new Date().toISOString() }).eq('company_id', companyId).eq('environment', environment).eq('invoice_id', invoice.id).eq('request_id', requestId).select('status').single();
      if (savedExport.error || !savedExport.data) throw new Error('QuickBooks invoice was created but export status could not be saved. Contact support.');
      if (exact && payments.length) return await syncPayments(invoice, payments, qboInvoice.Id, customerId, settings!);
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
