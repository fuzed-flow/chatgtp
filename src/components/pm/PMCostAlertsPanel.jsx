import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { categoryBudgetValues, positiveAmount } from '@/lib/costNotificationWorkflows';

export default function PMCostAlertsPanel({ projectId }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();
  const canManage = ['owner', 'admin', 'manager', 'office'].includes(profile?.role);
  const [materialBudget, setMaterialBudget] = useState('');
  const [labourBudget, setLabourBudget] = useState('');
  const [categories, setCategories] = useState([]);
  const { data: project, isLoading, error } = useQuery({ queryKey: ['project-cost-alerts', companyId, projectId], enabled: !!projectId && !!companyId && canManage,
    queryFn: async () => { const { data, error: err } = await supabase.from('projects').select('id,material_budget,labour_budget,category_budgets').eq('id', projectId).eq('company_id', companyId).single(); if (err) throw err; return data; } });
  useEffect(() => { if (project) { setMaterialBudget(project.material_budget ?? ''); setLabourBudget(project.labour_budget ?? ''); setCategories(Object.entries(project.category_budgets || {}).map(([name, amount]) => ({ name, amount }))); } }, [project]);
  const save = useMutation({ mutationFn: async () => { const payload = { material_budget: positiveAmount(materialBudget, 'Material budget'), labour_budget: positiveAmount(labourBudget, 'Labour budget'), category_budgets: categoryBudgetValues(categories) }; const { error: err } = await supabase.from('projects').update(payload).eq('id', projectId).eq('company_id', companyId); if (err) throw err; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-cost-alerts', companyId, projectId] }); toast.success('Cost alert limits saved'); }, onError: err => toast.error(err.message) });
  if (!canManage) return null;
  return <Card className="p-4 sm:p-6 border-amber-200 bg-white space-y-4 mb-6">
    <div><h2 className="font-bold text-slate-900">Cost alert limits</h2><p className="text-sm text-slate-600 mt-1">Your team is alerted at 90% and when a limit is exceeded. Blank limits stay disabled.</p></div>
    {error && <p role="alert" className="text-red-700 text-sm">Cost limits could not be loaded. {error.message}</p>}
    {isLoading ? <p className="text-sm text-slate-500">Loading cost limits…</p> : <form onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(); }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><Label htmlFor="material-budget-limit">Material and purchase order budget</Label><Input id="material-budget-limit" type="number" min="0" step="0.01" value={materialBudget} onChange={e => setMaterialBudget(e.target.value)} className="mt-1 min-h-11" placeholder="No separate limit" /></div><div><Label htmlFor="labour-budget-limit">Approved labour cost budget</Label><Input id="labour-budget-limit" type="number" min="0" step="0.01" value={labourBudget} onChange={e => setLabourBudget(e.target.value)} className="mt-1 min-h-11" placeholder="No separate limit" /></div></div>
      <div className="space-y-2"><p className="text-sm font-bold">Cost categories</p>{categories.map((row, i) => <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2"><div><Label htmlFor={`cost-category-${i}`} className="sr-only">Category {i + 1}</Label><Input id={`cost-category-${i}`} value={row.name} maxLength={80} placeholder="e.g. Electrical" onChange={e => setCategories(categories.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))} /></div><div><Label htmlFor={`cost-category-limit-${i}`} className="sr-only">Category {i + 1} limit</Label><Input id={`cost-category-limit-${i}`} type="number" min="0" step="0.01" value={row.amount} placeholder="Budget amount" onChange={e => setCategories(categories.map((r, idx) => idx === i ? { ...r, amount: e.target.value } : r))} /></div><Button type="button" variant="outline" className="min-h-11" aria-label={`Remove category ${row.name || i + 1}`} onClick={() => setCategories(categories.filter((_, idx) => idx !== i))}>Remove</Button></div>)}<Button type="button" variant="outline" className="min-h-11" onClick={() => setCategories([...categories, { name: '', amount: '' }])}>Add category limit</Button></div>
      <p className="text-xs text-slate-500">Committed costs include purchase orders, ordered materials and approved labour and expenses. Link materials and expense claims to their purchase order to count each purchase once. Set staff hourly rates in Human Resources.</p>
      <Button type="submit" className="min-h-11 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={save.isPending || !!error}>{save.isPending ? 'Saving…' : 'Save cost limits'}</Button>
    </form>}
  </Card>;
}
