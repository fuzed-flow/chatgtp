import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';

export default function EPAssignedWork({ currentUser, companyId, mode = 'projects' }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const selectedProject = params.get('notificationProject');
  const selectedEvent = params.get('notificationEvent');
  const query = useQuery({
    queryKey: ['field-assigned-work', companyId, currentUser?.id, mode, selectedProject, selectedEvent],
    enabled: !!companyId && !!currentUser?.id,
    queryFn: async () => {
      const { data: staff, error: staffError } = await supabase.from('project_staff').select('project_id')
        .eq('company_id', companyId).eq('user_id', currentUser.id).or('is_active.is.null,is_active.eq.true');
      if (staffError) throw staffError;
      let ids = [...new Set((staff || []).map(row => row.project_id))];
      if (selectedProject) ids = ids.filter(id => id === selectedProject);
      if (!ids.length) return { projects: [], events: [], milestones: [] };
      const { data: projects, error } = await supabase.from('projects')
        .select('id,name,status,site_address,start_date,target_end_date').eq('company_id', companyId).in('id', ids).order('name');
      if (error) throw error;
      if (mode === 'schedule') {
        let request = supabase.from('schedule_jobs').select('id,project_id,title,start_date_time,end_date_time,address,status')
          .eq('company_id', companyId).in('project_id', ids).order('start_date_time', { ascending: false });
        if (selectedEvent) request = request.eq('id', selectedEvent);
        const { data: events, error: eventError } = await request.limit(200);
        if (eventError) throw eventError;
        return { projects: projects || [], events: events || [], milestones: [] };
      }
      const { data: milestones, error: milestoneError } = await supabase.from('project_milestones')
        .select('id,project_id,title,status,due_date_target').eq('company_id', companyId).in('project_id', ids);
      if (milestoneError) throw milestoneError;
      return { projects: projects || [], events: [], milestones: milestones || [] };
    },
  });
  if (query.isPending) return <p role="status" className="p-6 text-slate-500">Loading assigned work…</p>;
  if (query.isError) return <div className="p-6"><p role="alert">Could not load your assigned work.</p><Button onClick={() => query.refetch()} className="mt-3">Retry</Button></div>;
  const { projects, events, milestones } = query.data;
  const rows = mode === 'schedule' ? events : projects;
  const time = value => value ? new Date(value).toLocaleString() : 'Not scheduled';
  return <section className="space-y-4">
    <h2 className="text-xl font-bold text-slate-900">{mode === 'schedule' ? 'My Project Schedule' : 'My Projects'}</h2>
    {!rows.length && <p className="text-slate-500">{selectedProject || selectedEvent ? 'This item is no longer available in your assigned work.' : 'No assigned work to show.'}</p>}
    {rows.map(row => <article key={row.id} className="bg-white rounded-xl border p-5 space-y-2">
      <h3 className="font-semibold text-slate-900">{row.title || row.name}</h3>
      <p className="text-sm text-slate-600">{row.status || 'No status'}</p>
      {mode === 'schedule' ? <>
        <p className="text-sm">{projects.find(project => project.id === row.project_id)?.name}</p>
        <p className="text-sm">{time(row.start_date_time)} – {time(row.end_date_time)}</p>
        <p className="text-sm text-slate-600">{row.address}</p>
      </> : <>
        <p className="text-sm text-slate-600">{row.site_address}</p>
        <p className="text-sm">Start: {row.start_date || 'Not set'} · Target completion: {row.target_end_date || 'Not set'}</p>
        {milestones.filter(item => item.project_id === row.id).map(item => <p key={item.id} className="text-sm border-t pt-2">{item.title} · {item.status || 'Pending'}{item.due_date_target ? ` · ${item.due_date_target}` : ''}</p>)}
      </>}
    </article>)}
  </section>;
}
