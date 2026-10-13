-- 0005_events.sql
-- events: the append-only ledger (3.3, decision 9). Inserted only by private.emit_event()
-- (0013_helpers.sql); routed by events_route (0016_event_routing.sql).

create table public.events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in (
    'lead', 'owner_account', 'membership', 'property', 'property_step', 'agreement', 'dd_mandate', 'channel_connection',
    'channel_listing', 'ical_import', 'ical_export', 'property_fact', 'property_secret', 'access_code', 'stay_link',
    'reservation', 'job', 'photo', 'maintenance_item', 'quote', 'approval', 'supplier_invoice', 'claim', 'pay_run',
    'platform_payout', 'statement', 'invoice', 'thread', 'message', 'notification', 'offboarding', 'document', 'lock',
    'security', 'auth', 'enquiry', 'sync', 'digest', 'retention')),
  entity_id uuid,
  type text not null check (type = any (private.event_types())),
  property_id uuid references public.properties (id),
  owner_account_id uuid references public.owner_accounts (id),
  actor_kind text not null default 'system' check (actor_kind in ('user', 'system', 'adapter', 'assistant', 'guest_token')),
  actor_user_id uuid references public.profiles (id),
  audience text[] not null default '{internal}' check (audience <@ array['internal', 'owner', 'crew']::text[] and cardinality(audience) > 0),
  at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  correlation_id text
);
comment on table public.events is 'Append-only ledger: every history view reads it. Insert only through private.emit_event(); no update or delete for any role; truncate revoked.';
create index events_entity_idx on public.events (entity_type, entity_id, at);
create index events_owner_feed_idx on public.events (property_id, at desc) where audience @> '{owner}';
create index events_type_idx on public.events (type, at desc);
create index events_account_idx on public.events (owner_account_id, at desc);
create unique index events_dedupe_idx on public.events (entity_type, entity_id, type)
  where type in ('turnover.long_gap', 'job.unassigned_soon', 'job.unaccepted_same_day');
create unique index events_correlation_idx on public.events (correlation_id, type) where correlation_id is not null;

create trigger events_immutable before update or delete on public.events
  for each row execute function private.raise_immutable();

alter table public.events enable row level security;
alter table public.events force row level security;
