create table public.project_schedule_drafts(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,project_id uuid not null references public.projects(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,schedule jsonb not null,applied_at timestamptz,created_at timestamptz not null default now());
alter table public.project_schedule_drafts enable row level security;
create policy schedule_draft_company on public.project_schedule_drafts for select to authenticated using(company_id=(select public.get_auth_company_id()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active is distinct from false));
revoke all on public.project_schedule_drafts from anon,authenticated;
grant select on public.project_schedule_drafts to authenticated;
grant all on public.project_schedule_drafts to service_role;
create index on public.project_schedule_drafts(company_id,created_at);
create or replace function public.apply_project_schedule(p_draft uuid) returns integer language plpgsql security definer set search_path='' as $$
declare d public.project_schedule_drafts; phase jsonb; task jsonb; task_count int:=0; actor public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false and role in ('owner','admin','office','manager');
 if not found then raise exception 'Manager access required' using errcode='42501'; end if;
 if actor.role not in ('owner','admin') and actor.permissions is not null and actor.permissions!='[]'::jsonb and not actor.permissions ? 'projects' and exists(select 1 from public.companies where id=actor.company_id and plan_id='business') then raise exception 'Project module access required' using errcode='42501'; end if;
 select * into d from public.project_schedule_drafts where id=p_draft and company_id=actor.company_id for update;
 if not found then raise exception 'Draft unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.projects where id=d.project_id and company_id=actor.company_id) then raise exception 'Project unavailable'; end if;
 if d.applied_at is not null then return 0; end if;
 update public.projects set start_date=(d.schedule->'timeline'->>'project_start')::date,target_end_date=(d.schedule->'timeline'->>'project_end')::date where id=d.project_id and company_id=actor.company_id;
 for phase in select value from jsonb_array_elements(d.schedule->'phases') loop
  for task in select value from jsonb_array_elements(phase->'tasks') loop
   insert into public.tasks(company_id,project_id,title,description,status,priority,due_date,estimated_hours) values(actor.company_id,d.project_id,task->>'title',task->>'description','To Do',coalesce(task->>'priority','Medium'),(task->>'due_date')::date,(task->>'estimated_hours')::numeric);
   task_count:=task_count+1;
  end loop;
 end loop;
 update public.project_schedule_drafts set applied_at=now() where id=p_draft;
 return task_count;
end $$;
revoke all on function public.apply_project_schedule(uuid) from public,anon;
grant execute on function public.apply_project_schedule(uuid) to authenticated;
