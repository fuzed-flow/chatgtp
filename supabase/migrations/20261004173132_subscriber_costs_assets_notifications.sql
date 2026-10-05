-- Cost, purchasing, equipment and compliance workflows. Additive; no historical
-- customer communications are replayed by this migration.
alter table public.purchase_orders add column if not exists approved_amount numeric;
alter table public.purchase_orders add column if not exists supplier_acknowledged_at timestamptz;
alter table public.purchase_orders add column if not exists delivery_status text not null default 'Not received';
alter table public.purchase_orders add column if not exists delivery_notes text;
alter table public.purchase_orders add column if not exists budget_category text;
alter table public.project_materials add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;
alter table public.project_materials add column if not exists budget_category text;
alter table public.project_materials add column if not exists photo_url text;
alter table public.inventory add column if not exists item_type text not null default 'Material';
alter table public.inventory add column if not exists equipment_status text not null default 'Available';
alter table public.inventory add column if not exists maintenance_due_date date;
alter table public.vendors add column if not exists insurance_expiry date;
alter table public.vendors add column if not exists certification_expiry date;
alter table public.vendors add column if not exists wcb_policy text;
alter table public.subcontractors add column if not exists certification_expiry date;
alter table public.project_permits add column if not exists inspection_date date;
alter table public.project_permits add column if not exists inspection_result text;
alter table public.project_permits add column if not exists inspection_notes text;
alter table public.projects add column if not exists material_budget numeric;
alter table public.projects add column if not exists labour_budget numeric;
alter table public.projects add column if not exists category_budgets jsonb not null default '{}'::jsonb;
alter table public.time_entries add column if not exists cost_rate numeric;
alter table public.expenses add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;
alter table public.expenses add column if not exists project_material_id uuid references public.project_materials(id) on delete set null;
alter table public.vendor_requests add column if not exists response_token text not null default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
alter table public.vendor_requests add column if not exists response_amount numeric;
alter table public.vendor_requests add column if not exists response_message text;
alter table public.vendor_requests add column if not exists responded_at timestamptz;
alter table public.vendor_requests add column if not exists delivered_at timestamptz;
alter table public.vendor_requests enable row level security;
-- Preserve all existing policies and grants. Restrictive policies AND their
-- predicates with every legacy permissive policy, so old USING(true) policies
-- cannot expose invitation tokens across tenants or to anonymous recipients.
-- Public recipients obtain only a projected response through the token RPC.
create policy vendor_requests_anon_token_rpc_only on public.vendor_requests as restrictive for all to anon using (false) with check (false);
create policy vendor_requests_active_staff_boundary on public.vendor_requests as restrictive for all to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=vendor_requests.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
) with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=vendor_requests.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
);
create policy vendor_requests_company_access on public.vendor_requests for all to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=vendor_requests.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
) with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=vendor_requests.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
);
grant select,insert,update,delete on public.vendor_requests to authenticated;

create table public.inventory_reservations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 inventory_id uuid not null references public.inventory(id),
 project_id uuid references public.projects(id),
 assigned_to uuid references public.profiles(id),
 quantity numeric not null check(quantity>0),
 start_date date not null,
 return_due_date date not null,
 status text not null default 'Reserved' check(status in ('Reserved','Checked out','Returned','Cancelled')),
 returned_at timestamptz,
 checkout_requested_at timestamptz,
 notes text,
 created_at timestamptz not null default now(),
 check(return_due_date>=start_date)
);
create index inventory_reservations_active_lookup on public.inventory_reservations(company_id,inventory_id,start_date,return_due_date) where status in ('Reserved','Checked out');
create index costs_po_project_lookup on public.purchase_orders(company_id,project_id);
create index costs_material_project_lookup on public.project_materials(company_id,project_id);
alter table public.inventory_reservations enable row level security;
grant select,insert,update,delete on public.inventory_reservations to authenticated;
grant all on public.inventory_reservations to service_role;
create policy inventory_reservations_read on public.inventory_reservations for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=inventory_reservations.company_id and p.is_active is distinct from false
 and (p.role in ('owner','admin','manager','office') or p.id=inventory_reservations.assigned_to or exists(select 1 from public.project_staff ps where ps.company_id=p.company_id and ps.project_id=inventory_reservations.project_id and ps.user_id=p.id and ps.is_active is distinct from false)))
);
create policy inventory_reservations_write on public.inventory_reservations for all to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=inventory_reservations.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
) with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=inventory_reservations.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office'))
);

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module)
select e.key,e.title,e.severity,e.category,array['owner','admin','manager','office'],'leadership',e.module from (values
 ('po_approval_requested','Purchase order awaiting approval','Action Required','Financial','purchase_orders'),
 ('po_sent','Purchase order sent','FYI','Financial','purchase_orders'),
 ('po_acknowledged','Supplier acknowledged purchase order','Important','Financial','purchase_orders'),
 ('po_delivery_soon','Purchase order delivery approaching','Important','Financial','purchase_orders'),
 ('po_delivery_late','Purchase order delivery overdue','Action Required','Financial','purchase_orders'),
 ('po_delivery_delayed','Purchase order delivery delayed','Action Required','Financial','purchase_orders'),
 ('po_cancelled','Purchase order cancelled','Important','Financial','purchase_orders'),
 ('po_partial_delivery','Purchase order partially delivered','Important','Financial','purchase_orders'),
 ('po_amount_exceeded','Purchase order exceeds approved amount','Action Required','Financial','purchase_orders'),
 ('inventory_reservation_conflict','Inventory reservation conflict','Action Required','Inventory','inventory'),
 ('equipment_maintenance_due','Equipment maintenance due','Action Required','Inventory','inventory'),
 ('equipment_return_overdue','Equipment return overdue','Action Required','Inventory','inventory'),
 ('equipment_checkout_requested','Equipment checkout requested','Action Required','Inventory','inventory'),
 ('equipment_damaged','Equipment reported damaged','Action Required','Inventory','inventory'),
 ('equipment_missing','Equipment reported missing','Action Required','Inventory','inventory'),
 ('material_needed_unavailable','Required project material unavailable','Action Required','Financial','projects'),
 ('material_budget_approaching','Material commitments approaching budget','Important','Financial','projects'),
 ('material_budget_exceeded','Material commitments exceed budget','Action Required','Financial','projects'),
 ('labour_cost_approaching','Labour cost approaching budget','Important','Financial','projects'),
 ('labour_cost_exceeded','Labour cost exceeds budget','Action Required','Financial','projects'),
 ('category_budget_approaching','Cost category approaching budget','Important','Financial','projects'),
 ('category_budget_exceeded','Cost category exceeds budget','Action Required','Financial','projects'),
 ('committed_budget_approaching','Committed project costs approaching budget','Important','Financial','projects'),
 ('committed_budget_exceeded','Committed project costs exceed budget','Action Required','Financial','projects'),
 ('permit_approved','Permit approved','Important','Documents','projects'),
 ('permit_rejected','Permit rejected','Action Required','Documents','projects'),
 ('permit_information_required','Permit information required','Action Required','Documents','projects'),
 ('permit_expiring','Permit approaching expiry','Action Required','Documents','projects'),
 ('permit_expired','Permit expired','Action Required','Documents','projects'),
 ('inspection_result_changed','Inspection result updated','Important','Scheduling','projects'),
 ('subcontractor_invitation_accepted','Trade invitation accepted','Important','Subcontractors','vendors'),
 ('subcontractor_quote_approved','Trade quote approved','Important','Subcontractors','vendors'),
 ('subcontractor_quote_declined','Trade quote declined','Important','Subcontractors','vendors'),
 ('subcontractor_certification_expiring','Trade certification approaching expiry','Action Required','Subcontractors','vendors'),
 ('subcontractor_documents_missing','Required trade documents missing','Action Required','Subcontractors','vendors')
 ,('vendor_request_delivery_failed','Trade request delivery failed','Action Required','Subcontractors','vendors')
 ,('vendor_request_bounced','Trade request email bounced','Action Required','Subcontractors','vendors')
 ,('subcontractor_assigned','Trade assigned to project','Important','Subcontractors','vendors')
 ,('subcontractor_invoice_received','Trade invoice uploaded','Important','Financial','vendors')
) e(key,title,severity,category,module) on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;
insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('equipment_reserved','Equipment reserved for you','Important','Inventory',array['owner','admin','manager','office','employee','subcontractor'],'assigned','inventory'),
 ('equipment_checked_out','Equipment checked out to you','Important','Inventory',array['owner','admin','manager','office','employee','subcontractor'],'assigned','inventory'),
 ('equipment_returned','Equipment return recorded','FYI','Inventory',array['owner','admin','manager','office','employee','subcontractor'],'assigned','inventory')
on conflict(event_key) do nothing;

create or replace function notification_private.costs_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb:=to_jsonb(new); c uuid:=(d->>'company_id')::uuid; p uuid:=nullif(d->>'project_id','')::uuid; actor public.profiles;
begin
 if tg_table_name='vendor_requests' and current_setting('notification.vendor_response',true)=(d->>'id')||':'||(d->>'response_token') then return new; end if;
 if auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
 if auth.uid() is not null then
   select * into actor from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false;
   if not found then raise exception 'Company access required' using errcode='42501'; end if;
 end if;
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'Company cannot be changed' using errcode='42501'; end if;
 if p is not null and not exists(select 1 from public.projects where id=p and company_id=c) then raise exception 'Project does not belong to company' using errcode='23514'; end if;
 if tg_table_name='purchase_orders' and nullif(d->>'vendor_id','') is not null and not exists(select 1 from public.vendors where id=(d->>'vendor_id')::uuid and company_id=c) then raise exception 'Vendor does not belong to company' using errcode='23514'; end if;
 if tg_table_name='vendor_requests' then
   if new.vendor_id is null or not exists(select 1 from public.vendors where id=new.vendor_id and company_id=c) then raise exception 'Vendor does not belong to company' using errcode='23514'; end if;
   if auth.uid() is not null and actor.role not in ('owner','admin','manager','office') then raise exception 'Management access required' using errcode='42501'; end if;
 elsif tg_table_name='inventory_reservations' then
   -- Serialize bookings per inventory item so concurrent reservations are visible
   -- to the conflict notification rather than silently slipping past one another.
   perform 1 from public.inventory where id=new.inventory_id and company_id=c for update;
   if not found then raise exception 'Inventory does not belong to company' using errcode='23514'; end if;
   if new.assigned_to is not null and not exists(select 1 from public.profiles where id=new.assigned_to and company_id=c and is_active is distinct from false) then raise exception 'Assignee does not belong to company' using errcode='23514'; end if;
   if auth.uid() is not null and actor.role not in ('owner','admin','manager','office') and not (tg_op='UPDATE' and new.assigned_to=auth.uid() and current_setting('notification.reservation_action',true) is not distinct from new.id::text||':'||auth.uid()::text) then raise exception 'Management access required' using errcode='42501'; end if;
   if new.status='Returned' and (tg_op='INSERT' or old.status is distinct from 'Returned') then new.returned_at:=now(); end if;
 elsif tg_table_name='project_materials' or tg_table_name='expenses' then
   if tg_table_name='project_materials' and nullif(d->>'phase_id','') is not null and not exists(select 1 from public.project_phases ph where ph.id=(d->>'phase_id')::uuid and ph.company_id=c and ph.project_id=p) then raise exception 'Phase must belong to this project' using errcode='23514'; end if;
   if nullif(d->>'purchase_order_id','') is not null and not exists(select 1 from public.purchase_orders po where po.id=(d->>'purchase_order_id')::uuid and po.company_id=c and po.project_id is not distinct from p) then raise exception 'Purchase order must belong to this project' using errcode='23514'; end if;
   if tg_table_name='expenses' and nullif(d->>'project_material_id','') is not null and not exists(select 1 from public.project_materials m where m.id=(d->>'project_material_id')::uuid and m.company_id=c and m.project_id is not distinct from p) then raise exception 'Material must belong to this project' using errcode='23514'; end if;
 elsif tg_table_name='time_entries' then
   if new.user_id is not null and not exists(select 1 from public.profiles where id=new.user_id and company_id=c) then raise exception 'Staff member does not belong to company' using errcode='23514'; end if;
   if tg_op='INSERT' and (new.cost_rate is null or auth.uid() is not null and actor.role not in ('owner','admin','office')) then
     select greatest(coalesce(hourly_rate,0),0) into new.cost_rate from public.profiles where id=new.user_id and company_id=c;
   elsif tg_op='UPDATE' and new.cost_rate is distinct from old.cost_rate and auth.uid() is not null and actor.role not in ('owner','admin','office') then raise exception 'Only office staff may change labour cost rates' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function notification_private.costs_guard() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['inventory_reservations','project_materials','expenses','time_entries','purchase_orders','project_permits','inventory','vendors','vendor_requests'] loop
 execute format('create trigger costs_tenant_guard before insert or update on public.%I for each row execute function notification_private.costs_guard()',t);
 end loop;
end $$;

create or replace function notification_private.costs_project_budgets(p_project uuid,p_actor uuid default auth.uid())
returns integer language plpgsql security definer set search_path='' as $$
declare pr public.projects; material numeric:=0; labour numeric:=0; expense numeric:=0; total numeric; category_total numeric; budget numeric; e text; n integer:=0; cat record;
begin
 select * into pr from public.projects where id=p_project;
 if not found or lower(coalesce(pr.status,'')) in ('completed','complete','closed','cancelled','canceled','archived') then return 0; end if;
 if p_actor is not null and not exists(select 1 from public.profiles where id=p_actor and company_id=pr.company_id and is_active is distinct from false) then return 0; end if;
 select coalesce(sum(coalesce(po.subtotal,po.total,0)),0) into material from public.purchase_orders po where po.company_id=pr.company_id and po.project_id=pr.id and lower(coalesce(po.status,'')) in ('approved','sent','issued','acknowledged','ordered','received','partially received');
 select material+coalesce(sum(greatest(coalesce(m.quantity,0),0)*coalesce(m.cost_actual,m.cost_estimated,0)),0) into material from public.project_materials m where m.company_id=pr.company_id and m.project_id=pr.id and m.purchase_order_id is null and lower(coalesce(m.status,'')) in ('ordered','received','picked up','ready','delivered','backordered','partial delivery');
 select coalesce(sum(greatest(coalesce(t.total_hours,0),0)*coalesce(t.cost_rate,p.hourly_rate,0)),0) into labour from public.time_entries t left join public.profiles p on p.id=t.user_id and p.company_id=t.company_id where t.company_id=pr.company_id and t.project_id=pr.id and lower(coalesce(t.status,''))='approved';
 select coalesce(sum(e.amount),0) into expense from public.expenses e where e.company_id=pr.company_id and e.project_id=pr.id and lower(coalesce(e.status,'')) in ('approved','reimbursed','paid')
 and not exists(select 1 from public.purchase_orders po where po.id=e.purchase_order_id and po.company_id=pr.company_id and lower(coalesce(po.status,'')) in ('approved','sent','issued','acknowledged','ordered','received','partially received'))
 and not exists(select 1 from public.project_materials m where m.id=e.project_material_id and m.company_id=pr.company_id and lower(coalesce(m.status,'')) in ('ordered','received','picked up','ready','delivered','backordered','partial delivery'));
 total:=material+labour+expense;
 for cat in select 'material' key,pr.material_budget allowance,material actual union all select 'labour_cost',pr.labour_budget,labour union all select 'committed',coalesce(nullif(pr.budget_cost,0),nullif(pr.budget,0)),total loop
   if cat.allowance>0 and cat.actual>=cat.allowance*0.9 then
     e:=case cat.key when 'material' then 'material_budget_' when 'labour_cost' then 'labour_cost_' else 'committed_budget_' end||case when cat.actual>cat.allowance then 'exceeded' else 'approaching' end;
     n:=n+notification_private.emit(pr.company_id,e,'Project',pr.id,pr.id,'{}',coalesce(pr.name,'Project')||': '||replace(cat.key,'_',' ')||' costs $'||round(cat.actual,2)||' against $'||round(cat.allowance,2),e||':'||pr.id||':'||cat.allowance,p_actor);
   end if;
 end loop;
 for cat in select key,value from jsonb_each_text(case when jsonb_typeof(pr.category_budgets)='object' then pr.category_budgets else '{}'::jsonb end) loop
   if cat.value !~ '^[0-9]+([.][0-9]+)?$' then continue; end if;
   budget:=cat.value::numeric; if budget<=0 then continue; end if;
   select coalesce(sum(x.amount),0) into category_total from (
    select coalesce(po.subtotal,po.total,0) amount from public.purchase_orders po where po.company_id=pr.company_id and po.project_id=pr.id and lower(coalesce(po.budget_category,''))=lower(cat.key) and lower(coalesce(po.status,'')) in ('approved','sent','issued','acknowledged','ordered','received','partially received')
    union all select greatest(coalesce(m.quantity,0),0)*coalesce(m.cost_actual,m.cost_estimated,0) from public.project_materials m where m.company_id=pr.company_id and m.project_id=pr.id and m.purchase_order_id is null and lower(coalesce(m.budget_category,''))=lower(cat.key) and lower(coalesce(m.status,'')) in ('ordered','received','picked up','ready','delivered','backordered','partial delivery')
    union all select ex.amount from public.expenses ex where ex.company_id=pr.company_id and ex.project_id=pr.id and lower(coalesce(ex.category,''))=lower(cat.key) and lower(coalesce(ex.status,'')) in ('approved','reimbursed','paid')
    and not exists(select 1 from public.purchase_orders po where po.id=ex.purchase_order_id and po.company_id=pr.company_id and lower(coalesce(po.status,'')) in ('approved','sent','issued','acknowledged','ordered','received','partially received'))
    and not exists(select 1 from public.project_materials m where m.id=ex.project_material_id and m.company_id=pr.company_id and lower(coalesce(m.status,'')) in ('ordered','received','picked up','ready','delivered','backordered','partial delivery'))
   ) x;
   if category_total>=budget*0.9 then
    e:='category_budget_'||case when category_total>budget then 'exceeded' else 'approaching' end;
    n:=n+notification_private.emit(pr.company_id,e,'Project',pr.id,pr.id,'{}',coalesce(pr.name,'Project')||': '||cat.key||' costs $'||round(category_total,2)||' against $'||round(budget,2),e||':'||pr.id||':'||lower(cat.key)||':'||budget,p_actor);
   end if;
 end loop;
 return n;
end $$;
revoke all on function notification_private.costs_project_budgets(uuid,uuid) from public,anon,authenticated;

create or replace function notification_private.costs_source_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb:=to_jsonb(new); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 c uuid:=(d->>'company_id')::uuid; proj uuid:=nullif(d->>'project_id','')::uuid; events text[]:='{}'; e text; label text; k text; ref jsonb; reserved numeric; st text:=lower(coalesce(d->>'status','')); before_st text:=lower(coalesce(o->>'status','')); actor uuid:=auth.uid();
begin
 if tg_table_name='vendor_requests' and current_setting('notification.vendor_response',true)=(d->>'id')||':'||(d->>'response_token') then actor:=null; end if;
 if c is null or (actor is not null and not exists(select 1 from public.profiles where id=actor and company_id=c and is_active is distinct from false)) then return new; end if;
 label:=coalesce(nullif(d->>'po_number',''),nullif(d->>'name',''),nullif(d->>'custom_material_name',''),nullif(d->>'title',''),nullif(d->>'permit_number',''),nullif(d->>'permit_type',''),'Project record');
 k:='costs:'||tg_table_name||':'||(d->>'id')||':'||md5(d::text);
 if tg_table_name='purchase_orders' then
   if st is distinct from before_st then
    if st in ('pending approval','awaiting approval','pending review') then events:=array_append(events,'po_approval_requested');
    elsif st in ('sent','issued') then events:=array_append(events,'po_sent');
    elsif st in ('cancelled','canceled') then events:=array_append(events,'po_cancelled'); end if;
   end if;
   if d->>'supplier_acknowledged_at' is not null and d->>'supplier_acknowledged_at' is distinct from o->>'supplier_acknowledged_at' then events:=array_append(events,'po_acknowledged'); end if;
   if d->>'delivery_status' is distinct from o->>'delivery_status' then
     if lower(d->>'delivery_status')='partial delivery' then events:=array_append(events,'po_partial_delivery');
     elsif lower(d->>'delivery_status')='delayed' then events:=array_append(events,'po_delivery_delayed');
     elsif lower(d->>'delivery_status')='cancelled' and st not in ('cancelled','canceled') then events:=array_append(events,'po_cancelled'); end if;
   end if;
   if coalesce((d->>'approved_amount')::numeric,0)>0 and coalesce((d->>'total')::numeric,0)>(d->>'approved_amount')::numeric and (tg_op='INSERT' or coalesce((o->>'total')::numeric,0)<=coalesce((o->>'approved_amount')::numeric,0) or d->>'approved_amount' is distinct from o->>'approved_amount') then events:=array_append(events,'po_amount_exceeded'); end if;
 elsif tg_table_name='project_permits' then
   if nullif(d->>'inspection_date','') is not null and d->>'inspection_date' is distinct from o->>'inspection_date' then events:=array_append(events,'inspection_scheduled'); end if;
   if st is distinct from before_st then
    if st in ('approved','active') and before_st not in ('approved','active') then events:=array_append(events,'permit_approved');
    elsif st='rejected' then events:=array_append(events,'permit_rejected');
    elsif st in ('information required','additional information required') then events:=array_append(events,'permit_information_required');
    elsif st='expired' then events:=array_append(events,'permit_expired'); end if;
   end if;
   if d->>'inspection_result' is distinct from o->>'inspection_result' then
    if lower(d->>'inspection_result')='passed' then events:=array_append(events,'inspection_passed');
    elsif lower(d->>'inspection_result')='failed' then events:=array_append(events,'inspection_failed');
    elsif nullif(d->>'inspection_result','') is not null then events:=array_append(events,'inspection_result_changed'); end if;
   end if;
 elsif tg_table_name='inventory' then
   if lower(coalesce(d->>'item_type',''))='equipment' and d->>'equipment_status' is distinct from o->>'equipment_status' then
    if lower(d->>'equipment_status')='damaged' then events:=array_append(events,'equipment_damaged');
    elsif lower(d->>'equipment_status')='missing' then events:=array_append(events,'equipment_missing'); end if;
   end if;
   if tg_op='UPDATE' and d->>'quantity_on_hand' is distinct from o->>'quantity_on_hand' then
    select coalesce(max(peak.quantity),0) into reserved from (
      select day.value,sum(r.quantity) quantity from (select distinct start_date value from public.inventory_reservations where company_id=c and inventory_id=(d->>'id')::uuid and status in ('Reserved','Checked out') and return_due_date>=current_date) day
      join public.inventory_reservations r on r.company_id=c and r.inventory_id=(d->>'id')::uuid and r.status in ('Reserved','Checked out') and r.start_date<=day.value and r.return_due_date>=day.value group by day.value
    ) peak;
    if reserved>coalesce((d->>'quantity_on_hand')::numeric,0) then events:=array_append(events,'inventory_reservation_conflict'); label:=label||': active reservations need '||reserved||' units; '||coalesce(d->>'quantity_on_hand','0')||' available'; end if;
   end if;
 elsif tg_table_name='inventory_reservations' then
   select to_jsonb(i) into ref from public.inventory i where i.id=new.inventory_id and i.company_id=c;
   if st is distinct from before_st and new.assigned_to is not null then
     e:=case st when 'reserved' then 'equipment_reserved' when 'checked out' then 'equipment_checked_out' when 'returned' then 'equipment_returned' else null end;
     if e is not null then perform notification_private.emit(c,e,'Reservation',new.id,proj,array[new.assigned_to],coalesce(ref->>'name','Inventory')||': '||new.status,k||':'||e,actor); end if;
   end if;
   if new.checkout_requested_at is not null and (tg_op='INSERT' or old.checkout_requested_at is null) then perform notification_private.emit(c,'equipment_checkout_requested','Reservation',new.id,proj,'{}',coalesce(ref->>'name','Equipment')||': checkout requested for '||new.quantity||' units',k||':checkout-request',actor); end if;
   if st in ('reserved','checked out') then
    select coalesce(max(peak.quantity),0) into reserved from (
     select day.value,sum(r.quantity) quantity from (
       select new.start_date value union select rr.start_date from public.inventory_reservations rr where rr.company_id=c and rr.inventory_id=new.inventory_id and rr.status in ('Reserved','Checked out') and rr.start_date between new.start_date and new.return_due_date
     ) day join public.inventory_reservations r on r.company_id=c and r.inventory_id=new.inventory_id and r.status in ('Reserved','Checked out') and r.start_date<=day.value and r.return_due_date>=day.value group by day.value
    ) peak;
    if reserved>coalesce((ref->>'quantity_on_hand')::numeric,0) or lower(coalesce(ref->>'equipment_status','available')) in ('damaged','missing','maintenance') then
     perform notification_private.emit(c,'inventory_reservation_conflict','Inventory',new.inventory_id,proj,array_remove(array[new.assigned_to],null),coalesce(ref->>'name','Inventory')||': overlapping reservations need '||reserved||' units; '||coalesce(ref->>'quantity_on_hand','0')||' available',k,actor);
    end if;
   end if;
 elsif tg_table_name='vendor_requests' then
   if nullif(d->>'delivered_at','') is not null and d->>'delivered_at' is distinct from o->>'delivered_at' and nullif(o->>'delivered_at','') is null then events:=array_append(events,'subcontractor_invited'); end if;
   if st in ('received','quoted') and (st is distinct from before_st or (d->>'response_amount',d->>'response_message') is distinct from (o->>'response_amount',o->>'response_message')) then events:=array_append(events,'subcontractor_quote'); end if;
   if st is distinct from before_st then
    if st in ('accepted','confirmed') then events:=array_append(events,'subcontractor_invitation_accepted');
    elsif st in ('approved','quote approved') then events:=array_append(events,'subcontractor_quote_approved');
    elsif st in ('declined','rejected','quote declined') then events:=array_append(events,'subcontractor_quote_declined'); end if;
   end if;
 elsif tg_table_name='project_subcontractors' and tg_op='INSERT' then
   events:=array_append(events,'subcontractor_assigned');
   select coalesce((select name from public.vendors where id=(d->>'subcontractor_id')::uuid and company_id=c),(select company_name from public.subcontractors where id=(d->>'subcontractor_id')::uuid and company_id=c),'Trade') into label;
 elsif tg_table_name='vendors' and d->'invoice_urls' is distinct from o->'invoice_urls' then
   if jsonb_typeof(d->'invoice_urls')='array' and jsonb_array_length(d->'invoice_urls')>(case when jsonb_typeof(o->'invoice_urls')='array' then jsonb_array_length(o->'invoice_urls') else 0 end) then events:=array_append(events,'subcontractor_invoice_received'); end if;
 end if;
 foreach e in array events loop
  if tg_table_name='project_permits' then perform notification_private.emit(c,e,'Permit',(d->>'id')::uuid,proj,'{}',label,k||':'||e,actor);
  elsif tg_table_name='vendor_requests' then perform notification_private.emit(c,e,'Trade',(d->>'id')::uuid,proj,'{}',label,k||':'||e,actor);
  elsif tg_table_name='vendors' then perform notification_private.emit(c,e,'Vendor',(d->>'id')::uuid,proj,'{}',label,k||':'||e,actor);
  else perform notification_private.row_event(d,tg_table_name,e,proj,'{}',label,k||':'||e); end if;
 end loop;
 if tg_table_name in ('projects','project_materials','purchase_orders','expenses','time_entries') and proj is not null then perform notification_private.costs_project_budgets(proj,actor);
 elsif tg_table_name='projects' then perform notification_private.costs_project_budgets((d->>'id')::uuid,actor); end if;
 return new;
end $$;
revoke all on function notification_private.costs_source_event() from public,anon,authenticated;
-- The domain handler owns trade requests, including token-authenticated public
-- responses and confirmed delivery. Disable the legacy insert-only handler.
drop trigger if exists notification_events on public.vendor_requests;
do $$ declare t text; begin
 foreach t in array array['purchase_orders','project_materials','project_permits','inventory','inventory_reservations','vendor_requests','projects','expenses','time_entries','project_subcontractors','vendors'] loop
  execute format('create trigger costs_source_notification after insert or update on public.%I for each row execute function notification_private.costs_source_event()',t);
 end loop;
end $$;

create or replace function notification_private.costs_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare co record; d jsonb; ref jsonb; today date; e text; n integer:=0; item record;
begin
 for co in select id,case when timezone in (select name from pg_timezone_names) then timezone else 'UTC' end timezone from public.companies loop
  today:=(p_now at time zone co.timezone)::date;
  for d in select to_jsonb(po) from public.purchase_orders po where po.company_id=co.id and po.expected_delivery_date<=today+2 and po.actual_delivery_date is null and po.delivery_status not in ('Received','Cancelled') and lower(coalesce(po.status,'')) not in ('draft','cancelled','canceled','rejected','closed') loop
   e:=case when (d->>'expected_delivery_date')::date<today then 'po_delivery_late' else 'po_delivery_soon' end;
   n:=n+notification_private.emit(co.id,e,'PurchaseOrder',(d->>'id')::uuid,nullif(d->>'project_id','')::uuid,'{}',coalesce(d->>'po_number','Purchase order')||': delivery expected '||(d->>'expected_delivery_date'),e||':'||(d->>'id')||':'||(d->>'expected_delivery_date'),null);
  end loop;
  for d in select to_jsonb(p) from public.project_permits p where p.company_id=co.id and p.expiry_date<=today+30 and lower(coalesce(p.status,'')) not in ('closed','rejected') loop
   e:=case when (d->>'expiry_date')::date<today then 'permit_expired' else 'permit_expiring' end;
   n:=n+notification_private.emit(co.id,e,'Permit',(d->>'id')::uuid,(d->>'project_id')::uuid,'{}',coalesce(d->>'permit_type','Permit')||' '||coalesce(d->>'permit_number','')||': expires '||(d->>'expiry_date'),e||':'||(d->>'id')||':'||(d->>'expiry_date'),null);
  end loop;
  for d in select to_jsonb(i) from public.inventory i where i.company_id=co.id and lower(i.item_type)='equipment' and i.maintenance_due_date<=today+7 loop
   n:=n+notification_private.emit(co.id,'equipment_maintenance_due','Inventory',(d->>'id')::uuid,null,'{}',coalesce(d->>'name','Equipment')||': maintenance due '||(d->>'maintenance_due_date'),'equipment-maintenance:'||(d->>'id')||':'||(d->>'maintenance_due_date'),null);
  end loop;
  for item in select r.*,i.name from public.inventory_reservations r join public.inventory i on i.id=r.inventory_id and i.company_id=r.company_id where r.company_id=co.id and r.status='Checked out' and r.return_due_date<today loop
   n:=n+notification_private.emit(co.id,'equipment_return_overdue','Reservation',item.id,item.project_id,array_remove(array[item.assigned_to],null),item.name||': return was due '||item.return_due_date,'equipment-return:'||item.id||':'||item.return_due_date,null);
  end loop;
  for d in select to_jsonb(m) from public.project_materials m where m.company_id=co.id and m.needed_by_date<=today+2 and lower(coalesce(m.status,'')) not in ('received','picked up','ready','delivered','cancelled','canceled') loop
   n:=n+notification_private.emit(co.id,'material_needed_unavailable','Material',(d->>'id')::uuid,(d->>'project_id')::uuid,'{}',coalesce(d->>'custom_material_name','Material')||': needed '||(d->>'needed_by_date')||'; current status '||coalesce(d->>'status','To Order'),'material-needed:'||(d->>'id')||':'||(d->>'needed_by_date'),null);
  end loop;
  for d in select to_jsonb(s) from public.subcontractors s where s.company_id=co.id and s.is_active is distinct from false union all select to_jsonb(v)||jsonb_build_object('company_name',v.name) from public.vendors v where v.company_id=co.id loop
   if nullif(d->>'insurance_expiry','') is not null and (d->>'insurance_expiry')::date<=today+30 then
    n:=n+notification_private.emit(co.id,'subcontractor_insurance_expiring','Subcontractor',(d->>'id')::uuid,null,'{}',coalesce(d->>'company_name','Trade')||': insurance expires '||(d->>'insurance_expiry'),'trade-insurance:'||(d->>'id')||':'||(d->>'insurance_expiry'),null);
   end if;
   if nullif(d->>'certification_expiry','') is not null and (d->>'certification_expiry')::date<=today+30 then
    n:=n+notification_private.emit(co.id,'subcontractor_certification_expiring','Subcontractor',(d->>'id')::uuid,null,'{}',coalesce(d->>'company_name','Trade')||': certification expires '||(d->>'certification_expiry'),'trade-certification:'||(d->>'id')||':'||(d->>'certification_expiry'),null);
   end if;
  end loop;
  for item in select ps.id,ps.project_id,ps.subcontractor_id,coalesce(v.name,s.company_name,'Trade') name,v.insurance_expiry vendor_insurance,s.insurance_expiry sub_insurance from public.project_subcontractors ps left join public.vendors v on v.id=ps.subcontractor_id and v.company_id=ps.company_id left join public.subcontractors s on s.id=ps.subcontractor_id and s.company_id=ps.company_id where ps.company_id=co.id and lower(coalesce(ps.status,'')) not in ('removed','completed','complete','declined','rejected') loop
   if item.vendor_insurance is null and item.sub_insurance is null then
    n:=n+notification_private.emit(co.id,'subcontractor_documents_missing','ProjectRecord',item.id,item.project_id,'{}',item.name||': insurance expiry has not been recorded','trade-missing-insurance:'||item.id,null);
   end if;
  end loop;
  for item in select id from public.projects where company_id=co.id loop n:=n+notification_private.costs_project_budgets(item.id,null); end loop;
 end loop;
 return n;
end $$;
revoke all on function notification_private.costs_reminders(timestamptz) from public,anon,authenticated;
grant execute on function notification_private.costs_reminders(timestamptz) to service_role;

-- Anonymous contractors receive only the invitation they hold the unguessable
-- token for. No company, staff, financial or other invitations are exposed.
create or replace function public.process_vendor_response(p_request uuid,p_token text,p_action text default 'view',p_amount numeric default null,p_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.vendor_requests; vendor_name text; company_name text; project_name text; old_context text;
begin
 if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation' using errcode='42501'; end if;
 select * into r from public.vendor_requests where id=p_request and response_token=p_token for update;
 if not found or r.created_at<now()-interval '90 days' then raise exception 'Invitation unavailable or expired' using errcode='42501'; end if;
 if p_action not in ('view','accepted','declined','quoted') then raise exception 'Unknown response'; end if;
 if p_action<>'view' then
   if lower(coalesce(r.status,'')) in ('approved','rejected','cancelled','quote approved','quote declined') then raise exception 'This request has already been closed'; end if;
   if coalesce(length(p_message),0)>10000 then raise exception 'Please keep your message under 10,000 characters'; end if;
   if p_action='quoted' and (p_amount is null or p_amount<0 or p_amount>1000000000) then raise exception 'Enter a valid quote amount'; end if;
   if not (p_action='accepted' and lower(coalesce(r.status,'')) in ('received','quoted'))
    and not ((p_action='accepted' and lower(coalesce(r.status,''))='accepted' or p_action='declined' and lower(coalesce(r.status,''))='declined' or p_action='quoted' and lower(coalesce(r.status,'')) in ('received','quoted') and r.response_amount is not distinct from p_amount) and coalesce(nullif(btrim(p_message),''),r.response_message) is not distinct from r.response_message) then
    old_context:=current_setting('notification.vendor_response',true);
    perform set_config('notification.vendor_response',r.id::text||':'||r.response_token,true);
    update public.vendor_requests set status=case p_action when 'accepted' then 'Accepted' when 'declined' then 'Declined' else 'Received' end,
      response_amount=case when p_action='quoted' then p_amount else response_amount end,response_message=coalesce(nullif(btrim(p_message),''),response_message),responded_at=now() where id=r.id returning * into r;
    perform set_config('notification.vendor_response',coalesce(old_context,''),true);
   end if;
 end if;
 select v.name into vendor_name from public.vendors v where v.id=r.vendor_id and v.company_id=r.company_id;
 select c.name into company_name from public.companies c where c.id=r.company_id;
 select p.name into project_name from public.projects p where p.id=r.project_id and p.company_id=r.company_id;
 return jsonb_build_object('id',r.id,'title',r.title,'scope_of_work',r.scope_of_work,'due_date',r.due_date,'status',r.status,'attachments',r.attachments,'vendor_name',vendor_name,'company_name',company_name,'project_name',project_name,'response_amount',r.response_amount,'response_message',r.response_message);
end $$;
revoke all on function public.process_vendor_response(uuid,text,text,numeric,text) from public;
grant execute on function public.process_vendor_response(uuid,text,text,numeric,text) to anon,authenticated;
-- Field users can request an office checkout and confirm only their own return.
-- No arbitrary reservation fields or warehouse stock updates are accepted.
create function public.inventory_reservation_action(p_reservation uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; r public.inventory_reservations; previous text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if not found then raise exception 'Active account required' using errcode='42501'; end if;
 select * into r from public.inventory_reservations where id=p_reservation and company_id=actor.company_id and assigned_to=actor.id for update;
 if not found then raise exception 'Assigned reservation unavailable' using errcode='42501'; end if;
 if p_action not in ('request_checkout','confirm_return') or p_action is null then raise exception 'Invalid reservation action'; end if;
 previous:=current_setting('notification.reservation_action',true);
 perform set_config('notification.reservation_action',r.id::text||':'||actor.id::text,true);
 if p_action='request_checkout' then
  if r.status<>'Reserved' then raise exception 'Only a reserved item can be requested'; end if;
  if not exists(select 1 from public.inventory where id=r.inventory_id and company_id=actor.company_id and item_type='Equipment' and equipment_status='Available') then raise exception 'Equipment is unavailable; contact your office'; end if;
  if r.checkout_requested_at is null then update public.inventory_reservations set checkout_requested_at=now() where id=r.id returning * into r; end if;
 else
  if r.status='Returned' then null;
  elsif r.status='Checked out' then update public.inventory_reservations set status='Returned' where id=r.id returning * into r;
  else raise exception 'Only checked-out equipment can be returned'; end if;
 end if;
 perform set_config('notification.reservation_action',coalesce(previous,''),true);
 return jsonb_build_object('id',r.id,'status',r.status,'checkout_requested_at',r.checkout_requested_at,'returned_at',r.returned_at);
end $$;
revoke all on function public.inventory_reservation_action(uuid,text) from public,anon;
grant execute on function public.inventory_reservation_action(uuid,text) to authenticated;

alter table public.inventory_transactions add column if not exists user_id uuid references public.profiles(id);
alter table public.inventory_transactions add column if not exists project_id uuid references public.projects(id);
alter table public.inventory_transactions add column if not exists refunded_at timestamptz;
create index inventory_transactions_actor_lookup on public.inventory_transactions(company_id,user_id,created_at desc);
create function notification_private.stock_actor_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb; actor public.profiles;
begin
 d:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if auth.uid() is null then
  if coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
 else
  select * into actor from public.profiles where id=auth.uid() and company_id=(d->>'company_id')::uuid and is_active is distinct from false;
  if not found then raise exception 'Company access required' using errcode='42501'; end if;
  if actor.role not in ('owner','admin','manager','office') and current_setting('notification.stock_actor',true) is distinct from actor.id::text then raise exception 'Use the assigned material workflow; office staff manage warehouse stock' using errcode='42501'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function notification_private.stock_actor_guard() from public,anon,authenticated;
create trigger inventory_stock_actor_guard before insert or update or delete on public.inventory for each row execute function notification_private.stock_actor_guard();
create trigger transaction_stock_actor_guard before insert or update or delete on public.inventory_transactions for each row execute function notification_private.stock_actor_guard();

create function public.consume_inventory_material(p_inventory uuid,p_quantity numeric,p_project uuid default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles; item public.inventory; project_name text; result uuid; previous text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if not found then raise exception 'Active account required' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<=0 or p_quantity>1000000000 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Quantity must be a valid positive amount'; end if;
 if length(coalesce(p_notes,''))>10000 then raise exception 'Notes are too long'; end if;
 select * into item from public.inventory where id=p_inventory and company_id=actor.company_id for update;
 if not found then raise exception 'Material unavailable' using errcode='42501'; end if;
 if item.item_type<>'Material' then raise exception 'Use equipment reservations for reusable equipment'; end if;
 if coalesce(item.quantity_on_hand,0)<p_quantity then raise exception 'Insufficient warehouse stock'; end if;
 if p_project is not null then
  select name into project_name from public.projects where id=p_project and company_id=actor.company_id;
  if not found or (actor.role not in ('owner','admin','manager','office') and not exists(select 1 from public.project_staff where project_id=p_project and company_id=actor.company_id and user_id=actor.id and is_active is distinct from false)) then raise exception 'Assigned project required' using errcode='42501'; end if;
 end if;
 previous:=current_setting('notification.stock_actor',true); perform set_config('notification.stock_actor',actor.id::text,true);
 update public.inventory set quantity_on_hand=quantity_on_hand-p_quantity where id=item.id;
 insert into public.inventory_transactions(company_id,inventory_id,user_id,employee_name,project_id,project_name,quantity_changed,transaction_type,notes)
 values(actor.company_id,item.id,actor.id,coalesce(actor.full_name,actor.email,'Employee'),p_project,project_name,-p_quantity,'Consume',nullif(trim(p_notes),'')) returning id into result;
 perform set_config('notification.stock_actor',coalesce(previous,''),true);
 return result;
end $$;
revoke all on function public.consume_inventory_material(uuid,numeric,uuid,text) from public,anon;
grant execute on function public.consume_inventory_material(uuid,numeric,uuid,text) to authenticated;

create function public.refund_inventory_material(p_transaction uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles; tx public.inventory_transactions; previous text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if not found then raise exception 'Active account required' using errcode='42501'; end if;
 select * into tx from public.inventory_transactions where id=p_transaction and company_id=actor.company_id and user_id=actor.id and transaction_type='Consume' and quantity_changed<0 for update;
 if not found then raise exception 'Your material usage record is unavailable' using errcode='42501'; end if;
 if tx.refunded_at is not null then return tx.id; end if;
 perform 1 from public.inventory where id=tx.inventory_id and company_id=actor.company_id and item_type='Material' for update;
 if not found then raise exception 'Material unavailable'; end if;
 previous:=current_setting('notification.stock_actor',true); perform set_config('notification.stock_actor',actor.id::text,true);
 update public.inventory set quantity_on_hand=coalesce(quantity_on_hand,0)-tx.quantity_changed where id=tx.inventory_id;
 update public.inventory_transactions set refunded_at=now() where id=tx.id;
 perform set_config('notification.stock_actor',coalesce(previous,''),true);
 return tx.id;
end $$;
revoke all on function public.refund_inventory_material(uuid) from public,anon;
grant execute on function public.refund_inventory_material(uuid) to authenticated;
notify pgrst, 'reload schema';
