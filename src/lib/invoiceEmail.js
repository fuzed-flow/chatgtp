export const DEFAULT_INVOICE_EMAIL = "Hi {{client_name}},\n\n{{payment_summary}}\n\nUse the private secure link below to view the detailed invoice and payment options.";

const previousDefaults = new Set([
  "Hi {{client_name}},\n\nYour invoice {{invoice_number}} for ${{balance_due}} is ready to review.\n\nUse the private secure link below to view the detailed invoice and payment options.",
  "Hi {{client_name}},\n\nPlease find attached Invoice {{invoice_number}} for the amount of ${{balance_due}}.\n\nYou can view your interactive invoice history, milestones, and secure credit card payment options online using the link provided.",
]);

export function invoiceEmailTemplate(value) {
  const template = String(value || "").trim();
  return !template || previousDefaults.has(template) ? DEFAULT_INVOICE_EMAIL : template;
}

const money = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100) / 100) : 0;
export const formatInvoiceEmailAmount = value => money(value).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function invoiceEmailPayments(invoice, schedule) {
  const invoiceBalance = money(invoice.balance_due);
  if (!invoiceBalance) return [];
  return [...schedule].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .filter(item => String(item.status || "").toLowerCase() !== "paid")
    .map(item => ({
      id: item.id,
      name: String(item.payment_name || "Payment").trim(),
      milestone: String(item.due_event || "").trim(),
      balance: Math.min(invoiceBalance, money(Number(item.amount || 0) - Number(item.amount_paid || 0))),
    }))
    .filter(item => item.id && item.balance > 0)
    .map(item => ({ ...item, label: [item.name, item.milestone].filter(Boolean).join(" — ") }));
}

export function renderInvoiceEmail({ template, clientName, invoiceNumber, invoice, payment }) {
  const number = invoice.invoice_number || invoiceNumber || "Draft";
  const balance = formatInvoiceEmailAmount(invoice.balance_due);
  const paymentBalance = payment ? formatInvoiceEmailAmount(payment.balance) : balance;
  const summary = payment
    ? `Your ${payment.label} for invoice ${number} has a remaining balance of $${paymentBalance}.`
    : money(invoice.balance_due) > 0
      ? `Your invoice ${number} has a remaining balance of $${balance}.`
      : `Your invoice ${number} is paid in full and ready to review.`;
  const tokens = {
    client_name: clientName ? clientName.split(" ")[0] : "there",
    invoice_number: number,
    invoice_title: `Invoice ${number}`,
    balance_due: balance,
    payment_summary: summary,
    payment_name: payment?.name || `Invoice ${number}`,
    milestone_name: payment?.milestone || "",
    payment_balance: paymentBalance,
  };
  return invoiceEmailTemplate(template).replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => tokens[key] ?? "").trim();
}
