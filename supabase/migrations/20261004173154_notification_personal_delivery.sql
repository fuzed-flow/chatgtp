-- Opt-in personal delivery. Enqueue only newly inserted, already-routed notifications.
-- No existing history is replayed, and no company-wide recipient expansion occurs.
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 in_app boolean not null default true, email boolean not null default false,
 sms boolean not null default false, push boolean not null default false,
 sms_phone text not null default '', categories jsonb not null default '{}'::jsonb,
 quiet_enabled boolean not null default false, quiet_start time not null default '22:00', quiet_end time not null default '08:00',
 timezone text not null default 'America/Edmonton',
 digest_frequency text not null default 'off' check(digest_frequency in ('off','daily','weekly')),
 digest_hour integer not null default 8 check(digest_hour between 0 and 23),
 digest_weekday integer not null default 1 check(digest_weekday between 1 and 7),
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(categories)='object'), check(not sms or sms_phone ~ '^\+[1-9][0-9]{7,14}$')
);
create table public.notification_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth text not null, device text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index notification_preferences_digest_enabled on public.notification_preferences(user_id) where digest_frequency!='off';
create index notification_push_user_company on public.notification_push_subscriptions(user_id,company_id);
alter table public.notification_preferences enable row level security;
alter table public.notification_push_subscriptions enable row level security;
revoke all on public.notification_preferences,public.notification_push_subscriptions from public,anon,authenticated;
grant select on public.notification_preferences,public.notification_push_subscriptions to authenticated;
grant all on public.notification_preferences,public.notification_push_subscriptions to service_role;
create policy notification_preferences_owner on public.notification_preferences for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=notification_preferences.company_id and p.is_active is distinct from false));
create policy notification_push_owner on public.notification_push_subscriptions for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=notification_push_subscriptions.company_id and p.is_active is distinct from false));

create table notification_private.delivery_outbox (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 notification_id uuid references public.notifications(id) on delete cascade,
 subscription_id uuid references public.notification_push_subscriptions(id) on delete cascade,
 job_kind text not null default 'alert' check(job_kind in ('alert','digest','transactional')),
 channel text not null check(channel in ('email','sms','push')),
 dedupe_key text not null unique, payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','leased','sent','delivered','failed','cancelled','unconfirmed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, leased_at timestamptz, first_attempt_at timestamptz,
 provider_payload jsonb, provider_id text, provider_status text, last_error text,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create index notification_delivery_pending on notification_private.delivery_outbox(available_at,created_at) where state in ('pending','leased');
create index notification_delivery_user_pending on notification_private.delivery_outbox(user_id) where state='pending';
create index notification_delivery_subscription on notification_private.delivery_outbox(subscription_id) where subscription_id is not null;
create unique index notification_delivery_provider_identity on notification_private.delivery_outbox(channel,provider_id) where provider_id is not null;
alter table notification_private.delivery_outbox enable row level security;
revoke all on notification_private.delivery_outbox from public,anon,authenticated;
grant all on notification_private.delivery_outbox to service_role;
create table notification_private.delivery_receipts (
 provider text not null, event_id text not null, delivery_id uuid not null references notification_private.delivery_outbox(id) on delete cascade,
 status text not null, created_at timestamptz not null default now(), primary key(provider,event_id)
);
alter table notification_private.delivery_receipts enable row level security;
revoke all on notification_private.delivery_receipts from public,anon,authenticated;
grant all on notification_private.delivery_receipts to service_role;
create table notification_private.digest_items (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 batch_id uuid references notification_private.delivery_outbox(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index notification_digest_unbatched_user on notification_private.digest_items(user_id,created_at) where batch_id is null;
alter table notification_private.digest_items enable row level security;
revoke all on notification_private.digest_items from public,anon,authenticated;
grant all on notification_private.digest_items to service_role;

create or replace function notification_private.save_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; result public.notification_preferences; tz text; cats jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active is distinct from false;
 if p.id is null or p.company_id is null then raise exception 'Active account required' using errcode='42501'; end if;
 if jsonb_typeof(p_preferences)!='object' then raise exception 'Invalid preferences'; end if;
 tz:=coalesce(nullif(p_preferences->>'timezone',''),'America/Edmonton');
 if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Use a valid timezone, such as America/Edmonton'; end if;
 cats:=coalesce(p_preferences->'categories','{}'::jsonb);
 if jsonb_typeof(cats)!='object' or exists(select 1 from jsonb_each(cats) where jsonb_typeof(value)!='boolean' or length(key)>60) or octet_length(cats::text)>4096 then raise exception 'Invalid categories'; end if;
 insert into public.notification_preferences(user_id,company_id,in_app,email,sms,push,sms_phone,categories,quiet_enabled,quiet_start,quiet_end,timezone,digest_frequency,digest_hour,digest_weekday)
 values(p.id,p.company_id,coalesce((p_preferences->>'in_app')::boolean,true),coalesce((p_preferences->>'email')::boolean,false),
 coalesce((p_preferences->>'sms')::boolean,false),coalesce((p_preferences->>'push')::boolean,false),trim(coalesce(p_preferences->>'sms_phone','')),cats,
 coalesce((p_preferences->>'quiet_enabled')::boolean,false),coalesce((p_preferences->>'quiet_start')::time,'22:00'),coalesce((p_preferences->>'quiet_end')::time,'08:00'),tz,
 coalesce(p_preferences->>'digest_frequency','off'),coalesce((p_preferences->>'digest_hour')::integer,8),coalesce((p_preferences->>'digest_weekday')::integer,1))
 on conflict(user_id) do update set company_id=excluded.company_id,in_app=excluded.in_app,email=excluded.email,sms=excluded.sms,push=excluded.push,
 sms_phone=excluded.sms_phone,categories=excluded.categories,quiet_enabled=excluded.quiet_enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,
 timezone=excluded.timezone,digest_frequency=excluded.digest_frequency,digest_hour=excluded.digest_hour,digest_weekday=excluded.digest_weekday,updated_at=now()
 returning * into result;
 -- A later opt-in must not revive deliveries cancelled while a channel was off.
 update notification_private.delivery_outbox o set state='cancelled',finished_at=now(),last_error='Preferences changed'
 where o.user_id=p.id and o.state='pending' and o.job_kind!='transactional' and (
 (o.job_kind='digest' and result.digest_frequency!=(o.payload->>'frequency')) or
 (o.job_kind='alert' and ((o.channel='email' and not result.email) or (o.channel='sms' and not result.sms) or (o.channel='push' and not result.push)
 or result.categories->>(o.payload->>'category')='false')));
 if result.digest_frequency='off' then delete from notification_private.digest_items where user_id=p.id and batch_id is null; end if;
 return to_jsonb(result);
end $$;
revoke all on function notification_private.save_preferences(jsonb) from public,anon,authenticated;
grant execute on function notification_private.save_preferences(jsonb) to authenticated;
create or replace function public.save_notification_preferences(p_preferences jsonb)
returns jsonb language sql security invoker set search_path='' as $$select notification_private.save_preferences(p_preferences)$$;
revoke all on function public.save_notification_preferences(jsonb) from public,anon;
grant execute on function public.save_notification_preferences(jsonb) to authenticated;

create or replace function notification_private.register_push(p_subscription jsonb,p_device text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.profiles; ep text; host text; new_id uuid;
begin
 select * into p from public.profiles where id=auth.uid() and is_active is distinct from false;
 if p.id is null or p.company_id is null then raise exception 'Active account required' using errcode='42501'; end if;
 ep:=p_subscription->>'endpoint'; host:=lower(substring(ep from '^https://([^/:?#]+)'));
 if length(ep)>2048 or host is null or not (host in ('fcm.googleapis.com','android.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com') or host ~ '^[a-z0-9-]+\.push\.apple\.com$')
 or ep !~ '^https://[^/:?#]+/[^#]*$' then raise exception 'Unsupported push endpoint'; end if;
 if coalesce(p_subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87,88}={0,2}$' or coalesce(p_subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Invalid push keys'; end if;
 if exists(select 1 from public.notification_push_subscriptions where endpoint=ep and user_id!=p.id) then raise exception 'Reconnect this shared browser before enabling push' using errcode='42501'; end if;
 if (select count(*) from public.notification_push_subscriptions where user_id=p.id)>=10 and not exists(select 1 from public.notification_push_subscriptions where endpoint=ep and user_id=p.id) then raise exception 'Disconnect an old device before adding another'; end if;
 insert into public.notification_push_subscriptions(user_id,company_id,endpoint,p256dh,auth,device)
 values(p.id,p.company_id,ep,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth',left(coalesce(p_device,''),180))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,device=excluded.device,updated_at=now()
 returning id into new_id;
 return new_id;
end $$;
revoke all on function notification_private.register_push(jsonb,text) from public,anon,authenticated;
grant execute on function notification_private.register_push(jsonb,text) to authenticated;
create or replace function public.register_notification_push(p_subscription jsonb,p_device text default '')
returns uuid language sql security invoker set search_path='' as $$select notification_private.register_push(p_subscription,p_device)$$;
revoke all on function public.register_notification_push(jsonb,text) from public,anon;
grant execute on function public.register_notification_push(jsonb,text) to authenticated;
create or replace function notification_private.remove_push(p_endpoint text)
returns boolean language plpgsql security definer set search_path='' as $$
begin delete from public.notification_push_subscriptions where endpoint=p_endpoint and user_id=auth.uid(); return found; end $$;
revoke all on function notification_private.remove_push(text) from public,anon,authenticated;
grant execute on function notification_private.remove_push(text) to authenticated;
create or replace function public.remove_notification_push(p_endpoint text)
returns boolean language sql security invoker set search_path='' as $$select notification_private.remove_push(p_endpoint)$$;
revoke all on function public.remove_notification_push(text) from public,anon;
grant execute on function public.remove_notification_push(text) to authenticated;

create or replace function notification_private.enqueue_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare pref public.notification_preferences; p public.profiles; s record; payload jsonb; ch text;
begin
 -- Delivery failures are private in-app notices. Never recursively send them or digest them.
 if new.event_key in ('personal_notification_delivery_failed','company_notification_failed') then return new; end if;
 select * into p from public.profiles where id=new.user_id and company_id=new.company_id and is_active is distinct from false;
 select * into pref from public.notification_preferences where user_id=new.user_id and company_id=new.company_id;
 if p.id is null or pref.user_id is null or pref.categories->>new.category='false'
 or (coalesce(p.notify_action_required_only,false) and new.severity!='Action Required') then return new; end if;
 payload:=jsonb_build_object('id',new.id,'title',new.title,'body',new.body,'category',new.category,'severity',new.severity,'url',new.action_url,'metadata',new.metadata,'event_key',new.event_key,'created_at',new.created_at);
 foreach ch in array array['email','sms'] loop
  if (ch='email' and pref.email) or (ch='sms' and pref.sms) then
   insert into notification_private.delivery_outbox(company_id,user_id,notification_id,channel,dedupe_key,payload)
   values(new.company_id,new.user_id,new.id,ch,'alert:'||new.id||':'||ch,payload) on conflict do nothing;
  end if;
 end loop;
 if pref.push then for s in select id from public.notification_push_subscriptions where user_id=new.user_id and company_id=new.company_id loop
  insert into notification_private.delivery_outbox(company_id,user_id,notification_id,subscription_id,channel,dedupe_key,payload)
  values(new.company_id,new.user_id,new.id,s.id,'push','alert:'||new.id||':push:'||s.id,payload) on conflict do nothing;
 end loop; end if;
 if pref.digest_frequency!='off' then insert into notification_private.digest_items(notification_id,user_id) values(new.id,new.user_id) on conflict do nothing; end if;
 return new;
end $$;
revoke all on function notification_private.enqueue_delivery() from public,anon,authenticated;
create trigger notification_personal_delivery after insert on public.notifications for each row execute function notification_private.enqueue_delivery();

create or replace function notification_private.prepare_digests(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare pref record; local_now timestamp; job uuid; key text; items jsonb; ids uuid[]; added integer; count_jobs integer:=0;
begin
 for pref in select np.* from public.notification_preferences np join public.profiles p on p.id=np.user_id and p.company_id=np.company_id
 where np.digest_frequency!='off' and p.is_active is distinct from false loop
  local_now:=p_now at time zone pref.timezone;
  if extract(hour from local_now)<pref.digest_hour or (pref.digest_frequency='weekly' and extract(isodow from local_now)!=pref.digest_weekday) then continue; end if;
  perform pg_advisory_xact_lock(hashtextextended('digest:'||pref.user_id,0));
  select array_agg(id),jsonb_agg(doc) into ids,items from (
   select n.id,jsonb_build_object('id',n.id,'title',n.title,'body',n.body,'url',n.action_url,'category',n.category,'severity',n.severity,'metadata',n.metadata,'created_at',n.created_at) doc
   from notification_private.digest_items di join public.notifications n on n.id=di.notification_id
   join public.profiles p on p.id=di.user_id
   where di.user_id=pref.user_id and di.batch_id is null and n.company_id=pref.company_id
    and notification_private.eligible(n.user_id,n.company_id,n.event_key,nullif(n.metadata->>'project_id','')::uuid,coalesce((n.metadata->>'targeted')::boolean,false))
    and coalesce(pref.categories->>n.category,'true')!='false' and (not coalesce(p.notify_action_required_only,false) or n.severity='Action Required')
   order by n.created_at limit 200
  ) batch;
  if ids is null then continue; end if;
  key:='digest:'||pref.user_id||':'||pref.digest_frequency||':'||local_now::date;
  insert into notification_private.delivery_outbox(company_id,user_id,job_kind,channel,dedupe_key,payload)
  values(pref.company_id,pref.user_id,'digest','email',key,jsonb_build_object('frequency',pref.digest_frequency,'items',items,'timezone',pref.timezone,'date',local_now::date))
  on conflict(dedupe_key) do nothing returning id into job;
  if job is not null then update notification_private.digest_items set batch_id=job where notification_id=any(ids); count_jobs:=count_jobs+1; end if;
 end loop;
 return count_jobs;
end $$;
revoke all on function notification_private.prepare_digests(timestamptz) from public,anon,authenticated;

-- Privileged request workflows may enqueue one explicit invitation/request email.
-- Browser-facing request APIs must derive these values from their authorized source rows.
create or replace function notification_private.enqueue_transactional_email(p_company uuid,p_reference uuid,p_event text,p_recipient text,p_subject text,p_body text,p_action_url text)
returns uuid language plpgsql security definer set search_path='' as $$
declare job uuid;
begin
 if p_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_event !~ '^[a-z0-9_]{1,100}$' or length(p_subject)>250 or length(p_body)>10000 or p_action_url !~ '^https://app\.fuzedflow\.com/' then raise exception 'Invalid request email'; end if;
 insert into notification_private.delivery_outbox(company_id,job_kind,channel,dedupe_key,payload)
 values(p_company,'transactional','email','request:'||p_reference||':'||p_event||':'||md5(p_action_url),jsonb_build_object('to',p_recipient,'title',p_subject,'body',p_body,'url',p_action_url,'reference_id',p_reference,'event_key',p_event))
 on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key returning id into job;
 return job;
end $$;
revoke all on function notification_private.enqueue_transactional_email(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function notification_private.enqueue_transactional_email(uuid,uuid,text,text,text,text,text) to service_role;

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module)
values('personal_notification_delivery_failed','A notification could not be delivered','Action Required','Support',array['owner','admin','manager','office','employee','subcontractor'],'personal',null)
on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;
create or replace function notification_private.delivery_failure_notice(p_delivery uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare job notification_private.delivery_outbox;
begin
 select * into job from notification_private.delivery_outbox where id=p_delivery;
 if job.id is null or job.user_id is null then return 0; end if;
 -- No original title, entity, address, phone or project survives an access change.
 return notification_private.emit(job.company_id,'personal_notification_delivery_failed','NotificationDelivery',job.id,null,array[job.user_id],
 'Fuzed Flow could not confirm delivery of one of your notifications. Check your notification settings and contact support if the problem continues.',
 'personal_delivery_failed:'||job.id,null);
end $$;
revoke all on function notification_private.delivery_failure_notice(uuid) from public,anon,authenticated;
grant execute on function notification_private.delivery_failure_notice(uuid) to service_role;

create or replace function notification_private.record_delivery_receipt(p_provider text,p_provider_id text,p_event_id text,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare job notification_private.delivery_outbox; ch text; receipt_status text; inserted integer;
begin
 ch:=case p_provider when 'resend' then 'email' when 'twilio' then 'sms' else null end;
 receipt_status:=lower(p_status);
 if ch is null or nullif(p_provider_id,'') is null or length(p_provider_id)>256 or nullif(p_event_id,'') is null or length(p_event_id)>256
 or receipt_status is null or receipt_status not in ('accepted','queued','sending','sent','delayed','delivered','failed','bounced','complained','undelivered') then return false; end if;
 select * into job from notification_private.delivery_outbox where channel=ch and provider_id=p_provider_id for update;
 if job.id is null then return false; end if;
 insert into notification_private.delivery_receipts(provider,event_id,delivery_id,status) values(p_provider,p_event_id,job.id,receipt_status)
 on conflict(provider,event_id) do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return exists(select 1 from notification_private.delivery_receipts where provider=p_provider and event_id=p_event_id and delivery_id=job.id); end if;
 if receipt_status in ('failed','bounced','complained','undelivered') then
  update notification_private.delivery_outbox set state='failed',provider_status=receipt_status,last_error='Provider reported unsuccessful delivery',finished_at=now(),lease_token=null,leased_at=null where id=job.id;
  perform notification_private.delivery_failure_notice(job.id);
 elsif job.provider_status not in ('failed','bounced','complained','undelivered') or job.provider_status is null then
  if receipt_status='delivered' then
   update notification_private.delivery_outbox set state='delivered',provider_status='delivered',finished_at=now(),last_error=null,lease_token=null,leased_at=null where id=job.id;
  elsif job.state!='delivered' then
   update notification_private.delivery_outbox set provider_status=receipt_status where id=job.id;
  end if;
 end if;
 return true;
end $$;
revoke all on function notification_private.record_delivery_receipt(text,text,text,text) from public,anon,authenticated;
grant execute on function notification_private.record_delivery_receipt(text,text,text,text) to service_role;
create or replace function public.record_personal_notification_delivery_callback(p_provider text,p_provider_id text,p_event_id text,p_status text)
returns boolean language sql security invoker set search_path='' as $$select notification_private.record_delivery_receipt(p_provider,p_provider_id,p_event_id,p_status)$$;
revoke all on function public.record_personal_notification_delivery_callback(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_personal_notification_delivery_callback(text,text,text,text) to service_role;

create or replace function notification_private.claim_deliveries(p_limit integer default 30,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare job notification_private.delivery_outbox; pref public.notification_preferences; p public.profiles; n public.notifications; recipient text; sub jsonb; items jsonb; token uuid; result jsonb:='[]'::jsonb; allowed boolean;
begin
 perform notification_private.prepare_digests(p_now);
 for job in select * from notification_private.delivery_outbox where available_at<=p_now
 and (state='pending' or (state='leased' and leased_at<p_now-interval '5 minutes'))
 order by created_at for update skip locked limit greatest(1,least(p_limit,50)) loop
  allowed:=true; recipient:=null; sub:=null; items:=null;
  if job.job_kind!='transactional' then
   select * into p from public.profiles where id=job.user_id and company_id=job.company_id and is_active is distinct from false;
   select * into pref from public.notification_preferences where user_id=job.user_id and company_id=job.company_id;
   allowed:=p.id is not null and pref.user_id is not null;
   if job.job_kind='alert' then
    select * into n from public.notifications where id=job.notification_id and user_id=job.user_id and company_id=job.company_id;
    allowed:=allowed and n.id is not null and notification_private.eligible(n.user_id,n.company_id,n.event_key,nullif(n.metadata->>'project_id','')::uuid,coalesce((n.metadata->>'targeted')::boolean,false))
     and coalesce(pref.categories->>n.category,'true')!='false' and (not coalesce(p.notify_action_required_only,false) or n.severity='Action Required')
     and ((job.channel='email' and pref.email) or (job.channel='sms' and pref.sms) or (job.channel='push' and pref.push));
   else
    allowed:=allowed and pref.digest_frequency=job.payload->>'frequency';
    select jsonb_agg(item) into items from jsonb_array_elements(job.payload->'items') item
    join public.notifications nn on nn.id=(item->>'id')::uuid and nn.user_id=job.user_id and nn.company_id=job.company_id
    where notification_private.eligible(nn.user_id,nn.company_id,nn.event_key,nullif(nn.metadata->>'project_id','')::uuid,coalesce((nn.metadata->>'targeted')::boolean,false))
    and coalesce(pref.categories->>nn.category,'true')!='false' and (not coalesce(p.notify_action_required_only,false) or nn.severity='Action Required');
    allowed:=allowed and items is not null and jsonb_array_length(items)=jsonb_array_length(job.payload->'items');
   end if;
   if job.channel='email' then select email into recipient from auth.users where id=job.user_id and email_confirmed_at is not null; allowed:=allowed and nullif(recipient,'') is not null;
   elsif job.channel='sms' then recipient:=pref.sms_phone; allowed:=allowed and recipient ~ '^\+[1-9][0-9]{7,14}$';
   else select jsonb_build_object('endpoint',endpoint,'keys',jsonb_build_object('p256dh',p256dh,'auth',auth)) into sub from public.notification_push_subscriptions where id=job.subscription_id and user_id=job.user_id and company_id=job.company_id; allowed:=allowed and sub is not null; end if;
  else
   recipient:=job.payload->>'to';
   if to_regprocedure('workflow_private.notification_request_mail_allowed(uuid,text,text)') is null then allowed:=false;
   else execute 'select workflow_private.notification_request_mail_allowed($1,$2,$3)' into allowed using (job.payload->>'reference_id')::uuid,job.payload->>'event_key',job.payload->>'url'; end if;
  end if;
  if not coalesce(allowed,false) then update notification_private.delivery_outbox set state='cancelled',finished_at=p_now,last_error='Access or preferences changed' where id=job.id; continue; end if;
  -- A leased SMS may already have reached Twilio. Never send it twice after a worker crash.
  if job.channel='sms' and job.first_attempt_at is not null and job.state='leased' then update notification_private.delivery_outbox set state='unconfirmed',provider_status='unconfirmed',finished_at=p_now,last_error='SMS outcome unconfirmed' where id=job.id; perform notification_private.delivery_failure_notice(job.id); continue; end if;
  if job.attempts>=8 or (job.first_attempt_at is not null and p_now-job.first_attempt_at>=interval '23 hours 55 minutes') then update notification_private.delivery_outbox set state='failed',provider_status='failed',finished_at=p_now,last_error='Retry window expired' where id=job.id; perform notification_private.delivery_failure_notice(job.id); continue; end if;
  token:=gen_random_uuid();
  update notification_private.delivery_outbox set state='leased',lease_token=token,leased_at=p_now,attempts=attempts+1 where id=job.id;
  result:=result||jsonb_build_array(to_jsonb(job)||jsonb_build_object('lease_token',token,'attempts',job.attempts+1,'recipient',recipient,'subscription',sub,'preferences',case when job.job_kind='transactional' then '{}'::jsonb else to_jsonb(pref) end,'digest_items',items));
 end loop;
 return result;
end $$;
revoke all on function notification_private.claim_deliveries(integer,timestamptz) from public,anon,authenticated;
grant execute on function notification_private.claim_deliveries(integer,timestamptz) to service_role;
create or replace function public.claim_notification_deliveries(p_limit integer default 30)
returns jsonb language sql security invoker set search_path='' as $$select notification_private.claim_deliveries(p_limit)$$;
revoke all on function public.claim_notification_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

create or replace function notification_private.capture_delivery(p_id uuid,p_token uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare captured jsonb; job notification_private.delivery_outbox; pref public.notification_preferences; p public.profiles; n public.notifications; allowed boolean; item record;
begin
 select * into job from notification_private.delivery_outbox where id=p_id and state='leased' and lease_token=p_token for update;
 if job.id is null then raise exception 'Delivery lease lost'; end if;
 if job.job_kind='transactional' then
  execute 'select workflow_private.notification_request_mail_allowed($1,$2,$3)' into allowed using (job.payload->>'reference_id')::uuid,job.payload->>'event_key',job.payload->>'url';
 else
  select * into p from public.profiles where id=job.user_id and company_id=job.company_id and is_active is distinct from false;
  select * into pref from public.notification_preferences where user_id=job.user_id and company_id=job.company_id;
  allowed:=p.id is not null and pref.user_id is not null and ((job.job_kind='digest' and pref.digest_frequency=job.payload->>'frequency') or (job.job_kind='alert' and ((job.channel='email' and pref.email) or (job.channel='sms' and pref.sms) or (job.channel='push' and pref.push))));
  for item in select value from jsonb_array_elements(case when job.job_kind='digest' then job.payload->'items' else jsonb_build_array(job.payload) end) loop
   select * into n from public.notifications where id=(item.value->>'id')::uuid and user_id=job.user_id and company_id=job.company_id;
   allowed:=allowed and n.id is not null and notification_private.eligible(n.user_id,n.company_id,n.event_key,nullif(n.metadata->>'project_id','')::uuid,coalesce((n.metadata->>'targeted')::boolean,false)) and coalesce(pref.categories->>n.category,'true')!='false' and (not coalesce(p.notify_action_required_only,false) or n.severity='Action Required');
  end loop;
 end if;
 if not coalesce(allowed,false) then raise exception 'Delivery access or preferences changed' using errcode='42501'; end if;
 update notification_private.delivery_outbox set provider_payload=coalesce(provider_payload,p_payload),first_attempt_at=coalesce(first_attempt_at,now())
 where id=p_id and state='leased' and lease_token=p_token returning provider_payload into captured;
 if captured is null then raise exception 'Delivery lease lost'; end if;
 return captured;
end $$;
revoke all on function notification_private.capture_delivery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function notification_private.capture_delivery(uuid,uuid,jsonb) to service_role;
create or replace function public.capture_notification_delivery(p_id uuid,p_token uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select notification_private.capture_delivery(p_id,p_token,p_payload)$$;
revoke all on function public.capture_notification_delivery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.capture_notification_delivery(uuid,uuid,jsonb) to service_role;

create or replace function notification_private.finish_delivery(p_id uuid,p_token uuid,p_state text,p_error text default null,p_provider_id text default null,p_available_at timestamptz default now())
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_state not in ('pending','sent','failed','cancelled','unconfirmed','deferred','expired_push') then raise exception 'Invalid delivery outcome'; end if;
 if p_state='expired_push' then delete from public.notification_push_subscriptions where id=(select subscription_id from notification_private.delivery_outbox where id=p_id and lease_token=p_token and state='leased'); return found; end if;
 update notification_private.delivery_outbox set state=case when p_state='deferred' then 'pending' else p_state end,
 available_at=greatest(now(),p_available_at),attempts=case when p_state='deferred' then greatest(0,attempts-1) else attempts end,
 last_error=left(p_error,250),provider_id=p_provider_id,provider_status=case when p_state='sent' then 'accepted' when p_state in ('failed','unconfirmed') then p_state else provider_status end,lease_token=null,leased_at=null,
 finished_at=case when p_state in ('sent','failed','cancelled','unconfirmed') then now() else null end
 where id=p_id and lease_token=p_token and state='leased';
 if not found then return false; end if;
 if p_state in ('failed','unconfirmed') then perform notification_private.delivery_failure_notice(p_id); end if;
 return true;
end $$;
revoke all on function notification_private.finish_delivery(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function notification_private.finish_delivery(uuid,uuid,text,text,text,timestamptz) to service_role;
create or replace function public.finish_notification_delivery(p_id uuid,p_token uuid,p_state text,p_error text default null,p_provider_id text default null,p_available_at timestamptz default now())
returns boolean language sql security invoker set search_path='' as $$select notification_private.finish_delivery(p_id,p_token,p_state,p_error,p_provider_id,p_available_at)$$;
revoke all on function public.finish_notification_delivery(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finish_notification_delivery(uuid,uuid,text,text,text,timestamptz) to service_role;

create or replace function notification_private.server_config()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb:='{}'::jsonb;
begin
 if to_regclass('vault.decrypted_secrets') is not null then
  execute 'select coalesce(jsonb_object_agg(name,decrypted_secret),''{}''::jsonb) from vault.decrypted_secrets where name=any($1)' into result
  using array['notification_vapid_private_key','notification_vapid_public_key','notification_vapid_subject','notification_cron_secret','project_url'];
 end if;
 return result;
end $$;
revoke all on function notification_private.server_config() from public,anon,authenticated;
grant execute on function notification_private.server_config() to service_role;
create or replace function public.notification_delivery_server_config()
returns jsonb language sql security invoker set search_path='' as $$select notification_private.server_config()$$;
revoke all on function public.notification_delivery_server_config() from public,anon,authenticated;
grant execute on function public.notification_delivery_server_config() to service_role;
create or replace function notification_private.push_config()
returns jsonb language plpgsql security definer set search_path='' as $$
declare config jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active is distinct from false) then raise exception 'Active account required' using errcode='42501'; end if;
 config:=notification_private.server_config();
 return jsonb_build_object('public_key',config->>'notification_vapid_public_key','app_origin','https://app.fuzedflow.com','configured',nullif(config->>'notification_vapid_private_key','') is not null);
end $$;
revoke all on function notification_private.push_config() from public,anon,authenticated;
grant execute on function notification_private.push_config() to authenticated;
create or replace function public.notification_push_config()
returns jsonb language sql security invoker set search_path='' as $$select notification_private.push_config()$$;
revoke all on function public.notification_push_config() from public,anon;
grant execute on function public.notification_push_config() to authenticated;

-- Vault provisioning and Edge Function deployment precede activation. A missing secret sends nothing.
create or replace function notification_private.dispatch_tick()
returns bigint language plpgsql security definer set search_path='' as $$
declare config jsonb; request_id bigint;
begin
 config:=notification_private.server_config();
 if nullif(config->>'notification_cron_secret','') is null or nullif(config->>'project_url','') is null then return null; end if;
 execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=10000)' into request_id
 using (config->>'project_url')||'/functions/v1/notification-dispatch',jsonb_build_object('Content-Type','application/json','X-Notification-Cron-Secret',config->>'notification_cron_secret'),'{}'::jsonb;
 return request_id;
end $$;
revoke all on function notification_private.dispatch_tick() from public,anon,authenticated;
-- The job remains harmless until Vault is provisioned; root activates after deployment verification.
