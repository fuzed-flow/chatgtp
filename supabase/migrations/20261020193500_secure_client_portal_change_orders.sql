create or replace function public.get_client_portal_change_orders(p_client uuid,p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.change_order_share_links; co public.change_orders;
begin
  if p_client is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Change order link is invalid' using errcode='42501';
  end if;
  select * into link from public.change_order_share_links
  where client_id=p_client and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and status='Active' and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()) limit 1;
  if not found then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into co from public.change_orders where id=link.change_order_id and company_id=link.company_id
    and lower(coalesce(status,'')) not in ('draft','cancelled','void');
  if not found then raise exception 'Change order unavailable' using errcode='P0002'; end if;
  return jsonb_build_array(jsonb_build_object(
    'id',co.id,'co_number',co.change_order_number,'title',co.title,'status',co.status,
    'created_at',co.created_at,'total',co.total,'share_token',p_token
  ));
end;
$$;
revoke all on function public.get_client_portal_change_orders(uuid,text) from public,anon,authenticated;
grant execute on function public.get_client_portal_change_orders(uuid,text) to anon,authenticated,service_role;
