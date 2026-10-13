-- 0016_event_routing.sql
-- route_event() (notification_rules -> outbox, phase-0 version: rows are queued, nothing is sent
-- until the worker lands in phase 4), the events_route trigger (route + realtime.send to the
-- audience-split topics), notifications_broadcast, memberships_after_end, and the
-- realtime.messages select policies (3.1). No insert policy exists on realtime.messages, so no
-- browser can broadcast.

-- Recipients for a rule scope, as (recipient_kind, user_id, address).
create function private.event_recipients(p_scope text, p_event public.events)
returns table (recipient_kind text, recipient_user_id uuid, recipient_address text)
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_account uuid := p_event.owner_account_id;
begin
  if v_account is null and p_event.property_id is not null then
    select owner_account_id into v_account from public.properties where id = p_event.property_id;
  end if;
  if p_scope in ('property_owners', 'account_members') then
    return query
      select 'user'::text, m.user_id, null::text
      from public.memberships m
      where m.owner_account_id = v_account and m.role = 'owner' and m.status = 'active';
  elsif p_scope in ('all_managers', 'assignee_then_all_managers') then
    -- assignee-first routing arrives with threads (phase 6); until then every manager is told
    return query
      select distinct 'user'::text, m.user_id, null::text
      from public.memberships m
      where m.role = 'manager' and m.status = 'active';
  elsif p_scope = 'lead_enquirer' and p_event.entity_type = 'lead' then
    return query
      select 'enquirer'::text, null::uuid, l.email::text
      from public.leads l
      where l.id = p_event.entity_id and l.email is not null and l.deidentified_at is null;
  end if;
  -- job_crew and reservation_guest resolve once jobs (phase 3) and reservations (phase 2) exist.
  return;
end $$;

-- route_event(): one outbox row per recipient per first rung (priority 0 sends push and SMS together).
-- Priority 2 push honours notification_preferences.routine_push; priorities 0 and 1 cannot be
-- switched off. Quiet hours hold priority 1 and 2 until quiet_end; priority 0 breaks them.
create function private.route_event(p_event public.events) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  r record;
  rec record;
  v_ladder public.notify_channel[];
  v_channel public.notify_channel;
  v_fallback public.notify_channel;
  v_send_after timestamptz;
  v_dedupe text;
  v_recipient_key text;
  v_count integer := 0;
  v_prefs public.notification_preferences;
  v_profile public.profiles;
  v_address text;
begin
  perform set_config('app.rpc', 'route_event', true);
  for r in
    select * from public.notification_rules nr where nr.event_type = p_event.type and nr.enabled
  loop
    for rec in select * from private.event_recipients(r.recipient_scope, p_event) loop
      v_ladder := r.channels;
      v_prefs := null;
      v_profile := null;
      if rec.recipient_kind = 'user' then
        select * into v_profile from public.profiles where id = rec.recipient_user_id;
        if v_profile.id is null or not v_profile.is_active then
          continue;
        end if;
        select * into v_prefs from public.notification_preferences where user_id = rec.recipient_user_id;
        if r.priority = 2 and v_prefs.user_id is not null and not v_prefs.routine_push then
          v_ladder := array_remove(v_ladder, 'push'::public.notify_channel);
        end if;
        if v_profile.sms_opt_out_at is not null or v_profile.phone_e164 is null then
          v_ladder := array_remove(v_ladder, 'sms'::public.notify_channel);
          v_ladder := array_remove(v_ladder, 'voice'::public.notify_channel);
        end if;
        if v_profile.email is null then
          v_ladder := array_remove(v_ladder, 'email'::public.notify_channel);
        end if;
      end if;
      if cardinality(v_ladder) = 0 then
        continue;
      end if;
      v_send_after := now();
      if r.respect_quiet_hours and r.priority > 0 and private.in_quiet_hours(now()) then
        v_send_after := private.next_quiet_end(now());
      end if;
      v_recipient_key := coalesce(rec.recipient_user_id::text, rec.recipient_address, 'unknown');
      v_dedupe := p_event.type || ':' || coalesce(p_event.entity_id::text, p_event.id::text) || ':' || v_recipient_key
                  || coalesce(':' || r.dedupe_discriminator, '');
      v_channel := v_ladder[1];
      v_fallback := v_ladder[2];
      v_address := case v_channel
        when 'email' then coalesce(rec.recipient_address, v_profile.email::text)
        when 'sms' then coalesce(rec.recipient_address, v_profile.phone_e164)
        when 'voice' then coalesce(rec.recipient_address, v_profile.phone_e164)
        else rec.recipient_address
      end;
      insert into public.outbox (event_id, kind, template_key, priority, recipient_kind, recipient_user_id, recipient_address,
                                 property_id, entity_type, entity_id, channel, rung, fallback_channel, ack_wait_minutes,
                                 dedupe_key, collapse_key, payload, send_after)
      values (p_event.id, 'notification', r.template_key, r.priority, rec.recipient_kind, rec.recipient_user_id, v_address,
              p_event.property_id, p_event.entity_type, p_event.entity_id, v_channel, 1, v_fallback, r.ack_wait_minutes,
              v_dedupe, r.collapse_key_pattern, p_event.payload, v_send_after)
      on conflict (dedupe_key, channel) where status <> 'cancelled' do nothing;
      v_count := v_count + 1;
      -- urgent: push and SMS go together, now
      if r.priority = 0 and v_channel = 'push' and 'sms' = any (v_ladder) then
        insert into public.outbox (event_id, kind, template_key, priority, recipient_kind, recipient_user_id, recipient_address,
                                   property_id, entity_type, entity_id, channel, rung, fallback_channel, ack_wait_minutes,
                                   dedupe_key, collapse_key, payload, send_after)
        values (p_event.id, 'notification', r.template_key, r.priority, rec.recipient_kind, rec.recipient_user_id, v_profile.phone_e164,
                p_event.property_id, p_event.entity_type, p_event.entity_id, 'sms', 1,
                (select c from unnest(v_ladder) with ordinality as u(c, n) where c not in ('push', 'sms') order by n limit 1),
                r.ack_wait_minutes, v_dedupe, r.collapse_key_pattern, p_event.payload, v_send_after)
        on conflict (dedupe_key, channel) where status <> 'cancelled' do nothing;
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  perform set_config('app.rpc', '', true);
  return v_count;
end $$;

-- events_route: after every event, route it and poke the audience-split private topics with no
-- payload beyond the entity reference; clients only router.refresh().
create function private.events_route() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_ref jsonb := jsonb_build_object('entity_type', new.entity_type, 'entity_id', new.entity_id, 'type', new.type);
begin
  perform private.route_event(new);
  perform realtime.send(v_ref, 'refresh', 'managers', true);
  if new.property_id is not null and new.audience @> '{owner}' then
    perform realtime.send(v_ref, 'refresh', 'property:' || new.property_id::text || ':owner', true);
  end if;
  if new.property_id is not null and new.audience @> '{crew}' then
    perform realtime.send(v_ref, 'refresh', 'property:' || new.property_id::text || ':crew', true);
  end if;
  return null;
end $$;
create trigger events_route after insert on public.events
  for each row execute function private.events_route();

-- notifications_broadcast: each in-app notification pokes user:{id}.
create function private.notifications_broadcast() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
begin
  perform realtime.send(jsonb_build_object('entity_type', 'notification', 'entity_id', new.id, 'type', 'notification.sent'),
                        'refresh', 'user:' || new.user_id::text, true);
  return null;
end $$;
create trigger notifications_broadcast after insert on public.notifications
  for each row execute function private.notifications_broadcast();

-- memberships_after_end: an ended member loses push subscriptions at once (and, from phase 3, open
-- assignments and queued offers). Sessions are deleted by end_membership() itself.
create function private.memberships_after_end() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
begin
  if not exists (select 1 from public.memberships m where m.user_id = new.user_id and m.status = 'active') then
    delete from public.push_subscriptions where user_id = new.user_id;
  end if;
  -- phase 3: remove open job_assignments and cancel queued offers for new.user_id
  return null;
end $$;
create trigger memberships_after_end after update of status on public.memberships
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function private.memberships_after_end();

-- realtime.messages: select policies per topic suffix. Realtime authorises at join and token
-- refresh only, which is why end_membership() deletes auth.sessions rows.
create policy realtime_owner_topic on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.is_owner_of(private.topic_property_id(realtime.topic(), 'owner'))
  );
create policy realtime_crew_topic on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.crew_at(private.topic_property_id(realtime.topic(), 'crew'))
  );
create policy realtime_managers_topic on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'managers'
    and private.is_manager()
  );
create policy realtime_user_topic on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select auth.uid()) is not null
    and realtime.topic() = 'user:' || (select auth.uid())::text
  );
