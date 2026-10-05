create or replace function public.delete_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_unlinked_quotes integer := 0;
  v_unlinked_tasks integer := 0;
  v_deleted_notes integer := 0;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to delete a lead.';
  end if;

  select l.company_id
    into v_company_id
  from public.leads l
  where l.id = p_lead_id
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = l.company_id
        and p.is_active is distinct from false
    )
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Lead not found or access denied.';
  end if;

  select count(*)::integer
    into v_unlinked_tasks
  from public.tasks t
  where t.company_id = v_company_id
    and t.lead_id = p_lead_id;

  update public.quotes q
  set lead_id = null
  where q.company_id = v_company_id
    and q.lead_id = p_lead_id;
  get diagnostics v_unlinked_quotes = row_count;

  delete from public.notes n
  where n.company_id = v_company_id
    and lower(n.related_type) = 'lead'
    and n.related_id = p_lead_id;
  get diagnostics v_deleted_notes = row_count;

  delete from public.leads l
  where l.id = p_lead_id
    and l.company_id = v_company_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'The lead changed before it could be deleted. Reload and try again.';
  end if;

  return jsonb_build_object(
    'deleted_lead_id', p_lead_id,
    'unlinked_quotes', v_unlinked_quotes,
    'unlinked_tasks', v_unlinked_tasks,
    'deleted_notes', v_deleted_notes
  );
end;
$function$;

revoke all on function public.delete_lead(uuid) from public, anon;
grant execute on function public.delete_lead(uuid) to authenticated;

comment on function public.delete_lead(uuid) is
  'Deletes one lead inside the caller company, preserving linked quotes and tasks by unlinking them.';
