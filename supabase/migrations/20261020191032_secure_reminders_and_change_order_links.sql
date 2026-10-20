-- Secure reminder dispatch and public change-order capabilities.
-- Existing companies remain opted out until an administrator explicitly saves
-- enabled automation settings.

alter table public.change_orders
  add column if not exists sent_at timestamptz,
  add column if not exists last_reminder_sent_at timestamptz;

update public.companies
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'automations', jsonb_build_object(
    'quote_enabled', false, 'quote_followup_1', 3, 'quote_followup_2', 7,
    'invoice_enabled', false, 'invoice_predue', 3,
    'invoice_overdue_1', 3, 'invoice_overdue_2', 14,
    'co_enabled', false, 'co_followup_1', 2
  )
)
where coalesce(settings, '{}'::jsonb) -> 'automations' is null;

create or replace function notification_private.invoke_reminder(p_slug text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  config jsonb;
  request_id bigint;
begin
  if p_slug not in ('quote-reminder-cron', 'invoice-reminder-cron', 'co-reminder-cron') then
    raise exception 'Unsupported reminder';
  end if;
  config := notification_private.server_config();
  if nullif(config ->> 'notification_cron_secret', '') is null
     or nullif(config ->> 'project_url', '') is null then
    raise exception 'Reminder configuration is incomplete';
  end if;
  select net.http_post(
    url := (config ->> 'project_url') || '/functions/v1/' || p_slug,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Notification-Cron-Secret', config ->> 'notification_cron_secret'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function notification_private.invoke_reminder(text) from public, anon, authenticated, service_role;

do $$
declare job record;
begin
  for job in
    select jobid from cron.job
    where jobname in ('daily-quote-reminders', 'invoke-quote-reminder-cron', 'daily-invoice-reminders', 'daily-co-reminders')
       or command like '%quote-reminder-cron%'
       or command like '%invoice-reminder-cron%'
       or command like '%co-reminder-cron%'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$$;

select cron.schedule('daily-quote-reminders', '0 8 * * *', $$select notification_private.invoke_reminder('quote-reminder-cron');$$);
select cron.schedule('daily-invoice-reminders', '5 8 * * *', $$select notification_private.invoke_reminder('invoice-reminder-cron');$$);
select cron.schedule('daily-co-reminders', '10 8 * * *', $$select notification_private.invoke_reminder('co-reminder-cron');$$);

create or replace function public.reset_quote_approval_cycle(p_quote uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare q public.quotes; actor public.profiles; result_token text; approval_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote for update;
  if not found or q.is_template is true then raise exception 'Quote unavailable' using errcode='P0002'; end if;
  select * into actor from public.profiles where id=auth.uid() and company_id=q.company_id and is_active is distinct from false;
  if not found or actor.role not in ('owner','admin','manager','office') then raise exception 'Quote sharing permission required' using errcode='42501'; end if;
  select id,approval_token into approval_id,result_token from public.quote_approvals
    where quote_id=q.id and company_id=q.company_id and coalesce(approval_status,'')<>'Revoked'
    order by created_at desc nulls last,id desc limit 1 for update;
  if result_token is null then
    result_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
    insert into public.quote_approvals(company_id,quote_id,client_id,approval_token,approval_status,sent_at)
      values(q.company_id,q.id,q.client_id,result_token,'Sent',now());
  else
    update public.quote_approvals set client_id=q.client_id,approval_status='Sent',sent_at=now(),viewed_at=null,
      signed_at=null,signer_name=null,signer_email=null,client_ip=null where id=approval_id;
  end if;
  update public.quotes set client_selected_items='{}'::jsonb,client_selected_items_json=null,client_signature=null,
    signed_at=null,signed_by=null,decline_reason=null,viewed_at=null,sent_at=current_date,
    automation_stage=0,next_follow_up_date=null where id=q.id;
  return result_token;
end;
$$;
revoke all on function public.reset_quote_approval_cycle(uuid) from public,anon,authenticated;
grant execute on function public.reset_quote_approval_cycle(uuid) to authenticated,service_role;

create table if not exists public.change_order_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  change_order_id uuid not null references public.change_orders(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'Active' check (status in ('Active','Revoked','Expired')),
  expires_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists change_order_share_links_lookup on public.change_order_share_links(change_order_id,status);
alter table public.change_order_share_links enable row level security;
revoke all on public.change_order_share_links from public,anon,authenticated;
grant all on public.change_order_share_links to service_role;

create table if not exists public.change_order_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  change_order_id uuid not null references public.change_orders(id) on delete cascade,
  share_link_id uuid not null references public.change_order_share_links(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'Open',
  created_at timestamptz not null default now()
);
alter table public.change_order_change_requests enable row level security;
create policy change_order_change_requests_tenant on public.change_order_change_requests for all to authenticated
  using (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')))
  with check (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')));
revoke all on public.change_order_change_requests from public,anon;
grant select,insert,update,delete on public.change_order_change_requests to authenticated,service_role;

create schema if not exists change_order_share_private;
revoke all on schema change_order_share_private from public,anon,authenticated,service_role;

create or replace function change_order_share_private.issue_token(p_change_order uuid,p_created_by uuid)
returns text language plpgsql security definer set search_path='' as $$
declare co public.change_orders; recipient uuid; token text;
begin
  select * into co from public.change_orders where id=p_change_order;
  if not found then raise exception 'Change order unavailable' using errcode='P0002'; end if;
  recipient:=co.client_id;
  if recipient is null then select client_id into recipient from public.projects where id=co.project_id and company_id=co.company_id; end if;
  if recipient is null then raise exception 'Change order has no client'; end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.change_order_share_links(company_id,change_order_id,client_id,token_hash,created_by)
    values(co.company_id,co.id,recipient,encode(extensions.digest(token,'sha256'),'hex'),p_created_by);
  return token;
end;
$$;
revoke all on function change_order_share_private.issue_token(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.issue_change_order_share_token(p_change_order uuid)
returns text language plpgsql security definer set search_path='' as $$
declare co public.change_orders; actor public.profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into co from public.change_orders where id=p_change_order;
  select * into actor from public.profiles where id=auth.uid() and company_id=co.company_id and is_active is distinct from false;
  if co.id is null or actor.id is null or actor.role not in ('owner','admin','manager','office')
     or not app_review_private.module_allowed('change_orders') then
    raise exception 'Change order sharing permission required' using errcode='42501';
  end if;
  return change_order_share_private.issue_token(p_change_order,auth.uid());
end;
$$;

create or replace function public.issue_change_order_reminder_share_token(p_change_order uuid)
returns text language sql security definer set search_path='' as $$
  select change_order_share_private.issue_token(p_change_order,null);
$$;

create or replace function public.get_public_change_order_bundle(p_change_order uuid,p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.change_order_share_links; co public.change_orders; recipient public.clients; company public.companies; project public.projects;
  phase_rows jsonb; item_rows jsonb;
begin
  if p_change_order is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into link from public.change_order_share_links where change_order_id=p_change_order
    and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and status='Active' and revoked_at is null
    and (expires_at is null or expires_at>clock_timestamp()) limit 1;
  if not found then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into co from public.change_orders where id=p_change_order and company_id=link.company_id
    and lower(coalesce(status,'')) not in ('draft','pending review','cancelled','void');
  if not found then raise exception 'Change order unavailable' using errcode='P0002'; end if;
  select * into recipient from public.clients where id=link.client_id and company_id=link.company_id;
  select * into company from public.companies where id=link.company_id;
  select * into project from public.projects where id=co.project_id and company_id=link.company_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'change_order_id',p.change_order_id,'phase_name',p.phase_name,
    'scope_of_work',p.scope_of_work,'show_scope_to_client',p.show_scope_to_client,'photos',p.photos,'sort_order',p.sort_order,
    'is_optional',p.is_optional,'default_selected',p.default_selected) order by p.sort_order),'[]'::jsonb) into phase_rows
    from public.change_order_phases p where p.change_order_id=co.id and p.company_id=co.company_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'change_order_id',i.change_order_id,'phase_id',i.phase_id,'name',i.name,
    'description',i.description,'quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price,'taxable',i.taxable,
    'display_order',i.display_order,'is_optional',i.is_optional,'default_selected',i.default_selected,'photo_url',i.photo_url)
    order by i.display_order),'[]'::jsonb) into item_rows from public.change_order_line_items i
    where i.change_order_id=co.id and i.company_id=co.company_id;
  return jsonb_build_object(
    'change_order',jsonb_build_object('id',co.id,'company_id',co.company_id,'project_id',co.project_id,'client_id',link.client_id,
      'title',co.title,'change_order_number',co.change_order_number,'status',co.status,'issue_date',co.issue_date,
      'client_message',co.client_message,'terms',co.terms,'overall_scope',co.overall_scope,'show_overall_scope',co.show_overall_scope,
      'hero_image_url',co.hero_image_url,'end_photos',co.end_photos,'documents',co.documents,'subtotal',co.subtotal,'tax',co.tax,'total',co.total,
      'client_selected_items_json',co.client_selected_items_json),
    'client',jsonb_build_object('id',recipient.id,'name',recipient.name,'first_name',recipient.first_name,'surname',recipient.surname,
      'formatted_name',coalesce(nullif(recipient.name,''),nullif(trim(coalesce(recipient.first_name,'')||' '||coalesce(recipient.surname,'')),''),'Client'),
      'billing_address',recipient.billing_address,'site_address',recipient.site_address),
    'company',jsonb_build_object('id',company.id,'name',company.name,'logo_url',company.logo_url,'company_logo_url',company.company_logo_url,
      'settings',jsonb_build_object('address',company.settings->'address','phone',company.settings->'phone','email',company.settings->'email',
        'website',company.settings->'website','tax_id',company.settings->'tax_id','tax_rate',company.settings->'tax_rate',
        'tax_label',company.settings->'tax_label','enable_secondary_tax',company.settings->'enable_secondary_tax',
        'secondary_tax_rate',company.settings->'secondary_tax_rate','secondary_tax_label',company.settings->'secondary_tax_label',
        'currency',company.settings->'currency','pdf',jsonb_build_object('brand_color',company.settings#>'{pdf,brand_color}'))),
    'project',case when project.id is null then null else jsonb_build_object('id',project.id,'name',project.name,'project_number',project.project_number,'site_address',project.site_address) end,
    'phases',phase_rows,'items',item_rows);
end;
$$;

create or replace function public.track_public_change_order_view(p_change_order uuid,p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare link public.change_order_share_links; co public.change_orders;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into link from public.change_order_share_links where change_order_id=p_change_order
    and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and status='Active' and revoked_at is null
    and (expires_at is null or expires_at>clock_timestamp()) limit 1 for update;
  if not found then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into co from public.change_orders where id=p_change_order and company_id=link.company_id;
  update public.change_order_share_links set first_viewed_at=coalesce(first_viewed_at,clock_timestamp()),last_viewed_at=clock_timestamp(),view_count=view_count+1 where id=link.id;
  update public.change_orders set status='Viewed' where id=co.id and status='Sent';
  begin perform invoice_share_private.request_document_notification(co.id,'co_viewed',''); exception when others then null; end;
  return true;
end;
$$;

create or replace function public.respond_to_public_change_order(p_change_order uuid,p_token text,p_action text,p_selections jsonb default '{}'::jsonb,p_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.change_order_share_links; co public.change_orders; company public.companies; subtotal numeric:=0; taxable numeric:=0;
  primary_rate numeric:=0; secondary_rate numeric:=0; total_tax numeric:=0; action text:=lower(coalesce(p_action,''));
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into link from public.change_order_share_links where change_order_id=p_change_order
    and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and status='Active' and revoked_at is null
    and (expires_at is null or expires_at>clock_timestamp()) limit 1;
  if not found then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into co from public.change_orders where id=p_change_order and company_id=link.company_id for update;
  if co.status not in ('Sent','Viewed') then raise exception 'This change order already has a recorded decision' using errcode='40001'; end if;
  if action='approve' then
    if p_selections is null or jsonb_typeof(p_selections)<>'object' then raise exception 'Selections are invalid'; end if;
    if exists(select 1 from jsonb_each(p_selections) e where jsonb_typeof(e.value)<>'boolean') then raise exception 'Selections are invalid'; end if;
    if exists(select 1 from jsonb_object_keys(p_selections) k where not exists(select 1 from public.change_order_phases p where p.id::text=k and p.change_order_id=co.id) and not exists(select 1 from public.change_order_line_items i where i.id::text=k and i.change_order_id=co.id)) then raise exception 'Selections are invalid'; end if;
    select coalesce(sum(i.quantity*i.unit_price),0),coalesce(sum(case when i.taxable then i.quantity*i.unit_price else 0 end),0)
      into subtotal,taxable from public.change_order_line_items i join public.change_order_phases p on p.id=i.phase_id
      where i.change_order_id=co.id and p.change_order_id=co.id
        and (not p.is_optional or coalesce((p_selections->>p.id::text)::boolean,p.default_selected,false))
        and (not i.is_optional or coalesce((p_selections->>i.id::text)::boolean,i.default_selected,false));
    select * into company from public.companies where id=co.company_id;
    primary_rate:=coalesce((company.settings->>'tax_rate')::numeric,5)/100;
    if coalesce((company.settings->>'enable_secondary_tax')::boolean,false) then secondary_rate:=coalesce((company.settings->>'secondary_tax_rate')::numeric,0)/100; end if;
    total_tax:=round(taxable*(primary_rate+secondary_rate),2);
    update public.change_orders set status='Approved',subtotal=subtotal,tax=total_tax,total=subtotal+total_tax,
      client_selected_items_json=p_selections::text,next_follow_up_date=null where id=co.id;
    begin perform invoice_share_private.request_document_notification(co.id,'co_approved',''); exception when others then null; end;
  elsif action='decline' then
    update public.change_orders set status='Declined',decline_reason=nullif(left(trim(coalesce(p_message,'')),2000),''),next_follow_up_date=null where id=co.id;
  elsif action='request_changes' then
    if char_length(trim(coalesce(p_message,''))) not between 1 and 2000 then raise exception 'Describe the requested changes'; end if;
    insert into public.change_order_change_requests(company_id,change_order_id,share_link_id,message) values(co.company_id,co.id,link.id,trim(p_message));
    update public.change_orders set status='Pending Review',next_follow_up_date=null where id=co.id;
    begin perform invoice_share_private.request_document_notification(co.id,'change_order_requested',trim(p_message)); exception when others then null; end;
  else raise exception 'Unsupported response'; end if;
  return jsonb_build_object('success',true,'status',(select status from public.change_orders where id=co.id));
end;
$$;

create or replace function public.request_document_notification(p_document uuid,p_event text,p_message text default '')
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_event in ('invoice_viewed','co_viewed','co_approved','change_order_requested') and coalesce(auth.role(),'anon')='anon' then
    raise exception 'Notification requires a valid secure link' using errcode='42501';
  end if;
  return invoice_share_private.request_document_notification(p_document,p_event,p_message);
end;
$$;

do $$ declare policy_row record; begin
  for policy_row in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('change_orders','change_order_phases','change_order_line_items') loop
    execute format('drop policy %I on public.%I',policy_row.policyname,policy_row.tablename);
  end loop;
end $$;
create policy change_orders_tenant on public.change_orders for all to authenticated
  using (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')))
  with check (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')));
create policy change_order_phases_tenant on public.change_order_phases for all to authenticated
  using (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')))
  with check (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')));
create policy change_order_line_items_tenant on public.change_order_line_items for all to authenticated
  using (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')))
  with check (company_id=(select app_review_private.member_company()) and (select app_review_private.module_allowed('change_orders')));
revoke all on public.change_orders,public.change_order_phases,public.change_order_line_items from public,anon;
grant select,insert,update,delete on public.change_orders,public.change_order_phases,public.change_order_line_items to authenticated,service_role;

revoke all on function public.issue_change_order_share_token(uuid) from public,anon,authenticated;
grant execute on function public.issue_change_order_share_token(uuid) to authenticated,service_role;
revoke all on function public.issue_change_order_reminder_share_token(uuid) from public,anon,authenticated;
grant execute on function public.issue_change_order_reminder_share_token(uuid) to service_role;
revoke all on function public.get_public_change_order_bundle(uuid,text) from public,anon,authenticated;
grant execute on function public.get_public_change_order_bundle(uuid,text) to anon,authenticated,service_role;
revoke all on function public.track_public_change_order_view(uuid,text) from public,anon,authenticated;
grant execute on function public.track_public_change_order_view(uuid,text) to anon,authenticated,service_role;
revoke all on function public.respond_to_public_change_order(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.respond_to_public_change_order(uuid,text,text,jsonb,text) to anon,authenticated,service_role;
revoke all on function public.request_document_notification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_document_notification(uuid,text,text) to anon,authenticated,service_role;
