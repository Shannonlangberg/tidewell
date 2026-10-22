-- Planted HQ: deleting website enquiries (migrations 0158, 0159).
-- Directors only (an administrator with growth.delete, the BDM, read only and the junior are refused),
-- the typed confirmation, the spam tidy-up first (an untouched lead and contact are archived, a lead
-- it joined is kept), the row is gone, copies elsewhere are kept, the audit event has no personal data,
-- every other delete is still refused, and the privileges.
--
-- Runs on an unseeded database (the CI job resets from scratch).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(27);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz_r to public;
create function pg_temp.r(p_k text, p_f text) returns text language sql stable as $$ select v ->> p_f from zz_r where k = p_k $$;
create function pg_temp.eid(p_k text) returns uuid language sql stable as $$ select (v ->> 'enquiry_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.oid_(p_k text) returns uuid language sql stable as $$ select (v ->> 'opportunity_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql stable as $$ select (v ->> 'contact_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.tid(p_k text) returns uuid language sql stable as $$ select (v ->> 'task_id')::uuid from zz_r where k = p_k $$;
grant execute on function pg_temp.r(text, text), pg_temp.eid(text), pg_temp.oid_(text), pg_temp.cid(text), pg_temp.tid(text) to public;

create function pg_temp.submit(p_k text, p_name text, p_email text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.submit_enquiry('contact'::hq.enquiry_kind, p_name, p_email, null, null, 'A test enquiry from ' || p_name || ', please ignore', null, '/contact', null);
  execute 'reset role';
  insert into zz_r values (p_k, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
grant execute on function pg_temp.submit(text, text, text) to public;

select pg_temp.submit('a', '[test] Steve', 'steve@example.test');
select pg_temp.submit('b', '[test] Jeff', 'jeff@example.test');
select pg_temp.submit('b2', '[test] Jeff again', 'jeff@example.test');

-- ------------------------------------------------------------ structure and privileges
select has_function('hq', 'delete_enquiry', array['uuid', 'text'], 'delete_enquiry exists');
select ok(has_function_privilege('authenticated', 'hq.delete_enquiry(uuid,text)', 'execute'), 'authenticated can execute it (it checks the director role inside)');
select ok(not has_function_privilege('anon', 'hq.delete_enquiry(uuid,text)', 'execute')
      and not has_function_privilege('service_role', 'hq.delete_enquiry(uuid,text)', 'execute'), 'anon and service_role cannot');
select ok(not has_function_privilege('authenticated', 'hq_private.enquiry_no_delete()', 'execute'), 'nobody may execute the delete guard');

-- ------------------------------------------------------------ who may delete
select pg_temp.become('adm');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', 'only a director can delete a website enquiry', 'an administrator (growth.delete, not a director) is refused');
select pg_temp.become('bdm');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', null, 'a business development manager (growth.write only) is refused');
select pg_temp.become('ro');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', null, 'read only is refused');
select pg_temp.become('jpm');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', null, 'a junior property manager is refused');
select pg_temp.become('outsider');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', null, 'a login with no HQ profile is refused');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), 'ENQ-0001')$$, '42501', null, 'a director at aal1 with require_mfa is refused');

-- ------------------------------------------------------------ the confirmation
select pg_temp.become('dir');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), null)$$, '22023', null, 'no confirmation: refused');
select throws_ok($$select hq.delete_enquiry(pg_temp.eid('a'), pg_temp.r('b', 'ref'))$$, '22023', null, 'another enquiry''s number: refused');
select throws_ok($$select hq.delete_enquiry(gen_random_uuid(), 'ENQ-0001')$$, 'P0002', 'enquiry not found', 'an unknown enquiry is not found');
select pg_temp.unbecome();
select is((select count(*) from hq.enquiries where id = pg_temp.eid('a')), 1::bigint, '... and nothing was deleted');

-- ------------------------------------------------------------ a director deletes a new test enquiry
select pg_temp.become('dir');
insert into zz_r select 'da', hq.delete_enquiry(pg_temp.eid('a'), lower(' ' || pg_temp.r('a', 'ref') || ' '));
select is(pg_temp.r('da', 'deleted') || pg_temp.r('da', 'lead_archived') || pg_temp.r('da', 'contact_archived'), 'truetruetrue', 'a director deletes it (the number in any case, spaces ignored); its untouched lead and contact are archived');
select is((select count(*) from hq.enquiry_overview where id = pg_temp.eid('a')), 0::bigint, '... it is gone from the list');
select pg_temp.unbecome();
select is((select count(*) from hq.enquiries where id = pg_temp.eid('a')), 0::bigint, '... the row is deleted');
select ok((select deleted_at is not null from hq.opportunities where id = pg_temp.oid_('a'))
      and (select deleted_at is not null from hq.contacts where id = pg_temp.cid('a'))
      and (select deleted_at is not null from hq.tasks where id = pg_temp.tid('a')), '... the lead, contact and reply task are archived, not erased');
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('a') and action = 'delete' and actor_id = pg_temp.fx('dir')), 1::bigint, 'one delete audit event, as the director');
select ok((select summary !~ 'Steve|example' and changes::text !~ 'Steve|example|ignore' from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('a') and action = 'delete'),
  '... with no name, email or message in it');
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('a') and action = 'mark_spam'), 1::bigint, '... after the spam tidy-up, also audited');

-- ------------------------------------------------------------ one already marked spam; one that joined a lead
select pg_temp.become('dir');
select hq.mark_enquiry_spam(pg_temp.eid('b2'));
insert into zz_r select 'db2', hq.delete_enquiry(pg_temp.eid('b2'), pg_temp.r('b2', 'ref'));
select is(pg_temp.r('db2', 'deleted') || pg_temp.r('db2', 'lead_archived'), 'truefalse', 'a spam enquiry that joined a lead is deleted; the lead it joined is kept');
select pg_temp.unbecome();
select is((select deleted_at from hq.opportunities where id = pg_temp.oid_('b')), null, '... the lead stays live');
select is((select count(*) from hq.enquiries where id = pg_temp.eid('b')), 1::bigint, '... and the first enquiry on it is untouched');

-- ------------------------------------------------------------ every other delete is still refused
select pg_temp.become('dir');
select throws_ok($$delete from hq.enquiries where id = pg_temp.eid('b')$$, '42501', null, 'a director still cannot delete an enquiry directly');
select pg_temp.unbecome();
select throws_ok($$delete from hq.enquiries where id = pg_temp.eid('b')$$, '42501', null, '... nor can the table owner');
select is((select current_setting('hq.enquiry_delete', true)), '', 'the delete marker is cleared after the delete');

select * from finish();
rollback;
