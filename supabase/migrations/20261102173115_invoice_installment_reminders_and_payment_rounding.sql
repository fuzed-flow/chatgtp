-- Installment reminders require an explicit date and an unpaid cent balance.
-- Service-only invoker RPCs preserve tenant isolation and do not expose data.
create or replace function public.invoice_reminder_context(p_company uuid, p_invoice uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare i public.invoices; s public.invoice_payment_schedules; unpaid numeric; installment_due numeric;
begin
  select * into i from public.invoices where id=p_invoice and company_id=p_company;
  if not found or lower(coalesce(i.status,'')) not in ('sent','viewed','overdue','partial','partially paid') then return null; end if;
  select greatest(0,round(coalesce(i.total,0)-greatest(coalesce(i.amount_paid,0),coalesce(sum(p.amount),0)),2))
    into unpaid from public.payments p where p.invoice_id=i.id and p.company_id=p_company;
  if unpaid<=0 then return null; end if;
  if i.has_payment_schedule is true or exists(select 1 from public.invoice_payment_schedules where invoice_id=i.id and company_id=p_company) then
    select * into s from public.invoice_payment_schedules
    where invoice_id=i.id and company_id=p_company and due_date is not null
      and lower(coalesce(status,'')) not in ('paid','void','cancelled','canceled')
      and round(case when amount_type='percentage' then coalesce(i.total,0)*coalesce(percentage,0)/100 else coalesce(amount,0) end,2)>round(coalesce(amount_paid,0),2)
    order by due_date,sort_order,id limit 1;
    if not found then return null; end if;
    installment_due:=least(unpaid,greatest(0,round(case when s.amount_type='percentage' then coalesce(i.total,0)*coalesce(s.percentage,0)/100 else coalesce(s.amount,0) end,2)-round(coalesce(s.amount_paid,0),2)));
    return jsonb_build_object('schedule_item_id',s.id,'due_date',s.due_date,'payment_name',s.payment_name,'balance_due',installment_due);
  end if;
  if i.due_date is null then return null; end if;
  return jsonb_build_object('schedule_item_id',null,'due_date',i.due_date,'payment_name',null,'balance_due',unpaid);
end $$;
revoke all on function public.invoice_reminder_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.invoice_reminder_context(uuid,uuid) to service_role;

create table notification_private.invoice_installment_reminder_deliveries (
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  schedule_item_id uuid not null references public.invoice_payment_schedules(id) on delete cascade,
  due_date date not null,
  stage integer not null check(stage between 1 and 3),
  channel text not null check(channel in ('email','sms')),
  accepted_at timestamptz not null default now(),
  primary key(company_id,invoice_id,schedule_item_id,due_date,stage,channel)
);
alter table notification_private.invoice_installment_reminder_deliveries enable row level security;
revoke all on notification_private.invoice_installment_reminder_deliveries from public,anon,authenticated;
grant select,insert,update on notification_private.invoice_installment_reminder_deliveries to service_role;

create or replace function public.invoice_installment_reminder_policy(p_company uuid,p_invoice uuid,p_schedule uuid,p_due_date date,p_stage integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare target jsonb; has_email boolean; has_sms boolean; last_sent timestamptz;
begin
  target:=public.invoice_reminder_context(p_company,p_invoice);
  if p_stage is null or p_stage not between 1 and 3 or target is null
    or (target->>'schedule_item_id')::uuid is distinct from p_schedule
    or (target->>'due_date')::date is distinct from p_due_date or p_schedule is null then
    raise exception 'Installment unavailable' using errcode='42501';
  end if;
  -- Only successful original document sends opt a channel in. Copies, receipts,
  -- follow-ups and replies cannot enable a new channel.
  select coalesce(bool_or(provider='resend'),false),coalesce(bool_or(provider='twilio'),false),max(created_at)
    into has_email,has_sms,last_sent from notification_private.outbound_deliveries
    where company_id=p_company and related_type='Invoice' and related_id=p_invoice
      and kind='document' and not is_copy
      and lower(status) in ('accepted','queued','sending','sent','delivered','opened','clicked');
  return jsonb_build_object('email',has_email,'sms',has_sms,'cycle',coalesce(extract(epoch from last_sent)::text,''),
    'email_sent',exists(select 1 from notification_private.invoice_installment_reminder_deliveries
      where company_id=p_company and invoice_id=p_invoice and schedule_item_id=p_schedule
        and due_date=p_due_date and stage=p_stage and channel='email' and accepted_at>=last_sent),
    'sms_sent',exists(select 1 from notification_private.invoice_installment_reminder_deliveries
      where company_id=p_company and invoice_id=p_invoice and schedule_item_id=p_schedule
        and due_date=p_due_date and stage=p_stage and channel='sms' and accepted_at>=last_sent));
end $$;
revoke all on function public.invoice_installment_reminder_policy(uuid,uuid,uuid,date,integer) from public,anon,authenticated;
grant execute on function public.invoice_installment_reminder_policy(uuid,uuid,uuid,date,integer) to service_role;

create or replace function public.record_invoice_installment_reminder(p_company uuid,p_invoice uuid,p_schedule uuid,p_due_date date,p_stage integer,p_channel text)
returns void language plpgsql security invoker set search_path='' as $$
declare policy jsonb;
begin
  policy:=public.invoice_installment_reminder_policy(p_company,p_invoice,p_schedule,p_due_date,p_stage);
  if p_channel is null or p_channel not in ('email','sms') or coalesce((policy->>p_channel)::boolean,false) is not true then
    raise exception 'Reminder channel unavailable' using errcode='42501';
  end if;
  insert into notification_private.invoice_installment_reminder_deliveries(company_id,invoice_id,schedule_item_id,due_date,stage,channel)
    values(p_company,p_invoice,p_schedule,p_due_date,p_stage,p_channel)
    on conflict(company_id,invoice_id,schedule_item_id,due_date,stage,channel) do update set accepted_at=now();
end $$;
revoke all on function public.record_invoice_installment_reminder(uuid,uuid,uuid,date,integer,text) from public,anon,authenticated;
grant execute on function public.record_invoice_installment_reminder(uuid,uuid,uuid,date,integer,text) to service_role;

-- Keep card allocations and completion checks in whole cents.
CREATE OR REPLACE FUNCTION public.record_checkout_payment(p_session text, p_company uuid, p_invoice uuid, p_quote uuid, p_amount numeric, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare i public.invoices; q public.quotes; paid numeric; schedule_record record; remaining numeric; allocated numeric; schedule_due numeric;
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
  paid:=round(coalesce(i.amount_paid,0)+p_amount,2);
  update public.invoices set amount_paid=paid,balance_due=greatest(0,coalesce(total,0)-paid),status=case when paid>=coalesce(total,0) then 'Paid' else 'Partially Paid' end where id=i.id;
  remaining:=round(p_amount,2);
  for schedule_record in select * from public.invoice_payment_schedules where invoice_id=i.id and company_id=p_company order by sort_order,id for update loop
   schedule_due:=round(case when schedule_record.amount_type='percentage' then coalesce(i.total,0)*coalesce(schedule_record.percentage,0)/100 else coalesce(schedule_record.amount,0) end,2);
   allocated:=least(remaining,greatest(0,schedule_due-round(coalesce(schedule_record.amount_paid,0),2)));
   if allocated>0 then
    update public.invoice_payment_schedules set amount_paid=round(coalesce(amount_paid,0)+allocated,2),
      status=case when round(coalesce(amount_paid,0)+allocated,2)>=schedule_due then 'Paid' else 'Partial' end,
      paid_date=case when round(coalesce(amount_paid,0)+allocated,2)>=schedule_due then coalesce(paid_date,p_date) else paid_date end
      where id=schedule_record.id;
    remaining:=remaining-allocated;
   end if;
  end loop;
 end if;
 return jsonb_build_object('duplicate',false,'invoice_id',i.id,'quote_id',p_quote);
end $function$

;
revoke all on function public.record_checkout_payment(text,uuid,uuid,uuid,numeric,date) from public,anon,authenticated;
grant execute on function public.record_checkout_payment(text,uuid,uuid,uuid,numeric,date) to service_role;

-- Repair fully covered installments without inserting or changing payments.
update public.invoice_payment_schedules s set status='Paid',
  paid_date=coalesce(s.paid_date,(select max(p.payment_date) from public.payments p where p.invoice_id=s.invoice_id and p.company_id=s.company_id))
from public.invoices i
where i.id=s.invoice_id and i.company_id=s.company_id and lower(s.status) in ('partial','partially paid')
  and round(coalesce(s.amount_paid,0),2)>0
  and round(coalesce(s.amount_paid,0),2)>=round(case when s.amount_type='percentage' then coalesce(i.total,0)*coalesce(s.percentage,0)/100 else coalesce(s.amount,0) end,2);
