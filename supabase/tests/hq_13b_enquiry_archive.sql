-- Planted HQ: archiving and restoring website enquiries (migrations 0156, 0157).
-- Who may archive and restore (growth.write; read only, a property manager and the junior are
-- refused), the stamps and the constraint, idempotence, spam refused, restore back to the status it
-- had, set_enquiry_status keeping the stamps in step, the lead, contact and task left alone, nothing
-- erased, the overview columns, and the audit trail.
--
-- Runs on an unseeded database (the CI job resets from scratch).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(38);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz_r to public;
create function pg_temp.eid(p_k text) returns uuid language sql stable as $$ select (v ->> 'enquiry_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.oid_(p_k text) returns uuid language sql stable as $$ select (v ->> 'opportunity_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql stable as $$ select (v ->> 'contact_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.tid(p_k text) returns uuid language sql stable as $$ select (v ->> 'task_id')::uuid from zz_r where k = p_k $$;
grant execute on function pg_temp.eid(text), pg_temp.oid_(text), pg_temp.cid(text), pg_temp.tid(text) to public;

create function pg_temp.submit(p_k text, p_name text, p_email text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.submit_enquiry('contact'::hq.enquiry_kind, p_name, p_email, null, null, 'Please call me about my rental', null, '/contact', null);
  execute 'reset role';
  insert into zz_r values (p_k, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
grant execute on function pg_temp.submit(text, text, text) to public;

select pg_temp.submit('a', '[test] Archie', 'archie@example.test');
select pg_temp.submit('b', '[test] Bea', 'bea@example.test');
select pg_temp.submit('s', '[test] Spam', 'spam@example.test');

-- ------------------------------------------------------------ structure and privileges
select has_function('hq', 'archive_enquiry', array['uuid', 'text'], 'archive_enquiry exists');
select has_function('hq', 'restore_enquiry', array['uuid'], 'restore_enquiry exists');
select ok(has_function_privilege('authenticated', 'hq.archive_enquiry(uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'hq.restore_enquiry(uuid)', 'execute'), 'authenticated can execute both (each checks growth.write inside)');
select ok(not has_function_privilege('anon', 'hq.archive_enquiry(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'hq.restore_enquiry(uuid)', 'execute')
      and not has_function_privilege('service_role', 'hq.archive_enquiry(uuid,text)', 'execute')
      and not has_function_privilege('service_role', 'hq.restore_enquiry(uuid)', 'execute'), 'anon and service_role cannot');
select has_column('hq', 'enquiry_overview', 'archived_by_name', 'the overview names who archived it');

-- ------------------------------------------------------------ who may archive
select pg_temp.become('ro');
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('a'))$$, '42501', null, 'read only cannot archive');
select pg_temp.become('pm');
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('a'))$$, '42501', null, 'a property manager (growth.read only) cannot archive');
select pg_temp.become('jpm');
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('a'))$$, '42501', null, 'a junior property manager cannot archive');
select pg_temp.become('outsider');
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('a'))$$, '42501', null, 'a login with no HQ profile cannot archive');

-- ------------------------------------------------------------ archiving
select pg_temp.become('dir');
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('a'), repeat('x', 201))$$, '22023', null, 'a reason over 200 characters is refused');
select throws_ok($$select hq.archive_enquiry(gen_random_uuid())$$, 'P0002', 'enquiry not found', 'an unknown enquiry is not found');
select is((hq.archive_enquiry(pg_temp.eid('a'), 'Test enquiry') ->> 'changed'), 'true', 'a director archives a new enquiry');
select is((select status::text || ' ' || archived_from::text || ' ' || archive_reason from hq.enquiries where id = pg_temp.eid('a')), 'archived new Test enquiry', '... archived, from new, with the reason');
select is((select archived_by from hq.enquiries where id = pg_temp.eid('a')), pg_temp.fx('dir'), '... stamped with who');
select ok((select archived_at is not null and handled_at is null from hq.enquiries where id = pg_temp.eid('a')), '... and when; who handled it is unchanged');
select is((select archived_by_name from hq.enquiry_overview where id = pg_temp.eid('a')), (select full_name from hq.staff_profiles where id = pg_temp.fx('dir')), '... and the overview names them');
select is((hq.archive_enquiry(pg_temp.eid('a')) ->> 'changed'), 'false', 'archiving it again changes nothing');
select is((select archive_reason from hq.enquiries where id = pg_temp.eid('a')), 'Test enquiry', '... and keeps the reason');
select pg_temp.unbecome();
select is((select deleted_at from hq.opportunities where id = pg_temp.oid_('a')), null, 'its lead is left alone');
select is((select deleted_at from hq.contacts where id = pg_temp.cid('a')), null, '... and its contact');
select is((select deleted_at from hq.tasks where id = pg_temp.tid('a')), null, '... and its reply task');
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('a') and action = 'archive' and actor_id = pg_temp.fx('dir')), 1::bigint, 'archiving is audited once, as the director');

-- the BDM (growth.write) archives one that is in progress
select pg_temp.become('dir');
select hq.set_enquiry_status(pg_temp.eid('b'), 'in_progress');
select pg_temp.become('bdm');
select is((hq.archive_enquiry(pg_temp.eid('b')) ->> 'status'), 'archived', 'a business development manager (growth.write) archives one in progress');
select is((select archived_from::text || coalesce(archive_reason, '-') from hq.enquiries where id = pg_temp.eid('b')), 'in_progress-', '... remembering it was in progress, no reason');

-- spam is refused
select pg_temp.become('dir');
select hq.mark_enquiry_spam(pg_temp.eid('s'));
select throws_ok($$select hq.archive_enquiry(pg_temp.eid('s'))$$, '22023', null, 'a spam enquiry cannot be archived (it is already out of the list)');

-- ------------------------------------------------------------ restoring
select pg_temp.become('ro');
select throws_ok($$select hq.restore_enquiry(pg_temp.eid('a'))$$, '42501', null, 'read only cannot restore');
select pg_temp.become('dir');
select is((hq.restore_enquiry(pg_temp.eid('a')) ->> 'status'), 'new', 'restoring brings it back to new');
select ok((select archived_at is null and archived_by is null and archived_from is null and archive_reason is null from hq.enquiries where id = pg_temp.eid('a')), '... clearing the archive stamps');
select is((hq.restore_enquiry(pg_temp.eid('a')) ->> 'changed'), 'false', 'restoring one that is not archived changes nothing');
select is((hq.restore_enquiry(pg_temp.eid('b')) ->> 'status'), 'in_progress', 'the in-progress one comes back in progress');
select throws_ok($$select hq.restore_enquiry(gen_random_uuid())$$, 'P0002', 'enquiry not found', 'restoring an unknown enquiry is not found');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and action = 'restore'), 2::bigint, 'each restore is audited');

-- ------------------------------------------------------------ set_enquiry_status keeps the stamps in step
select pg_temp.become('dir');
select is((hq.set_enquiry_status(pg_temp.eid('a'), 'archived') ->> 'status'), 'archived', 'Archive through set_enquiry_status still works');
select ok((select archived_at is not null and archived_by = pg_temp.fx('dir') and archived_from = 'new' from hq.enquiries where id = pg_temp.eid('a')), '... and is stamped like archive_enquiry');
select is((hq.set_enquiry_status(pg_temp.eid('a'), 'new') ->> 'status'), 'new', 'Back to New through set_enquiry_status');
select ok((select archived_at is null and archived_from is null from hq.enquiries where id = pg_temp.eid('a')), '... clears the stamps');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the constraint, for every writer
select throws_ok($$update hq.enquiries set status = 'archived' where id = pg_temp.eid('a')$$, '23514', null, 'archived without the stamps is refused, even for the table owner');
select throws_ok($$delete from hq.enquiries where id = pg_temp.eid('a')$$, '42501', null, 'nothing is erased: an enquiry still cannot be deleted');

select * from finish();
rollback;
