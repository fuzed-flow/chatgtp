-- Additive stage: deploy before the new app and public-project function.
alter table public.projects add column if not exists contractor_share_token uuid not null default gen_random_uuid();
create unique index if not exists projects_contractor_share_token_idx on public.projects(contractor_share_token);
alter table public.quotes add column if not exists deposit_paid_amount numeric not null default 0;
alter table public.payments add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.payments add column if not exists stripe_checkout_session_id text;
create unique index if not exists payments_stripe_checkout_session_idx on public.payments(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists payments_quote_id_idx on public.payments(quote_id);
update public.payments p set company_id=i.company_id from public.invoices i where p.invoice_id=i.id and p.company_id is null;
-- Legacy Paid quotes had no separate deposit balance. Preserve that historical credit without fabricating a cash receipt.
update public.quotes set deposit_paid_amount=least(coalesce(deposit_amount,0),coalesce(total,0)) where status='Paid' and deposit_paid_amount=0;

create or replace function public.record_checkout_payment(p_session text,p_company uuid,p_invoice uuid,p_quote uuid,p_amount numeric,p_date date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.invoices; q public.quotes; paid numeric; schedule_record record; remaining numeric; allocated numeric;
begin
 if p_session is null or p_amount is null or p_amount<=0 or (p_invoice is null)=(p_quote is null) then raise exception 'Invalid payment'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 if exists(select 1 from public.payments where stripe_checkout_session_id=p_session) then return jsonb_build_object('duplicate',true); end if;
 if p_quote is not null then
  select * into q from public.quotes where id=p_quote and company_id=p_company for update;
  if not found then raise exception 'Quote company mismatch'; end if;
  select * into i from public.invoices where quote_id=p_quote and company_id=p_company and status not in ('Cancelled','Canceled') order by created_at,id limit 1 for update;
  insert into public.payments(company_id,invoice_id,quote_id,amount,payment_method,notes,payment_date,stripe_checkout_session_id)
   values(p_company,i.id,p_quote,p_amount,'Stripe','Quote deposit confirmed by Stripe',p_date,p_session);
  update public.quotes set deposit_paid_amount=coalesce(deposit_paid_amount,0)+p_amount where id=p_quote;
 else
  select * into i from public.invoices where id=p_invoice and company_id=p_company for update;
  if not found then raise exception 'Invoice company mismatch'; end if;
  insert into public.payments(company_id,invoice_id,amount,payment_method,notes,payment_date,stripe_checkout_session_id)
   values(p_company,p_invoice,p_amount,'Stripe','Payment confirmed by Stripe',p_date,p_session);
 end if;
 if i.id is not null then
  paid:=coalesce(i.amount_paid,0)+p_amount;
  update public.invoices set amount_paid=paid,balance_due=greatest(0,coalesce(total,0)-paid),status=case when paid>=coalesce(total,0) then 'Paid' else 'Partially Paid' end where id=i.id;
  remaining:=p_amount;
  for schedule_record in select * from public.invoice_payment_schedules where invoice_id=i.id and company_id=p_company order by sort_order,id for update loop
   allocated:=least(remaining,greatest(0,case when schedule_record.amount_type='percentage' then coalesce(i.total,0)*coalesce(schedule_record.percentage,0)/100 else coalesce(schedule_record.amount,0) end-coalesce(schedule_record.amount_paid,0)));
   if allocated>0 then
    update public.invoice_payment_schedules set amount_paid=coalesce(amount_paid,0)+allocated,status=case when coalesce(amount_paid,0)+allocated>=case when amount_type='percentage' then coalesce(i.total,0)*coalesce(percentage,0)/100 else coalesce(amount,0) end then 'Paid' else 'Partial' end where id=schedule_record.id;
    remaining:=remaining-allocated;
   end if;
  end loop;
 end if;
 return jsonb_build_object('duplicate',false,'invoice_id',i.id,'quote_id',p_quote);
end $$;
revoke all on function public.record_checkout_payment(text,uuid,uuid,uuid,numeric,date) from public,anon,authenticated;
grant execute on function public.record_checkout_payment(text,uuid,uuid,uuid,numeric,date) to service_role;

create schema if not exists app_review_private;
revoke all on schema app_review_private from public;
create or replace function app_review_private.invoice_deposit_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare credit numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if new.quote_id is null then return new; end if;
 if tg_when='BEFORE' then
  if not exists(select 1 from public.invoices where quote_id=new.quote_id and company_id=new.company_id and status not in ('Cancelled','Canceled')) then
   select coalesce(deposit_paid_amount,0) into credit from public.quotes where id=new.quote_id and company_id=new.company_id;
   if coalesce(credit,0)>0 then
    new.amount_paid:=greatest(coalesce(new.amount_paid,0),credit);
    new.balance_due:=greatest(0,coalesce(new.total,0)-new.amount_paid);
    if new.balance_due=0 then new.status:='Paid'; else new.status:='Partially Paid'; end if;
   end if;
  end if;
 else
  update public.payments set invoice_id=new.id where quote_id=new.quote_id and company_id=new.company_id and invoice_id is null;
 end if;
 return new;
end $$;
create trigger invoice_deposit_before before insert on public.invoices for each row execute function app_review_private.invoice_deposit_credit();
create trigger invoice_deposit_after after insert on public.invoices for each row execute function app_review_private.invoice_deposit_credit();
revoke all on function app_review_private.invoice_deposit_credit() from public,anon,authenticated;

create table public.strategic_goals(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,goal_type text not null default 'Business',title text not null,description text,status text not null default 'Not Started',priority text default 'Medium',target_date date,progress_percentage numeric default 0 check(progress_percentage between 0 and 100),created_at timestamptz not null default now());
create table public.goal_kpis(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,goal_id uuid not null references public.strategic_goals(id) on delete cascade,name text not null,metric text,unit text,target_value numeric default 0,current_value numeric default 0,status text default 'On Track',created_at timestamptz not null default now());
alter table public.strategic_goals enable row level security;
alter table public.goal_kpis enable row level security;
create policy goal_company on public.strategic_goals for all to authenticated using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));
create policy kpi_company on public.goal_kpis for all to authenticated using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()) and exists(select 1 from public.strategic_goals g where g.id=goal_id and g.company_id=goal_kpis.company_id));
grant select,insert,update,delete on public.strategic_goals,public.goal_kpis to authenticated;
grant all on public.strategic_goals,public.goal_kpis to service_role;
create index on public.strategic_goals(company_id);
create index on public.goal_kpis(company_id,goal_id);

-- Seat entitlements include purchased seats. Accepting an invite consumes its reserved seat.
create or replace function public.check_user_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare used_seats int; reserved int; allowed int;
begin
 if new.company_id is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,1));
 select coalesce(max_users,case plan_id when 'professional' then 3 when 'business' then 10 else 1 end) into allowed from public.companies where id=new.company_id;
 select count(*) into used_seats from public.profiles where company_id=new.company_id and is_active is distinct from false and (tg_table_name!='profiles' or id!=new.id);
 select count(*) into reserved from public.team_invites where company_id=new.company_id and is_pending=true and (tg_table_name!='team_invites' or id!=new.id) and (tg_table_name!='profiles' or lower(email) is distinct from lower(new.email));
 if (tg_table_name='profiles' and coalesce((to_jsonb(new)->>'is_active')::boolean,true)) or (tg_table_name='team_invites' and coalesce((to_jsonb(new)->>'is_pending')::boolean,false)) then
  if used_seats+reserved>=allowed then raise exception 'PLAN LIMIT REACHED: Your plan allows % users including purchased seats.',allowed; end if;
 end if;
 return new;
end $$;
-- Using jsonb avoids accessing table-specific columns in a shared trigger.

revoke all on function public.check_user_limit() from public,anon,authenticated;
