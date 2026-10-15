-- hq_contractor_fixture.inc: Phase 2 (contractor) helpers for the hq_05_contractors_* tests. Included
-- with \ir AFTER hq_fixture.inc, and pg_temp.seed_contractors() runs AFTER pg_temp.seed_hq(). Not a
-- test itself; everything is undone by the test's rollback.

-- Any contractor data already in this database (for example the seeded maintenance prospects) is put
-- out of the way for the transaction, the two settings are reset to their defaults, and two fixture
-- contractors are added by a system write:
--   c_plumb  "Test Plumbing Co"   plumbing     suburbs Moonta, Kadina
--   c_spark  "Test Sparks Co"     electrical   no suburbs
create function pg_temp.seed_contractors() returns void
language plpgsql as $$
declare
  v uuid;
begin
  update hq.settings set value = '3'::jsonb where key = 'contractor_min_reviews_for_rating';
  update hq.settings set value = '30'::jsonb where key = 'contractor_expiry_warning_days';
  update hq.contractor_documents set deleted_at = now() where deleted_at is null;
  update hq.contractor_reviews set deleted_at = now() where deleted_at is null;
  update hq.contractors set deleted_at = now() where deleted_at is null;

  insert into hq.contractors (business_name, categories, service_suburbs) values ('Test Plumbing Co', '{plumbing}', '{Moonta,Kadina}') returning id into v;
  insert into fx values ('c_plumb', v);
  insert into hq.contractors (business_name, categories) values ('Test Sparks Co', '{electrical}') returning id into v;
  insert into fx values ('c_spark', v);
end $$;

-- A contractor added by a system write; returns its id and keeps it as fx(p_key).
create function pg_temp.mk_contractor(p_key text, p_name text, p_categories text[] default '{other}') returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  insert into hq.contractors (business_name, categories) values (p_name, p_categories) returning id into v;
  insert into fx values (p_key, v);
  return v;
end $$;

-- Steps 1 to 8 marked done through the RPC, as whoever is signed in.
create function pg_temp.complete_checklist(p_contractor uuid) returns void
language plpgsql as $$
declare
  s hq.vetting_step;
begin
  for s in select unnest(enum_range(null::hq.vetting_step)) loop
    continue when s = 'review_and_approve';
    perform hq.set_vetting_step(p_contractor, s, 'done', null);
  end loop;
end $$;

-- An object in the private bucket as the Storage API leaves it after an upload (system write).
create function pg_temp.mk_object(p_path text, p_size bigint default 1000, p_mime text default 'application/pdf') returns void
language sql as $$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('contractor-documents', p_path, null, jsonb_build_object('size', p_size, 'mimetype', p_mime));
$$;

-- A storage path for a new document of a contractor: <contractor id>/<new uuid>-<name>.
create function pg_temp.doc_path(p_contractor uuid, p_name text default 'file.pdf') returns text
language sql volatile as $$ select p_contractor::text || '/' || gen_random_uuid()::text || '-' || p_name $$;

-- A registered document (system write of the object AND the row); kept as fx(p_key).
create function pg_temp.mk_document(p_key text, p_contractor uuid, p_type hq.contractor_document_type, p_expires_on date default null) returns uuid
language plpgsql as $$
declare
  v_path text := pg_temp.doc_path(p_contractor, 'doc.pdf');
  v_id uuid := left(split_part(v_path, '/', 2), 36)::uuid;
begin
  perform pg_temp.mk_object(v_path);
  insert into hq.contractor_documents (id, contractor_id, document_type, file_name, storage_path, mime_type, size_bytes, expires_on)
  values (v_id, p_contractor, p_type, 'doc.pdf', v_path, 'application/pdf', 1000, p_expires_on);
  insert into fx values (p_key, v_id);
  return v_id;
end $$;
