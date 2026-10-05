import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { reservationValues, reservationPeak } from '@/lib/costNotificationWorkflows';

export default function InventoryReservations({ item, companyId, profile, focusReservationId }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const initial = () => ({ quantity: '1', project_id: 'none', assigned_to: 'none', start_date: new Date().toISOString().slice(0, 10), return_due_date: '', status: 'Reserved', notes: '' });
  const [form, setForm] = useState(initial);
  const canManage = ['owner', 'admin', 'manager', 'office'].includes(profile?.role);
  const focusRef = useRef(null);
  const { data: listed = [], isLoading, error } = useQuery({ queryKey: ['inventory-reservations', companyId, item.id], enabled: !!companyId,
    queryFn: async () => { const { data, error: err } = await supabase.from('inventory_reservations').select('*').eq('company_id', companyId).eq('inventory_id', item.id).order('start_date', { ascending: false }); if (err) throw err; return data || []; } });
  const { data: focused } = useQuery({ queryKey: ['inventory-reservation-target-detail', companyId, item.id, focusReservationId], enabled: !!companyId && !!focusReservationId,
    queryFn: async () => { const { data, error: err } = await supabase.from('inventory_reservations').select('*').eq('company_id', companyId).eq('inventory_id', item.id).eq('id', focusReservationId).maybeSingle(); if (err) throw err; return data; } });
  const reservations = focused ? [focused, ...listed.filter(r => r.id !== focused.id)] : listed;
  useEffect(() => { if (focused) { focusRef.current?.scrollIntoView({ block: 'nearest' }); focusRef.current?.focus({ preventScroll: true }); } }, [focused]);
  const { data: projects = [] } = useQuery({ queryKey: ['reservation-projects', companyId], enabled: !!companyId && canManage && adding,
    queryFn: async () => { const { data, error: err } = await supabase.from('projects').select('id,name').eq('company_id', companyId).order('name'); if (err) throw err; return data || []; } });
  const { data: users = [] } = useQuery({ queryKey: ['reservation-users', companyId], enabled: !!companyId && canManage && adding,
    queryFn: async () => { const { data, error: err } = await supabase.from('profiles').select('id,full_name,email').eq('company_id', companyId).neq('is_active', false); if (err) throw err; return data || []; } });
  const save = useMutation({ mutationFn: async () => { const payload = reservationValues(form, companyId, item.id); const { error: err } = await supabase.from('inventory_reservations').insert(payload); if (err) throw err; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-reservations', companyId, item.id] }); setAdding(false); setForm(initial()); toast.success('Reservation saved. Any stock conflicts have been flagged.'); }, onError: err => toast.error(err.message) });
  const update = useMutation({ mutationFn: async ({ id, status }) => { const { error: err } = await supabase.from('inventory_reservations').update({ status }).eq('company_id', companyId).eq('id', id); if (err) throw err; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-reservations', companyId, item.id] }); qc.invalidateQueries({ queryKey: ['inventory-reservation-target-detail', companyId, item.id] }); }, onError: err => toast.error(err.message) });
  const overlapping = reservationPeak(reservations, form.start_date, form.return_due_date);
  const conflict = adding && form.return_due_date && overlapping + Number(form.quantity || 0) > Number(item.quantity_on_hand || 0);
  return <section className="space-y-3 border-t border-slate-200 pt-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">Reservations and returns</h3>{canManage && <Button variant="outline" className="min-h-11 text-amber-800" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Reserve'}</Button>}</div>
    {error && <p role="alert" className="text-sm text-red-700">Reservations could not be loaded. {error.message}</p>}
    {isLoading ? <p className="text-sm text-slate-500">Loading reservations…</p> : !reservations.length && <p className="text-sm text-slate-500">No reservations or checkouts recorded.</p>}
    {reservations.map(r => <div key={r.id} ref={r.id === focusReservationId ? focusRef : null} tabIndex={r.id === focusReservationId ? -1 : undefined} className={`rounded-lg border p-3 text-sm space-y-2 ${r.id === focusReservationId ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : "border-slate-200"}`}><p className="font-bold">{r.quantity} {item.unit || 'units'} · {r.status}</p><p>{r.start_date} → {r.return_due_date}</p>{r.status === "Reserved" && r.checkout_requested_at && <p className="font-semibold text-amber-800">Checkout requested — office approval required</p>}{r.notes && <p className="text-slate-600 break-words">{r.notes}</p>}{canManage && ['Reserved', 'Checked out'].includes(r.status) && <div className="flex flex-wrap gap-2">{r.status === 'Reserved' && <Button size="sm" className="min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: 'Checked out' })}>Check out</Button>}<Button size="sm" variant="outline" className="min-h-11" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: r.status === 'Checked out' ? 'Returned' : 'Cancelled' })}>{r.status === 'Checked out' ? 'Record return' : 'Cancel reservation'}</Button></div>}</div>)}
    {adding && <form className="space-y-3 bg-amber-50 rounded-lg border border-amber-200 p-3" onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <div><Label htmlFor="reservation-quantity">Quantity</Label><Input id="reservation-quantity" type="number" min="0.01" step="any" required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
      <div><Label htmlFor="reservation-project">Project</Label><Select value={form.project_id} onValueChange={project_id => setForm({ ...form, project_id })}><SelectTrigger id="reservation-project"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No project</SelectItem>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="reservation-assignee">Assigned to</Label><Select value={form.assigned_to} onValueChange={assigned_to => setForm({ ...form, assigned_to })}><SelectTrigger id="reservation-assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><Label htmlFor="reservation-start">Start date</Label><Input id="reservation-start" type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div><div><Label htmlFor="reservation-return">Return due</Label><Input id="reservation-return" type="date" required min={form.start_date} value={form.return_due_date} onChange={e => setForm({ ...form, return_due_date: e.target.value })} /></div></div>
      <div><Label htmlFor="reservation-notes">Notes</Label><Input id="reservation-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
      {conflict && <p role="alert" className="text-sm font-medium text-amber-900">These dates need more stock than is available. Saving flags a conflict for your team to resolve.</p>}
      <Button type="submit" className="w-full min-h-11 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save reservation'}</Button>
    </form>}
  </section>;
}
