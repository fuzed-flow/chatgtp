-- Branded client project updates, with authenticated staff authoring and a
-- deliberately narrow public portal projection.

create table public.client_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  client_id uuid not null references public.clients(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  update_date date not null default current_date,
  summary text not null default '' check (length(summary) <= 10000),
  completed_work text[] not null default '{}',
  upcoming_work text[] not null default '{}',
  client_notes text not null default '' check (length(client_notes) <= 10000),
  status text not null default 'Draft' check (status in ('Draft','Published')),
  prepared_by_name text not null default '' check (length(prepared_by_name) <= 200),
  published_at timestamptz,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(completed_work) <= 50),
  check (cardinality(upcoming_work) <= 50)
);

create index client_updates_project_recent
  on public.client_updates(company_id, project_id, update_date desc, created_at desc);
create index client_updates_client_published
  on public.client_updates(client_id, published_at desc)
  where status = 'Published';
create index client_updates_project_fk on public.client_updates(project_id);
create index client_updates_created_by_fk on public.client_updates(created_by);
create index client_updates_updated_by_fk on public.client_updates(updated_by);

alter table public.client_updates enable row level security;
revoke all on public.client_updates from public, anon, authenticated;
grant select, insert, update, delete on public.client_updates to authenticated;
grant all on public.client_updates to service_role;

create policy client_updates_staff_read on public.client_updates
  for select to authenticated
  using (workflow_private.staff_access(company_id, project_id));
create policy client_updates_staff_insert on public.client_updates
  for insert to authenticated
  with check (workflow_private.staff_access(company_id, project_id));
create policy client_updates_staff_update on public.client_updates
  for update to authenticated
  using (workflow_private.staff_access(company_id, project_id))
  with check (workflow_private.staff_access(company_id, project_id));
create policy client_updates_staff_delete on public.client_updates
  for delete to authenticated
  using (workflow_private.staff_access(company_id, project_id));

create or replace function workflow_private.guard_client_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_row public.projects;
  author_row public.profiles;
begin
  select * into project_row
  from public.projects
  where id = new.project_id and company_id = new.company_id;
  if not found then raise exception 'Project does not belong to this company'; end if;
  if project_row.client_id is null then raise exception 'Assign a client to the project before creating a client update'; end if;
  new.client_id := project_row.client_id;

  select * into author_row
  from public.profiles
  where id = (select auth.uid()) and company_id = new.company_id and is_active is distinct from false;
  if not found or not workflow_private.staff_access(new.company_id, new.project_id) then
    raise exception 'Active project access is required';
  end if;

  new.updated_by := author_row.id;
  new.prepared_by_name := coalesce(nullif(btrim(new.prepared_by_name), ''), nullif(btrim(author_row.full_name), ''), 'Project team');
  new.completed_work := array(select btrim(item) from unnest(coalesce(new.completed_work, '{}')) item where btrim(item) <> '');
  new.upcoming_work := array(select btrim(item) from unnest(coalesce(new.upcoming_work, '{}')) item where btrim(item) <> '');
  new.updated_at := clock_timestamp();

  if tg_op = 'INSERT' then
    new.created_by := author_row.id;
    new.created_at := now();
  elsif (new.id, new.company_id, new.project_id, new.client_id, new.created_by, new.created_at)
    is distinct from (old.id, old.company_id, old.project_id, old.client_id, old.created_by, old.created_at) then
    raise exception 'Client update ownership is immutable';
  end if;

  if new.status = 'Published' then
    new.published_at := coalesce(new.published_at, now());
  else
    new.published_at := null;
  end if;
  return new;
end
$$;
revoke all on function workflow_private.guard_client_update() from public, anon, authenticated;
create trigger client_updates_guard
  before insert or update on public.client_updates
  for each row execute function workflow_private.guard_client_update();

create or replace function workflow_private.client_portal_updates(p_client uuid)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  project_number text,
  site_address text,
  title text,
  update_date date,
  summary text,
  completed_work text[],
  upcoming_work text[],
  client_notes text,
  prepared_by_name text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.project_id, p.name, p.project_number, p.site_address,
    u.title, u.update_date, u.summary, u.completed_work, u.upcoming_work,
    u.client_notes, u.prepared_by_name, u.published_at
  from public.client_updates u
  join public.projects p on p.id = u.project_id and p.company_id = u.company_id
  where u.client_id = p_client and p.client_id = p_client and u.status = 'Published'
  order by u.update_date desc, u.published_at desc, u.id desc
$$;
revoke all on function workflow_private.client_portal_updates(uuid) from public, anon, authenticated;
grant execute on function workflow_private.client_portal_updates(uuid) to anon, authenticated;

create or replace function public.get_client_portal_updates(p_client uuid)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  project_number text,
  site_address text,
  title text,
  update_date date,
  summary text,
  completed_work text[],
  upcoming_work text[],
  client_notes text,
  prepared_by_name text,
  published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from workflow_private.client_portal_updates(p_client) $$;
revoke all on function public.get_client_portal_updates(uuid) from public;
grant execute on function public.get_client_portal_updates(uuid) to anon, authenticated;
