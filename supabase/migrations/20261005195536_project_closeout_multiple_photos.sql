-- Add an ordered, bounded photo collection to each deficiency while retaining
-- photo_url as the backward-compatible primary image for existing clients.

alter table public.project_closeout_items
  add column photo_urls text[];

-- The existing item guard requires an authenticated user. This one-time data
-- backfill runs as the migration role, so suspend only that guard while legacy
-- primary photos are copied into the new array. Transaction rollback restores
-- the trigger automatically if the backfill fails.
alter table public.project_closeout_items disable trigger project_closeout_items_guard;

update public.project_closeout_items
set photo_urls = array[photo_url]
where photo_urls is null;

alter table public.project_closeout_items enable trigger project_closeout_items_guard;

alter table public.project_closeout_items
  alter column photo_urls set default '{}'::text[],
  alter column photo_urls set not null;

alter table public.project_closeout_items
  add constraint project_closeout_items_photo_count
  check (cardinality(photo_urls) between 1 and 10);

create or replace function workflow_private.normalize_project_closeout_item_photos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  photo text;
begin
  -- A legacy client that only replaces photo_url replaces the primary image
  -- and preserves any additional photos. New clients write both columns.
  if tg_op = 'UPDATE'
    and new.photo_urls is not distinct from old.photo_urls
    and new.photo_url is distinct from old.photo_url then
    new.photo_urls[1] := new.photo_url;
  elsif tg_op = 'INSERT' and cardinality(coalesce(new.photo_urls, '{}'::text[])) = 0 then
    new.photo_urls := array[new.photo_url];
  else
    new.photo_url := new.photo_urls[1];
  end if;

  if cardinality(new.photo_urls) not between 1 and 10 then
    raise exception using
      errcode = '23514',
      message = 'A deficiency must include between 1 and 10 photos.';
  end if;

  foreach photo in array new.photo_urls loop
    if nullif(btrim(photo), '') is null or length(photo) > 2000 then
      raise exception using
        errcode = '23514',
        message = 'Every deficiency photo must have a valid URL.';
    end if;
  end loop;

  new.photo_url := new.photo_urls[1];
  return new;
end
$$;

revoke all on function workflow_private.normalize_project_closeout_item_photos() from public, anon, authenticated;

drop trigger if exists project_closeout_item_photos_guard on public.project_closeout_items;
create trigger project_closeout_item_photos_guard
before insert or update on public.project_closeout_items
for each row execute function workflow_private.normalize_project_closeout_item_photos();

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
        'photo_urls', i.photo_urls,
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
