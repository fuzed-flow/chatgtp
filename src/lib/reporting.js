export function parseRecordDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function paymentDate(payment) {
  return payment.payment_date || payment.date || payment.created_at;
}

export function withinDateRange(value, start, end) {
  const date = parseRecordDate(value);
  return !!date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

export function invoiceBalance(invoice) {
  const balance = Number(invoice.balance_due);
  return invoice.balance_due != null && Number.isFinite(balance)
    ? Math.max(0, balance)
    : Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));
}

export function csvText(headers, records) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text) && !/^\-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers, ...records].map(row => row.map(cell).join(',')).join('\r\n');
}
