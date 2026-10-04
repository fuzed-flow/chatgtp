-- Explicit warranty and document workflows. No historical claims or outbound emails are created.
create schema if not exists workflow_private;
revoke all on schema workflow_private from public, anon, authenticated;
grant usage on schema workflow_private to anon, authenticated, service_role;

create or replace function workflow_private.staff_access(c uuid, p uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles u where u.id=(select auth.uid()) and u.company_id=c
   and u.is_active is distinct from false and u.role in ('owner','admin','office','manager')
   and (u.role in ('owner','admin') or coalesce(jsonb_array_length(u.permissions),0)=0 or u.permissions ? 'projects')
   and (u.role != 'manager' or p is null or exists(select 1 from public.project_staff s where s.company_id=c and s.project_id=p and s.user_id=u.id and s.is_active is distinct from false)));
$$;
revoke all on function workflow_private.staff_access(uuid,uuid) from public,anon;
grant execute on function workflow_private.staff_access(uuid,uuid) to authenticated;

create table public.warranty_claims (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), client_id uuid references public.clients(id),
 title text not null check(length(btrim(title)) between 1 and 200), description text not null check(length(btrim(description)) between 1 and 10000),
 customer_name text not null default '' check(length(customer_name)<=200), customer_email text check(customer_email is null or (length(customer_email)<=254 and customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')), status text not null default 'Open' check(status in ('Open','In Progress','Awaiting Customer','Resolved','Closed')),
 priority text not null default 'Normal' check(priority in ('Normal','Urgent')), assigned_to uuid references public.profiles(id),
 response_due_at timestamptz not null default now()+interval '3 days', repair_visit_at timestamptz,
 resolution text check(length(resolution)<=10000), resolved_at timestamptz, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index warranty_claims_company_recent on public.warranty_claims(company_id,created_at desc,id);
create index warranty_claims_open_deadline on public.warranty_claims(response_due_at,company_id) where status not in ('Resolved','Closed');
create table public.warranty_updates (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 claim_id uuid not null references public.warranty_claims(id), message text not null check(length(btrim(message)) between 1 and 10000),
 kind text not null default 'staff_note' check(kind in ('staff_note','customer_update','repair_confirmation','reopened')),
 visible_to_customer boolean not null default false, author_id uuid references public.profiles(id), author_name text not null default '', created_at timestamptz not null default now()
);
create index warranty_updates_claim_recent on public.warranty_updates(company_id,claim_id,created_at);
create table public.warranty_audit (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), claim_id uuid not null references public.warranty_claims(id),
 actor_id uuid references public.profiles(id), actor_name text not null, event text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index warranty_audit_claim on public.warranty_audit(company_id,claim_id,created_at);
alter table public.warranty_audit enable row level security;
revoke all on public.warranty_audit from public,anon,authenticated;
grant select on public.warranty_audit to authenticated;
grant all on public.warranty_audit to service_role;

alter table public.project_documents add column if not exists file_sha256 text;
alter table public.project_documents add column if not exists uploaded_by uuid references public.profiles(id);
alter table public.project_drawings add column if not exists file_sha256 text;
alter table public.project_drawings add column if not exists uploaded_by uuid references public.profiles(id);
alter table public.project_drawings add column if not exists supersedes_id uuid references public.project_drawings(id);

create table public.document_requests (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), document_id uuid not null references public.project_documents(id),
 title text not null, request_type text not null check(request_type in ('review','signature')),
 recipient_id uuid references public.profiles(id), recipient_name text not null, recipient_email text not null,
 instructions text not null default '', status text not null default 'Pending' check(status in ('Pending','Reviewed','Signed','Declined','Expired','Cancelled')),
 document_name text not null, document_url text not null, document_sha256 text,
 expires_at timestamptz not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 responded_at timestamptz, signer_name text, response_message text, consent_version text,
 email_requested_at timestamptz, reminder_requested_at timestamptz
);
create index document_requests_company_project on public.document_requests(company_id,project_id,created_at desc);
create index document_requests_pending_expiry on public.document_requests(expires_at,company_id) where status='Pending';
create table public.document_request_audit (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 request_id uuid not null references public.document_requests(id), event text not null,
 actor_id uuid references public.profiles(id), actor_name text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index document_request_audit_request on public.document_request_audit(company_id,request_id,created_at);
create table workflow_private.capabilities (
 token_hash text primary key, company_id uuid not null references public.companies(id),
 kind text not null check(kind in ('document','warranty')), entity_id uuid not null,
 expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table workflow_private.warranty_portals (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), client_id uuid not null references public.clients(id),
 claim_id uuid references public.warranty_claims(id), customer_name text not null, customer_email text not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), last_email_at timestamptz
);
create unique index warranty_portal_project_scope on workflow_private.warranty_portals(company_id,project_id,client_id) where claim_id is null;
create unique index warranty_portal_claim_scope on workflow_private.warranty_portals(company_id,claim_id) where claim_id is not null;
alter table workflow_private.warranty_portals enable row level security;
revoke all on workflow_private.warranty_portals from public,anon,authenticated;
grant all on workflow_private.warranty_portals to service_role;
alter table workflow_private.capabilities enable row level security;
revoke all on workflow_private.capabilities from public,anon,authenticated;
grant all on workflow_private.capabilities to service_role;

alter table public.warranty_claims enable row level security;
alter table public.warranty_updates enable row level security;
alter table public.document_requests enable row level security;
alter table public.document_request_audit enable row level security;
revoke all on public.warranty_claims,public.warranty_updates,public.document_requests,public.document_request_audit from public,anon,authenticated;
grant select,insert,update on public.warranty_claims to authenticated;
grant select,insert on public.warranty_updates to authenticated;
grant select on public.document_requests,public.document_request_audit to authenticated;
grant all on public.warranty_claims,public.warranty_updates,public.document_requests,public.document_request_audit to service_role;
create policy warranty_claims_staff_read on public.warranty_claims for select to authenticated using (
 workflow_private.staff_access(company_id,project_id) or (assigned_to=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=warranty_claims.company_id and p.is_active is distinct from false)));
create policy warranty_claims_staff_insert on public.warranty_claims for insert to authenticated with check(workflow_private.staff_access(company_id,project_id));
create policy warranty_claims_staff_update on public.warranty_claims for update to authenticated using(workflow_private.staff_access(company_id,project_id)) with check(workflow_private.staff_access(company_id,project_id));
create policy warranty_updates_read on public.warranty_updates for select to authenticated using(exists(select 1 from public.warranty_claims c where c.id=claim_id and c.company_id=warranty_updates.company_id));
create policy warranty_updates_write on public.warranty_updates for insert to authenticated with check(exists(select 1 from public.warranty_claims c where c.id=claim_id and c.company_id=warranty_updates.company_id and (workflow_private.staff_access(c.company_id,c.project_id) or c.assigned_to=(select auth.uid()))));
create policy warranty_audit_read on public.warranty_audit for select to authenticated using(exists(select 1 from public.warranty_claims c where c.id=claim_id and c.company_id=warranty_audit.company_id));
create policy document_requests_staff_read on public.document_requests for select to authenticated using(workflow_private.staff_access(company_id,project_id) or (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=document_requests.company_id and p.is_active is distinct from false)));
create policy document_request_audit_staff_read on public.document_request_audit for select to authenticated using(exists(select 1 from public.document_requests r where r.id=request_id and r.company_id=document_request_audit.company_id));

create or replace function workflow_private.guard_warranty()
returns trigger language plpgsql security definer set search_path='' as $$
declare u public.profiles; c public.clients; p public.projects; capability_authorized boolean;
begin
 if new.project_id is not null then
   select * into p from public.projects where id=new.project_id and company_id=new.company_id;
   if not found then raise exception 'Project does not belong to this company'; end if;
   new.client_id:=coalesce(new.client_id,p.client_id);
 end if;
 if new.client_id is not null then
   select * into c from public.clients where id=new.client_id and company_id=new.company_id;
   if not found or (p.client_id is not null and p.client_id<>new.client_id) then raise exception 'Client does not belong to this project/company'; end if;
   if btrim(new.customer_name)='' then new.customer_name:=coalesce(nullif(c.name,''),nullif(btrim(concat_ws(' ',c.first_name,c.surname)),''),'Customer'); end if;
   new.customer_email:=coalesce(new.customer_email,c.email);
 end if;
 if new.assigned_to is not null and not exists(select 1 from public.profiles where id=new.assigned_to and company_id=new.company_id and is_active is distinct from false) then raise exception 'Assignee does not belong to this company'; end if;
 if tg_op='UPDATE' and (new.id,new.company_id,new.project_id,new.client_id,new.created_by,new.created_at) is distinct from (old.id,old.company_id,old.project_id,old.client_id,old.created_by,old.created_at) then raise exception 'Claim ownership is immutable'; end if;
 capability_authorized:=exists(select 1 from workflow_private.capabilities cap join workflow_private.warranty_portals portal on portal.id=cap.entity_id and portal.company_id=cap.company_id
   where cap.token_hash=current_setting('workflow.customer_token_hash',true) and cap.kind='warranty' and cap.revoked_at is null and cap.expires_at>now()
   and portal.company_id=new.company_id and portal.project_id=new.project_id and portal.client_id=new.client_id and (portal.claim_id is null or portal.claim_id=new.id));
 if (select auth.uid()) is not null and not capability_authorized then
   select * into u from public.profiles where id=(select auth.uid()) and company_id=new.company_id and is_active is distinct from false;
   if not found then raise exception 'Active company membership required'; end if;
   new.updated_by:=u.id;
   if tg_op='INSERT' then new.created_by:=u.id; end if;
 else new.updated_by:=null; end if;
 if tg_op='INSERT' then new.created_at:=now(); end if;
 new.updated_at:=clock_timestamp();
 if new.status in ('Awaiting Customer','Resolved','Closed') then
   if nullif(btrim(new.resolution),'') is null then raise exception 'Add a resolution before resolving or closing this claim'; end if;
   new.resolved_at:=case when new.status='Awaiting Customer' then null else coalesce(new.resolved_at,now()) end;
 else new.resolved_at:=null; end if;
 return new;
end $$;
revoke all on function workflow_private.guard_warranty() from public,anon,authenticated;
create trigger warranty_claims_guard before insert or update on public.warranty_claims for each row execute function workflow_private.guard_warranty();

create or replace function workflow_private.guard_warranty_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.warranty_claims; u public.profiles; capability_authorized boolean;
begin
 select * into c from public.warranty_claims where id=new.claim_id and company_id=new.company_id;
 if not found then raise exception 'Claim not found in company'; end if;
 capability_authorized:=exists(select 1 from workflow_private.capabilities cap join workflow_private.warranty_portals portal on portal.id=cap.entity_id and portal.company_id=cap.company_id
   where cap.token_hash=current_setting('workflow.customer_token_hash',true) and cap.kind='warranty' and cap.revoked_at is null and cap.expires_at>now()
   and portal.company_id=c.company_id and portal.project_id=c.project_id and portal.client_id=c.client_id and (portal.claim_id is null or portal.claim_id=c.id));
 if (select auth.uid()) is not null and not capability_authorized then
   select * into u from public.profiles where id=(select auth.uid()) and company_id=new.company_id and is_active is distinct from false;
   if not found or not (workflow_private.staff_access(c.company_id,c.project_id) or c.assigned_to=u.id) then raise exception 'Claim access denied'; end if;
   new.author_id:=u.id; new.author_name:=coalesce(nullif(u.full_name,''),'Team member'); new.kind:='staff_note';
 else new.author_id:=null; new.author_name:=c.customer_name; end if;
 new.created_at:=now();
 return new;
end $$;
revoke all on function workflow_private.guard_warranty_update() from public,anon,authenticated;
create trigger warranty_updates_guard before insert on public.warranty_updates for each row execute function workflow_private.guard_warranty_update();

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('warranty_created','New warranty claim','Action Required','Warranty',array['owner','admin','office','manager'],'leadership','projects'),
 ('warranty_assigned','Warranty claim assigned','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'assigned','projects'),
 ('warranty_customer_updated','Customer updated warranty claim','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_response_due','Warranty response deadline approaching','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_response_overdue','Warranty response overdue','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_repair_scheduled','Warranty repair visit scheduled or changed','Important','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_confirmation_pending','Warranty repair awaiting confirmation','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_resolved','Warranty claim resolved','Important','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('warranty_reopened','Warranty claim reopened','Action Required','Warranty',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('plan_uploaded','New project plan uploaded','Important','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('plan_revised','Project plan revised','Action Required','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('document_review_requested','Document review requested','Action Required','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('document_signature_requested','Document signature requested','Action Required','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('document_reviewed','Document review completed','Important','Documents',array['owner','admin','office','manager'],'leadership','projects'),
 ('document_signed','Document signed','Important','Documents',array['owner','admin','office','manager'],'leadership','projects'),
 ('document_signature_declined','Document request declined','Action Required','Documents',array['owner','admin','office','manager'],'leadership','projects'),
 ('document_request_expiring','Document request approaching expiry','Action Required','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects'),
 ('document_request_expired','Document request expired','Action Required','Documents',array['owner','admin','office','manager'],'leadership','projects'),
 ('document_request_reminder','Document response reminder','Action Required','Documents',array['owner','admin','office','manager','employee','subcontractor'],'project','projects')
on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;
update notification_private.event_rules set audience='assigned' where event_key in ('warranty_customer_updated','warranty_response_due','warranty_response_overdue','warranty_repair_scheduled','warranty_confirmation_pending','warranty_resolved','warranty_reopened','document_review_requested','document_signature_requested','document_request_expiring','document_request_reminder');

create or replace function workflow_private.claim_targets(c uuid,p uuid,a uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(u.id),'{}'::uuid[]) from public.profiles u where u.company_id=c and u.is_active is distinct from false and
 (u.id=a or u.role in ('owner','admin','office') or (u.role='manager' and (p is null or exists(select 1 from public.project_staff s where s.company_id=c and s.project_id=p and s.user_id=u.id and s.is_active is distinct from false))));
$$;
revoke all on function workflow_private.claim_targets(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function notification_private.documents_source_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare e text; d jsonb:=to_jsonb(new); o jsonb:='{}'; c public.warranty_claims; targets uuid[]:='{}'; actor uuid:=auth.uid(); label text; k text;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 k:=tg_table_name||':'||new.id||':'||md5(d::text);
 if tg_table_name='warranty_claims' then
   label:=new.title||' for '||coalesce(nullif(new.customer_name,''),'Customer'); actor:=new.updated_by; targets:=workflow_private.claim_targets(new.company_id,new.project_id,new.assigned_to);
   if tg_op='INSERT' then e:='warranty_created';
   elsif new.status is distinct from old.status then e:=case when new.status in ('Resolved','Closed') then 'warranty_resolved' when old.status in ('Resolved','Closed') then 'warranty_reopened' when new.status='Awaiting Customer' then 'warranty_confirmation_pending' end; end if;
   if e is not null then perform notification_private.emit(new.company_id,e,'WarrantyClaim',new.id,new.project_id,targets,label,k||':'||e,actor); end if;
   if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then perform notification_private.emit(new.company_id,'warranty_assigned','WarrantyClaim',new.id,new.project_id,array[new.assigned_to],label,k||':assigned',actor); end if;
   insert into public.warranty_audit(company_id,claim_id,actor_id,actor_name,event,details)
   values(new.company_id,new.id,actor,coalesce((select nullif(full_name,'') from public.profiles where id=actor and company_id=new.company_id),nullif(new.customer_name,''),'Fuzed Flow'),
     case when tg_op='INSERT' then 'claim_created' else 'claim_updated' end,jsonb_build_object('previous_status',o->>'status','status',new.status,'assigned_to',new.assigned_to,'response_due_at',new.response_due_at,'repair_visit_at',new.repair_visit_at,'resolution',new.resolution));
   if tg_op='UPDATE' and new.repair_visit_at is distinct from old.repair_visit_at then perform notification_private.emit(new.company_id,'warranty_repair_scheduled','WarrantyClaim',new.id,new.project_id,targets,label||case when new.repair_visit_at is null then ': visit cancelled' else ': visit '||new.repair_visit_at::text end,k||':visit',actor); end if;
 elsif tg_table_name='warranty_updates' then
   select * into c from public.warranty_claims where id=new.claim_id and company_id=new.company_id;
   if new.kind<>'staff_note' then perform notification_private.emit(new.company_id,'warranty_customer_updated','WarrantyClaim',c.id,c.project_id,workflow_private.claim_targets(c.company_id,c.project_id,c.assigned_to),coalesce(nullif(new.author_name,''),'Customer')||' updated '||c.title,k,null); end if;
 elsif tg_table_name='project_drawings' then
   label:=coalesce(nullif(new.title,''),new.file_name,'Project plan');
   if tg_op='INSERT' then e:=case when new.supersedes_id is null then 'plan_uploaded' else 'plan_revised' end;
   elsif (new.file_url,new.revision,new.file_sha256) is distinct from (old.file_url,old.revision,old.file_sha256) then e:='plan_revised'; end if;
   if e is not null then perform notification_private.emit(new.company_id,e,'ProjectPlan',new.id,new.project_id,'{}',label||coalesce(' (Rev '||nullif(new.revision,'')||')',''),k,coalesce(new.uploaded_by,actor)); end if;
 elsif tg_table_name='document_requests' then
   label:=new.title||' for '||new.recipient_name; targets:=array[new.recipient_id,new.created_by];
   if tg_op='INSERT' then e:=case when new.request_type='signature' then 'document_signature_requested' else 'document_review_requested' end;
   elsif new.status is distinct from old.status then e:=case new.status when 'Signed' then 'document_signed' when 'Reviewed' then 'document_reviewed' when 'Declined' then 'document_signature_declined' when 'Expired' then 'document_request_expired' end; end if;
   if e is not null then perform notification_private.emit(new.company_id,e,'DocumentRequest',new.id,new.project_id,targets,label,k,case when tg_op='INSERT' then new.created_by else null end); end if;
 end if;
 return new;
end $$;
revoke all on function notification_private.documents_source_event() from public,anon,authenticated;
create trigger notification_warranty_claims after insert or update on public.warranty_claims for each row execute function notification_private.documents_source_event();
create trigger notification_warranty_updates after insert on public.warranty_updates for each row execute function notification_private.documents_source_event();
create trigger notification_project_drawings after insert or update on public.project_drawings for each row execute function notification_private.documents_source_event();
create trigger notification_document_requests after insert or update on public.document_requests for each row execute function notification_private.documents_source_event();

create or replace function workflow_private.token_hash(t text)
returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(t,'UTF8')),'hex')$$;
revoke all on function workflow_private.token_hash(text) from public,anon,authenticated;

create or replace function workflow_private.create_document_request(p_document uuid,p_type text,p_name text,p_email text,p_expires timestamptz,p_instructions text default '',p_recipient uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.project_documents; r public.document_requests; t text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); uid uuid:=auth.uid();
begin
 select * into d from public.project_documents where id=p_document;
 if not found or uid is null or not workflow_private.staff_access(d.company_id,d.project_id) then raise exception 'Document access denied'; end if;
 if p_type not in ('review','signature') or length(btrim(p_name)) not between 1 and 200 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_email)>254 then raise exception 'Enter a valid request type, recipient name and email'; end if;
 if p_expires<=now()+interval '1 minute' or p_expires>now()+interval '180 days' or p_expires is null then raise exception 'Choose an expiry within the next 180 days'; end if;
 if d.file_url !~ '^https://' or nullif(d.file_name,'') is null then raise exception 'Upload a document before requesting review or signature'; end if;
 if p_recipient is not null and not exists(select 1 from public.profiles where id=p_recipient and company_id=d.company_id and is_active is distinct from false and lower(email)=lower(p_email)) then raise exception 'Recipient does not belong to this company'; end if;
 insert into public.document_requests(company_id,project_id,document_id,title,request_type,recipient_id,recipient_name,recipient_email,instructions,document_name,document_url,document_sha256,expires_at,created_by)
 values(d.company_id,d.project_id,d.id,d.file_name,p_type,p_recipient,btrim(p_name),lower(btrim(p_email)),left(coalesce(p_instructions,''),5000),d.file_name,d.file_url,d.file_sha256,p_expires,uid) returning * into r;
 insert into workflow_private.capabilities(token_hash,company_id,kind,entity_id,expires_at) values(workflow_private.token_hash(t),d.company_id,'document',r.id,p_expires);
 insert into public.document_request_audit(company_id,request_id,event,actor_id,actor_name,details) select d.company_id,r.id,'requested',uid,coalesce(nullif(full_name,''),'Team member'),jsonb_build_object('document_name',d.file_name,'document_sha256',d.file_sha256,'request_type',p_type,'expires_at',p_expires) from public.profiles where id=uid and company_id=d.company_id;
 return jsonb_build_object('request_id',r.id,'token',t,'expires_at',p_expires);
end $$;
revoke all on function workflow_private.create_document_request(uuid,text,text,text,timestamptz,text,uuid) from public,anon;
grant execute on function workflow_private.create_document_request(uuid,text,text,text,timestamptz,text,uuid) to authenticated;
create or replace function public.create_document_request(p_document uuid,p_type text,p_name text,p_email text,p_expires timestamptz,p_instructions text default '',p_recipient uuid default null)
returns jsonb language sql security invoker set search_path='' as $$select workflow_private.create_document_request(p_document,p_type,p_name,p_email,p_expires,p_instructions,p_recipient)$$;
revoke all on function public.create_document_request(uuid,text,text,text,timestamptz,text,uuid) from public,anon;
grant execute on function public.create_document_request(uuid,text,text,text,timestamptz,text,uuid) to authenticated;

create or replace function workflow_private.document_details(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.document_requests; cap workflow_private.capabilities; company_name text; company_timezone text;
begin
 if length(p_token)<>64 then raise exception 'This document link is invalid or expired'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and kind='document' and revoked_at is null and expires_at>now();
 if not found then raise exception 'This document link is invalid or expired'; end if;
 select * into r from public.document_requests where id=cap.entity_id and company_id=cap.company_id and expires_at>now() and status not in ('Expired','Cancelled');
 if not found then raise exception 'This document link is invalid or expired'; end if;
 select name,coalesce(nullif(timezone,''),'UTC') into company_name,company_timezone from public.companies where id=r.company_id;
 return jsonb_build_object('id',r.id,'company_name',company_name,'timezone',company_timezone,'title',r.title,'request_type',r.request_type,'recipient_name',r.recipient_name,'instructions',r.instructions,'status',r.status,'document_name',r.document_name,'document_url',r.document_url,'document_sha256',r.document_sha256,'expires_at',r.expires_at,'responded_at',r.responded_at,'signer_name',r.signer_name,'response_message',r.response_message);
end $$;
revoke all on function workflow_private.document_details(text) from public;
grant execute on function workflow_private.document_details(text) to anon,authenticated;
create or replace function public.document_request_details(p_token text) returns jsonb language sql security invoker set search_path='' as $$select workflow_private.document_details(p_token)$$;
revoke all on function public.document_request_details(text) from public;
grant execute on function public.document_request_details(text) to anon,authenticated;

create or replace function workflow_private.document_respond(p_token text,p_action text,p_name text,p_message text default '',p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.document_requests; cap workflow_private.capabilities; next_status text;
begin
 if length(p_token)<>64 then raise exception 'This document link is invalid or expired'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and kind='document' and revoked_at is null and expires_at>now();
 if not found then raise exception 'This document link is invalid or expired'; end if;
 select * into r from public.document_requests where id=cap.entity_id and company_id=cap.company_id for update;
 if not found or r.expires_at<=now() or r.status in ('Expired','Cancelled') then raise exception 'This document link is invalid or expired'; end if;
 if r.status<>'Pending' then return workflow_private.document_details(p_token); end if;
 if length(btrim(p_name)) not between 1 and 200 then raise exception 'Enter your full name'; end if;
 if p_action='decline' then next_status:='Declined';
 elsif p_action='complete' and p_consent then next_status:=case r.request_type when 'signature' then 'Signed' else 'Reviewed' end;
 else raise exception 'Confirm your consent before completing this request'; end if;
 update public.document_requests set status=next_status,responded_at=now(),signer_name=btrim(p_name),response_message=left(coalesce(p_message,''),5000),consent_version=case when p_consent then 'fuzedflow-electronic-consent-v1' end where id=r.id and company_id=r.company_id;
 insert into public.document_request_audit(company_id,request_id,event,actor_name,details) values(r.company_id,r.id,lower(next_status),btrim(p_name),jsonb_build_object('recipient_email',r.recipient_email,'document_name',r.document_name,'document_sha256',r.document_sha256,'consent_version',case when p_consent then 'fuzedflow-electronic-consent-v1' end,'message',left(coalesce(p_message,''),5000)));
 return workflow_private.document_details(p_token);
end $$;
revoke all on function workflow_private.document_respond(text,text,text,text,boolean) from public;
grant execute on function workflow_private.document_respond(text,text,text,text,boolean) to anon,authenticated;
create or replace function public.respond_document_request(p_token text,p_action text,p_name text,p_message text default '',p_consent boolean default false) returns jsonb language sql security invoker set search_path='' as $$select workflow_private.document_respond(p_token,p_action,p_name,p_message,p_consent)$$;
revoke all on function public.respond_document_request(text,text,text,text,boolean) from public;
grant execute on function public.respond_document_request(text,text,text,text,boolean) to anon,authenticated;

create or replace function workflow_private.cancel_document(p_request uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.document_requests;
begin
 select * into r from public.document_requests where id=p_request for update;
 if not found or not workflow_private.staff_access(r.company_id,r.project_id) then raise exception 'Document access denied'; end if;
 if r.status<>'Pending' then raise exception 'Only pending requests can be cancelled'; end if;
 update public.document_requests set status='Cancelled' where id=r.id;
 update workflow_private.capabilities set revoked_at=now() where entity_id=r.id and kind='document';
 insert into public.document_request_audit(company_id,request_id,event,actor_id,actor_name) select r.company_id,r.id,'cancelled',auth.uid(),coalesce(nullif(full_name,''),'Team member') from public.profiles where id=auth.uid() and company_id=r.company_id;
 return true;
end $$;
revoke all on function workflow_private.cancel_document(uuid) from public,anon;
grant execute on function workflow_private.cancel_document(uuid) to authenticated;
create or replace function public.cancel_document_request(p_request uuid) returns boolean language sql security invoker set search_path='' as $$select workflow_private.cancel_document(p_request)$$;
revoke all on function public.cancel_document_request(uuid) from public,anon;
grant execute on function public.cancel_document_request(uuid) to authenticated;

create or replace function notification_private.document_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare r record; e text; n integer:=0;
begin
 for r in select c.*,coalesce(nullif(co.timezone,''),'UTC') zone from public.warranty_claims c join public.companies co on co.id=c.company_id where c.status in ('Open','In Progress') and c.response_due_at<=p_now+interval '24 hours' loop
   e:=case when r.response_due_at<=p_now then 'warranty_response_overdue' else 'warranty_response_due' end;
   n:=n+notification_private.emit(r.company_id,e,'WarrantyClaim',r.id,r.project_id,workflow_private.claim_targets(r.company_id,r.project_id,r.assigned_to),r.title||' for '||r.customer_name||': respond by '||r.response_due_at::text,e||':'||r.id||':'||(p_now at time zone r.zone)::date,null);
 end loop;
 for r in select * from public.document_requests where status='Pending' and expires_at<=p_now+interval '48 hours' loop
   if r.expires_at<=p_now then update public.document_requests set status='Expired' where id=r.id and status='Pending';
     if found then insert into public.document_request_audit(company_id,request_id,event,actor_name) values(r.company_id,r.id,'expired','Fuzed Flow'); end if;
   else n:=n+notification_private.emit(r.company_id,'document_request_expiring','DocumentRequest',r.id,r.project_id,array[r.recipient_id,r.created_by],r.title||' for '||r.recipient_name||': expires '||r.expires_at::text,'document_request_expiring:'||r.id||':'||r.expires_at,null); end if;
 end loop;
 for r in select * from public.document_requests where status='Pending' and expires_at>p_now+interval '48 hours' and created_at<=p_now-interval '3 days' loop
   n:=n+notification_private.emit(r.company_id,'document_request_reminder','DocumentRequest',r.id,r.project_id,array[r.recipient_id,r.created_by],r.title||' for '||r.recipient_name||': response pending','document_request_reminder:'||r.id||':'||to_char(p_now,'IYYY-IW'),null);
 end loop;
 return n;
end $$;
revoke all on function notification_private.document_reminders(timestamptz) from public,anon,authenticated;

create or replace function workflow_private.create_warranty_link(p_project uuid,p_claim uuid default null,p_expires timestamptz default now()+interval '30 days')
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects; c public.clients; claim public.warranty_claims; portal workflow_private.warranty_portals; t text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 select * into p from public.projects where id=p_project;
 if not found or not workflow_private.staff_access(p.company_id,p.id) then raise exception 'Project access denied'; end if;
 select * into c from public.clients where id=p.client_id and company_id=p.company_id;
 if not found or c.email is null or c.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Add a valid email to the project client before sharing warranty access'; end if;
 if p_expires<=now()+interval '1 minute' or p_expires>now()+interval '180 days' or p_expires is null then raise exception 'Choose an expiry within the next 180 days'; end if;
 if p_claim is not null then
   select * into claim from public.warranty_claims where id=p_claim and company_id=p.company_id and project_id=p.id and client_id=c.id;
   if not found then raise exception 'Warranty claim does not belong to this project/client'; end if;
   select * into portal from workflow_private.warranty_portals where company_id=p.company_id and claim_id=p_claim;
 else select * into portal from workflow_private.warranty_portals where company_id=p.company_id and project_id=p.id and client_id=c.id and claim_id is null; end if;
 if portal.id is null then
   insert into workflow_private.warranty_portals(company_id,project_id,client_id,claim_id,customer_name,customer_email,created_by)
   values(p.company_id,p.id,c.id,p_claim,coalesce(nullif(c.name,''),nullif(btrim(concat_ws(' ',c.first_name,c.surname)),''),'Customer'),c.email,auth.uid()) returning * into portal;
 else
   update workflow_private.warranty_portals set customer_name=coalesce(nullif(c.name,''),nullif(btrim(concat_ws(' ',c.first_name,c.surname)),''),'Customer'),customer_email=c.email where id=portal.id and company_id=p.company_id returning * into portal;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('warranty-link:'||portal.id,0));
 update workflow_private.capabilities set revoked_at=now() where kind='warranty' and entity_id=portal.id and revoked_at is null;
 insert into workflow_private.capabilities(token_hash,company_id,kind,entity_id,expires_at) values(workflow_private.token_hash(t),p.company_id,'warranty',portal.id,p_expires);
 return jsonb_build_object('portal_id',portal.id,'token',t,'expires_at',p_expires,'customer_email',portal.customer_email);
end $$;
revoke all on function workflow_private.create_warranty_link(uuid,uuid,timestamptz) from public,anon;
grant execute on function workflow_private.create_warranty_link(uuid,uuid,timestamptz) to authenticated;
create or replace function public.create_warranty_link(p_project uuid,p_claim uuid default null,p_expires timestamptz default now()+interval '30 days') returns jsonb language sql security invoker set search_path='' as $$select workflow_private.create_warranty_link(p_project,p_claim,p_expires)$$;
revoke all on function public.create_warranty_link(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.create_warranty_link(uuid,uuid,timestamptz) to authenticated;

create or replace function workflow_private.warranty_details(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cap workflow_private.capabilities; portal workflow_private.warranty_portals; claims jsonb;
begin
 if length(p_token)<>64 then raise exception 'This warranty link is invalid or expired. Ask your contractor for a new link.'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and kind='warranty' and revoked_at is null and expires_at>now();
 if not found then raise exception 'This warranty link is invalid or expired. Ask your contractor for a new link.'; end if;
 select * into portal from workflow_private.warranty_portals where id=cap.entity_id and company_id=cap.company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'status',c.status,'repair_visit_at',c.repair_visit_at,'resolution',c.resolution,'created_at',c.created_at,
   'updates',(select coalesce(jsonb_agg(jsonb_build_object('message',u.message,'author_name',u.author_name,'created_at',u.created_at,'kind',u.kind) order by u.created_at),'[]') from (select message,author_name,created_at,kind from public.warranty_updates where claim_id=c.id and company_id=c.company_id and visible_to_customer order by created_at desc limit 20) u)) order by c.created_at desc),'[]') into claims
 from (select * from public.warranty_claims c where c.company_id=portal.company_id and c.project_id=portal.project_id and c.client_id=portal.client_id and (portal.claim_id is null or c.id=portal.claim_id) order by created_at desc limit 50) c;
 return jsonb_build_object('company_name',(select name from public.companies where id=portal.company_id),'timezone',(select coalesce(nullif(timezone,''),'UTC') from public.companies where id=portal.company_id),'project_name',(select name from public.projects where id=portal.project_id and company_id=portal.company_id),'customer_name',portal.customer_name,'can_create',portal.claim_id is null,'expires_at',cap.expires_at,'claims',claims);
end $$;
revoke all on function workflow_private.warranty_details(text) from public;
grant execute on function workflow_private.warranty_details(text) to anon,authenticated;
create or replace function public.warranty_portal_details(p_token text) returns jsonb language sql security invoker set search_path='' as $$select workflow_private.warranty_details(p_token)$$;
revoke all on function public.warranty_portal_details(text) from public;
grant execute on function public.warranty_portal_details(text) to anon,authenticated;

create or replace function workflow_private.warranty_respond(p_token text,p_action text,p_claim uuid default null,p_title text default '',p_message text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cap workflow_private.capabilities; portal workflow_private.warranty_portals; c public.warranty_claims;
begin
 if length(p_token)<>64 then raise exception 'This warranty link is invalid or expired. Ask your contractor for a new link.'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and kind='warranty' and revoked_at is null and expires_at>now();
 if not found then raise exception 'This warranty link is invalid or expired. Ask your contractor for a new link.'; end if;
 select * into portal from workflow_private.warranty_portals where id=cap.entity_id and company_id=cap.company_id;
 if length(btrim(p_message)) not between 1 and 10000 or p_message is null then raise exception 'Enter the claim details or update'; end if;
 perform pg_advisory_xact_lock(hashtextextended('warranty-response:'||portal.id,0));
 if (select count(*) from public.warranty_updates where company_id=portal.company_id and claim_id in (select id from public.warranty_claims where company_id=portal.company_id and project_id=portal.project_id and client_id=portal.client_id) and kind<>'staff_note' and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily update limit reached. Please contact your contractor directly.'; end if;
 perform set_config('workflow.customer_token_hash',cap.token_hash,true);
 if p_action='create' then
   if portal.claim_id is not null or length(btrim(p_title)) not between 1 and 200 or p_title is null then raise exception 'Enter a claim title using the project warranty link'; end if;
   if (select count(*) from public.warranty_claims where company_id=portal.company_id and project_id=portal.project_id and client_id=portal.client_id and created_at>now()-interval '24 hours')>=5 then raise exception 'Daily claim limit reached. Please contact your contractor directly.'; end if;
   insert into public.warranty_claims(company_id,project_id,client_id,title,description,customer_name,customer_email) values(portal.company_id,portal.project_id,portal.client_id,btrim(p_title),btrim(p_message),portal.customer_name,portal.customer_email) returning * into c;
 else
   select * into c from public.warranty_claims where id=p_claim and company_id=portal.company_id and project_id=portal.project_id and client_id=portal.client_id and (portal.claim_id is null or id=portal.claim_id) for update;
   if not found then raise exception 'Claim not found for this warranty link'; end if;
   if p_action='confirm' then
     if c.status<>'Awaiting Customer' then raise exception 'This claim is not awaiting repair confirmation'; end if;
     update public.warranty_claims set status='Resolved' where id=c.id;
   elsif p_action='reopen' then
     if c.status not in ('Resolved','Closed') then raise exception 'Only resolved claims can be reopened'; end if;
     update public.warranty_claims set status='Open',response_due_at=now()+interval '3 days' where id=c.id;
   elsif p_action<>'update' or p_action is null then raise exception 'Invalid warranty action'; end if;
   insert into public.warranty_updates(company_id,claim_id,message,kind,visible_to_customer,author_name) values(portal.company_id,c.id,btrim(p_message),case p_action when 'confirm' then 'repair_confirmation' when 'reopen' then 'reopened' else 'customer_update' end,true,portal.customer_name);
 end if;
 perform set_config('workflow.customer_token_hash','',true);
 return workflow_private.warranty_details(p_token);
end $$;
revoke all on function workflow_private.warranty_respond(text,text,uuid,text,text) from public;
grant execute on function workflow_private.warranty_respond(text,text,uuid,text,text) to anon,authenticated;
create or replace function public.respond_warranty_claim(p_token text,p_action text,p_claim uuid default null,p_title text default '',p_message text default '') returns jsonb language sql security invoker set search_path='' as $$select workflow_private.warranty_respond(p_token,p_action,p_claim,p_title,p_message)$$;
revoke all on function public.respond_warranty_claim(text,text,uuid,text,text) from public;
grant execute on function public.respond_warranty_claim(text,text,uuid,text,text) to anon,authenticated;

-- Source ownership stays scoped even where legacy document policies are broader.
create or replace function workflow_private.guard_project_file()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.projects p where p.id=new.project_id and p.company_id=new.company_id) then raise exception 'Project does not belong to this company'; end if;
 if tg_op='UPDATE' and (new.id,new.company_id,new.project_id) is distinct from (old.id,old.company_id,old.project_id) then raise exception 'File ownership is immutable'; end if;
 if new.file_sha256 is not null and new.file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file checksum'; end if;
 if auth.uid() is not null then
   if not workflow_private.staff_access(new.company_id,new.project_id) then raise exception 'Project document access denied'; end if;
   new.uploaded_by:=auth.uid();
 end if;
 if tg_op='INSERT' then new.created_at:=now(); end if;
 if tg_table_name='project_drawings' and nullif(to_jsonb(new)->>'supersedes_id','') is not null then
   if not exists(select 1 from public.project_drawings d where d.id=(to_jsonb(new)->>'supersedes_id')::uuid and d.company_id=new.company_id and d.project_id=new.project_id and d.id<>new.id) then raise exception 'Previous revision does not belong to this project'; end if;
 end if;
 return new;
end $$;
revoke all on function workflow_private.guard_project_file() from public,anon,authenticated;
create trigger project_documents_workflow_guard before insert or update on public.project_documents for each row execute function workflow_private.guard_project_file();
create trigger project_drawings_workflow_guard before insert or update on public.project_drawings for each row execute function workflow_private.guard_project_file();

create or replace function workflow_private.project_file_read_access(c uuid,p uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select workflow_private.staff_access(c,p) or exists(select 1 from public.profiles u join public.project_staff s on s.user_id=u.id and s.company_id=u.company_id
 where u.id=auth.uid() and u.company_id=c and u.is_active is distinct from false and s.company_id=c and s.project_id=p and s.is_active is distinct from false);
$$;
revoke all on function workflow_private.project_file_read_access(uuid,uuid) from public,anon;
grant execute on function workflow_private.project_file_read_access(uuid,uuid) to authenticated;
-- Add restrictive boundaries alongside the existing permissive policies.
-- Existing policy names, expressions and table grants remain intact. PUBLIC
-- scope also constrains anonymous access granted by a legacy permissive policy.
-- Its simple role gate needs no private helper grants. The per-operation
-- authenticated boundaries retain the helpers' existing execution permissions.
do $$ declare t text; begin
 foreach t in array array['project_documents','project_drawings'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy workflow_project_file_authenticated_boundary on public.%I as restrictive for all to public using(current_user=''authenticated'' and (select auth.uid()) is not null) with check(current_user=''authenticated'' and (select auth.uid()) is not null)',t);
   execute format('create policy workflow_project_file_read_boundary on public.%I as restrictive for select to authenticated using(workflow_private.project_file_read_access(company_id,project_id))',t);
   execute format('create policy workflow_project_file_insert_boundary on public.%I as restrictive for insert to authenticated with check(workflow_private.staff_access(company_id,project_id))',t);
   execute format('create policy workflow_project_file_update_boundary on public.%I as restrictive for update to authenticated using(workflow_private.staff_access(company_id,project_id)) with check(workflow_private.staff_access(company_id,project_id))',t);
   execute format('create policy workflow_project_file_delete_boundary on public.%I as restrictive for delete to authenticated using(workflow_private.staff_access(company_id,project_id))',t);
 end loop;
end $$;

-- The shared dispatcher queues these explicit requests separately from optional personal alerts.
-- Addresses and email content are derived here from authorized server records, never supplied by a public enqueue call.
create or replace function workflow_private.email_document_request(p_request uuid,p_token text,p_reminder boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.document_requests; cap workflow_private.capabilities; co public.companies; job uuid; event text; label text; uid uuid:=auth.uid();
begin
 select * into r from public.document_requests where id=p_request for update;
 if not found or uid is null or not workflow_private.staff_access(r.company_id,r.project_id) then raise exception 'Document access denied'; end if;
 if r.status<>'Pending' or r.expires_at<=now() then raise exception 'Create a new request for an expired or completed document'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and entity_id=r.id and company_id=r.company_id and kind='document' and revoked_at is null and expires_at>now();
 if not found then raise exception 'The document link is invalid or expired'; end if;
 select * into co from public.companies where id=r.company_id;
 event:=case when p_reminder then 'document_reminder_'||to_char(now(),'YYYYMMDD') else 'document_request' end;
 label:=case r.request_type when 'signature' then 'Signature' else 'Review' end;
 job:=notification_private.enqueue_transactional_email(r.company_id,r.id,event,r.recipient_email,
   left(case when p_reminder then 'Reminder: ' else '' end||label||' requested: '||r.title||' from '||co.name,250),
   left('Hello '||r.recipient_name||E',\n\n'||co.name||' has requested your '||lower(label)||' of '||r.document_name||E'.\n\n'||r.instructions||E'\n\nPlease open the secure link below. It expires on '||(r.expires_at at time zone coalesce(nullif(co.timezone,''),'UTC'))::text||'.',10000),
   'https://app.fuzedflow.com/DocumentResponse?token='||p_token);
 update public.document_requests set email_requested_at=coalesce(email_requested_at,now()),reminder_requested_at=case when p_reminder then now() else reminder_requested_at end where id=r.id;
 insert into public.document_request_audit(company_id,request_id,event,actor_id,actor_name,details) select r.company_id,r.id,case when p_reminder then 'reminder_queued' else 'email_queued' end,uid,coalesce(nullif(full_name,''),'Team member'),jsonb_build_object('queue_id',job) from public.profiles where id=uid and company_id=r.company_id;
 if p_reminder then perform notification_private.emit(r.company_id,'document_request_reminder','DocumentRequest',r.id,r.project_id,array[r.recipient_id,r.created_by],r.title||' for '||r.recipient_name,event||':'||r.id,uid); end if;
 return job;
end $$;
revoke all on function workflow_private.email_document_request(uuid,text,boolean) from public,anon;
grant execute on function workflow_private.email_document_request(uuid,text,boolean) to authenticated;
create or replace function public.email_document_request(p_request uuid,p_token text,p_reminder boolean default false) returns uuid language sql security invoker set search_path='' as $$select workflow_private.email_document_request(p_request,p_token,p_reminder)$$;
revoke all on function public.email_document_request(uuid,text,boolean) from public,anon;
grant execute on function public.email_document_request(uuid,text,boolean) to authenticated;

create or replace function workflow_private.email_warranty_link(p_portal uuid,p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare portal workflow_private.warranty_portals; cap workflow_private.capabilities; co public.companies; project_name text; job uuid;
begin
 select * into portal from workflow_private.warranty_portals where id=p_portal for update;
 if not found or auth.uid() is null or not workflow_private.staff_access(portal.company_id,portal.project_id) then raise exception 'Warranty access denied'; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(p_token) and kind='warranty' and entity_id=portal.id and company_id=portal.company_id and revoked_at is null and expires_at>now();
 if not found then raise exception 'The warranty link is invalid or expired'; end if;
 if portal.last_email_at>now()-interval '1 minute' then raise exception 'Please wait one minute before sending another warranty access email'; end if;
 select * into co from public.companies where id=portal.company_id;
 select name into project_name from public.projects where id=portal.project_id and company_id=portal.company_id;
 job:=notification_private.enqueue_transactional_email(portal.company_id,portal.id,'warranty_access_'||left(cap.token_hash,16),portal.customer_email,
   left('Warranty support for '||project_name||' from '||co.name,250),
   'Hello '||portal.customer_name||E',\n\n'||co.name||' has shared a secure warranty link for '||project_name||E'. Use it to submit a claim, add information, confirm a repair or reopen a resolved claim.\n\nThe link expires on '||(cap.expires_at at time zone coalesce(nullif(co.timezone,''),'UTC'))::text||'.',
   'https://app.fuzedflow.com/WarrantyResponse?token='||p_token);
 update workflow_private.warranty_portals set last_email_at=now() where id=portal.id;
 return job;
end $$;
revoke all on function workflow_private.email_warranty_link(uuid,text) from public,anon;
grant execute on function workflow_private.email_warranty_link(uuid,text) to authenticated;
create or replace function public.email_warranty_link(p_portal uuid,p_token text) returns uuid language sql security invoker set search_path='' as $$select workflow_private.email_warranty_link(p_portal,p_token)$$;
revoke all on function public.email_warranty_link(uuid,text) from public,anon;
grant execute on function public.email_warranty_link(uuid,text) to authenticated;

create or replace function workflow_private.refresh_document_link(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.document_requests; t text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 select * into r from public.document_requests where id=p_request for update;
 if not found or auth.uid() is null or not workflow_private.staff_access(r.company_id,r.project_id) then raise exception 'Document access denied'; end if;
 if r.status<>'Pending' or r.expires_at<=now() then raise exception 'Create a new request for this expired or completed document'; end if;
 update workflow_private.capabilities set revoked_at=now() where entity_id=r.id and kind='document' and revoked_at is null;
 insert into workflow_private.capabilities(token_hash,company_id,kind,entity_id,expires_at) values(workflow_private.token_hash(t),r.company_id,'document',r.id,r.expires_at);
 insert into public.document_request_audit(company_id,request_id,event,actor_id,actor_name) select r.company_id,r.id,'link_renewed',auth.uid(),coalesce(nullif(full_name,''),'Team member') from public.profiles where id=auth.uid() and company_id=r.company_id;
 return jsonb_build_object('request_id',r.id,'token',t,'expires_at',r.expires_at);
end $$;
revoke all on function workflow_private.refresh_document_link(uuid) from public,anon;
grant execute on function workflow_private.refresh_document_link(uuid) to authenticated;
create or replace function public.refresh_document_request_link(p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select workflow_private.refresh_document_link(p_request)$$;
revoke all on function public.refresh_document_request_link(uuid) from public,anon;
grant execute on function public.refresh_document_request_link(uuid) to authenticated;

create or replace function workflow_private.notification_request_mail_allowed(p_reference uuid,p_event text,p_url text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare t text; cap workflow_private.capabilities;
begin
 if p_event='support_request' then
   return exists(select 1 from public.support_ticket_messages m join public.support_tickets ticket on ticket.id=m.ticket_id and ticket.company_id=m.company_id
     join public.profiles p on p.id=ticket.user_id and p.company_id=ticket.company_id and p.is_active is distinct from false
     where m.id=p_reference and m.is_support=false and p_url='https://app.fuzedflow.com/Contact?ticket='||ticket.id);
 end if;
 t:=substring(p_url from '[?]token=([0-9a-f]{64})$');
 if t is null then return false; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(t) and entity_id=p_reference and revoked_at is null and expires_at>now();
 if not found then return false; end if;
 if p_event ~ '^document_(request|reminder)' then
   return cap.kind='document' and p_url='https://app.fuzedflow.com/DocumentResponse?token='||t and exists(select 1 from public.document_requests r where r.id=p_reference and r.company_id=cap.company_id and r.status='Pending' and r.expires_at>now());
 elsif p_event ~ '^warranty_access_' then
   return cap.kind='warranty' and p_url='https://app.fuzedflow.com/WarrantyResponse?token='||t and exists(select 1 from workflow_private.warranty_portals p where p.id=p_reference and p.company_id=cap.company_id);
 end if;
 return false;
end $$;
revoke all on function workflow_private.notification_request_mail_allowed(uuid,text,text) from public,anon,authenticated;
grant execute on function workflow_private.notification_request_mail_allowed(uuid,text,text) to service_role;

create or replace function workflow_private.recipient_document_link(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.document_requests; t text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 select * into r from public.document_requests where id=p_request for update;
 if not found or auth.uid() is null or not (workflow_private.staff_access(r.company_id,r.project_id) or (r.recipient_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and company_id=r.company_id and is_active is distinct from false))) then raise exception 'Document access denied'; end if;
 if r.status<>'Pending' or r.expires_at<=now() then raise exception 'This request has expired or already has a response'; end if;
 if (select count(*) from workflow_private.capabilities where entity_id=r.id and kind='document' and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily link limit reached'; end if;
 insert into workflow_private.capabilities(token_hash,company_id,kind,entity_id,expires_at) values(workflow_private.token_hash(t),r.company_id,'document',r.id,r.expires_at);
 return jsonb_build_object('request_id',r.id,'token',t,'expires_at',r.expires_at);
end $$;
revoke all on function workflow_private.recipient_document_link(uuid) from public,anon;
grant execute on function workflow_private.recipient_document_link(uuid) to authenticated;
create or replace function public.open_document_request(p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select workflow_private.recipient_document_link(p_request)$$;
revoke all on function public.open_document_request(uuid) from public,anon;
grant execute on function public.open_document_request(uuid) to authenticated;
