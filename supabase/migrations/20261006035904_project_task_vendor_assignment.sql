-- Project tasks can be assigned to a saved subcontractor without weakening tenant isolation.
alter table public.project_tasks
  add column if not exists vendor_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_tasks'::regclass
      and conname = 'project_tasks_vendor_id_fkey'
  ) then
    alter table public.project_tasks
      add constraint project_tasks_vendor_id_fkey
      foreign key (vendor_id) references public.vendors(id) on delete set null;
  end if;
end
$$;

create index if not exists project_tasks_vendor_company
  on public.project_tasks(company_id, vendor_id)
  where vendor_id is not null;

create index if not exists project_tasks_vendor_fk
  on public.project_tasks(vendor_id)
  where vendor_id is not null;

create schema if not exists app_review_private;

create or replace function app_review_private.validate_project_task_vendor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vendor_id is null then
    return new;
  end if;

  if new.company_id is null or not exists (
    select 1
    from public.vendors vendor
    where vendor.id = new.vendor_id
      and vendor.company_id = new.company_id
  ) then
    raise exception 'Subcontractor must belong to the project task company'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function app_review_private.validate_project_task_vendor() from public, anon, authenticated;

drop trigger if exists project_task_vendor_company_guard on public.project_tasks;
create trigger project_task_vendor_company_guard
before insert or update of vendor_id, company_id on public.project_tasks
for each row execute function app_review_private.validate_project_task_vendor();

comment on column public.project_tasks.vendor_id is
  'Optional same-company subcontractor or vendor responsible for this project task.';
