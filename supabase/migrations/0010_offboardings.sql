-- 0010_offboardings.sql
-- offboardings (3.3, v1.1 adds undo_until), then documents.offboarding_id's foreign key (3.6).

create table public.offboardings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  initiated_by text not null check (initiated_by in ('owner', 'tidewell')),
  requested_by_user_id uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  reason public.offboarding_reason not null,
  reason_note text,
  effective_date date not null,
  lock_in_waived_by uuid references public.profiles (id),
  lock_in_waiver_reason text,
  status public.offboarding_status not null default 'notice_given',
  future_stays_acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  undo_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offboardings_waiver_needs_reason check (lock_in_waived_by is null or lock_in_waiver_reason is not null),
  constraint offboardings_cancelled_pair check ((status = 'cancelled') = (cancelled_at is not null))
);
comment on column public.offboardings.undo_until is 'A notice by a non-primary member carries a 24-hour window in which every member is told and any member may cancel.';
create unique index offboardings_one_open_per_property on public.offboardings (property_id) where status <> 'cancelled';
create trigger offboardings_set_updated_at before update on public.offboardings for each row execute function private.set_updated_at();
create trigger offboardings_status_guard before update of status on public.offboardings
  for each row when (old.status is distinct from new.status)
  execute function private.rpc_guard('start_offboarding', 'acknowledge_future_stays', 'cancel_offboarding', 'close_property', 'offboarding_worker');
alter table public.offboardings enable row level security;
alter table public.offboardings force row level security;

alter table public.documents
  add constraint documents_offboarding_id_fkey foreign key (offboarding_id) references public.offboardings (id);
