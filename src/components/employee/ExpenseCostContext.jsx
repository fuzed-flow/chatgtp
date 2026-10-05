import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ExpenseCostContext({ companyId, projectId, value, onChange }) {
  const enabled = !!companyId && !!projectId && projectId !== 'none';
  const { data: orders = [] } = useQuery({ queryKey: ['expense-po-context', companyId, projectId], enabled,
    queryFn: async () => { const { data, error } = await supabase.from('purchase_orders').select('id,po_number').eq('company_id', companyId).eq('project_id', projectId); if (error) throw error; return data || []; } });
  const { data: materials = [] } = useQuery({ queryKey: ['expense-material-context', companyId, projectId], enabled,
    queryFn: async () => { const { data, error } = await supabase.from('project_materials').select('id,custom_material_name').eq('company_id', companyId).eq('project_id', projectId); if (error) throw error; return data || []; } });
  if (!enabled) return null;
  return <div><Label htmlFor="expense-existing-purchase">Already recorded purchase (optional)</Label><Select value={value} onValueChange={onChange}><SelectTrigger id="expense-existing-purchase" className="mt-1 min-h-11 bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">New purchase / no existing record</SelectItem>{orders.map(po => <SelectItem key={po.id} value={`po:${po.id}`}>Purchase order {po.po_number}</SelectItem>)}{materials.map(m => <SelectItem key={m.id} value={`material:${m.id}`}>{m.custom_material_name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-slate-500 mt-1">Link an existing purchase so the project budget counts its cost once.</p></div>;
}
