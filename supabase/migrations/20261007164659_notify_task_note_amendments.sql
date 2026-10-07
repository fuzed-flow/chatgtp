-- Amendments create fresh notifications through the existing personal delivery queue.
insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('task_updated','Task updated','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'assigned','projects'),
 ('note_created','Note added','FYI','Mentions',array['owner','admin','manager','office'],'leadership','clients'),
 ('note_updated','Note updated','Important','Mentions',array['owner','admin','manager','office','employee','subcontractor'],'leadership','clients'),
 ('daily_log_updated','Project note updated','Important','Daily Logs',array['owner','admin','manager','office','employee','subcontractor'],'leadership','DailyLogs')
on conflict (event_key) do update set title=excluded.title,severity=excluded.severity,
 category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;

create or replace function notification_private.amendment_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 d jsonb:=to_jsonb(new); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 c uuid:=new.company_id; proj uuid:=nullif(d->>'project_id','')::uuid;
 recipients uuid[]:='{}'::uuid[]; added_mentions uuid[]:='{}'::uuid[];
 changes text[]:='{}'::text[]; k text:=tg_table_name||':'||new.id||':'||txid_current()::text;
begin
 if c is null then return new; end if;
 if auth.uid() is not null and not exists(select 1 from public.profiles p
   where p.id=auth.uid() and p.company_id=c and p.is_active is distinct from false) then return new; end if;

 if tg_table_name in ('tasks','project_tasks') then
  if tg_op<>'UPDATE' then return new; end if;
  -- Assignment, completion, priority, and deadline already have their own alerts.
  if d->'assigned_to' is distinct from o->'assigned_to'
   or d->>'priority' is distinct from o->>'priority'
   or coalesce(d->>'due_date_target',d->>'due_date') is distinct from coalesce(o->>'due_date_target',o->>'due_date')
   or (lower(coalesce(d->>'status','')) in ('done','completed','complete') and d->>'status' is distinct from o->>'status')
  then return new; end if;
  if d->>'title' is distinct from o->>'title' then changes:=array_append(changes,'title'); end if;
  if d->>'description' is distinct from o->>'description' then changes:=array_append(changes,'description'); end if;
  if d->>'status' is distinct from o->>'status' then changes:=array_append(changes,'status'); end if;
  if d->>'estimated_hours' is distinct from o->>'estimated_hours' then changes:=array_append(changes,'estimated hours'); end if;
  if d->>'task_type' is distinct from o->>'task_type' then changes:=array_append(changes,'type'); end if;
  if d->>'phase_id' is distinct from o->>'phase_id' then changes:=array_append(changes,'phase'); end if;
  if d->>'vendor_id' is distinct from o->>'vendor_id' then changes:=array_append(changes,'trade'); end if;
  if d->>'project_id' is distinct from o->>'project_id' then changes:=array_append(changes,'project'); end if;
  if d->>'client_id' is distinct from o->>'client_id' then changes:=array_append(changes,'client'); end if;
  if d->>'lead_id' is distinct from o->>'lead_id' then changes:=array_append(changes,'lead'); end if;
  if cardinality(changes)>0 then
   recipients:=notification_private.people_task_recipients(d);
   perform notification_private.row_event(d,tg_table_name,'task_updated',proj,recipients,
    coalesce(nullif(d->>'title',''),'Task')||': '||array_to_string(changes,', ')||' changed.',k||':updated');
  end if;

 elsif tg_table_name='notes' then
  if lower(coalesce(d->>'related_type',''))='project' then proj:=nullif(d->>'related_id','')::uuid; end if;
  if tg_op='INSERT' then
   -- Project inserts still use the original project_comment and mention trigger.
   if proj is null then perform notification_private.row_event(d,'notes','note_created',null,'{}',
     'A note was added. Open it to review.',k||':created'); end if;
   return new;
  end if;
  if d->>'content' is distinct from o->>'content' then changes:=array_append(changes,'content'); end if;
  if d->>'category' is distinct from o->>'category' then changes:=array_append(changes,'category'); end if;
  if d->>'is_pinned' is distinct from o->>'is_pinned' then changes:=array_append(changes,'pin'); end if;
  if (d->>'related_type',d->>'related_id') is distinct from (o->>'related_type',o->>'related_id')
   then changes:=array_append(changes,'linked record'); end if;
  select coalesce(array_agg(m),'{}'::uuid[]) into added_mentions
   from unnest(coalesce(new.mention_user_ids,'{}'::uuid[])) m
   where not (m=any(coalesce(old.mention_user_ids,'{}'::uuid[])));
  if cardinality(added_mentions)>0 then
   recipients:=notification_private.targets(c,to_jsonb(added_mentions));
   select coalesce(array_agg(p.id),'{}'::uuid[]) into recipients from public.profiles p
    where p.id=any(recipients) and (p.role in ('owner','admin','office') or
     (proj is not null and exists(select 1 from public.project_staff s where s.company_id=c
       and s.project_id=proj and s.user_id=p.id and s.is_active is distinct from false)));
   perform notification_private.row_event(d,'notes','mentioned',proj,recipients,
     left(coalesce(d->>'content',''),500),k||':mention');
  elsif d->'mention_user_ids' is distinct from o->'mention_user_ids' then
   changes:=array_append(changes,'mentions');
  end if;
  if cardinality(changes)>0 then
   perform notification_private.row_event(d,'notes','note_updated',proj,'{}',
    'Note '||array_to_string(changes,', ')||' changed. Open it to review.',k||':updated');
  end if;

 elsif tg_table_name='project_daily_logs' then
  if tg_op<>'UPDATE' then return new; end if;
  if d->>'summary' is distinct from o->>'summary' then changes:=array_append(changes,'summary'); end if;
  if d->>'crew_on_site' is distinct from o->>'crew_on_site' then changes:=array_append(changes,'crew'); end if;
  if d->>'materials_used' is distinct from o->>'materials_used' then changes:=array_append(changes,'materials'); end if;
  if d->>'next_steps' is distinct from o->>'next_steps' then changes:=array_append(changes,'next steps'); end if;
  if d->>'weather' is distinct from o->>'weather' then changes:=array_append(changes,'weather'); end if;
  if d->>'date' is distinct from o->>'date' then changes:=array_append(changes,'date'); end if;
  if d->>'category' is distinct from o->>'category' then changes:=array_append(changes,'category'); end if;
  if (d->>'project_id',d->>'lead_id',d->>'client_id') is distinct from (o->>'project_id',o->>'lead_id',o->>'client_id')
   then changes:=array_append(changes,'linked record'); end if;
  if d->>'blockers' is distinct from o->>'blockers' and nullif(d->>'blockers','') is null
   then changes:=array_append(changes,'resolved blocker'); end if;
  if d->>'safety_concerns' is distinct from o->>'safety_concerns' and nullif(d->>'safety_concerns','') is null
   then changes:=array_append(changes,'resolved safety concern'); end if;
  if d->>'weather_delay' is distinct from o->>'weather_delay' and d->>'weather_delay' is distinct from 'true'
   then changes:=array_append(changes,'weather delay'); end if;
  if d->'photos' is distinct from o->'photos' and
    jsonb_array_length(case when jsonb_typeof(d->'photos')='array' then d->'photos' else '[]'::jsonb end)
    <=jsonb_array_length(case when jsonb_typeof(o->'photos')='array' then o->'photos' else '[]'::jsonb end)
   then changes:=array_append(changes,'photos'); end if;
  if cardinality(changes)>0 and
   -- Existing safety, issue, and new-photo alerts cover these changes in the same save.
   not ((d->>'blockers' is distinct from o->>'blockers' and nullif(d->>'blockers','') is not null)
    or (d->>'safety_concerns' is distinct from o->>'safety_concerns' and nullif(d->>'safety_concerns','') is not null)
    or (d->>'safety_status' is distinct from o->>'safety_status' and nullif(d->>'safety_concerns','') is not null)
    or (d->>'weather_delay' is distinct from o->>'weather_delay' and d->>'weather_delay'='true')
    or (d->'photos' is distinct from o->'photos' and
      jsonb_array_length(case when jsonb_typeof(d->'photos')='array' then d->'photos' else '[]'::jsonb end)
       >jsonb_array_length(case when jsonb_typeof(o->'photos')='array' then o->'photos' else '[]'::jsonb end)))
  then perform notification_private.row_event(d,'project_daily_logs','daily_log_updated',proj,'{}',
    'Project note '||array_to_string(changes,', ')||' changed. Open it to review.',k||':updated'); end if;
 end if;
 return new;
end $$;
revoke all on function notification_private.amendment_event() from public,anon,authenticated;

-- Preserve the original project-note creation behavior, while routing edits to the new handler.
drop trigger if exists notification_events on public.notes;
create trigger notification_events after insert on public.notes for each row
 execute function notification_private.source_event();
create trigger notification_amendment_events after insert or update on public.notes for each row
 execute function notification_private.amendment_event();
create trigger notification_amendment_events after update on public.tasks for each row
 execute function notification_private.amendment_event();
create trigger notification_amendment_events after update on public.project_tasks for each row
 execute function notification_private.amendment_event();
create trigger notification_amendment_events after update on public.project_daily_logs for each row
 execute function notification_private.amendment_event();
