-- 0006_documents.sql
-- documents: every PDF and file of record (3.3). statement_id and invoice_id get their foreign keys
-- in phase 7; offboarding_id gets its key in 0010_offboardings.sql.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  kind public.document_kind not null,
  owner_account_id uuid references public.owner_accounts (id),
  property_id uuid references public.properties (id),
  user_id uuid references public.profiles (id),
  storage_path text not null unique,
  bytes integer check (bytes is null or bytes >= 0),
  sha256 bytea not null check (octet_length(sha256) = 32),
  etag text,
  content_type text,
  statement_id uuid,   -- fk in phase 7 (statements)
  invoice_id uuid,     -- fk in phase 7 (invoices)
  offboarding_id uuid, -- fk in 0010_offboardings.sql
  contents jsonb,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles (id),
  retain_until date not null,
  expires_at timestamptz,
  downloaded_at timestamptz,
  resent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.documents is 'Every PDF and file of record. Clients never list the bucket: the UI reads these rows and signs by document_id after a sha256 check. Only downloaded_at and resent_at ever change.';
create index documents_account_idx on public.documents (owner_account_id, kind);
create index documents_property_idx on public.documents (property_id);
create index documents_user_idx on public.documents (user_id);
create index documents_retention_idx on public.documents (retain_until);
create trigger documents_set_updated_at before update on public.documents for each row execute function private.set_updated_at();

-- Immutability with two mutable columns (3.1: documents are immutable except downloaded_at, resent_at).
create function private.documents_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'public.documents rows are immutable (DELETE refused)' using errcode = 'insufficient_privilege';
  end if;
  if row(new.id, new.kind, new.owner_account_id, new.property_id, new.user_id, new.storage_path, new.bytes, new.sha256,
         new.etag, new.content_type, new.statement_id, new.invoice_id, new.offboarding_id, new.contents, new.generated_at,
         new.generated_by, new.retain_until, new.expires_at, new.created_at)
     is distinct from
     row(old.id, old.kind, old.owner_account_id, old.property_id, old.user_id, old.storage_path, old.bytes, old.sha256,
         old.etag, old.content_type, old.statement_id, old.invoice_id, old.offboarding_id, old.contents, old.generated_at,
         old.generated_by, old.retain_until, old.expires_at, old.created_at) then
    raise exception 'public.documents rows are immutable except downloaded_at and resent_at' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger documents_immutable before update or delete on public.documents
  for each row execute function private.documents_immutable();

alter table public.documents enable row level security;
alter table public.documents force row level security;
