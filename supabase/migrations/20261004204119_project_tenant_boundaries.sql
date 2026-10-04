-- Apply only after public-project and the token-aware app are deployed.
create or replace function app_review_private.member_company() returns uuid language sql stable security definer set search_path='' as $$
 select company_id from public.profiles where id=auth.uid() and is_active is distinct from false
$$;
create or replace function app_review_private.module_allowed(module text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select p.role in ('owner','admin') or c.plan_id!='business' or p.permissions is null or p.permissions='[]'::jsonb or p.permissions ? module from public.profiles p join public.companies c on c.id=p.company_id where p.id=auth.uid() and p.is_active is distinct from false),false)
$$;
grant usage on schema app_review_private to authenticated;
revoke all on function app_review_private.member_company(),app_review_private.module_allowed(text) from public,anon;
grant execute on function app_review_private.member_company(),app_review_private.module_allowed(text) to authenticated;
-- Restrictive policies cannot be overridden by permissive legacy OR policies.
do $$ declare t record; begin
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='company_id' loop
  execute format('alter table public.%I enable row level security',t.table_name);
  execute format('create policy review_company_boundary on public.%I as restrictive for all to authenticated using (company_id=(select app_review_private.member_company())) with check (company_id=(select app_review_private.member_company()))',t.table_name);
 end loop;
end $$;
create policy review_company_read on public.companies as restrictive for select to authenticated using(id=(select app_review_private.member_company()));
create policy review_company_update on public.companies as restrictive for update to authenticated using(id=(select app_review_private.member_company())) with check(id=(select app_review_private.member_company()));
create policy review_company_delete on public.companies as restrictive for delete to authenticated using(id=(select app_review_private.member_company()));
-- Direct project reads/writes are authenticated. Public documents resolve a minimal project through their capability link.
revoke all on public.projects,public.contractor_portal_files from public,anon;
grant select,insert,update,delete on public.projects,public.contractor_portal_files to authenticated;
grant all on public.projects,public.contractor_portal_files to service_role;
do $$ declare p record; begin
 for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('projects','contractor_portal_files') loop
  execute format('drop policy %I on public.%I',p.policyname,p.tablename);
 end loop;
end $$;
create policy project_company on public.projects for all to authenticated using(company_id=(select app_review_private.member_company())) with check(company_id=(select app_review_private.member_company()));
create policy contractor_company on public.contractor_portal_files for all to authenticated using(company_id=(select app_review_private.member_company())) with check(company_id=(select app_review_private.member_company()) and exists(select 1 from public.projects p where p.id=project_id and p.company_id=contractor_portal_files.company_id));

create or replace function app_review_private.project_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare plan text; active_count int;
begin
 if lower(coalesce(new.status,'')) in ('completed','cancelled','canceled','lead') then return new; end if;
 if tg_op='UPDATE' and new.company_id=old.company_id and lower(coalesce(old.status,'')) not in ('completed','cancelled','canceled','lead') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,2));
 select plan_id into plan from public.companies where id=new.company_id;
 if plan='starter' then
  select count(*) into active_count from public.projects where company_id=new.company_id and lower(coalesce(status,'')) not in ('completed','cancelled','canceled','lead') and id!=new.id;
  if active_count>=5 then raise exception 'Starter includes 5 active projects. Complete a project or upgrade to add another.'; end if;
 end if;
 return new;
end $$;
create trigger review_project_limit before insert or update of status,company_id on public.projects for each row execute function app_review_private.project_limit();
revoke all on function app_review_private.project_limit() from public,anon,authenticated;

create or replace function public.check_user_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare used_seats int; reserved int; allowed int;
begin
 if new.company_id is null then return new; end if;
 if tg_op='UPDATE' and new.company_id=old.company_id and ((tg_table_name='profiles' and (to_jsonb(new)->>'is_active') is not distinct from (to_jsonb(old)->>'is_active')) or (tg_table_name='team_invites' and (to_jsonb(new)->>'is_pending') is not distinct from (to_jsonb(old)->>'is_pending'))) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,1));
 select coalesce(max_users,case plan_id when 'professional' then 3 when 'business' then 10 else 1 end) into allowed from public.companies where id=new.company_id;
 select count(*) into used_seats from public.profiles where company_id=new.company_id and is_active is distinct from false and (tg_table_name!='profiles' or id!=new.id);
 select count(*) into reserved from public.team_invites where company_id=new.company_id and is_pending=true and (tg_table_name!='team_invites' or id!=new.id) and (tg_table_name!='profiles' or lower(email) is distinct from lower(new.email));
 if (tg_table_name='profiles' and coalesce((to_jsonb(new)->>'is_active')::boolean,true)) or (tg_table_name='team_invites' and coalesce((to_jsonb(new)->>'is_pending')::boolean,false)) then
  if used_seats+reserved>=allowed then raise exception 'PLAN LIMIT REACHED: Your plan allows % users including purchased seats.',allowed; end if;
 end if;
 return new;
end $$;

-- Seat limits also apply when an inactive account or expired invitation is reactivated.
drop trigger if exists enforce_max_users on public.profiles;
drop trigger if exists enforce_max_users_invites on public.team_invites;
create trigger enforce_max_users before insert or update of is_active,company_id on public.profiles for each row execute function public.check_user_limit();
create trigger enforce_max_users_invites before insert or update of is_pending,company_id on public.team_invites for each row execute function public.check_user_limit();

create or replace function app_review_private.company_billing_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null or auth.role() in ('anon','authenticated') then
  if (new.plan_id,new.subscription_status,new.stripe_customer_id,new.max_users,new.stripe_account_id,new.stripe_charges_enabled) is distinct from (old.plan_id,old.subscription_status,old.stripe_customer_id,old.max_users,old.stripe_account_id,old.stripe_charges_enabled)
  then raise exception 'Billing and payment connection fields are managed by the payment service' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger review_billing_guard before update on public.companies for each row execute function app_review_private.company_billing_guard();
revoke all on function app_review_private.company_billing_guard() from public,anon,authenticated;
-- Business custom module access augments basic roles. Related child rows inherit the same module restriction.
do $$ declare t text; m text; pair text[]; begin
 foreach pair slice 1 in array array[['quotes','quotes'],['quote_phases','quotes'],['quote_line_items','quotes'],['invoices','invoices'],['invoice_phases','invoices'],['invoice_line_items','invoices'],['payments','invoices'],['purchase_orders','purchase_orders'],['purchase_order_line_items','purchase_orders'],['change_orders','change_orders'],['change_order_phases','change_orders'],['change_order_line_items','change_orders'],['projects','projects'],['strategic_goals','dashboard'],['goal_kpis','dashboard']] loop
  t:=pair[1]; m:=pair[2];
  execute format('create policy review_module_access on public.%I as restrictive for all to authenticated using ((select app_review_private.module_allowed(%L))) with check ((select app_review_private.module_allowed(%L)))',t,m,m);
 end loop;
end $$;
