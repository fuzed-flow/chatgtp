-- Synthetic additions mirror the inspected production types. No external jobs.
create table public.project_phases(
 id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),project_id uuid references projects(id),
 name text not null,status text default 'Not Started',phase_order integer default 0,assigned_to uuid,
 start_date_target date,end_date_target date,start_date_actual date,end_date_actual date,internal_notes text,budget numeric default 0
);
create table public.project_allocations(
 id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,task_id uuid,user_id uuid,
 allocated_hours numeric default 0,utilization_percentage numeric default 100,allocation_start_date date,allocation_end_date date
);
create table public.task_dependencies(
 id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),project_id uuid references projects(id),
 task_id uuid references project_tasks(id) on delete cascade,depends_on_task_id uuid references project_tasks(id) on delete cascade,
 dependency_type text default 'Finish-to-Start',created_at timestamptz default now()
);
create table public.time_off_requests(
 id uuid primary key default gen_random_uuid(),company_id uuid,employee_name text,type text,start_date date,end_date date,
 total_days numeric,reason text,status text default 'Pending',admin_notes text,created_at timestamptz default now()
);
create policy legacy_allocation_access on public.project_allocations for all to public using(true) with check(true);
create policy legacy_allocation_access on public.resource_allocations for all to public using(true) with check(true);
create policy legacy_dependency_access on public.task_dependencies for all to public using(true) with check(true);
create policy legacy_leave_access on public.time_off_requests for all to public using(true) with check(true);
grant select,insert,update,delete on public.project_allocations,public.resource_allocations,public.task_dependencies,public.time_off_requests to authenticated;
