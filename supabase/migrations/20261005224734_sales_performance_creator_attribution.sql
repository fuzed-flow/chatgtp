-- Sales ownership is attributed to the person who created the lead. Assignment
-- remains an operational responsibility field and must not rewrite attribution.

alter table public.leads
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;

-- A one-person company has only one safe historical attribution. Multi-user
-- companies remain explicitly unknown rather than being guessed from assignee.
with single_profile_companies as (
  select company_id, min(id::text)::uuid as profile_id
  from public.profiles
  group by company_id
  having count(*) = 1
)
update public.leads l
set created_by_user_id = single.profile_id
from single_profile_companies single
where l.company_id = single.company_id
  and l.created_by_user_id is null;

create index if not exists sales_leads_creator
  on public.leads(company_id, created_by_user_id, created_at desc);

create or replace function sales_private.lead_creator_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  creator_company uuid;
begin
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 and new.created_by_user_id is null then
      return new;
    end if;
    new.created_by_user_id := old.created_by_user_id;
    return new;
  end if;

  if actor is not null then
    select company_id into creator_company
    from public.profiles
    where id = actor
      and is_active is distinct from false;

    if creator_company is distinct from new.company_id then
      raise exception 'Lead creator must belong to this company' using errcode = '23514';
    end if;
    new.created_by_user_id := actor;
  elsif new.created_by_user_id is not null then
    select company_id into creator_company
    from public.profiles
    where id = new.created_by_user_id;

    if creator_company is distinct from new.company_id then
      raise exception 'Lead creator must belong to this company' using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

revoke all on function sales_private.lead_creator_before_write() from public, anon, authenticated;

drop trigger if exists sales_lead_creator_before_write on public.leads;
create trigger sales_lead_creator_before_write
before insert or update of created_by_user_id on public.leads
for each row execute function sales_private.lead_creator_before_write();

update public.sales_activities activity
set user_id = lead.created_by_user_id
from public.leads lead
where activity.lead_id = lead.id
  and activity.activity_type = 'lead_created'
  and activity.user_id is null
  and lead.created_by_user_id is not null;

comment on column public.leads.created_by_user_id is
  'Immutable creator attribution used for sales performance. Assignment is tracked separately.';
