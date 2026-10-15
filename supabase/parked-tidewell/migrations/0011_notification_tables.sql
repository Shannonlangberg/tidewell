-- 0011_notification_tables.sql
-- notification_rules, notification_preferences, push_subscriptions, outbox, notifications (3.3, spec 2).

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type = any (private.event_types())),
  recipient_role text not null check (recipient_role in ('owner', 'manager', 'crew', 'guest', 'enquirer')),
  recipient_scope text not null check (recipient_scope in ('property_owners', 'account_members', 'assignee_then_all_managers', 'all_managers', 'job_crew', 'reservation_guest', 'lead_enquirer')),
  priority smallint not null check (priority in (0, 1, 2)),
  channels public.notify_channel[] not null check (cardinality(channels) > 0),
  ack_wait_minutes integer check (ack_wait_minutes is null or ack_wait_minutes > 0),
  respect_quiet_hours boolean not null default true,
  template_key text not null check (template_key ~ '^[a-z0-9_]+$'),
  dedupe_discriminator text,
  collapse_key_pattern text,
  enabled boolean not null default true,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_rules_unique unique (event_type, recipient_role, recipient_scope)
);
comment on table public.notification_rules is 'The notification matrix as data (spec 2), seeded by seed.sql and edited on the triggers page. channels is the ladder: rung 1 is sent first, later rungs after ack_wait_minutes. Priority 0 urgent (breaks quiet hours), 1 important, 2 routine.';
create trigger notification_rules_set_updated_at before update on public.notification_rules for each row execute function private.set_updated_at();
alter table public.notification_rules enable row level security;
alter table public.notification_rules force row level security;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  routine_push boolean not null default true,
  prefer_sms_over_push boolean not null default false,
  digest_morning boolean not null default true,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notification_preferences is 'Per-person switches. Priority 0 and 1, and statement or invoice emails, cannot be switched off (route_event enforces it).';
create trigger notification_preferences_set_updated_at before update on public.notification_preferences for each row execute function private.set_updated_at();
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_seen_at timestamptz,
  failed_at timestamptz,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions for each row execute function private.set_updated_at();
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

-- outbox: durable queue, one row per recipient per channel rung, plus document jobs.
create table public.outbox (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events (id),
  kind public.outbox_kind not null default 'notification',
  template_key text,
  category text not null default 'operational' check (category = 'operational'),
  priority smallint not null check (priority in (0, 1, 2)),
  recipient_kind text not null check (recipient_kind in ('user', 'guest', 'enquirer', 'contact')),
  recipient_user_id uuid references public.profiles (id),
  recipient_guest_id uuid,   -- fk in phase 2 (guests)
  recipient_contact_id uuid, -- fk in phase 6 (contacts)
  recipient_address text,
  property_id uuid references public.properties (id),
  entity_type text,
  entity_id uuid,
  thread_id uuid,            -- fk in phase 6 (threads)
  channel public.notify_channel not null,
  rung smallint not null default 1 check (rung >= 1),
  fallback_channel public.notify_channel,
  ack_wait_minutes integer,
  dedupe_key text not null,
  collapse_key text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  rendered_subject text,
  rendered_body text,
  send_after timestamptz not null default now(),
  status public.outbox_status not null default 'queued',
  attempts smallint not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  acknowledged_at timestamptz,
  provider text,
  provider_message_id text,
  cancelled_reason public.outbox_cancel_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbox_recipient_user check (recipient_kind <> 'user' or recipient_user_id is not null),
  constraint outbox_cancelled_pair check ((status = 'cancelled') = (cancelled_reason is not null))
);
comment on table public.outbox is 'Durable notification queue (spec 2 section 9). No client policies: only route_event() and the worker, through RPCs. Managers see v_outbox_status (phase 4).';
create unique index outbox_dedupe_idx on public.outbox (dedupe_key, channel) where status <> 'cancelled';
create index outbox_queued_idx on public.outbox (send_after) where status = 'queued';
create index outbox_fallback_idx on public.outbox (sent_at) where status in ('sent', 'delivered') and acknowledged_at is null and fallback_channel is not null;
create index outbox_recipient_idx on public.outbox (recipient_user_id, created_at desc);
create index outbox_provider_idx on public.outbox (provider_message_id);
create index outbox_event_idx on public.outbox (event_id);
create trigger outbox_set_updated_at before update on public.outbox for each row execute function private.set_updated_at();

-- No secret ever rides in a payload (3.3): reject the obvious keys before insert.
create function private.outbox_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_bad text;
begin
  select k into v_bad from jsonb_object_keys(new.payload) as k
    where lower(k) in ('code', 'door_code', 'wifi', 'password', 'token') limit 1;
  if v_bad is not null then
    raise exception 'outbox payload key "%" is refused: secrets never ride in a notification', v_bad using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger outbox_guard before insert or update of payload on public.outbox for each row execute function private.outbox_guard();
create trigger outbox_rpc_guard before update on public.outbox for each row
  execute function private.rpc_guard('route_event', 'outbox_worker', 'claim_outbox', 'complete_outbox', 'cancel_outbox', 'acknowledge', 'digest_merge', 'document_sweep', 'memberships_after_end', 'record_document');
alter table public.outbox enable row level security;
alter table public.outbox force row level security;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  outbox_id bigint references public.outbox (id),
  event_id bigint references public.events (id),
  property_id uuid references public.properties (id),
  priority smallint not null check (priority in (0, 1, 2)),
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notifications is 'The in-app feed and badges. Inserted by the worker; a person may set read_at on their own rows; each insert broadcasts to user:{id}.';
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create trigger notifications_set_updated_at before update on public.notifications for each row execute function private.set_updated_at();
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
