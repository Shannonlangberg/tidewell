# Parked: Tidewell database

This is the database design for the parked Tidewell holiday-home app (see `docs/backend-design.md`).
It is **not** applied to the Planted HQ project, and `supabase db reset` / `supabase db push` ignore it
because it lives outside `supabase/migrations/`.

- `migrations/`: the Tidewell migrations 0000 to 0020, unchanged.
- `tests/`: its pgTAP tests and fixture.
- `seed.sql`, `seed.mts`: its seed data.

To bring it back, use a **separate** Supabase project: copy `migrations/` into that project's
`supabase/migrations/`, restore the Tidewell `config.toml` hooks from git history, and run the tests there.
Do not apply it to the HQ project: it adds tables, an `auth.users` trigger and storage buckets HQ does not use.
