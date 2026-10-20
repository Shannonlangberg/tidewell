-- Planted HQ: growth behaviour. Unique constraints, soft deletion, record_interaction (one
-- transaction), record_referral, move_opportunity, set_attributed_referral, the DOUBLE-COUNT PROOF,
-- views, audit and verification stamps.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(190);

-- archive every referral and opportunity (keeps the partner graph) so pipeline counts are exact
create function pg_temp.clear_pipeline() returns void language plpgsql as $$
begin
  update hq.referrals set deleted_at = now() where deleted_at is null;
  update hq.opportunities set deleted_at = now() where deleted_at is null;
end $$;

-- ------------------------------------------------------------ unique constraints and shapes
select throws_ok($$insert into hq.organisations (name, categories) values ('The Alpha Realty Pty Ltd', '{other}')$$, '23505', null, 'a second spelling of the same organisation name is refused (normalised name_key)');
select throws_ok($$insert into hq.organisations (name, categories) values ('ALPHA  realty', '{other}')$$, '23505', null, 'organisation names differing only by case and spacing are refused');
select lives_ok($$insert into hq.organisations (name, categories) values ('Alpha Realty Group', '{other}')$$, 'a genuinely different name is accepted');
select throws_ok(format($$insert into hq.contacts (organisation_id, full_name) values (%L, 'alice  ANDERS')$$, pg_temp.fx('alpha')), '23505', null, 'a duplicate contact within an organisation is refused (normalised name)');
select lives_ok(format($$insert into hq.contacts (organisation_id, full_name) values (%L, 'Alice Anders')$$, pg_temp.fx('beta')), 'the same name in a different organisation is fine');
select lives_ok($$insert into hq.contacts (full_name) values ('Indie Person'), ('Indie Person')$$, 'independents (no organisation) may share a name');
select throws_ok($$insert into hq.contacts (full_name, email) values ('Email Thief', 'ALICE@alpha.test')$$, '23505', null, 'a duplicate email is refused (case-insensitive)');
select throws_ok(format($$update hq.contacts set org_contact_role = 'primary' where id = %L$$, pg_temp.fx('alex')), '23505', null, 'two primary contacts in one organisation are refused');
select lives_ok(format($$update hq.contacts set org_contact_role = 'secondary' where id = %L$$, pg_temp.fx('alice')), 'a primary can be demoted ...');
select lives_ok(format($$update hq.contacts set org_contact_role = 'primary' where id = %L$$, pg_temp.fx('alex')), '... and another promoted');
update hq.contacts set org_contact_role = 'secondary' where id = pg_temp.fx('alex');
update hq.contacts set org_contact_role = 'primary' where id = pg_temp.fx('alice');
select throws_ok($$insert into hq.organisations (name, categories) values ('No Category Co', '{}')$$, '23514', null, 'an organisation needs at least one category');
select throws_ok($$insert into hq.organisations (name, categories) values ('   ', '{other}')$$, '23514', null, 'a blank organisation name is refused');
select throws_ok($$insert into hq.contacts (full_name, email) values ('Bad Email', 'not-an-email')$$, '23514', null, 'a malformed email is refused');
select throws_ok(format($$insert into hq.opportunities (prospect_name, estimated_annual_value_cents, assigned_to) values ('Negative', -1, %L)$$, pg_temp.fx('dir')), '23514', null, 'a negative estimated value is refused');
select throws_ok($$insert into hq.interactions (summary, interaction_type) values ('Nobody', 'note')$$, '23514', null, 'an interaction must reference a contact or an organisation');

-- ------------------------------------------------------------ soft deletion
select pg_temp.become('bdm');
select throws_ok(format($$update hq.contacts set deleted_at = now() where id = %L$$, pg_temp.fx('carol')), '42501', null, 'a growth.write holder without growth.delete cannot archive directly');
select throws_ok(format($$select hq.archive_record('contact', %L)$$, pg_temp.fx('carol')), '42501', null, 'archive_record needs growth.delete');
select pg_temp.become('dir');
select lives_ok(format($$select hq.archive_record('contact', %L, 'duplicate of another record')$$, pg_temp.fx('carol')), 'a director archives a contact');
select is((select deleted_by from hq.contacts where id = pg_temp.fx('carol')), pg_temp.fx('dir'), 'deleted_by is stamped by the database');
select is((select count(*) from hq.contact_directory where id = pg_temp.fx('carol')), 0::bigint, 'the directory view lists live contacts only');
select is(hq.archive_record('contact', pg_temp.fx('carol')) ->> 'changed', 'false', 'archiving twice is a no-op');
select pg_temp.become('bdm');
select is((select count(*) from hq.contacts where id = pg_temp.fx('carol')), 0::bigint, 'an archived contact is hidden from a growth.write holder');
select is((select count(*) from hq.contacts where full_name = 'Carol Clark'), 0::bigint, '... by any query');
select pg_temp.become('pm');
select is((select count(*) from hq.contacts where id = pg_temp.fx('carol')), 0::bigint, 'an archived contact is hidden from a property manager');
select pg_temp.become('dir');
select is((select deleted_at is not null from hq.contacts where id = pg_temp.fx('carol')), true, 'an archived contact stays visible to growth.delete holders');
select is((select count(*) from hq.audit_events where action = 'archive' and entity_id = pg_temp.fx('carol') and summary like '%duplicate of another record%'), 1::bigint, 'the archive is audited with its reason');
select lives_ok(format($$select hq.restore_record('contact', %L)$$, pg_temp.fx('carol')), 'a director restores it');
select is((select deleted_at is null and deleted_by is null from hq.contacts where id = pg_temp.fx('carol')), true, 'restored: deleted_at and deleted_by are cleared');
select is((select count(*) from hq.audit_events where action = 'restore' and entity_id = pg_temp.fx('carol')), 1::bigint, 'the restore is audited');
select throws_ok($$select hq.archive_record('banana', gen_random_uuid())$$, '22023', null, 'archive_record rejects an unknown entity');
select throws_ok($$select hq.archive_record('contact', gen_random_uuid())$$, 'P0002', null, 'archive_record reports a missing record');
-- a direct soft delete by a growth.delete holder works and is stamped
select lives_ok(format($$update hq.contacts set deleted_at = now() where id = %L$$, pg_temp.fx('alex')), 'a director may archive with a direct update');
select is((select deleted_by from hq.contacts where id = pg_temp.fx('alex')), pg_temp.fx('dir'), '... and deleted_by is still the caller');
select lives_ok(format($$update hq.contacts set deleted_at = null where id = %L$$, pg_temp.fx('alex')), '... and may restore the same way');
-- the database keeps the bookkeeping columns: a client cannot back-date or re-stamp a row
select pg_temp.unbecome();
select pg_temp.become('dir');
update hq.organisations set created_at = timestamptz '2000-01-01', updated_at = timestamptz '2000-01-01' where id = pg_temp.fx('alpha');
select pg_temp.unbecome();
select ok((select created_at > timestamptz '2001-01-01' and updated_at > timestamptz '2001-01-01' from hq.organisations where id = pg_temp.fx('alpha')), 'created_at and updated_at cannot be set by a client (created_at is immutable, updated_at is maintained)');
select throws_ok($$update hq.organisations set id = gen_random_uuid() where name = 'Alpha Realty'$$, '42501', null, 'a row id is immutable');
-- archived rows free their unique keys
select pg_temp.unbecome();
select pg_temp.become('dir');
select lives_ok($$insert into hq.organisations (name, categories) values ('Delta Archive Co', '{other}')$$, 'create an organisation to archive');
select lives_ok($$select hq.archive_record('organisation', (select id from hq.organisations where name = 'Delta Archive Co'))$$, 'archive it');
select lives_ok($$insert into hq.organisations (name, categories) values ('The Delta Archive Co.', '{other}')$$, 'an archived organisation''s name can be used again (unique indexes are partial)');
select pg_temp.unbecome();

-- a task can be archived by its creator (tasks.write + sees it); others cannot
select pg_temp.become('jpm');
insert into hq.tasks (title, assigned_to) values ('arch-own', pg_temp.fx('jpm'));
select lives_ok($$select hq.archive_record('task', (select id from hq.tasks where title = 'arch-own'))$$, 'a creator archives their own task');
select is((select count(*) from hq.tasks where title = 'arch-own'), 0::bigint, 'the archived task disappears for its creator');
select pg_temp.become('pm');
select pg_temp.unbecome();
insert into hq.tasks (title, assigned_to, created_by) values ('arch-other', pg_temp.fx('dir'), pg_temp.fx('dir'));
select pg_temp.become('pm');
select throws_ok(format($$select hq.archive_record('task', %L)$$, (select id from hq.tasks where title = 'arch-other' limit 1)), '42501', null, 'a property manager cannot archive a task they cannot see') ;
select pg_temp.unbecome();

-- ------------------------------------------------------------ record_interaction: one transaction
select pg_temp.become('bdm');
select pg_temp.keep('i1', hq.record_interaction(
  p_contact := pg_temp.fx('alice'), p_type := 'phone_call', p_occurred_at := now() - interval '2 days',
  p_summary := 'Introduced Planted', p_next_action := 'Send the fee schedule', p_follow_up_date := hq.today() + 7,
  p_create_task := true, p_new_status := 'contacted'));
select pg_temp.unbecome();
select ok(pg_temp.fx('i1_interaction_id') is not null and pg_temp.fx('i1_task_id') is not null, 'record_interaction returns {interaction_id, task_id}');
select is((select staff_id from hq.interactions where id = pg_temp.fx('i1_interaction_id')), pg_temp.fx('bdm'), 'the interaction is attributed to the caller');
select is((select organisation_id from hq.interactions where id = pg_temp.fx('i1_interaction_id')), pg_temp.fx('alpha'), 'the interaction takes the contact''s organisation');
select is((select task_id from hq.interactions where id = pg_temp.fx('i1_interaction_id')), pg_temp.fx('i1_task_id'), 'interactions.task_id is linked to the new task');
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('alice')), now() - interval '2 days', 'contacts.last_contact_at = the interaction time');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), hq.today() + 7, 'contacts.next_follow_up_date = the follow-up date');
select is((select relationship_status::text from hq.contacts where id = pg_temp.fx('alice')), 'contacted', 'the relationship status moved');
select is((select title || '|' || assigned_to || '|' || due_date || '|' || source || '|' || related_contact_id || '|' || related_organisation_id from hq.tasks where id = pg_temp.fx('i1_task_id')),
  'Send the fee schedule|' || pg_temp.fx('bdm') || '|' || (hq.today() + 7) || '|interaction|' || pg_temp.fx('alice') || '|' || pg_temp.fx('alpha'), 'the follow-up task: title from next_action, assigned to the caller, due on the follow-up date, linked to the contact');
select is((select count(*) from hq.audit_events where entity_type = 'interaction' and entity_id = pg_temp.fx('i1_interaction_id')), 1::bigint, 'the interaction has one audit row (linking the task is not a second event)');
select is((select count(*) from hq.audit_events where entity_type = 'contact' and entity_id = pg_temp.fx('alice') and action = 'update' and changes ?& array['last_contact_at', 'next_follow_up_date', 'relationship_status']), 1::bigint, 'the contact update is audited with its changed columns');

-- an older interaction does not pull last_contact_at back; no follow-up date leaves the date alone; no task
select pg_temp.become('bdm');
select pg_temp.keep('i2', hq.record_interaction(p_contact := pg_temp.fx('alice'), p_type := 'email', p_occurred_at := now() - interval '5 days', p_summary := 'Earlier email, logged late'));
select pg_temp.unbecome();
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('alice')), now() - interval '2 days', 'last_contact_at = greatest(existing, occurred_at): an older interaction does not move it back');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), hq.today() + 7, 'no follow-up date given: next_follow_up_date is unchanged');
select is((select task_id from hq.interactions where id = pg_temp.fx('i2_interaction_id')), null, 'no task was created or linked');
select is((select relationship_status::text from hq.contacts where id = pg_temp.fx('alice')), 'contacted', 'no new status given: status unchanged');
select pg_temp.become('bdm');
select pg_temp.keep('i3', hq.record_interaction(p_contact := pg_temp.fx('alice'), p_type := 'coffee_meeting', p_occurred_at := now() - interval '1 hour', p_summary := 'Coffee', p_follow_up_date := hq.today() + 30));
select pg_temp.unbecome();
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('alice')), now() - interval '1 hour', 'a newer interaction moves last_contact_at forward');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), hq.today() + 30, 'a new follow-up date replaces the old one');

-- an organisation-only interaction touches no contact
select pg_temp.become('bdm');
select pg_temp.keep('i4', hq.record_interaction(p_organisation := pg_temp.fx('beta'), p_type := 'office_meeting', p_summary := 'Office visit'));
select pg_temp.unbecome();
select is((select contact_id is null and organisation_id = pg_temp.fx('beta') from hq.interactions where id = pg_temp.fx('i4_interaction_id')), true, 'an organisation-only interaction is stored against the organisation');
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('bob')), null, '... and no contact is touched');

-- validation
select pg_temp.become('bdm');
select throws_ok($$select hq.record_interaction(null, null, 'note', null, 'x')$$, '22023', 'a contact or an organisation is required', 'needs a contact or an organisation');
select throws_ok(format($$select hq.record_interaction(%L, null, null, null, 'x')$$, pg_temp.fx('alice')), '22023', 'an interaction type is required', 'needs a type');
select throws_ok(format($$select hq.record_interaction(%L, null, 'note', null, '  ')$$, pg_temp.fx('alice')), '22023', 'a summary is required', 'needs a summary');
select throws_ok(format($$select hq.record_interaction(%L, null, 'note', now() + interval '3 days', 'x')$$, pg_temp.fx('alice')), '22023', null, 'cannot have occurred in the future');
select throws_ok(format($$select hq.record_interaction(null, %L, 'note', null, 'x', null, null, false, null, 'met')$$, pg_temp.fx('alpha')), '22023', null, 'a status change needs a contact');
select throws_ok(format($$select hq.record_interaction(%L, %L, 'note', null, 'x')$$, pg_temp.fx('alice'), pg_temp.fx('beta')), '22023', null, 'the contact must belong to the organisation named');
select throws_ok($$select hq.record_interaction(gen_random_uuid(), null, 'note', null, 'x')$$, 'P0002', null, 'an unknown contact is reported');
select throws_ok(format($$select hq.record_interaction(%L, null, 'note', null, 'x', null, null, true, gen_random_uuid())$$, pg_temp.fx('alice')), '22023', null, 'a task assignee must be active staff');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = false where id = pg_temp.fx('ro');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.record_interaction(%L, null, 'note', null, 'x', null, null, true, %L)$$, pg_temp.fx('alice'), pg_temp.fx('ro')), '22023', null, 'a deactivated person cannot be assigned the follow-up task');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('ro');
select is((select count(*) from hq.interactions where summary = 'x'), 0::bigint, 'no failed call left an interaction behind');
select pg_temp.become('pm');
select throws_ok(format($$select hq.record_interaction(%L, null, 'note', null, 'x')$$, pg_temp.fx('alice')), '42501', null, 'a property manager (no growth.write) cannot record an interaction');
select pg_temp.unbecome();

-- ROLLBACK: a task that cannot be created takes the logged interaction and the contact update with it
create function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'task creation failed' using errcode = 'P0001'; end $$;
create trigger zz_boom before insert on hq.tasks for each row when (new.source = 'interaction') execute function public.zz_boom();
select pg_temp.become('bdm');
select throws_ok(format($$select hq.record_interaction(%L, null, 'phone_call', now(), 'Should roll back', 'Do the thing', hq.today() + 3, true, null, 'met')$$, pg_temp.fx('alice')),
  'P0001', 'task creation failed', 'record_interaction: a failing task creation raises');
select pg_temp.unbecome();
select is((select count(*) from hq.interactions where summary = 'Should roll back'), 0::bigint, 'ROLLBACK: the interaction was not kept');
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('alice')), now() - interval '1 hour', 'ROLLBACK: last_contact_at is unchanged');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), hq.today() + 30, 'ROLLBACK: next_follow_up_date is unchanged');
select is((select relationship_status::text from hq.contacts where id = pg_temp.fx('alice')), 'contacted', 'ROLLBACK: the status change was not kept');
drop trigger zz_boom on hq.tasks;
drop function public.zz_boom();

-- interactions: an author may edit their own; someone else may not
select pg_temp.become('va');
update hq.interactions set summary = 'Edited by someone else' where id = pg_temp.fx('i1_interaction_id');
select pg_temp.unbecome();
select is((select summary from hq.interactions where id = pg_temp.fx('i1_interaction_id')), 'Introduced Planted', 'another growth.write user cannot edit your interaction');
select pg_temp.become('bdm');
update hq.interactions set summary = 'Introduced Planted (edited)' where id = pg_temp.fx('i1_interaction_id');
select pg_temp.unbecome();
select is((select summary from hq.interactions where id = pg_temp.fx('i1_interaction_id')), 'Introduced Planted (edited)', 'the author can edit their own interaction');

-- ------------------------------------------------------------ record_referral
select pg_temp.clear_pipeline();
select pg_temp.become('bdm');
select pg_temp.keep('rA', hq.record_referral(
  p_direction := 'received', p_referring_contact := pg_temp.fx('alice'), p_prospect_name := 'Pat Prospect',
  p_prospect_phone := '0400 000 000', p_property_suburb := 'Moonta', p_estimated_value_cents := 1200000, p_notes := 'Met at the open home'));
select pg_temp.unbecome();
select is((select stage::text || '|' || prospect_name || '|' || estimated_annual_value_cents || '|' || property_suburb from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')),
  'introduction_received|Pat Prospect|1200000|Moonta', 'received: an opportunity is created at introduction_received');
select is((select is_attributed::text || '|' || direction::text || '|' || referring_organisation_id from hq.referrals where id = pg_temp.fx('rA_referral_id')),
  'true|received|' || pg_temp.fx('alpha'), 'received: the referral is attributed and takes the contact''s organisation');
select is((select array_agg(coalesce(from_stage::text, '-') || '>' || to_stage::text) from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('rA_opportunity_id')),
  array['->introduction_received'], 'received: a stage history row is written for the new opportunity');
select is((select ref_label from hq.referral_overview where id = pg_temp.fx('rA_referral_id')), 'REF-' || lpad((select ref_number::text from hq.referrals where id = pg_temp.fx('rA_referral_id')), 4, '0'), 'the register shows REF-0001 style numbers');
select pg_temp.become('bdm');
select pg_temp.keep('rB', hq.record_referral(
  p_direction := 'received', p_referring_organisation := pg_temp.fx('beta'), p_existing_opportunity := pg_temp.fx('rA_opportunity_id'), p_referral_date := hq.today() - 1));
select pg_temp.unbecome();
select is(pg_temp.fx('rB_opportunity_id'), pg_temp.fx('rA_opportunity_id'), 'received + existing opportunity: attaches to it');
select is((select is_attributed from hq.referrals where id = pg_temp.fx('rB_referral_id')), false, '... as a non-attributed claim');
select is((select is_attributed from hq.referrals where id = pg_temp.fx('rA_referral_id')), true, '... and the first referral keeps the attribution');
select is((select count(*) from hq.opportunities where deleted_at is null), 1::bigint, '... and creates no second opportunity');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.record_referral('received', null, %L, null, null, null, null, null, null, null, null, null, null, null, %L)$$, pg_temp.fx('beta'), pg_temp.fx('rA_opportunity_id')),
  '23505', null, 'the same partner cannot claim the same opportunity twice');
select throws_ok(format($$select hq.record_referral('received', null, %L, null, null, null, null, null, null, null, null, null, 100, null, %L)$$, pg_temp.fx('gamma'), pg_temp.fx('rA_opportunity_id')),
  '22023', null, 'an additional referral cannot set the opportunity''s value');
select throws_ok(format($$select hq.record_referral('received', null, %L)$$, pg_temp.fx('gamma')), '22023', 'a prospect name is required for a new opportunity', 'a new opportunity needs a prospect name');
select throws_ok($$select hq.record_referral('received', null, null, null, null, null, 'No Referrer')$$, '22023', null, 'a received referral needs a referring contact or organisation');
select throws_ok(format($$select hq.record_referral('received', %L, null, %L, null, null, 'Both Ways')$$, pg_temp.fx('alice'), pg_temp.fx('bob')), '22023', null, 'a received referral has no receiving partner');
select throws_ok(format($$select hq.record_referral('received', %L, %L, null, null, null, 'Mismatch')$$, pg_temp.fx('alice'), pg_temp.fx('beta')), '22023', null, 'the referring contact must belong to the referring organisation');
select throws_ok(format($$select hq.record_referral('received', %L, null, null, null, null, 'Ghost', null, null, null, null, null, null, null, gen_random_uuid())$$, pg_temp.fx('alice')), 'P0002', null, 'an unknown existing opportunity is reported');
select throws_ok($$select hq.record_referral('received', gen_random_uuid(), null, null, null, null, 'Ghost')$$, 'P0002', null, 'an unknown referring contact is reported');
select throws_ok($$select hq.record_referral(null)$$, '22023', null, 'a direction is required');
-- sent
select pg_temp.keep('rS', hq.record_referral(
  p_direction := 'sent', p_receiving_organisation := pg_temp.fx('gamma'), p_prospect_name := 'Sally Seller', p_property_suburb := 'Kadina', p_notes := 'Needs a conveyancer'));
select pg_temp.unbecome();
select is((select direction::text || '|' || sent_outcome::text || '|' || is_attributed::text || '|' || coalesce(opportunity_id::text, 'none') || '|' || receiving_organisation_id from hq.referrals where id = pg_temp.fx('rS_referral_id')),
  'sent|sent|false|none|' || pg_temp.fx('gamma'), 'sent: an outbound referral with outcome sent, no opportunity');
select is((select count(*) from hq.opportunities where deleted_at is null), 1::bigint, 'sent: creates no opportunity');
select is((select prospect_name from hq.referrals where id = pg_temp.fx('rS_referral_id')), 'Sally Seller', 'sent: carries its own prospect fields');
select pg_temp.become('bdm');
select throws_ok($$select hq.record_referral('sent', null, null, null, null, null, 'Nobody')$$, '22023', 'a sent referral needs a receiving contact or organisation', 'sent: a receiving partner is required');
select throws_ok(format($$select hq.record_referral('sent', null, null, %L, null, null, 'Opp', null, null, null, null, null, null, null, %L)$$, pg_temp.fx('carol'), pg_temp.fx('rA_opportunity_id')), '22023', null, 'sent: cannot attach to an opportunity');
select throws_ok(format($$select hq.record_referral('sent', %L, null, %L)$$, pg_temp.fx('alice'), pg_temp.fx('carol')), '22023', null, 'sent: has no referring partner');
select pg_temp.unbecome();
select pg_temp.become('bdm');
select pg_temp.keep('rS2', hq.record_referral(p_direction := 'sent', p_receiving_contact := pg_temp.fx('carol')));
select pg_temp.unbecome();
select is((select receiving_organisation_id from hq.referrals where id = pg_temp.fx('rS2_referral_id')), pg_temp.fx('gamma'), 'sent: a receiving contact brings its organisation');
select pg_temp.become('pm');
select throws_ok($$select hq.record_referral('sent', null, null, null, null)$$, '42501', null, 'a property manager cannot record a referral');
select pg_temp.unbecome();

-- table-level shapes (direct writes by the owner still obey the constraints)
select throws_ok(format($$insert into hq.referrals (direction, referring_organisation_id, referral_date) values ('received', %L, current_date)$$, pg_temp.fx('alpha')), '23514', null, 'a received referral needs an opportunity');
select throws_ok(format($$insert into hq.referrals (direction, receiving_organisation_id, referral_date, opportunity_id, sent_outcome) values ('sent', %L, current_date, %L, 'sent')$$, pg_temp.fx('alpha'), pg_temp.fx('rA_opportunity_id')), '23514', null, 'a sent referral cannot have an opportunity');
select throws_ok(format($$insert into hq.referrals (direction, receiving_organisation_id, referral_date) values ('sent', %L, current_date)$$, pg_temp.fx('alpha')), '23514', null, 'a sent referral needs a sent_outcome');
select throws_ok(format($$insert into hq.referrals (direction, referring_organisation_id, referral_date, opportunity_id, sent_outcome) values ('received', %L, current_date, %L, 'sent')$$, pg_temp.fx('alpha'), pg_temp.fx('rA_opportunity_id')), '23514', null, 'a received referral cannot have a sent_outcome');
select throws_ok(format($$insert into hq.referrals (direction, referring_organisation_id, referral_date, opportunity_id, is_attributed) values ('received', %L, current_date, %L, true)$$, pg_temp.fx('gamma'), pg_temp.fx('rA_opportunity_id')), '23505', null, 'two attributed referrals on one opportunity are impossible (partial unique index)');
select throws_ok(format($$insert into hq.referrals (direction, referring_contact_id, referring_organisation_id, referral_date, opportunity_id) values ('received', %L, %L, current_date, %L)$$, pg_temp.fx('alice'), pg_temp.fx('beta'), pg_temp.fx('rA_opportunity_id')), '22023', null, 'a referral''s contact and organisation must agree (trigger)');

-- exactly one attributed referral per opportunity, always (checked at commit; forced here)
set constraints all immediate;
select lives_ok($$set constraints all immediate$$, 'with attribution intact the deferred check passes');
select throws_ok(format($$update hq.referrals set is_attributed = false where id = %L; set constraints all immediate$$, pg_temp.fx('rA_referral_id')), '23514', null, 'an opportunity with received referrals but none attributed is refused');
set constraints all deferred;

-- ------------------------------------------------------------ move_opportunity, signing, history
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'contacted', 'Called Pat') ->> 'changed', 'true', 'move_opportunity: moves to contacted');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'contacted') ->> 'changed', 'false', 'moving to the stage it is already in changes nothing');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'qualified') ->> 'previous_stage', 'contacted', 'move_opportunity returns the previous stage');
select throws_ok(format($$select hq.move_opportunity(%L, 'lost')$$, pg_temp.fx('rA_opportunity_id')), '22023', 'a lost opportunity needs a reason', 'lost needs a reason');
select throws_ok(format($$select hq.move_opportunity(%L, 'lost', null, null, null, '   ')$$, pg_temp.fx('rA_opportunity_id')), '22023', null, 'a blank reason is not a reason');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'lost', 'Pat went elsewhere', null, null, 'Went with another agency', 'chose_another_manager') ->> 'stage', 'lost', 'lost takes a reason');
select pg_temp.unbecome();
select is((select lost_reason from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), 'Went with another agency', 'the lost reason is stored');
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'qualified', 'Pat is back') ->> 'changed', 'true', 'a lost opportunity can be reopened');
select pg_temp.unbecome();
select is((select lost_reason from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), null, 'reopening clears the lost reason');
select is((select array_agg(coalesce(from_stage::text, '-') || '>' || to_stage::text order by id) from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('rA_opportunity_id')),
  array['->introduction_received', 'introduction_received>contacted', 'contacted>qualified', 'qualified>lost', 'lost>qualified'], 'stage history records every change, in order');
select is((select note from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('rA_opportunity_id') and to_stage = 'contacted'), 'Called Pat', 'a history row carries the note');
select is((select changed_by from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('rA_opportunity_id') and to_stage = 'contacted'), pg_temp.fx('bdm'), 'a history row records who moved it');
select ok((select stage_changed_at > now() - interval '1 minute' from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), 'stage_changed_at follows the stage');
select is((select count(*) from hq.audit_events where action = 'stage_change' and entity_id = pg_temp.fx('rA_opportunity_id')), 4::bigint, 'stage changes are audited as stage_change');
select pg_temp.become('pm');
select throws_ok(format($$select hq.move_opportunity(%L, 'contacted')$$, pg_temp.fx('rA_opportunity_id')), '42501', null, 'a property manager cannot move an opportunity');
select pg_temp.become('bdm');
select throws_ok(format($$update hq.opportunities set stage = 'management_signed' where id = %L$$, pg_temp.fx('rA_opportunity_id')), '42501', null, 'stage cannot be changed by a direct update');
select throws_ok(format($$update hq.opportunities set signed_at = now() where id = %L$$, pg_temp.fx('rA_opportunity_id')), '42501', null, 'signed_at cannot be set by a direct update');
select lives_ok(format($$update hq.opportunities set notes = 'Direct edit of a note' where id = %L$$, pg_temp.fx('rA_opportunity_id')), 'notes can be edited directly');
select pg_temp.unbecome();
select throws_ok(format($$update hq.opportunities set stage = 'management_signed' where id = %L$$, pg_temp.fx('rA_opportunity_id')), '23514', null, 'stage = management_signed without signed_at is refused');
select throws_ok(format($$update hq.opportunities set signed_at = now() where id = %L$$, pg_temp.fx('rA_opportunity_id')), '23514', null, 'signed_at without management_signed is refused');

-- ------------------------------------------------------------ THE DOUBLE-COUNT PROOF
-- Two referrals from two partners (alpha: attributed rA, beta: claim rB) on ONE opportunity. Sign it,
-- sign it AGAIN, and the signed management is counted exactly once, credited only to the attributed partner.
select pg_temp.become('bdm');
select pg_temp.keep('sg', hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'management_signed', 'Signed at the kitchen table', now() - interval '2 hours', 'PM-1001'));
select pg_temp.unbecome();
select is((select signed_at from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), now() - interval '2 hours', 'signing sets signed_at');
select is((select management_reference from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), 'PM-1001', 'signing stores the management reference');
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'management_signed', 'Signed again by mistake', now(), 'PM-9999') ->> 'changed', 'false', 're-signing changes nothing');
select pg_temp.unbecome();
select is((select signed_at from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), now() - interval '2 hours', 're-signing leaves signed_at untouched (set once)');
select is((select management_reference from hq.opportunities where id = pg_temp.fx('rA_opportunity_id')), 'PM-1001', 're-signing leaves the reference untouched');
select is((select count(*) from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('rA_opportunity_id') and to_stage = 'management_signed'), 1::bigint, 're-signing writes no second history row');
select pg_temp.become('bdm');
select is((select to_jsonb(p) - 'organisation_id' - 'organisation_name' - 'categories' from hq.partner_performance p where p.organisation_id = pg_temp.fx('alpha')),
  '{"received": 1, "sent": 0, "qualified": 1, "signed": 1, "conversion": 1, "estimated_value_signed_cents": 1200000, "reciprocal": false}'::jsonb,
  'partner_performance: the attributed partner (alpha) is credited with ONE signing and ONE qualified');
select is((select to_jsonb(p) - 'organisation_id' - 'organisation_name' - 'categories' from hq.partner_performance p where p.organisation_id = pg_temp.fx('beta')),
  '{"received": 1, "sent": 0, "qualified": 0, "signed": 0, "conversion": 0, "estimated_value_signed_cents": 0, "reciprocal": false}'::jsonb,
  'partner_performance: the other partner (beta, a non-attributed claim) is credited with nothing');
select is((select to_jsonb(p) - 'organisation_id' - 'organisation_name' - 'categories' from hq.partner_performance p where p.organisation_id = pg_temp.fx('gamma')),
  '{"received": 0, "sent": 2, "qualified": 0, "signed": 0, "conversion": null, "estimated_value_signed_cents": 0, "reciprocal": false}'::jsonb,
  'partner_performance: a partner we only sent to has conversion null (nothing received)');
select is(hq.growth_summary(hq.today() - 1) - 'since' - 'as_of' - 'contacts_by_status' - 'contacts_not_contacted_30d' - 'overdue_followups',
  '{"managements_signed": 1, "referrals_received": 2, "referrals_sent": 2, "active_opportunities": 0, "qualified": 1, "conversion": 0.5, "estimated_value_signed_cents": 1200000}'::jsonb,
  'growth_summary: exactly ONE signed management (two referrals received), counted once');
select pg_temp.unbecome();
select is((select count(*) from hq.referrals where opportunity_id = pg_temp.fx('rA_opportunity_id') and is_attributed and deleted_at is null), 1::bigint, 'exactly one attributed referral');

-- moving attribution moves the credit and never counts twice
select pg_temp.become('bdm');
select is(hq.set_attributed_referral(pg_temp.fx('rA_opportunity_id'), pg_temp.fx('rB_referral_id')) ->> 'changed', 'true', 'set_attributed_referral moves attribution to the other partner''s referral');
select is((select to_jsonb(p) - 'organisation_id' - 'organisation_name' - 'categories' - 'received' - 'sent' - 'conversion' - 'reciprocal' from hq.partner_performance p where p.organisation_id = pg_temp.fx('alpha')),
  '{"qualified": 0, "signed": 0, "estimated_value_signed_cents": 0}'::jsonb, 'after moving attribution, alpha loses the signing and the qualification');
select is((select to_jsonb(p) - 'organisation_id' - 'organisation_name' - 'categories' - 'received' - 'sent' - 'conversion' - 'reciprocal' from hq.partner_performance p where p.organisation_id = pg_temp.fx('beta')),
  '{"qualified": 1, "signed": 1, "estimated_value_signed_cents": 1200000}'::jsonb, '... and beta gains exactly one of each');
select is((hq.growth_summary(hq.today() - 1) ->> 'managements_signed')::int, 1, 'growth_summary still counts ONE signed management after attribution moves');
select is((select sum(signed)::int from hq.partner_performance), 1, 'across all partners the signed total is still ONE');
select is((select count(*) from hq.referrals where opportunity_id = pg_temp.fx('rA_opportunity_id') and is_attributed and deleted_at is null), 1::bigint, 'still exactly one attributed referral');
select is(hq.set_attributed_referral(pg_temp.fx('rA_opportunity_id'), pg_temp.fx('rB_referral_id')) ->> 'changed', 'false', 'attributing the already-attributed referral is a no-op');
select is(hq.set_attributed_referral(pg_temp.fx('rA_opportunity_id'), pg_temp.fx('rA_referral_id')) ->> 'previous_referral_id', pg_temp.fx('rB_referral_id')::text, 'moving it back reports the previous holder');
select is((select sum(signed)::int from hq.partner_performance), 1, 'after moving back the signed total is still ONE');
select is((select signed from hq.partner_performance where organisation_id = pg_temp.fx('alpha')), 1::bigint, '... credited to alpha again');
select throws_ok(format($$select hq.set_attributed_referral(%L, %L)$$, pg_temp.fx('rA_opportunity_id'), pg_temp.fx('rS_referral_id')), '22023', null, 'a sent referral cannot be attributed');
select throws_ok(format($$select hq.set_attributed_referral(%L, gen_random_uuid())$$, pg_temp.fx('rA_opportunity_id')), '22023', null, 'a referral that does not exist cannot be attributed');
select pg_temp.unbecome();
set constraints all immediate;
select lives_ok($$set constraints all immediate$$, 'after every move, each opportunity with received referrals has exactly one attributed');
set constraints all deferred;
-- the attributed referral cannot be archived while claims remain
select pg_temp.become('dir');
select throws_ok(format($$select hq.archive_record('referral', %L)$$, pg_temp.fx('rA_referral_id')), '23514', null, 'the attributed referral cannot be archived while other referrals claim the opportunity');
select lives_ok(format($$select hq.archive_record('referral', %L, 'logged twice')$$, pg_temp.fx('rB_referral_id')), 'a non-attributed claim can be archived');
select lives_ok(format($$select hq.restore_record('referral', %L)$$, pg_temp.fx('rB_referral_id')), '... and restored');
select is((select is_attributed from hq.referrals where id = pg_temp.fx('rB_referral_id')), false, 'a restored claim does not take attribution back');
select pg_temp.unbecome();

-- management_reference cannot be reused; leaving management_signed needs a director or administrator
select pg_temp.become('bdm');
select pg_temp.keep('rY', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('gamma'), p_prospect_name := 'Yolanda Prospect', p_estimated_value_cents := 500000));
select throws_ok(format($$select hq.move_opportunity(%L, 'management_signed', null, null, 'PM-1001')$$, pg_temp.fx('rY_opportunity_id')), '23505', null, 'a management reference cannot be reused');
select lives_ok(format($$select hq.move_opportunity(%L, 'management_signed', null, null, 'PM-2002')$$, pg_temp.fx('rY_opportunity_id')), 'a different reference is accepted');
select throws_ok(format($$select hq.move_opportunity(%L, 'proposal_sent')$$, pg_temp.fx('rY_opportunity_id')), '42501', null, 'leaving management_signed needs a director or administrator');
select pg_temp.become('adm');
select lives_ok(format($$select hq.move_opportunity(%L, 'proposal_sent', 'Signed in error')$$, pg_temp.fx('rY_opportunity_id')), 'an administrator can move it out of management_signed');
select pg_temp.unbecome();
select ok((select signed_at is null and management_reference is null from hq.opportunities where id = pg_temp.fx('rY_opportunity_id')), 'leaving management_signed clears signed_at and the reference');
select pg_temp.become('bdm');
select is((select sum(signed)::int from hq.partner_performance), 1, 'the un-signed opportunity no longer counts: still ONE across all partners');
select pg_temp.unbecome();
select throws_ok(format($$update hq.opportunities set management_reference = 'PM-1001' where id = %L$$, pg_temp.fx('rY_opportunity_id')), '23505', null, 'the unique index also stops a direct reuse of a held reference (even by the owner)');

-- qualified = ever reached qualified or later (a lost deal that was once qualified still counts, a never-qualified one does not)
select pg_temp.become('bdm');
select pg_temp.keep('rZ', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('beta'), p_prospect_name := 'Zed Prospect'));
select pg_temp.keep('rW', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('beta'), p_prospect_name := 'Will Prospect'));
select hq.move_opportunity(pg_temp.fx('rZ_opportunity_id'), 'qualified');
select hq.move_opportunity(pg_temp.fx('rZ_opportunity_id'), 'lost', null, null, null, 'Not ready', 'not_ready');
select hq.move_opportunity(pg_temp.fx('rW_opportunity_id'), 'contacted');
select is((select qualified from hq.partner_performance where organisation_id = pg_temp.fx('beta')), 1::bigint, 'qualified counts opportunities that EVER reached qualified (the lost one), not the one still at contacted');
select pg_temp.unbecome();

-- ------------------------------------------------------------ views
select pg_temp.become('bdm');
select is((select contact_count from hq.organisation_directory where id = pg_temp.fx('alpha')), 2::bigint, 'organisation_directory: contact count');
select is((select primary_contact_name from hq.organisation_directory where id = pg_temp.fx('alpha')), 'Alice Anders', 'organisation_directory: primary contact');
select is((select organisation_name from hq.contact_directory where id = pg_temp.fx('alice')), 'Alpha Realty', 'contact_directory: organisation name');
select is((select count(*) from hq.organisation_directory where name = 'Delta Archive Co'), 0::bigint, 'organisation_directory: archived organisations are not listed');
select is((select partner_organisation_name || '|' || direction::text from hq.referral_overview where id = pg_temp.fx('rS_referral_id')), 'Gamma Conveyancing|sent', 'referral_overview: a sent referral shows the receiving partner');
select is((select partner_organisation_name || '|' || stage::text || '|' || prospect_name from hq.referral_overview where id = pg_temp.fx('rA_referral_id')), 'Alpha Realty|management_signed|Pat Prospect', 'referral_overview: a received referral shows the referrer, the stage and the prospect');
select pg_temp.unbecome();
update hq.contacts set next_follow_up_date = hq.today() - 3 where id = pg_temp.fx('alice');
update hq.contacts set next_follow_up_date = hq.today() - 9, relationship_status = 'inactive' where id = pg_temp.fx('bob');
update hq.contacts set next_follow_up_date = hq.today() + 2 where id = pg_temp.fx('carol');
select pg_temp.become('bdm');
select is((select array_agg(full_name order by full_name) from hq.overdue_followups where contact_id in (pg_temp.fx('alice'), pg_temp.fx('bob'), pg_temp.fx('carol'))), array['Alice Anders'], 'overdue_followups: only a live, non-inactive contact with a past follow-up date');
select is((select days_overdue from hq.overdue_followups where contact_id = pg_temp.fx('alice')), 3, 'overdue_followups: days_overdue is measured from hq.today()');
select is((select follow_up_overdue from hq.contact_directory where id = pg_temp.fx('alice')), true, 'contact_directory flags the overdue follow-up');
select is((select follow_up_overdue from hq.contact_directory where id = pg_temp.fx('carol')), false, '... and not a future one');
select pg_temp.unbecome();

-- ------------------------------------------------------------ audit
select pg_temp.become('bdm');
select is((select count(*) from hq.audit_events), 0::bigint, 'audit_events needs audit.read: a business development manager reads none');
select pg_temp.become('dir');
select ok((select count(*) from hq.audit_events) > 20, 'a director (audit.read) reads the log');
select is((select actor_id || '|' || actor_name from hq.audit_events where entity_type = 'organisation' and action = 'create' and summary like '%Delta Archive Co%' order by id limit 1), pg_temp.fx('dir') || '|Dana Director', 'a direct write is audited with the actor and a name snapshot');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'organisation' and entity_id = pg_temp.fx('alpha') and action = 'create' and actor_id is null and actor_name = 'System'), 1::bigint, 'a system write is audited with a null actor');
select is((select count(*) from hq.audit_events where entity_type = 'opportunity' and entity_id = pg_temp.fx('rA_opportunity_id') and action = 'create'), 1::bigint, 'record_referral audits the new opportunity');
-- diffs are small: changed columns only, free text cut to 500 characters
select pg_temp.become('bdm');
update hq.contacts set notes = repeat('long note ', 100) where id = pg_temp.fx('alex');
select pg_temp.unbecome();
select is((select char_length(changes -> 'notes' ->> 'to') from hq.audit_events where entity_type = 'contact' and entity_id = pg_temp.fx('alex') and changes ? 'notes' order by id desc limit 1), 500, 'free text in an audit diff is truncated to 500 characters');
select is((select array_agg(k order by k) from hq.audit_events e, jsonb_object_keys(e.changes) k where e.entity_type = 'contact' and e.entity_id = pg_temp.fx('alex') and e.changes ? 'notes' and e.action = 'update'), array['notes'], 'the diff holds only the changed column');
select count(*) as alex_audit_before from hq.audit_events where entity_type = 'contact' and entity_id = pg_temp.fx('alex') \gset
update hq.contacts set full_name = full_name where id = pg_temp.fx('alex');
select is((select count(*) from hq.audit_events where entity_type = 'contact' and entity_id = pg_temp.fx('alex')), :alex_audit_before::bigint, 'a no-op update writes no audit row');

-- ------------------------------------------------------------ verification stamp
select pg_temp.become('va');
select lives_ok($$insert into hq.contacts (full_name, needs_verification, verified_at, verified_by) values ('Research Lead', true, now(), gen_random_uuid())$$, 'insert a research lead with a spoofed verification stamp');
select pg_temp.unbecome();
select ok((select verified_at is null and verified_by is null from hq.contacts where full_name = 'Research Lead'), 'an unverified contact carries no verification stamp');
select pg_temp.become('va');
update hq.contacts set needs_verification = false, verified_by = pg_temp.fx('dir') where full_name = 'Research Lead';
select pg_temp.unbecome();
select is((select verified_by from hq.contacts where full_name = 'Research Lead'), pg_temp.fx('va'), 'verifying stamps verified_by with the caller, whatever was sent');
select ok((select verified_at is not null from hq.contacts where full_name = 'Research Lead'), '... and verified_at');
select pg_temp.become('va');
update hq.contacts set needs_verification = true where full_name = 'Research Lead';
select pg_temp.unbecome();
select ok((select verified_at is null and verified_by is null from hq.contacts where full_name = 'Research Lead'), 'flagging for verification again clears the stamp');

select * from finish();
rollback;
