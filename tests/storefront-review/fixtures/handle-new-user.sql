-- Existing production signup trigger, captured for onboarding regression tests.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$declare
  v_company_id uuid;
  v_role text;
  v_user_full_name text;
  v_invite_id uuid;
  v_company_name text;
  v_plan_id text;
begin
  -- 1. Extract the metadata sent from your React frontend
  v_user_full_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');
  v_company_name := coalesce(new.raw_user_meta_data->>'company_name', v_user_full_name || '''s Company');
  v_plan_id := coalesce(new.raw_user_meta_data->>'plan_id', 'starter');

  -- 2. Check if this email has a pending invite
  select id, company_id, role into v_invite_id, v_company_id, v_role
  from public.team_invites
  where email = new.email and is_pending = true
  limit 1;

  -- 3. Branching Logic: Invited vs. Brand New
  if v_invite_id is not null then
    -- 🎉 THE USER WAS INVITED
    -- Update the invite so it is no longer pending
    update public.team_invites set is_pending = false where id = v_invite_id;
  else
    -- 🏗️ THE USER IS BRAND NEW (No invite found)
    -- Create their new company
    v_role := 'admin'; 
    
    insert into public.companies (name, plan_id)
    values (v_company_name, v_plan_id)
    returning id into v_company_id;
  end if;

  -- 4. Create the profile (This works perfectly for both paths now!)
  insert into public.profiles (id, full_name, email, company_id, role)
  values (
    new.id,
    v_user_full_name,
    new.email,
    v_company_id,
    v_role
  );

  return new;
end;$function$
;

