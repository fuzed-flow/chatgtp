-- Employee Portal authorization guardrails.
--
-- This migration intentionally keeps the receipts and daily_logs buckets public
-- for reads because existing rows store durable public URLs used by HR, PM and
-- client-facing views. Upload/list/mutation access is tightened here; converting
-- those buckets to private requires a coordinated URL backfill and signed-URL
-- rollout and must not be done as a standalone database change.

create schema if not exists employee_portal_private;
revoke all on schema employee_portal_private from public, anon;
grant usage on schema employee_portal_private to authenticated;

-- Keep all authorization decisions anchored to an active profile stored by the
-- application. No user-editable JWT metadata participates in authorization.
-- Advanced per-user module permissions are a Business-plan entitlement. On
-- other plans any stale permission array is deliberately ignored so a downgrade
-- cannot unexpectedly remove the default manager/office access provided by the
-- role. On Business, NULL/empty retains the documented default-role behavior.
create or replace function employee_portal_private.module_allowed(
  p_profile public.profiles,
  p_module text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_profile.role in ('owner', 'admin')
    or c.plan_id is distinct from 'business'
    or p_profile.permissions is null
    or p_profile.permissions = '[]'::jsonb
    or p_profile.permissions ? p_module,
    false
  )
  from public.companies c
  where c.id = p_profile.company_id;
$$;

create or replace function employee_portal_private.assignment_matches(
  p_profile public.profiles,
  p_assigned jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from jsonb_array_elements_text(
      case
        when p_assigned is null or p_assigned = 'null'::jsonb then '[]'::jsonb
        when jsonb_typeof(p_assigned) = 'array' then p_assigned
        else jsonb_build_array(p_assigned #>> '{}')
      end
    ) assigned(value)
    where btrim(assigned.value) = p_profile.id::text
       or (
         nullif(btrim(p_profile.email), '') is not null
         and lower(btrim(assigned.value)) = lower(btrim(p_profile.email))
       )
  ), false);
$$;

create or replace function employee_portal_private.task_management_access(
  p_source text,
  p_company uuid,
  p_project uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  module_key text;
begin
  if p_source not in ('tasks', 'project_tasks') or (select auth.uid()) is null then
    return false;
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and company_id = p_company
    and is_active is distinct from false;

  if actor.id is null then return false; end if;
  if actor.role in ('owner', 'admin') then return true; end if;
  if actor.role not in ('manager', 'office') then return false; end if;

  module_key := case when p_source = 'tasks' then 'tasks' else 'projects' end;
  if not employee_portal_private.module_allowed(actor, module_key) then
    return false;
  end if;

  return actor.role = 'office'
    or p_project is null
    or exists (
      select 1
      from public.project_staff staff
      where staff.company_id = actor.company_id
        and staff.project_id = p_project
        and staff.user_id = actor.id
        and staff.is_active is distinct from false
    );
end;
$$;

create or replace function employee_portal_private.task_read_access(
  p_source text,
  p_company uuid,
  p_project uuid,
  p_assigned jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  if employee_portal_private.task_management_access(p_source, p_company, p_project) then
    return true;
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and company_id = p_company
    and is_active is distinct from false;

  return actor.id is not null
    and actor.role in ('employee', 'subcontractor')
    and employee_portal_private.assignment_matches(actor, p_assigned);
end;
$$;

create or replace function employee_portal_private.task_update_access(
  p_source text,
  p_company uuid,
  p_project uuid,
  p_assigned jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  if employee_portal_private.task_management_access(p_source, p_company, p_project) then
    return true;
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and company_id = p_company
    and is_active is distinct from false;

  return actor.id is not null
    and actor.role in ('employee', 'subcontractor')
    and employee_portal_private.assignment_matches(actor, p_assigned);
end;
$$;

-- Keep the established task workflow helper aligned with the table-specific
-- permission keys. Comments remain available to assigned field users, while
-- dependency/structural writes remain management-only through p_write=true.
create or replace function notification_private.people_task_access(
  p_table text,
  p_task uuid,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  task_doc jsonb;
  actor public.profiles;
  task_project uuid;
begin
  if p_table not in ('tasks', 'project_tasks') or (select auth.uid()) is null then
    return false;
  end if;
  select * into actor from public.profiles
  where id = (select auth.uid()) and is_active is distinct from false;
  if actor.id is null then return false; end if;
  execute format(
    'select to_jsonb(task_row) from public.%I task_row where id=$1 and company_id=$2',
    p_table
  ) into task_doc using p_task, actor.company_id;
  if task_doc is null then return false; end if;
  task_project := nullif(task_doc ->> 'project_id', '')::uuid;

  if employee_portal_private.task_management_access(p_table, actor.company_id, task_project) then
    return true;
  end if;
  return not p_write
    and actor.role in ('employee', 'subcontractor')
    and employee_portal_private.assignment_matches(actor, task_doc -> 'assigned_to');
end;
$$;

create or replace function employee_portal_private.task_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  -- Trusted server operations do not carry an end-user auth.uid().
  if (select auth.uid()) is null then return new; end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and company_id = old.company_id
    and is_active is distinct from false;

  if actor.id is null then
    raise exception 'Active company access required' using errcode = '42501';
  end if;

  if actor.role in ('employee', 'subcontractor') then
    if not employee_portal_private.assignment_matches(actor, to_jsonb(old.assigned_to))
       or not employee_portal_private.assignment_matches(actor, to_jsonb(new.assigned_to)) then
      raise exception 'Only an assigned team member can update this task'
        using errcode = '42501';
    end if;

    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Field users may update task status only'
        using errcode = '42501';
    end if;

    if lower(coalesce(new.status, '')) not in ('to do', 'done') then
      raise exception 'Choose To Do or Done for a field task status'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function employee_portal_private.module_allowed(public.profiles, text) from public, anon, authenticated;
revoke all on function employee_portal_private.assignment_matches(public.profiles, jsonb) from public, anon, authenticated;
revoke all on function employee_portal_private.task_management_access(text, uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.task_read_access(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function employee_portal_private.task_update_access(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function employee_portal_private.task_update_guard() from public, anon, authenticated;
revoke all on function notification_private.people_task_access(text, uuid, boolean) from public, anon, authenticated;
grant execute on function employee_portal_private.task_management_access(text, uuid, uuid) to authenticated;
grant execute on function employee_portal_private.task_read_access(text, uuid, uuid, jsonb) to authenticated;
grant execute on function employee_portal_private.task_update_access(text, uuid, uuid, jsonb) to authenticated;
grant execute on function notification_private.people_task_access(text, uuid, boolean) to authenticated;

alter table public.tasks enable row level security;
alter table public.project_tasks enable row level security;

-- The legacy project_tasks policy was TO public USING (true), and anon also had
-- table privileges. Revoke the grants as well as replacing the policies because
-- grants and RLS are independent layers. Authenticated is included in each
-- hardened table's REVOKE ALL so legacy TRUNCATE/TRIGGER privileges cannot
-- survive; only ordinary row-level CRUD is granted back below.
revoke all on public.tasks, public.project_tasks from anon, authenticated, public;
grant select, insert, update, delete on public.tasks, public.project_tasks to authenticated;
grant all on public.tasks, public.project_tasks to service_role;

drop policy if exists "Company users can manage tasks" on public.tasks;
drop policy if exists "Tenant Isolation" on public.tasks;
drop policy if exists "Company users manage project_tasks" on public.project_tasks;
drop policy if exists "Tenant Isolation" on public.project_tasks;
drop policy if exists "Allow authenticated to view tasks" on public.project_tasks;
drop policy if exists "Allow authenticated to update tasks" on public.project_tasks;

drop policy if exists employee_portal_tasks_select on public.tasks;
create policy employee_portal_tasks_select on public.tasks
  for select to authenticated
  using (employee_portal_private.task_read_access('tasks', company_id, project_id, to_jsonb(assigned_to)));

drop policy if exists employee_portal_tasks_insert on public.tasks;
create policy employee_portal_tasks_insert on public.tasks
  for insert to authenticated
  with check (employee_portal_private.task_management_access('tasks', company_id, project_id));

drop policy if exists employee_portal_tasks_update on public.tasks;
create policy employee_portal_tasks_update on public.tasks
  for update to authenticated
  using (employee_portal_private.task_update_access('tasks', company_id, project_id, to_jsonb(assigned_to)))
  with check (employee_portal_private.task_update_access('tasks', company_id, project_id, to_jsonb(assigned_to)));

drop policy if exists employee_portal_tasks_delete on public.tasks;
create policy employee_portal_tasks_delete on public.tasks
  for delete to authenticated
  using (employee_portal_private.task_management_access('tasks', company_id, project_id));

drop policy if exists employee_portal_project_tasks_select on public.project_tasks;
create policy employee_portal_project_tasks_select on public.project_tasks
  for select to authenticated
  using (employee_portal_private.task_read_access('project_tasks', company_id, project_id, to_jsonb(assigned_to)));

drop policy if exists employee_portal_project_tasks_insert on public.project_tasks;
create policy employee_portal_project_tasks_insert on public.project_tasks
  for insert to authenticated
  with check (employee_portal_private.task_management_access('project_tasks', company_id, project_id));

drop policy if exists employee_portal_project_tasks_update on public.project_tasks;
create policy employee_portal_project_tasks_update on public.project_tasks
  for update to authenticated
  using (employee_portal_private.task_update_access('project_tasks', company_id, project_id, to_jsonb(assigned_to)))
  with check (employee_portal_private.task_update_access('project_tasks', company_id, project_id, to_jsonb(assigned_to)));

drop policy if exists employee_portal_project_tasks_delete on public.project_tasks;
create policy employee_portal_project_tasks_delete on public.project_tasks
  for delete to authenticated
  using (employee_portal_private.task_management_access('project_tasks', company_id, project_id));

drop trigger if exists employee_portal_task_update_guard on public.tasks;
create trigger employee_portal_task_update_guard
before update on public.tasks
for each row execute function employee_portal_private.task_update_guard();

drop trigger if exists employee_portal_task_update_guard on public.project_tasks;
create trigger employee_portal_task_update_guard
before update on public.project_tasks
for each row execute function employee_portal_private.task_update_guard();

create index if not exists employee_portal_project_tasks_assigned_gin
  on public.project_tasks using gin (assigned_to);
create index if not exists employee_portal_tasks_company_assigned
  on public.tasks(company_id, assigned_to);

-- Expenses: personal claims remain self-service while HR review remains available
-- to owners/admins and authorized office staff. Reports may read company expenses
-- but report access does not grant mutation authority.
alter table public.expenses add column if not exists approved_by text;
comment on column public.expenses.approved_by is
  'Name recorded by the existing HR approval workflow; field users cannot set this value.';

create or replace function employee_portal_private.hr_management_access(p_company uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;
  return actor.role in ('owner', 'admin')
    or (actor.role = 'office' and employee_portal_private.module_allowed(actor, 'human_resources'));
end;
$$;

create or replace function employee_portal_private.expense_read_access(
  p_company uuid,
  p_user uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;
  if actor.id = p_user or actor.role in ('owner', 'admin') then return true; end if;
  if actor.role = 'office' and (
    employee_portal_private.module_allowed(actor, 'human_resources')
    or employee_portal_private.module_allowed(actor, 'reports')
  ) then return true; end if;
  return actor.role = 'manager'
    and employee_portal_private.module_allowed(actor, 'reports');
end;
$$;

create or replace function employee_portal_private.expense_mutation_access(
  p_company uuid,
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select employee_portal_private.hr_management_access(p_company)
    or exists (
      select 1 from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.company_id = p_company
        and actor.is_active is distinct from false
        and actor.id = p_user
    );
$$;

create or replace function employee_portal_private.expense_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  row_company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  row_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  editable_statuses constant text[] := array['submitted', 'under review', 'rejected'];
begin
  if (select auth.uid()) is null then return case when tg_op = 'DELETE' then old else new end; end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = row_company
    and is_active is distinct from false;
  if actor.id is null then raise exception 'Active company access required' using errcode = '42501'; end if;

  if employee_portal_private.hr_management_access(row_company) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if row_user is distinct from actor.id then
    raise exception 'You may change only your own expense claims' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if lower(coalesce(new.status, '')) <> 'submitted' then
      raise exception 'New employee expenses must be submitted for review' using errcode = '42501';
    end if;
    if new.approved_by is not null or new.admin_notes is not null
       or new.qbo_purchase_id is not null or new.qbo_sync_error is not null
       or lower(coalesce(new.qbo_sync_status, 'none')) <> 'none' then
      raise exception 'Approval and accounting fields are managed by office staff' using errcode = '42501';
    end if;
    if new.amount is null or new.amount <= 0 or new.date is null then
      raise exception 'Expense date and a positive amount are required' using errcode = '23514';
    end if;
    new.user_email := actor.email;
    new.employee_name := coalesce(nullif(actor.full_name, ''), actor.email, 'Team member');
    return new;
  end if;

  if lower(coalesce(old.status, '')) <> all(editable_statuses) then
    raise exception 'Approved or processed expenses cannot be changed by the employee' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if lower(coalesce(new.status, '')) <> 'submitted'
     or (to_jsonb(new) - array[
       'project_id','date','category','amount','description','payment_method',
       'receipt_url','status','purchase_order_id','project_material_id'
     ]) is distinct from (to_jsonb(old) - array[
       'project_id','date','category','amount','description','payment_method',
       'receipt_url','status','purchase_order_id','project_material_id'
     ]) then
    raise exception 'Employee expense updates may only revise claim details and resubmit'
      using errcode = '42501';
  end if;

  if new.amount is null or new.amount <= 0 or new.date is null then
    raise exception 'Expense date and a positive amount are required' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function employee_portal_private.hr_management_access(uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.expense_read_access(uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.expense_mutation_access(uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.expense_guard() from public, anon, authenticated;
grant execute on function employee_portal_private.hr_management_access(uuid) to authenticated;
grant execute on function employee_portal_private.expense_read_access(uuid, uuid) to authenticated;
grant execute on function employee_portal_private.expense_mutation_access(uuid, uuid) to authenticated;

alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated, public;
grant select, insert, update, delete on public.expenses to authenticated;
grant all on public.expenses to service_role;
drop policy if exists "Tenant Isolation" on public.expenses;
drop policy if exists "Allow employees to insert their own expenses" on public.expenses;
drop policy if exists "Allow employees to view their own expenses" on public.expenses;

drop policy if exists employee_portal_expenses_select on public.expenses;
create policy employee_portal_expenses_select on public.expenses
  for select to authenticated
  using (employee_portal_private.expense_read_access(company_id, user_id));
drop policy if exists employee_portal_expenses_insert on public.expenses;
create policy employee_portal_expenses_insert on public.expenses
  for insert to authenticated
  with check (employee_portal_private.expense_mutation_access(company_id, user_id));
drop policy if exists employee_portal_expenses_update on public.expenses;
create policy employee_portal_expenses_update on public.expenses
  for update to authenticated
  using (employee_portal_private.expense_mutation_access(company_id, user_id))
  with check (employee_portal_private.expense_mutation_access(company_id, user_id));
drop policy if exists employee_portal_expenses_delete on public.expenses;
create policy employee_portal_expenses_delete on public.expenses
  for delete to authenticated
  using (employee_portal_private.expense_mutation_access(company_id, user_id));

drop trigger if exists employee_portal_expense_guard on public.expenses;
create trigger employee_portal_expense_guard
before insert or update or delete on public.expenses
for each row execute function employee_portal_private.expense_guard();

-- Time entries: HR may review the company; everyone else sees and creates only
-- their own records. A read-only legacy fallback is permitted only when the
-- stored name maps uniquely to the active caller within the company.
create or replace function employee_portal_private.time_entry_read_access(
  p_company uuid,
  p_user uuid,
  p_employee_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;
  if employee_portal_private.hr_management_access(p_company) then return true; end if;
  if actor.role in ('manager', 'office')
     and employee_portal_private.module_allowed(actor, 'reports') then return true; end if;
  if p_user = actor.id then return true; end if;
  return p_user is null
    and p_employee_name = actor.full_name
    and (
      select count(*) from public.profiles candidate
      where candidate.company_id = actor.company_id
        and candidate.is_active is distinct from false
        and candidate.full_name = p_employee_name
    ) = 1;
end;
$$;

create or replace function employee_portal_private.time_entry_mutation_access(
  p_company uuid,
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select employee_portal_private.hr_management_access(p_company)
    or exists (
      select 1 from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.company_id = p_company
        and actor.is_active is distinct from false
        and actor.id = p_user
    );
$$;

create or replace function employee_portal_private.time_entry_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  row_company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
begin
  if (select auth.uid()) is null then return case when tg_op = 'DELETE' then old else new end; end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = row_company
    and is_active is distinct from false;
  if actor.id is null then raise exception 'Active company access required' using errcode = '42501'; end if;
  if employee_portal_private.hr_management_access(row_company) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Only HR may delete a time entry' using errcode = '42501';
  end if;

  if new.user_id is distinct from actor.id or new.company_id is distinct from actor.company_id then
    raise exception 'You may submit only your own time entries' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if lower(coalesce(new.status, '')) not in ('pending', 'clocked in')
       or new.approved_by is not null
       or new.qbo_time_activity_id is not null
       or new.qbo_sync_error is not null
       or lower(coalesce(new.qbo_sync_status, 'none')) <> 'none' then
      raise exception 'New time entries must be pending HR review' using errcode = '42501';
    end if;
    new.employee_name := coalesce(nullif(actor.full_name, ''), actor.email, 'Team member');
    return new;
  end if;

  if lower(coalesce(old.status, '')) <> 'clocked in'
     or old.clock_out is not null
     or lower(coalesce(new.status, '')) <> 'pending'
     or new.clock_out is null
     or new.clock_in is null
     or new.clock_out < new.clock_in
     or new.clock_out > now() + interval '5 minutes'
     or new.total_hours is null
     or abs(new.total_hours - round((extract(epoch from (new.clock_out - new.clock_in)) / 3600.0)::numeric, 2)) > 0.02
     or (to_jsonb(new) - array['clock_out','total_hours','status'])
        is distinct from (to_jsonb(old) - array['clock_out','total_hours','status']) then
    raise exception 'Field users may only clock out their own active shift'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function employee_portal_private.time_entry_read_access(uuid, uuid, text) from public, anon, authenticated;
revoke all on function employee_portal_private.time_entry_mutation_access(uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.time_entry_guard() from public, anon, authenticated;
grant execute on function employee_portal_private.time_entry_read_access(uuid, uuid, text) to authenticated;
grant execute on function employee_portal_private.time_entry_mutation_access(uuid, uuid) to authenticated;

alter table public.time_entries enable row level security;
revoke all on public.time_entries from anon, authenticated, public;
grant select, insert, update, delete on public.time_entries to authenticated;
grant all on public.time_entries to service_role;
drop policy if exists "Company users can manage time entries" on public.time_entries;
drop policy if exists "Tenant Isolation" on public.time_entries;

drop policy if exists employee_portal_time_entries_select on public.time_entries;
create policy employee_portal_time_entries_select on public.time_entries
  for select to authenticated
  using (employee_portal_private.time_entry_read_access(company_id, user_id, employee_name));
drop policy if exists employee_portal_time_entries_insert on public.time_entries;
create policy employee_portal_time_entries_insert on public.time_entries
  for insert to authenticated
  with check (employee_portal_private.time_entry_mutation_access(company_id, user_id));
drop policy if exists employee_portal_time_entries_update on public.time_entries;
create policy employee_portal_time_entries_update on public.time_entries
  for update to authenticated
  using (employee_portal_private.time_entry_mutation_access(company_id, user_id))
  with check (employee_portal_private.time_entry_mutation_access(company_id, user_id));
drop policy if exists employee_portal_time_entries_delete on public.time_entries;
create policy employee_portal_time_entries_delete on public.time_entries
  for delete to authenticated
  using (employee_portal_private.hr_management_access(company_id));

drop trigger if exists employee_portal_time_entry_guard on public.time_entries;
create trigger employee_portal_time_entry_guard
before insert or update or delete on public.time_entries
for each row execute function employee_portal_private.time_entry_guard();

-- Time off: HR can review company requests; field users can read/create their
-- own requests and cancel only a still-pending request. The restrictive policy
-- is intentional: it contains any older permissive policy that may remain on a
-- tenant upgraded from an earlier release.
create or replace function employee_portal_private.time_off_access(
  p_company uuid,
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select employee_portal_private.hr_management_access(p_company)
    or exists (
      select 1 from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.company_id = p_company
        and actor.is_active is distinct from false
        and actor.id = p_user
    );
$$;

create or replace function notification_private.people_leave_access(
  p_user uuid,
  p_company uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select employee_portal_private.time_off_access(p_company, p_user);
$$;

create or replace function notification_private.people_leave_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  is_hr boolean;
  row_company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
begin
  if (select auth.uid()) is null then
    if coalesce(auth.role(), current_setting('role', true)) in ('anon', 'authenticated') then
      raise exception 'Authentication required' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = row_company
    and is_active is distinct from false;
  if actor.id is null then
    raise exception 'Active company profile required' using errcode = '42501';
  end if;
  is_hr := employee_portal_private.hr_management_access(row_company);

  if tg_op <> 'DELETE' then
    if new.user_id is null and tg_op = 'INSERT' then new.user_id := actor.id; end if;
    if not exists (
      select 1 from public.profiles target
      where target.id = new.user_id and target.company_id = row_company
    ) then
      raise exception 'Select a valid company user' using errcode = '23514';
    end if;
    if new.start_date is null or new.end_date is null or new.end_date < new.start_date then
      raise exception 'End date must be on or after start date' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.id is distinct from old.id
    or (old.user_id is not null and new.user_id is distinct from old.user_id)
    or (old.user_id is null and not is_hr)
  ) then
    raise exception 'Time off identity cannot be changed' using errcode = '42501';
  end if;

  if is_hr then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is distinct from actor.id
       or lower(coalesce(new.status, '')) <> 'pending'
       or new.admin_notes is not null
       or new.approved_by is not null then
      raise exception 'You can submit only your own pending time off'
        using errcode = '42501';
    end if;
    new.employee_name := coalesce(nullif(actor.full_name, ''), actor.email, 'Team member');
    return new;
  end if;

  if old.user_id is distinct from actor.id
     or lower(coalesce(old.status, '')) <> 'pending' then
    raise exception 'You can cancel only your own pending time off'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if lower(coalesce(new.status, '')) not in ('cancelled', 'canceled')
     or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'You can cancel only your own pending time off'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function employee_portal_private.time_off_access(uuid, uuid) from public, anon, authenticated;
revoke all on function notification_private.people_leave_access(uuid, uuid) from public, anon, authenticated;
revoke all on function notification_private.people_leave_guard() from public, anon, authenticated;
grant execute on function employee_portal_private.time_off_access(uuid, uuid) to authenticated;
grant execute on function notification_private.people_leave_access(uuid, uuid) to authenticated;

alter table public.time_off_requests enable row level security;
revoke all on public.time_off_requests from anon, authenticated, public;
grant select, insert, update, delete on public.time_off_requests to authenticated;
grant all on public.time_off_requests to service_role;

drop policy if exists people_leave_scope on public.time_off_requests;
drop policy if exists people_leave_access on public.time_off_requests;
drop policy if exists "Tenant Isolation" on public.time_off_requests;
drop policy if exists "Allow employees to insert their own time off requests" on public.time_off_requests;
drop policy if exists "Allow employees to view their own time off requests" on public.time_off_requests;
drop policy if exists employee_portal_time_off_boundary on public.time_off_requests;
create policy employee_portal_time_off_boundary on public.time_off_requests
  as restrictive for all to authenticated
  using (employee_portal_private.time_off_access(company_id, user_id))
  with check (employee_portal_private.time_off_access(company_id, user_id));
drop policy if exists employee_portal_time_off_access on public.time_off_requests;
create policy employee_portal_time_off_access on public.time_off_requests
  for all to authenticated
  using (employee_portal_private.time_off_access(company_id, user_id))
  with check (employee_portal_private.time_off_access(company_id, user_id));

drop trigger if exists people_leave_guard on public.time_off_requests;
create trigger people_leave_guard
before insert or update or delete on public.time_off_requests
for each row execute function notification_private.people_leave_guard();

-- Daily logs double as dashboard, project, lead and client notes. Management
-- access therefore follows the row context instead of requiring the DailyLogs
-- menu permission for every legitimate consumer. Field roles remain limited to
-- their own logs on assigned projects, and notification deep links can open
-- only the specifically notified log.
create or replace function employee_portal_private.daily_log_access(
  p_log uuid,
  p_company uuid,
  p_project uuid,
  p_client uuid,
  p_lead uuid,
  p_user uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;

  if actor.role in ('owner', 'admin') then return true; end if;

  if actor.role in ('manager', 'office') then
    -- The company dashboard intentionally displays recent notes across these
    -- contexts. DailyLogs provides the equivalent company-wide notes view.
    if employee_portal_private.module_allowed(actor, 'dashboard')
       or employee_portal_private.module_allowed(actor, 'DailyLogs') then
      return true;
    end if;

    if p_lead is not null and employee_portal_private.module_allowed(actor, 'leads') then
      return true;
    end if;
    if p_client is not null and employee_portal_private.module_allowed(actor, 'clients') then
      return true;
    end if;
    if p_project is not null
       and employee_portal_private.module_allowed(actor, 'projects')
       and (
         actor.role = 'office'
         or exists (
           select 1 from public.project_staff staff
           where staff.company_id = p_company and staff.project_id = p_project
             and staff.user_id = actor.id and staff.is_active is distinct from false
         )
       ) then
      return true;
    end if;
  end if;

  if p_action = 'select' and exists (
    select 1 from public.notifications notification
    where notification.company_id = p_company
      and notification.related_id = p_log
      and notification.user_id = actor.id
      and notification.event_key in ('mentioned', 'project_comment')
  ) then return true; end if;

  return actor.role in ('employee', 'subcontractor')
    and p_action in ('select', 'insert', 'delete')
    and p_user = actor.id
    and p_project is not null
    and exists (
      select 1 from public.project_staff staff
      where staff.company_id = p_company and staff.project_id = p_project
        and staff.user_id = actor.id and staff.is_active is distinct from false
    );
end;
$$;

create or replace function notification_private.people_log_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  row_company uuid;
  row_project uuid;
  row_client uuid;
  row_lead uuid;
  row_user uuid;
  action_name text := lower(tg_op);
begin
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    row_company := old.company_id; row_project := old.project_id;
    row_client := old.client_id; row_lead := old.lead_id; row_user := old.user_id;
  else
    select * into actor from public.profiles
    where id = (select auth.uid()) and is_active is distinct from false;
    if actor.id is null then raise exception 'Active company access required' using errcode = '42501'; end if;
    if new.company_id is null then new.company_id := actor.company_id; end if;
    if new.user_id is null and tg_op = 'INSERT' then new.user_id := actor.id; end if;
    row_company := new.company_id; row_project := new.project_id;
    row_client := new.client_id; row_lead := new.lead_id; row_user := new.user_id;
  end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = row_company
    and is_active is distinct from false;
  if actor.id is null then raise exception 'Daily log company access denied' using errcode = '42501'; end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Daily log identity and author cannot be changed'
      using errcode = '42501';
  end if;

  -- Authorship is always the signed-in profile. Management may link notes to
  -- other company records, but must not create audit history as another user.
  if tg_op = 'INSERT' and row_user is distinct from actor.id then
    raise exception 'Daily logs must use the signed-in author'
      using errcode = '42501';
  end if;

  if row_project is not null and not exists (
    select 1 from public.projects project
    where project.id = row_project and project.company_id = row_company
  ) then raise exception 'Daily log project/company mismatch' using errcode = '23514'; end if;

  if row_client is not null and not exists (
    select 1 from public.clients client
    where client.id = row_client and client.company_id = row_company
  ) then raise exception 'Daily log client/company mismatch' using errcode = '23514'; end if;

  if row_lead is not null and not exists (
    select 1 from public.leads lead
    where lead.id = row_lead and lead.company_id = row_company
  ) then raise exception 'Daily log lead/company mismatch' using errcode = '23514'; end if;

  if row_user is null or not exists (
    select 1 from public.profiles worker
    where worker.id = row_user and worker.company_id = row_company
  ) then raise exception 'Daily log identity mismatch' using errcode = '23514'; end if;

  if not employee_portal_private.daily_log_access(
    case when tg_op = 'INSERT' then new.id else old.id end,
    row_company, row_project, row_client, row_lead, row_user, action_name
  ) then raise exception 'Daily log access denied' using errcode = '42501'; end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function employee_portal_private.daily_log_access(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function notification_private.people_log_identity() from public, anon, authenticated;
grant execute on function employee_portal_private.daily_log_access(uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

alter table public.project_daily_logs enable row level security;
revoke all on public.project_daily_logs from anon, authenticated, public;
grant select, insert, update, delete on public.project_daily_logs to authenticated;
grant all on public.project_daily_logs to service_role;
drop policy if exists "Allow employees to manage own logs" on public.project_daily_logs;
drop policy if exists "Company users can access project daily logs" on public.project_daily_logs;
drop policy if exists "Tenant Isolation" on public.project_daily_logs;
drop policy if exists "Allow inserting lead notes" on public.project_daily_logs;
drop policy if exists "Allow reading lead notes" on public.project_daily_logs;

drop policy if exists employee_portal_daily_logs_select on public.project_daily_logs;
create policy employee_portal_daily_logs_select on public.project_daily_logs
  for select to authenticated
  using (employee_portal_private.daily_log_access(id, company_id, project_id, client_id, lead_id, user_id, 'select'));
drop policy if exists employee_portal_daily_logs_insert on public.project_daily_logs;
create policy employee_portal_daily_logs_insert on public.project_daily_logs
  for insert to authenticated
  with check (employee_portal_private.daily_log_access(id, company_id, project_id, client_id, lead_id, user_id, 'insert'));
drop policy if exists employee_portal_daily_logs_update on public.project_daily_logs;
create policy employee_portal_daily_logs_update on public.project_daily_logs
  for update to authenticated
  using (employee_portal_private.daily_log_access(id, company_id, project_id, client_id, lead_id, user_id, 'update'))
  with check (employee_portal_private.daily_log_access(id, company_id, project_id, client_id, lead_id, user_id, 'update'));
drop policy if exists employee_portal_daily_logs_delete on public.project_daily_logs;
create policy employee_portal_daily_logs_delete on public.project_daily_logs
  for delete to authenticated
  using (employee_portal_private.daily_log_access(id, company_id, project_id, client_id, lead_id, user_id, 'delete'));

drop trigger if exists people_log_identity on public.project_daily_logs;
create trigger people_log_identity
before insert or update or delete on public.project_daily_logs
for each row execute function notification_private.people_log_identity();

-- Profile exposure: field accounts may read only their own profile. Management
-- workflows retain company-directory reads. An inactive caller may still read
-- only their own profile so AuthContext can observe is_active=false and sign out.
create or replace function employee_portal_private.profile_read_access(
  p_target uuid,
  p_company uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target = (select auth.uid())
    or exists (
      select 1 from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.company_id = p_company
        and actor.is_active is distinct from false
        and actor.role in ('owner', 'admin', 'manager', 'office')
    );
$$;

create or replace function employee_portal_private.profile_update_access(
  p_target uuid,
  p_company uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = (select auth.uid())
      and actor.company_id = p_company
      and actor.is_active is distinct from false
      and (
        actor.id = p_target
        or actor.role in ('owner', 'admin')
        or (
          actor.role = 'office'
          and employee_portal_private.module_allowed(actor, 'human_resources')
        )
      )
  );
$$;

create or replace function employee_portal_private.profile_admin_access(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = (select auth.uid())
      and actor.company_id = p_company
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin')
  );
$$;

-- RLS decides which profile rows can be updated; this trigger decides which
-- columns each workflow may change. In particular, a self-service update must
-- never be able to promote role/company/permissions or reactivate an account.
create or replace function notification_private.guard_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  if (select auth.uid()) is null then
    if coalesce(auth.role(), current_setting('role', true)) in ('anon', 'authenticated') then
      raise exception 'Authentication required' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and is_active is distinct from false;
  if actor.id is null then
    raise exception 'Active company profile required' using errcode = '42501';
  end if;

  if actor.role in ('owner', 'admin') then
    if actor.company_id is distinct from coalesce(new.company_id, old.company_id) then
      raise exception 'Profile company access denied' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.company_id is distinct from old.company_id
      or new.id is distinct from old.id
    ) then
      raise exception 'Profile identity and company cannot be changed' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE'
     and actor.role = 'office'
     and old.id is distinct from actor.id
     and actor.company_id = old.company_id
     and actor.company_id = new.company_id
     and employee_portal_private.module_allowed(actor, 'human_resources') then
    if (to_jsonb(new) - 'hourly_rate') is distinct from (to_jsonb(old) - 'hourly_rate') then
      raise exception 'Human Resources staff may change only the hourly rate'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE'
     or old.id is distinct from actor.id
     or new.id is distinct from actor.id
     or old.company_id is distinct from actor.company_id
     or new.company_id is distinct from actor.company_id
     or (to_jsonb(new) - array[
       'full_name','phone','dashboard_layout','onboarding_completed',
       'notify_action_required_only'
     ]) is distinct from (to_jsonb(old) - array[
       'full_name','phone','dashboard_layout','onboarding_completed',
       'notify_action_required_only'
     ]) then
    raise exception 'Only a company administrator can change access or another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function employee_portal_private.profile_read_access(uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.profile_update_access(uuid, uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.profile_admin_access(uuid) from public, anon, authenticated;
revoke all on function notification_private.guard_profile() from public, anon, authenticated;
grant execute on function employee_portal_private.profile_read_access(uuid, uuid) to authenticated;
grant execute on function employee_portal_private.profile_update_access(uuid, uuid) to authenticated;
grant execute on function employee_portal_private.profile_admin_access(uuid) to authenticated;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated, public;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists review_company_boundary on public.profiles;
drop policy if exists employee_portal_profiles_select_boundary on public.profiles;
create policy employee_portal_profiles_select_boundary on public.profiles
  as restrictive for select to authenticated
  using (employee_portal_private.profile_read_access(id, company_id));
drop policy if exists employee_portal_profiles_insert_boundary on public.profiles;
create policy employee_portal_profiles_insert_boundary on public.profiles
  as restrictive for insert to authenticated
  with check (employee_portal_private.profile_admin_access(company_id));
drop policy if exists employee_portal_profiles_update_boundary on public.profiles;
create policy employee_portal_profiles_update_boundary on public.profiles
  as restrictive for update to authenticated
  using (employee_portal_private.profile_update_access(id, company_id))
  with check (employee_portal_private.profile_update_access(id, company_id));
drop policy if exists employee_portal_profiles_delete_boundary on public.profiles;
create policy employee_portal_profiles_delete_boundary on public.profiles
  as restrictive for delete to authenticated
  using (employee_portal_private.profile_admin_access(company_id));

drop trigger if exists notification_guard_profile on public.profiles;
create trigger notification_guard_profile
before insert or update or delete on public.profiles
for each row execute function notification_private.guard_profile();

-- users is a legacy directory mirror. It has no client-side mutation workflow;
-- authenticated writes are therefore reserved for owner/admin maintenance while
-- reads follow the same field-vs-management visibility as profiles.
alter table public.users enable row level security;
revoke all on public.users from anon, authenticated, public;
grant select, insert, update, delete on public.users to authenticated;
grant all on public.users to service_role;
drop policy if exists "Company users can view team" on public.users;
drop policy if exists employee_portal_users_select_boundary on public.users;
create policy employee_portal_users_select_boundary on public.users
  as restrictive for select to authenticated
  using (employee_portal_private.profile_read_access(id, company_id));
drop policy if exists employee_portal_users_insert_boundary on public.users;
create policy employee_portal_users_insert_boundary on public.users
  as restrictive for insert to authenticated
  with check (employee_portal_private.profile_admin_access(company_id));
drop policy if exists employee_portal_users_update_boundary on public.users;
create policy employee_portal_users_update_boundary on public.users
  as restrictive for update to authenticated
  using (employee_portal_private.profile_admin_access(company_id))
  with check (employee_portal_private.profile_admin_access(company_id));
drop policy if exists employee_portal_users_delete_boundary on public.users;
create policy employee_portal_users_delete_boundary on public.users
  as restrictive for delete to authenticated
  using (employee_portal_private.profile_admin_access(company_id));

-- Inventory usage history is personal in the field portal. Office inventory
-- workflows retain company reporting/mutation access, while employee writes go
-- only through the atomic consume/refund SECURITY DEFINER functions installed
-- by the inventory workflow migration. Legacy name-only history is read-only
-- and visible only when the active company has exactly one matching person.
create or replace function employee_portal_private.inventory_transaction_access(
  p_company uuid,
  p_user uuid,
  p_employee_name text,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;

  if actor.role in ('owner', 'admin')
     or (
       actor.role in ('manager', 'office')
       and employee_portal_private.module_allowed(actor, 'inventory')
     ) then
    return true;
  end if;
  if not p_write
     and actor.role in ('manager', 'office')
     and employee_portal_private.module_allowed(actor, 'reports') then
    return true;
  end if;
  if p_write then return false; end if;
  if p_user = actor.id then return true; end if;

  return p_user is null
    and p_employee_name = actor.full_name
    and (
      select count(*) from public.profiles candidate
      where candidate.company_id = actor.company_id
        and candidate.is_active is distinct from false
        and candidate.full_name = p_employee_name
    ) = 1;
end;
$$;

revoke all on function employee_portal_private.inventory_transaction_access(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function employee_portal_private.inventory_transaction_access(uuid, uuid, text, boolean) to authenticated;

alter table public.inventory_transactions enable row level security;
revoke all on public.inventory_transactions from anon, authenticated, public;
grant select, insert, update, delete on public.inventory_transactions to authenticated;
grant all on public.inventory_transactions to service_role;

drop policy if exists "Company tenant transactions isolation" on public.inventory_transactions;
drop policy if exists "Enable ALL for authenticated users" on public.inventory_transactions;
drop policy if exists "Tenant Isolation" on public.inventory_transactions;

drop policy if exists employee_portal_inventory_transactions_select_boundary on public.inventory_transactions;
create policy employee_portal_inventory_transactions_select_boundary on public.inventory_transactions
  as restrictive for select to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, false));
drop policy if exists employee_portal_inventory_transactions_insert_boundary on public.inventory_transactions;
create policy employee_portal_inventory_transactions_insert_boundary on public.inventory_transactions
  as restrictive for insert to authenticated
  with check (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));
drop policy if exists employee_portal_inventory_transactions_update_boundary on public.inventory_transactions;
create policy employee_portal_inventory_transactions_update_boundary on public.inventory_transactions
  as restrictive for update to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true))
  with check (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));
drop policy if exists employee_portal_inventory_transactions_delete_boundary on public.inventory_transactions;
create policy employee_portal_inventory_transactions_delete_boundary on public.inventory_transactions
  as restrictive for delete to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));

drop policy if exists employee_portal_inventory_transactions_select on public.inventory_transactions;
create policy employee_portal_inventory_transactions_select on public.inventory_transactions
  for select to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, false));
drop policy if exists employee_portal_inventory_transactions_insert on public.inventory_transactions;
create policy employee_portal_inventory_transactions_insert on public.inventory_transactions
  for insert to authenticated
  with check (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));
drop policy if exists employee_portal_inventory_transactions_update on public.inventory_transactions;
create policy employee_portal_inventory_transactions_update on public.inventory_transactions
  for update to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true))
  with check (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));
drop policy if exists employee_portal_inventory_transactions_delete on public.inventory_transactions;
create policy employee_portal_inventory_transactions_delete on public.inventory_transactions
  for delete to authenticated
  using (employee_portal_private.inventory_transaction_access(company_id, user_id, employee_name, true));

-- Protect only companies.settings at the column-change level. Builders and
-- operational workflows may continue updating unrelated counters/fields. The
-- manager Settings route is intentional, so an entitled manager remains able
-- to save its manager-visible settings tabs; office and field roles cannot.
create or replace function employee_portal_private.company_settings_access(p_company uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = p_company
    and is_active is distinct from false;
  if actor.id is null then return false; end if;
  return actor.role in ('owner', 'admin')
    or (
      actor.role = 'manager'
      and employee_portal_private.module_allowed(actor, 'settings')
    );
end;
$$;

create or replace function employee_portal_private.company_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  manager_keys constant text[] := array[
    'quote_intro','quote_client_message','default_terms','templates',
    'tax_rate','tax_label','tax_id','currency','date_format','default_margin',
    'enable_secondary_tax','secondary_tax_label','secondary_tax_rate',
    'secondary_tax_id','automations','notifications','client_portal'
  ];
begin
  if new.settings is not distinct from old.settings or (select auth.uid()) is null then
    return new;
  end if;

  select * into actor from public.profiles
  where id = (select auth.uid()) and company_id = old.id
    and is_active is distinct from false;
  if actor.id is null then
    raise exception 'Company settings access denied' using errcode = '42501';
  end if;
  if actor.role in ('owner', 'admin') then return new; end if;

  if actor.role = 'manager'
     and employee_portal_private.module_allowed(actor, 'settings') then
    if (coalesce(new.settings, '{}'::jsonb) - manager_keys)
       is distinct from (coalesce(old.settings, '{}'::jsonb) - manager_keys) then
      raise exception 'Managers may change only manager-visible settings'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Company settings access denied' using errcode = '42501';
end;
$$;
revoke all on function employee_portal_private.company_settings_access(uuid) from public, anon, authenticated;
revoke all on function employee_portal_private.company_settings_guard() from public, anon, authenticated;
grant execute on function employee_portal_private.company_settings_access(uuid) to authenticated;
drop trigger if exists employee_portal_company_settings_guard on public.companies;
create trigger employee_portal_company_settings_guard
before update of settings on public.companies
for each row execute function employee_portal_private.company_settings_guard();

-- Storage writes are authenticated, active and bound to the caller's folder.
-- Both legacy <user>/<file> and new <company>/<user>/<file> layouts are allowed
-- so the release does not strand existing clients during path migration.
create or replace function employee_portal_private.storage_object_access(
  p_bucket text,
  p_name text,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  first_part text := split_part(p_name, '/', 1);
  second_part text := split_part(p_name, '/', 2);
  target_user text;
begin
  if p_bucket not in ('receipts', 'daily_logs') or (select auth.uid()) is null then
    return false;
  end if;
  select * into actor from public.profiles
  where id = (select auth.uid()) and is_active is distinct from false;
  if actor.id is null then return false; end if;

  if first_part = actor.company_id::text and second_part <> '' then
    target_user := second_part;
  else
    target_user := first_part;
  end if;

  if p_write then return target_user = actor.id::text; end if;
  if target_user = actor.id::text then return true; end if;
  return actor.role in ('owner', 'admin', 'manager', 'office')
    and exists (
      select 1 from public.profiles target
      where target.company_id = actor.company_id
        and target.id::text = target_user
    );
end;
$$;
revoke all on function employee_portal_private.storage_object_access(text, text, boolean) from public, anon, authenticated;
grant execute on function employee_portal_private.storage_object_access(text, text, boolean) to authenticated;

drop policy if exists "Allow public uploads to daily logs" on storage.objects;
drop policy if exists "Allow public uploads to receipts" on storage.objects;
drop policy if exists "Allow public viewing of daily logs" on storage.objects;
drop policy if exists "Allow public viewing of receipts" on storage.objects;
drop policy if exists employee_portal_media_insert on storage.objects;
create policy employee_portal_media_insert on storage.objects
  for insert to authenticated
  with check (employee_portal_private.storage_object_access(bucket_id, name, true));
drop policy if exists employee_portal_media_select on storage.objects;
create policy employee_portal_media_select on storage.objects
  for select to authenticated
  using (employee_portal_private.storage_object_access(bucket_id, name, false));
drop policy if exists employee_portal_media_update on storage.objects;
create policy employee_portal_media_update on storage.objects
  for update to authenticated
  using (employee_portal_private.storage_object_access(bucket_id, name, true))
  with check (employee_portal_private.storage_object_access(bucket_id, name, true));
drop policy if exists employee_portal_media_delete on storage.objects;
create policy employee_portal_media_delete on storage.objects
  for delete to authenticated
  using (employee_portal_private.storage_object_access(bucket_id, name, true));

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'
    ]::text[]
where id = 'receipts';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/heic','image/heif'
    ]::text[]
where id = 'daily_logs';

comment on function employee_portal_private.storage_object_access(text, text, boolean) is
  'Restricts Employee Portal media writes to an active user own folder; public download URLs remain staged for compatibility.';
