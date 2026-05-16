# Supabase migrations + seed

This directory is the **single source of truth** for the `"course-agent"` schema. Both the Next.js dashboard and the Python engine read from the same tables; nothing changes the schema except these files.

## Layout

```
supabase/
├── migrations/
│   ├── 0001_initial.sql              schema, extensions, tables, view, indexes, RLS
│   └── 0002_seed_rejection_taxonomy.sql
└── seed/                              (reserved for future fixture data)
```

## Apply order

Lexicographic — `0001` first, then `0002`, and so on. Never run partial files; each is meant to be applied as a whole.

## How to apply

Two paths.

### A. Supabase Studio SQL Editor (Phase 3, manual)

1. Open Supabase Studio → **SQL Editor** → **New query**.
2. Paste the whole contents of the first un-applied migration.
3. Click **Run**. Verify the result panel shows no errors.
4. Repeat for each subsequent migration.

This is the right flow while migrations are rare (Phase 3 ships two, Phase 4 + 5 may add one or two more). Track which files have been applied in your head or in a Studio "Saved query" note — the migrations themselves are idempotent, so re-running is safe, but slow.

### B. Supabase CLI (Phase 6+, automated)

When the migration cadence picks up:

```bash
brew install supabase/tap/supabase     # or scoop install supabase
supabase link --project-ref <ref>
supabase db push                        # applies any new files
```

The CLI tracks applied migrations in `supabase_migrations.schema_migrations`. Don't mix the two paths — once you start using the CLI, every new migration must go through it.

## Idempotency contract

Every file must be safe to re-run from a clean schema. Acceptance:

```sql
drop schema if exists "course-agent" cascade;
-- then run every migration in order
```

…should leave the database in the same state as a single forward pass. This is enforced by `create … if not exists`, `on conflict do nothing|update`, and avoiding `alter table … drop column` patterns that aren't reversible. See the migration headers for any deviations.

## The hyphen

The schema name `"course-agent"` uses a hyphen on purpose — it forces explicit qualification (`"course-agent".courses`, never bare `courses`) and prevents any `search_path` shortcut from accidentally cross-joining `public` tables. Every query in the codebase must quote the schema name. See `docs/phase3.md` for the full reasoning.
