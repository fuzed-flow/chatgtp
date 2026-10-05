import React, { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notificationTargetId } from '@/lib/costNotificationWorkflows';
import { toast } from 'sonner';
import { Wrench } from 'lucide-react';

const selection = 'id,inventory_id,quantity,start_date,return_due_date,status,notes,checkout_requested_at,returned_at,inventory(name,unit,item_type,equipment_status),projects(name)';

export default function EPEquipmentReservations({ profile }) {
  const companyId = profile?.company_id;
  const actorId = profile?.id;
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const reservationId = notificationTargetId(params, 'reservation', 'reservationId');
  const itemId = notificationTargetId(params, 'id', 'inventoryId');
  const focusRef = useRef(null);
  const query = () => supabase.from('inventory_reservations').select(selection).eq('company_id', companyId).eq('assigned_to', actorId);
  const { data: listed = [], isLoading, error } = useQuery({ queryKey: ['my-equipment-reservations', companyId, actorId], enabled: !!companyId && !!actorId,
    queryFn: async () => { const { data, error: err } = await query().order('start_date', { ascending: false }); if (err) throw err; return data || []; } });
  const { data: targeted = [], error: targetError } = useQuery({ queryKey: ['my-equipment-target', companyId, actorId, reservationId, itemId], enabled: !!companyId && !!actorId && !!(reservationId || itemId),
    queryFn: async () => { const request = query(); const { data, error: err } = await (reservationId ? request.eq('id', reservationId) : request.eq('inventory_id', itemId)).order('start_date', { ascending: false }); if (err) throw err; if (!data?.length) throw new Error('This reservation is unavailable or is not assigned to you.'); return data; } });
  const rows = [...targeted, ...listed.filter(r => !targeted.some(t => t.id === r.id))].filter(r => r.inventory?.item_type === 'Equipment');
  useEffect(() => { if (targeted.length) { focusRef.current?.scrollIntoView({ block: 'nearest' }); focusRef.current?.focus({ preventScroll: true }); } }, [targeted]);
  const action = useMutation({ mutationFn: async ({ id, value }) => { const { data, error: err } = await supabase.rpc('inventory_reservation_action', { p_reservation: id, p_action: value }); if (err) throw err; return { data, value }; },
    onSuccess: ({ value }) => { qc.invalidateQueries({ queryKey: ['my-equipment-reservations', companyId, actorId] }); qc.invalidateQueries({ queryKey: ['my-equipment-target', companyId, actorId] }); toast.success(value === 'request_checkout' ? 'Checkout requested. Your office must approve the handover.' : 'Equipment return confirmed.'); }, onError: err => toast.error(err.message) });
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Wrench className="h-5 w-5 text-amber-500" /> My equipment</h3>
    <p className="text-sm text-slate-600">Request your reserved equipment from the office. Confirm a return after you have handed it back.</p>
    {(error || targetError) && <p role="alert" className="text-sm text-red-700">{error?.message || targetError?.message}</p>}
    {isLoading ? <p className="text-sm text-slate-500">Loading equipment…</p> : !rows.length && !targetError && <p className="text-sm text-slate-500">No equipment is assigned to you.</p>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{rows.map(r => {
      const focused = r.id === reservationId || (!reservationId && r.inventory_id === itemId);
      const canRequest = r.status === 'Reserved' && !r.checkout_requested_at && r.inventory?.equipment_status === 'Available';
      return <article key={r.id} ref={focused && r.id === targeted[0]?.id ? focusRef : null} tabIndex={focused ? -1 : undefined} className={`rounded-lg border p-3 space-y-3 ${focused ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100' : 'border-slate-200'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-bold break-words">{r.inventory?.name || 'Equipment'}</h4><Badge variant="outline">{r.status}</Badge></div>
        <p className="text-sm">{r.quantity} {r.inventory?.unit || 'units'} · {r.projects?.name || 'Shop / unassigned project'}</p>
        <p className="text-sm text-slate-600">Reserved {r.start_date} · Return due {r.return_due_date}</p>
        {r.notes && <p className="text-sm whitespace-pre-wrap break-words text-slate-600">{r.notes}</p>}
        {r.status === 'Reserved' && r.checkout_requested_at && <p className="text-sm font-semibold text-amber-800" role="status">Checkout requested — waiting for office approval.</p>}
        {r.status === 'Reserved' && r.inventory?.equipment_status !== 'Available' && <p className="text-sm text-amber-800">Equipment is {r.inventory?.equipment_status?.toLowerCase() || 'unavailable'}. Contact your office.</p>}
        {canRequest && <Button className="w-full min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={action.isPending} onClick={() => action.mutate({ id: r.id, value: 'request_checkout' })}>Request checkout</Button>}
        {r.status === 'Checked out' && <Button className="w-full min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={action.isPending} onClick={() => action.mutate({ id: r.id, value: 'confirm_return' })}>Confirm equipment returned</Button>}
      </article>;
    })}</div>
  </section>;
}
