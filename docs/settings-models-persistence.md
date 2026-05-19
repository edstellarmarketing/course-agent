# /settings → engine model selection: make it persistent

> **Status**: planned, **not yet implemented**. Today the `/settings`
> page's "LLM models" section is a Phase-1 mock — picking a model
> updates `useState` only. The three model slugs that actually run
> the pipeline are hardcoded in the engine (see "Why this exists"
> below). Pick this doc up when you want the UI to genuinely steer
> the engine.

---

## Why this exists

The dashboard's `/settings` page advertises a "Models" section with
three rows:

| Role | Engine §  | What it does |
|---|---|---|
| Research model | §3.5 | Per-category candidate generation (heavy reasoning) |
| Rule 10 judge | §3.6 | Cheap yes/no: does this title name a cert / governing body? |
| Prompt regenerator | §3.8d | Weekly system-prompt rewrite from rejection patterns |

Each row has a **Change** button that opens a model-picker modal. An
admin picks a model; the row updates. **Nothing else happens.** The
state is local to the React tree — refreshing the page wipes it. The
engine never reads it.

The engine reads three hardcoded strings instead:

| Role | File | Constant |
|---|---|---|
| Research | `engine/src/engine/cli.py` | `DEFAULT_RESEARCH_MODEL` |
| Rule 10 judge | `engine/src/engine/rules/dispatcher.py` | `RuleContext.cert_judge_model` |
| Prompt regenerator | `engine/src/engine/scripts/regenerate_prompt.py` | `REWRITE_MODEL` |

To swap models today, you edit a Python file and `git push`. That's
fine for a deliberate model change but bad for ad-hoc tuning — the
admin's mental model from the UI ("pick a model, click Change, done")
silently doesn't match reality.

This doc plans the wiring that closes the gap.

---

## End-to-end shape

```
Admin opens /settings → picks a new model in the modal
   ↓
Server action `updateEngineSetting(role, slug)` writes to
  `course-agent.engine_settings` (audit-logged)
   ↓
Next agent run loads its model slugs from the engine_settings table
on startup, falling back to the code constants if a row is absent
   ↓
Run header in /history shows which model was used
(`agent_runs.model_used` already records this)
```

No webhook, no immediate-engine-restart magic. The change takes
effect on the **next** cron firing (or the next manual `agent run`).
That's the right behaviour — a run in flight shouldn't switch
models mid-pipeline.

---

## Data model

### New table: `course-agent.engine_settings`

A single-row-per-key key-value store, scoped to the engine's runtime
config:

```sql
create table "course-agent".engine_settings (
  key         text primary key,           -- e.g. "model.research"
  value       text not null,              -- e.g. "deepseek/deepseek-v3.2-exp"
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

alter table "course-agent".engine_settings enable row level security;

create policy engine_settings_select
  on "course-agent".engine_settings
  for select to authenticated using (true);

create policy engine_settings_admin_write
  on "course-agent".engine_settings
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());
```

### Seed rows

Migration ships the current code defaults so day-one reads work:

```sql
insert into "course-agent".engine_settings (key, value) values
  ('model.research',     'deepseek/deepseek-v3.2-exp'),
  ('model.judge',        'deepseek/deepseek-chat-v3.1'),
  ('model.regenerator',  'anthropic/claude-opus-4-7')
on conflict (key) do nothing;
```

### Allowed key namespace

Stick to the prefix `model.<role>` for now. Future settings (cost
ceilings, schedule overrides) can live in the same table under
different prefixes (`cost.daily_ceiling`, `schedule.daily_run`, etc.)
without a schema change.

---

## Implementation surface

### App side (TypeScript / Next.js)

| File | Change |
|---|---|
| `app/src/app/(app)/settings/actions.ts` | **NEW.** Server action `updateEngineSetting(key, value)`. Admin-gated. Validates `key` against a fixed allowlist + `value` against the model registry. Writes via `createAdminClient` so the audit log always shows who did it. Calls `revalidatePath('/settings')`. |
| `app/src/app/(app)/settings/page.tsx` | Add a server-side read of `engine_settings` (the three model rows) before render. Pass the resolved slugs to `SettingsModelsSection` as initial assignments. |
| `app/src/components/settings-models-section.tsx` | Stop initialising from `DEFAULT_MODEL_ASSIGNMENTS`. Take `initialAssignments: Record<ModelRoleKey, string>` as a prop. Replace `setAssignments` after-modal-submit with a `useTransition(updateEngineSetting)` call. Surface inline errors (RLS denial, model not in registry, etc.). Drop the "Reset to defaults" button or repurpose it to a confirm-revert that calls the action. |
| `app/src/lib/types.ts` | New `EngineSettingKey` union: `"model.research" \| "model.judge" \| "model.regenerator"`. |

### Engine side (Python)

| File | Change |
|---|---|
| `engine/src/engine/settings_table.py` | **NEW.** Tiny helper: `def load_engine_settings() -> dict[str, str]` reads the table via the existing `supabase()` client; returns `{}` if the table is empty or unreachable. ~20 lines. |
| `engine/src/engine/cli.py` | Replace `DEFAULT_RESEARCH_MODEL` constant with a resolver that calls `load_engine_settings().get('model.research', '<code default>')` at run start. Pass the resolved slug into `OpenRouterClient`. |
| `engine/src/engine/rules/dispatcher.py` | Same shape — resolve `cert_judge_model` from the table at the start of the rule pass, fall back to the code default. |
| `engine/src/engine/scripts/regenerate_prompt.py` | Same — resolve `REWRITE_MODEL` from the table. |
| `engine/src/engine/agent/state.py` | Add an optional `_engine_settings: dict[str, str]` field on `AgentState` so nodes can read without each one doing its own DB round-trip. Populated by the entry node. |

### Migration

| File | Change |
|---|---|
| `supabase/migrations/0017_engine_settings.sql` | **NEW.** The table + RLS policies + seed rows shown above. |

### Tests (engine)

| File | Change |
|---|---|
| `engine/tests/test_settings_table.py` | **NEW.** Mock `supabase()` and verify (a) empty table → empty dict, (b) populated table → dict with expected keys, (c) Supabase error → empty dict (no exception). |
| `engine/tests/test_cli_resolver.py` | Verify code-default fallback when the table is empty. |

---

## How a run picks up a change

1. Admin clicks **Change** on `/settings`, picks a new slug. Server
   action writes the row.
2. The current cron tonight runs as scheduled. Its first node
   (`feedback_ingest` or a new `bootstrap`) calls
   `load_engine_settings()` and stashes the dict in state.
3. Every subsequent node reads from state, not a hardcoded constant.
   The model that gets written to `agent_runs.model_used` is the
   one the table held at run-start, even if an admin changes the
   setting again mid-run.
4. `/history` and `/dashboard` continue to show `model_used` per
   run — so reviewers can correlate a run's quality with whichever
   model was active for it.

---

## Open decisions

| # | Decision | My recommendation |
|---|---|---|
| 1 | Where does the **registry of allowed model slugs** live? | The engine doesn't need a registry — OpenRouter just routes whatever slug you send. The validation lives on the app side: the picker modal already shows `mockLlmModels` (a curated list). Promote that file to `app/src/lib/llm-models.ts` (drop the `mock/` prefix) and have the server action enforce membership. |
| 2 | Per-environment overrides (dev vs prod) | None for v1 — the table is the source of truth across environments. Devs running locally can use a different Supabase. Phase 6.5 could add a `engine_settings_overrides` env var that wins over the table, for one-off staging tests. |
| 3 | What to do when `RESEARCH_LLM_PROVIDER=anthropic` (the Claude direct path) | The table-resolved `model.research` value is still the OpenRouter slug. When the provider toggle picks Anthropic instead, that slug doesn't apply — the Anthropic path reads `ANTHROPIC_RESEARCH_MODEL` from env. We need to either (a) add a fourth UI row "Anthropic research model" or (b) ignore the table entry when the toggle is on. **(b) is simpler for v1**; add a `(when provider=openrouter)` hint to the UI row. |
| 4 | Audit log shape | One `engine_setting.update` row per change, payload `{ key, prev_value, new_value }`. Shows up at `/history → Decisions tab` filtered by `action LIKE 'engine_setting.%'`. |
| 5 | What to do when an admin picks a slug the engine can't reach (typo, deprecated, geo-blocked) | Engine first call fails → run aborts with a clear error. No retry-with-fallback — silent fallback would mask the misconfiguration. The error message includes the slug + which setting key it came from so the admin can roll it back fast. |
| 6 | Should reviewers (non-admins) see the current model assignments? | **Yes, read-only.** Useful context for interpreting a run's quality without giving them write access. Already enforced by the SELECT-for-authenticated policy above. |
| 7 | Should the UI show "this change takes effect on the next run" | **Yes — a small inline note under the Change button.** Sets expectations so an admin doesn't watch `/history` waiting for the change to apply to an in-flight run. |
| 8 | Should we expose a "reset to code defaults" button | **No.** The defaults are baked into the engine; if an admin needs them, they can copy from the registry. Reset would just delete table rows, which is one click closer to leaving the table empty (table emptiness is the fall-back signal — fine but harder to debug). |

---

## What this doesn't solve (and what would come next)

Deliberately out of scope for the Phase-6 wiring:

1. **Per-category model overrides** — "use Sonnet for Cybersecurity,
   Haiku for everything else." Possible follow-up; needs a richer
   table or JSON column.
2. **Model evaluation harness** — automated quality comparison of
   model A vs B over a sample of suggestions. Useful for the
   `/learning` page's promote-candidate flow but separate from
   "which model runs prod."
3. **Per-run model overrides via CLI** — e.g.
   `uv run agent run --research-model anthropic/claude-sonnet-4-6`.
   Cheap addition once the resolver is in place; not required for
   the admin-UI fix this plan addresses.
4. **Hot-reload during a long run** — the resolver reads once at
   run-start. Phase-6 is deliberately not in scope of mid-run
   switching, which would invalidate the cost ledger's model
   attribution.

---

## Effort estimate

| Surface | Lines of code | Time |
|---|---|---|
| Migration | ~30 | 5 min |
| Engine `settings_table.py` + integration in 3 callers | ~80 | 30 min |
| App server action + admin gate + audit | ~50 | 30 min |
| `SettingsModelsSection` rewrite to take props + call action | ~40 | 30 min |
| Engine tests + manual verify | ~60 | 30 min |
| **Total** | **~260** | **~2.5 hours** |

---

## When you come back

1. Read the **Open decisions** table.
2. Reply with either **"go with all defaults on settings-persistence"**
   or "go with these changes: …".
3. I will:
   - Write migration 0017 + seed rows
   - Build `settings_table.py` + integrate the three call sites
   - Build the server action + audit-log
   - Rewrite `SettingsModelsSection` to take initial assignments + call the action
   - Verify end-to-end: change a slug in UI → reload `/settings` → confirm new value sticks → fire a dry-run and verify the agent_runs row records the new model
   - Commit + push
4. After merge: tomorrow's cron picks up whatever's in the table.
