-- Mobile-first project deficiency walkthroughs and a narrow client-portal view.

create table public.project_closeouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  client_id uuid not null references public.clients(id),
  title text not null default 'Project deficiency walkthrough' check (length(btrim(title)) between 1 and 200),
  walkthrough_date date not null default current_date,
  notes text not null default '' check (length(notes) <= 10000),
  status text not null default 'Draft' check (status in ('Draft','Published','Completed')),
  prepared_by_name text not null default '' check (length(prepared_by_name) <= 200),
  published_at timestamptz,
  completed_at timestamptz,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  subcontractors_sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_closeout_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  closeout_id uuid not null references public.project_closeouts(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  sort_order integer not null default 0 check (sort_order >= 0),
  photo_url text not null check (length(btrim(photo_url)) between 1 and 2000),
  deficiency_type text not null default 'General' check (length(btrim(deficiency_type)) between 1 and 100),
  description text not null default '' check (length(description) <= 5000),
  assigned_vendor_id uuid references public.vendors(id) on delete set null,
  due_date date,
  status text not null default 'Open' check (status in ('Open','In Progress','Ready for Review','Complete')),
  subcontractor_sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_closeouts_project_recent on public.project_closeouts(company_id, project_id, walkthrough_date desc, created_at desc);
create index project_closeouts_client_portal on public.project_closeouts(client_id, published_at desc) where status in ('Published','Completed');
create index project_closeouts_project_fk on public.project_closeouts(project_id);
create index project_closeouts_created_by_fk on public.project_closeouts(created_by);
create index project_closeouts_updated_by_fk on public.project_closeouts(updated_by);
create index project_closeout_items_closeout_order on public.project_closeout_items(closeout_id, sort_order, created_at);
create index project_closeout_items_vendor on public.project_closeout_items(company_id, assigned_vendor_id) where assigned_vendor_id is not null;
create index project_closeout_items_project_fk on public.project_closeout_items(project_id);
create index project_closeout_items_vendor_fk on public.project_closeout_items(assigned_vendor_id);
create index project_closeout_items_created_by_fk on public.project_closeout_items(created_by);
create index project_closeout_items_updated_by_fk on public.project_closeout_items(updated_by);

alter table public.project_closeouts enable row level security;
alter table public.project_closeout_items enable row level security;
revoke all on public.project_closeouts, public.project_closeout_items from public, anon, authenticated;
grant select, insert, update, delete on public.project_closeouts, public.project_closeout_items to authenticated;
grant all on public.project_closeouts, public.project_closeout_items to service_role;

create policy project_closeouts_staff_read on public.project_closeouts for select to authenticated
  using (workflow_private.staff_access(company_id, project_id));
create policy project_closeouts_staff_insert on public.project_closeouts for insert to authenticated
  with check (workflow_private.staff_access(company_id, project_id));
create policy project_closeouts_staff_update on public.project_closeouts for update to authenticated
  using (workflow_private.staff_access(company_id, project_id)) with check (workflow_private.staff_access(company_id, project_id));
create policy project_closeouts_staff_delete on public.project_closeouts for delete to authenticated
  using (workflow_private.staff_access(company_id, project_id));

create policy project_closeout_items_staff_read on public.project_closeout_items for select to authenticated
  using (workflow_private.staff_access(company_id, project_id));
create policy project_closeout_items_staff_insert on public.project_closeout_items for insert to authenticated
  with check (workflow_private.staff_access(company_id, project_id));
create policy project_closeout_items_staff_update on public.project_closeout_items for update to authenticated
  using (workflow_private.staff_access(company_id, project_id)) with check (workflow_private.staff_access(company_id, project_id));
create policy project_closeout_items_staff_delete on public.project_closeout_items for delete to authenticated
  using (workflow_private.staff_access(company_id, project_id));

create or replace function workflow_private.guard_project_closeout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare project_row public.projects; author_row public.profiles;
begin
  select * into project_row from public.projects where id = new.project_id and company_id = new.company_id;
  if not found then raise exception 'Project does not belong to this company'; end if;
  if project_row.client_id is null then raise exception 'Assign a client to the project before creating a closeout'; end if;
  new.client_id := project_row.client_id;
  select * into author_row from public.profiles
    where id = (select auth.uid()) and company_id = new.company_id and is_active is distinct from false;
  if not found or not workflow_private.staff_access(new.company_id, new.project_id) then
    raise exception 'Active project access is required';
  end if;
  new.updated_by := author_row.id;
  new.prepared_by_name := coalesce(nullif(btrim(new.prepared_by_name), ''), nullif(btrim(author_row.full_name), ''), 'Project team');
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_by := author_row.id;
    new.created_at := now();
  elsif (new.id, new.company_id, new.project_id, new.client_id, new.created_by, new.created_at)
    is distinct from (old.id, old.company_id, old.project_id, old.client_id, old.created_by, old.created_at) then
    raise exception 'Project closeout ownership is immutable';
  end if;
  if new.status in ('Published','Completed') then new.published_at := coalesce(new.published_at, now());
  else new.published_at := null; end if;
  if new.status = 'Completed' then new.completed_at := coalesce(new.completed_at, now());
  else new.completed_at := null; end if;
  return new;
end $$;
revoke all on function workflow_private.guard_project_closeout() from public, anon, authenticated;
create trigger project_closeouts_guard before insert or update on public.project_closeouts
  for each row execute function workflow_private.guard_project_closeout();

create or replace function workflow_private.guard_project_closeout_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare closeout_row public.project_closeouts; vendor_company uuid; author_row public.profiles;
begin
  select * into closeout_row from public.project_closeouts where id = new.closeout_id;
  if not found or closeout_row.company_id <> new.company_id or closeout_row.project_id <> new.project_id then
    raise exception 'Closeout item does not belong to this project';
  end if;
  if new.assigned_vendor_id is not null then
    select company_id into vendor_company from public.vendors where id = new.assigned_vendor_id;
    if not found or vendor_company is distinct from new.company_id then raise exception 'Subcontractor does not belong to this company'; end if;
  end if;
  select * into author_row from public.profiles
    where id = (select auth.uid()) and company_id = new.company_id and is_active is distinct from false;
  if not found or not workflow_private.staff_access(new.company_id, new.project_id) then
    raise exception 'Active project access is required';
  end if;
  new.updated_by := author_row.id;
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_by := author_row.id;
    new.created_at := now();
  elsif (new.id, new.company_id, new.closeout_id, new.project_id, new.created_by, new.created_at)
    is distinct from (old.id, old.company_id, old.closeout_id, old.project_id, old.created_by, old.created_at) then
    raise exception 'Closeout item ownership is immutable';
  end if;
  return new;
end $$;
revoke all on function workflow_private.guard_project_closeout_item() from public, anon, authenticated;
create trigger project_closeout_items_guard before insert or update on public.project_closeout_items
  for each row execute function workflow_private.guard_project_closeout_item();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-closeouts', 'project-closeouts', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy project_closeout_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-closeouts' and (storage.foldername(name))[1] = (
    select company_id::text from public.profiles where id = (select auth.uid()) and is_active is distinct from false
  ));
create policy project_closeout_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'project-closeouts' and (storage.foldername(name))[1] = (
    select company_id::text from public.profiles where id = (select auth.uid()) and is_active is distinct from false
  )) with check (bucket_id = 'project-closeouts' and (storage.foldername(name))[1] = (
    select company_id::text from public.profiles where id = (select auth.uid()) and is_active is distinct from false
  ));
create policy project_closeout_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-closeouts' and (storage.foldername(name))[1] = (
    select company_id::text from public.profiles where id = (select auth.uid()) and is_active is distinct from false
  ));

create or replace function workflow_private.client_portal_closeouts(p_client uuid)
returns table (
  id uuid, project_id uuid, project_name text, project_number text, site_address text,
  title text, walkthrough_date date, notes text, status text, prepared_by_name text,
  published_at timestamptz, completed_at timestamptz, items jsonb
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.project_id, p.name, p.project_number, p.site_address,
    c.title, c.walkthrough_date, c.notes, c.status, c.prepared_by_name,
    c.published_at, c.completed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'sort_order', i.sort_order, 'photo_url', i.photo_url,
        'deficiency_type', i.deficiency_type, 'description', i.description,
        'status', i.status, 'due_date', i.due_date, 'vendor_name', v.name
      ) order by i.sort_order, i.created_at)
      from public.project_closeout_items i
      left join public.vendors v on v.id = i.assigned_vendor_id and v.company_id = i.company_id
      where i.closeout_id = c.id and i.company_id = c.company_id
    ), '[]'::jsonb)
  from public.project_closeouts c
  join public.projects p on p.id = c.project_id and p.company_id = c.company_id
  where c.client_id = p_client and p.client_id = p_client and c.status in ('Published','Completed')
  order by c.walkthrough_date desc, c.published_at desc, c.id desc
$$;
revoke all on function workflow_private.client_portal_closeouts(uuid) from public, anon, authenticated;
grant execute on function workflow_private.client_portal_closeouts(uuid) to anon, authenticated;

create or replace function public.get_client_portal_closeouts(p_client uuid)
returns table (
  id uuid, project_id uuid, project_name text, project_number text, site_address text,
  title text, walkthrough_date date, notes text, status text, prepared_by_name text,
  published_at timestamptz, completed_at timestamptz, items jsonb
)
language sql stable security invoker set search_path = '' as $$
  select * from workflow_private.client_portal_closeouts(p_client)
$$;
revoke all on function public.get_client_portal_closeouts(uuid) from public;
grant execute on function public.get_client_portal_closeouts(uuid) to anon, authenticated;
