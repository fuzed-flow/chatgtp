const zeroDecimal = new Set(['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf']);
export const currencyFactor = (currency) => zeroDecimal.has(currency.toLowerCase()) ? 1 : 100;

export function checkoutAmount(document, kind, requested) {
  const total = Number(document.total);
  if (!Number.isFinite(total) || total <= 0) throw new Error('This document has no amount payable.');
  if (kind === 'quote') {
    if (!['Approved', 'Paid'].includes(document.status)) throw new Error('Approve the quote before paying a deposit.');
    const deposit = Number(document.deposit_amount);
    const paid = Number(document.deposit_paid_amount || (document.status === 'Paid' ? deposit : 0));
    const due = deposit - paid;
    if (!Number.isFinite(due) || due <= 0 || deposit > total) throw new Error('There is no deposit payable on this quote.');
    return due;
  }
  if (['Draft','Cancelled','Canceled'].includes(document.status)) throw new Error('This invoice is not payable.');
  const balance = total - Number(document.amount_paid || 0);
  const amount = requested == null ? balance : Number(requested);
  if (!Number.isFinite(amount) || amount <= 0 || amount > balance + 0.001) throw new Error('Payment must be within the outstanding invoice balance.');
  return amount;
}

export function checkoutReturnUrl(candidate, fallback, appUrl) {
  try {
    const url = new URL(candidate || fallback);
    if (url.origin === new URL(appUrl).origin && ['http:','https:'].includes(url.protocol)) return url.toString();
  } catch { /* use the trusted document URL */ }
  return fallback;
}
