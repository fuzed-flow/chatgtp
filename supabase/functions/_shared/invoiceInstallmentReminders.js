// Invoice-level and installment-level reminders have separate delivery history.
export async function invoiceReminderContext(db, invoice) {
  const { data, error } = await db.rpc('invoice_reminder_context', {
    p_company: invoice.company_id, p_invoice: invoice.id,
  });
  if (error) throw new Error('Invoice payment schedule is unavailable.');
  return data;
}

export async function installmentReminderPolicy(db, invoice, target, stage) {
  const { data, error } = await db.rpc('invoice_installment_reminder_policy', {
    p_company: invoice.company_id, p_invoice: invoice.id,
    p_schedule: target.schedule_item_id, p_due_date: target.due_date, p_stage: stage,
  });
  if (error || !data) throw new Error('Installment delivery history is unavailable.');
  return data;
}

export async function recordInstallmentReminder(db, invoice, target, stage, channel) {
  const { error } = await db.rpc('record_invoice_installment_reminder', {
    p_company: invoice.company_id, p_invoice: invoice.id,
    p_schedule: target.schedule_item_id, p_due_date: target.due_date,
    p_stage: stage, p_channel: channel,
  });
  if (error) throw new Error('Installment reminder acceptance could not be recorded.');
}
