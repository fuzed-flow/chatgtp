-- Keep the parent closeout status consistent with its deficiency items.
-- Existing completed closeouts with unresolved (or no) items are safely
-- returned to Published so they remain client-visible without claiming that
-- the walkthrough is finished.
alter table public.project_closeouts disable trigger project_closeouts_guard;

update public.project_closeouts c
set status = 'Published',
    published_at = coalesce(c.published_at, now()),
    completed_at = null,
    updated_at = clock_timestamp()
where c.status = 'Completed'
  and (
    not exists (
      select 1 from public.project_closeout_items i
      where i.closeout_id = c.id and i.company_id = c.company_id
    )
    or exists (
      select 1 from public.project_closeout_items i
      where i.closeout_id = c.id
        and i.company_id = c.company_id
        and i.status <> 'Complete'
    )
  );

alter table public.project_closeouts enable trigger project_closeouts_guard;

create or replace function workflow_private.guard_project_closeout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project_row public.projects;
  author_row public.profiles;
  item_count integer;
  unresolved_count integer;
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

  if new.status = 'Completed' then
    select count(*), count(*) filter (where status <> 'Complete')
      into item_count, unresolved_count
    from public.project_closeout_items
    where closeout_id = new.id and company_id = new.company_id;

    if item_count = 0 then
      raise exception using
        errcode = '23514',
        message = 'Add at least one deficiency before marking the closeout complete.';
    end if;
    if unresolved_count > 0 then
      raise exception using
        errcode = '23514',
        message = format('Complete all deficiencies before marking the closeout complete. %s unresolved item(s) remain.', unresolved_count);
    end if;
  end if;

  if new.status in ('Published','Completed') then new.published_at := coalesce(new.published_at, now());
  else new.published_at := null; end if;
  if new.status = 'Completed' then new.completed_at := coalesce(new.completed_at, now());
  else new.completed_at := null; end if;
  return new;
end $$;
revoke all on function workflow_private.guard_project_closeout() from public, anon, authenticated;

-- Lock the closeout row while an item is changed. This serializes item edits
-- with completion and prevents a race that could leave unresolved work under
-- a Completed parent. Making an item unresolved intentionally reopens the
-- client-visible checklist as Published; edits that remain Complete are valid.
create or replace function workflow_private.guard_project_closeout_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  closeout_row public.project_closeouts;
  vendor_company uuid;
  author_row public.profiles;
begin
  select * into closeout_row
  from public.project_closeouts
  where id = new.closeout_id
  for update;
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

  if closeout_row.status = 'Completed' and new.status <> 'Complete' then
    update public.project_closeouts
    set status = 'Published'
    where id = closeout_row.id and company_id = closeout_row.company_id;
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

create or replace function workflow_private.reopen_empty_completed_closeout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  closeout_status text;
begin
  select status into closeout_status
  from public.project_closeouts
  where id = old.closeout_id and company_id = old.company_id
  for update;

  if closeout_status = 'Completed' and not exists (
    select 1 from public.project_closeout_items
    where closeout_id = old.closeout_id and company_id = old.company_id
  ) then
    update public.project_closeouts
    set status = 'Published'
    where id = old.closeout_id and company_id = old.company_id;
  end if;
  return old;
end $$;
revoke all on function workflow_private.reopen_empty_completed_closeout() from public, anon, authenticated;

drop trigger if exists project_closeout_items_reopen_empty on public.project_closeout_items;
create trigger project_closeout_items_reopen_empty
after delete on public.project_closeout_items
for each row execute function workflow_private.reopen_empty_completed_closeout();
