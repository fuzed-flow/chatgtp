create table public.storefront_enquiries(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('demo','contact')),name text not null,email text not null,company text,phone text,message text,preferred_date date,request_digest text not null,notification_status text not null default 'pending',created_at timestamptz not null default now());
alter table public.storefront_enquiries enable row level security;
revoke all on public.storefront_enquiries from anon,authenticated;
grant all on public.storefront_enquiries to service_role;
create index on public.storefront_enquiries(request_digest,created_at);
create or replace function public.record_storefront_enquiry(p_fields jsonb,p_digest text) returns uuid language plpgsql security invoker set search_path='' as $$
declare new_id uuid;
begin
 if length(p_digest)!=64 then raise exception 'Invalid request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_digest,3));
 if (select count(*) from public.storefront_enquiries where request_digest=p_digest and created_at>now()-interval '1 hour')>=5 then raise exception 'Please try again later or email support@fuzedflow.com'; end if;
 insert into public.storefront_enquiries(kind,name,email,company,phone,message,preferred_date,request_digest) values(p_fields->>'kind',p_fields->>'name',p_fields->>'email',p_fields->>'company',p_fields->>'phone',p_fields->>'message',nullif(p_fields->>'preferred_date','')::date,p_digest) returning id into new_id;
 return new_id;
end $$;
revoke all on function public.record_storefront_enquiry(jsonb,text) from public,anon,authenticated;
grant execute on function public.record_storefront_enquiry(jsonb,text) to service_role;
