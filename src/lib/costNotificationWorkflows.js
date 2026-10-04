export const PURCHASE_ORDER_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Sent', 'Cancelled'];
export const DELIVERY_STATUSES = ['Not received', 'Partial delivery', 'Delayed', 'Received', 'Cancelled'];

export function purchaseOrderStatusUpdate(status, order) {
  const payload = { status };
  if (status === 'Approved') payload.approved_amount = Number(order?.total || 0);
  return payload;
}

export function purchaseOrderDeliveryUpdate(delivery_status, date = new Date()) {
  return { delivery_status, actual_delivery_date: delivery_status === 'Received' ? date.toISOString().slice(0, 10) : null };
}

export function positiveAmount(value, label) {
  if (value === '' || value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be zero or more.`);
  return amount;
}

export function categoryBudgetValues(rows) {
  const result = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !row.amount) continue;
    if (!name) throw new Error('Enter a name for each cost category.');
    if (name.length > 80) throw new Error('Category names must be 80 characters or fewer.');
    if (Object.keys(result).some(key => key.toLowerCase() === name.toLowerCase())) throw new Error('Use each cost category once.');
    if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Choose another category name.');
    result[name] = positiveAmount(row.amount, `${name} budget`) ?? 0;
  }
  return result;
}

export function reservationValues(form, companyId, inventoryId) {
  const quantity = Number(form.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a quantity greater than zero.');
  if (!form.start_date || !form.return_due_date || form.return_due_date < form.start_date) throw new Error('Return date must be on or after the start date.');
  return { company_id: companyId, inventory_id: inventoryId, project_id: form.project_id === 'none' ? null : form.project_id,
    assigned_to: form.assigned_to === 'none' ? null : form.assigned_to, quantity,
    start_date: form.start_date, return_due_date: form.return_due_date, status: form.status, notes: form.notes.trim() || null };
}

export function reservationPeak(reservations, start, end) {
  if (!start || !end || end < start) return 0;
  const active = reservations.filter(r => ['Reserved', 'Checked out'].includes(r.status) && r.start_date <= end && r.return_due_date >= start);
  const dates = new Set([start, ...active.map(r => r.start_date).filter(date => date >= start && date <= end)]);
  let peak = 0;
  for (const date of dates) peak = Math.max(peak, active.filter(r => r.start_date <= date && r.return_due_date >= date).reduce((sum, r) => sum + Number(r.quantity), 0));
  return peak;
}
export const notificationTargetId = (params, ...keys) => {
  const value = keys.map(key => params.get(key)).find(Boolean);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '') ? value : null;
};
