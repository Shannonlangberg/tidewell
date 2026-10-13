-- 0007_crew_profiles.sql
-- crew_profiles: supplier facts before a crew member is paid (3.3).

create table public.crew_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  crew_kind public.crew_kind not null,
  business_name text,
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  abn_verified_at timestamptz,
  entity_type text check (entity_type is null or entity_type in ('sole_trader', 'company', 'partnership', 'trust')),
  gst_registered boolean,
  super_applies boolean not null default true,
  address jsonb,
  super_fund jsonb,
  supplier_statement_document_id uuid references public.documents (id),
  rcti_agreement_signed_at timestamptz,
  bank_details_secret_id uuid,
  xero_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.crew_profiles is 'Supplier facts for a cleaner or tradie. super_fund member number and bank details are Vault secret ids, never plaintext. An RCTI needs gst_registered and rcti_agreement_signed_at; otherwise a remittance advice.';
create trigger crew_profiles_set_updated_at before update on public.crew_profiles for each row execute function private.set_updated_at();
alter table public.crew_profiles enable row level security;
alter table public.crew_profiles force row level security;

-- A crew member may set only business_name, address and abn, and only before the ABN is verified.
create function private.crew_profiles_self_update_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if private.is_manager() then
    return new;
  end if;
  if new.user_id = (select auth.uid()) then
    if old.abn_verified_at is not null and (new.abn is distinct from old.abn or new.business_name is distinct from old.business_name) then
      raise exception 'business name and ABN are locked once the ABN is verified' using errcode = 'insufficient_privilege';
    end if;
    if row(new.user_id, new.crew_kind, new.abn_verified_at, new.entity_type, new.gst_registered, new.super_applies, new.super_fund,
           new.supplier_statement_document_id, new.rcti_agreement_signed_at, new.bank_details_secret_id, new.xero_contact_id, new.created_at)
       is distinct from
       row(old.user_id, old.crew_kind, old.abn_verified_at, old.entity_type, old.gst_registered, old.super_applies, old.super_fund,
           old.supplier_statement_document_id, old.rcti_agreement_signed_at, old.bank_details_secret_id, old.xero_contact_id, old.created_at) then
      raise exception 'a crew member may change only business_name, address and abn' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  raise exception 'crew_profiles are written by managers' using errcode = 'insufficient_privilege';
end $$;
