-- Subscribers may delete only their own support requests. Conversation rows
-- are removed by the existing ON DELETE CASCADE foreign key.
grant delete on table public.support_tickets to authenticated;

create policy support_ticket_delete_own
on public.support_tickets
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.company_id = support_tickets.company_id
      and p.is_active is distinct from false
  )
);

-- Route saved in-app support requests to the private support inbox without
-- exposing that address in the subscriber interface.
create or replace function public.submit_support_ticket(
  p_subject text,
  p_message text,
  p_ticket uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  t public.support_tickets;
  msg uuid;
begin
  select * into p
  from public.profiles
  where id = auth.uid()
    and is_active is distinct from false;

  if p.id is null or p.company_id is null then
    raise exception 'Active account required' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_message, ''))) not between 1 and 10000 then
    raise exception 'Enter a message between 1 and 10,000 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support:' || p.id, 0));

  if p_ticket is null then
    if (
      select count(*)
      from public.support_tickets
      where user_id = p.id
        and created_at > now() - interval '1 day'
    ) >= 5 then
      raise exception 'Please reply to an existing request or call 1 (855) 904-5509';
    end if;

    insert into public.support_tickets(company_id, user_id, subject)
    values (p.company_id, p.id, trim(p_subject))
    returning * into t;
  else
    select * into t
    from public.support_tickets
    where id = p_ticket
      and user_id = p.id
      and company_id = p.company_id
    for update;

    if t.id is null then
      raise exception 'Support request unavailable' using errcode = '42501';
    end if;

    update public.support_tickets
    set status = 'Open', updated_at = now()
    where id = t.id;
  end if;

  if (
    select count(*)
    from public.support_ticket_messages
    where author_user_id = p.id
      and created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception 'Please wait a minute before sending another reply';
  end if;

  insert into public.support_ticket_messages(
    company_id,
    ticket_id,
    author_user_id,
    author_name,
    message
  )
  values (
    p.company_id,
    t.id,
    p.id,
    coalesce(nullif(p.full_name, ''), 'Subscriber'),
    trim(p_message)
  )
  returning id into msg;

  if p_ticket is null then
    perform notification_private.emit(
      p.company_id,
      'support_ticket_created',
      'SupportTicket',
      t.id,
      null,
      array[p.id],
      'Your support request was saved.',
      'support_created:' || t.id,
      p.id
    );
  end if;

  perform notification_private.enqueue_transactional_email(
    p.company_id,
    msg,
    'support_request',
    'fuzedflow@gmail.com',
    '[Support] ' || t.subject,
    left(
      coalesce(p.full_name, 'Subscriber') || ' (' ||
      coalesce((select email from auth.users where id = p.id), 'No reply email saved') ||
      ') from ' ||
      (select name from public.companies where id = p.company_id) ||
      E'\n\n' || trim(p_message),
      9900
    ) || E'\n\nTicket: ' || t.id,
    'https://app.fuzedflow.com/Contact?ticket=' || t.id
  );

  return t.id;
end;
$$;

revoke all on function public.submit_support_ticket(text, text, uuid) from public, anon;
grant execute on function public.submit_support_ticket(text, text, uuid) to authenticated;
