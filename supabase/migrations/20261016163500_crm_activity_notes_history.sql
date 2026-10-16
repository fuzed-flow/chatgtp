-- Keep system-generated document deliveries out of conversational history while
-- preserving their audit trail for the compact CRM activity feed.
alter table public.client_communications
  add column if not exists delivery_kind text,
  add column if not exists related_type text,
  add column if not exists related_id uuid,
  add column if not exists related_label text;

do $$ begin
  alter table public.client_communications
    add constraint client_communications_delivery_kind_check
    check (delivery_kind is null or delivery_kind in ('document','receipt','followup','communication','company_notification'));
exception when duplicate_object then null;
end $$;

update public.client_communications c
set delivery_kind = d.kind,
    related_type = d.related_type,
    related_id = d.related_id
from notification_private.outbound_deliveries d
where c.company_id = d.company_id
  and c.provider = d.provider
  and c.provider_message_id = d.provider_id
  and not d.is_copy
  and (c.delivery_kind is null or c.related_type is null or c.related_id is null);

update public.client_communications c
set related_label = coalesce(
  case c.related_type
    when 'Quote' then (select q.quote_number from public.quotes q where q.id = c.related_id and q.company_id = c.company_id)
    when 'Invoice' then (select i.invoice_number from public.invoices i where i.id = c.related_id and i.company_id = c.company_id)
    when 'ChangeOrder' then (select o.change_order_number from public.change_orders o where o.id = c.related_id and o.company_id = c.company_id)
    when 'Lead' then (select l.contact_name from public.leads l where l.id = c.related_id and l.company_id = c.company_id)
    when 'Message' then (select cl.name from public.clients cl where cl.id = c.related_id and cl.company_id = c.company_id)
    else null
  end,
  c.subject
)
where c.delivery_kind is not null
  and nullif(trim(c.related_label), '') is null;

create index if not exists client_communications_lead_activity
  on public.client_communications(company_id, lead_id, created_at desc)
  where delivery_kind in ('document','receipt','followup');
create index if not exists client_communications_client_activity
  on public.client_communications(company_id, client_id, created_at desc)
  where delivery_kind in ('document','receipt','followup');

-- Lead and client notes were historically saved through two UI paths. Copy the
-- CRM-only daily-log rows into the canonical notes table without deleting the
-- original records, using the original UUID so the migration is idempotent.
-- Temporarily pause note alert triggers so historical rows do not notify staff.
do $$ begin
  if exists(select 1 from pg_trigger where tgrelid='public.notes'::regclass and tgname='notification_events') then
    execute 'alter table public.notes disable trigger notification_events';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.notes'::regclass and tgname='notification_amendment_events') then
    execute 'alter table public.notes disable trigger notification_amendment_events';
  end if;
end $$;

insert into public.notes(
  id, company_id, related_type, related_id, content, category,
  author_name, created_at, is_pinned, mention_user_ids
)
select
  l.id,
  l.company_id,
  case when l.lead_id is not null then 'Lead' else 'Client' end,
  coalesce(l.lead_id, l.client_id),
  coalesce(nullif(trim(l.summary), ''), 'Imported note'),
  coalesce(nullif(trim(l.category), ''), 'General'),
  coalesce(p.full_name, 'Team Member'),
  coalesce(l.created_at, l.date::timestamptz, now()),
  false,
  coalesce(l.mention_user_ids, '{}'::uuid[])
from public.project_daily_logs l
left join public.profiles p on p.id = l.user_id and p.company_id = l.company_id
where l.company_id is not null
  and (l.lead_id is not null or l.client_id is not null)
on conflict (id) do nothing;

do $$ begin
  if exists(select 1 from pg_trigger where tgrelid='public.notes'::regclass and tgname='notification_events') then
    execute 'alter table public.notes enable trigger notification_events';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.notes'::regclass and tgname='notification_amendment_events') then
    execute 'alter table public.notes enable trigger notification_amendment_events';
  end if;
end $$;
