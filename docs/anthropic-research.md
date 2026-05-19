# Research provider: Anthropic web_search vs OpenRouter

Two providers serve the agent's `research.candidates` LLM call. Pick
one with the `RESEARCH_LLM_PROVIDER` env var; everything else
(rule_07 reference verification, rule_10 cert judge, gap_analyze
checks, embedding, search) stays on OpenRouter / Voyage / Serper
regardless.

## TL;DR

| Provider | When to use | Cost per run | Reference quality |
|---|---|---|---|
| `openrouter` *(default)* | Saving cents matters more than reference accuracy | ~$0.05–0.15 | Model-recalled URLs; Rule 7 throws away the bad ones |
| `anthropic` | Grounded references matter more than cents | ~$0.20–0.60 | URLs the model actually opened during the call |

The cost gap is dominated by Anthropic's `web_search` tool charge
($10 per 1,000 searches). A typical research call issues 3-8 searches.

## Switching to Anthropic

### 1. Get an Anthropic API key

`https://console.anthropic.com/settings/keys` → **Create Key** →
copy the `sk-ant-...` string.

### 2. Set the env vars on the VPS (Coolify) — both at once

```bash
nano /opt/course-agent/engine/.env
```

Append:

```
ANTHROPIC_API_KEY=sk-ant-...                 # the new key
RESEARCH_LLM_PROVIDER=anthropic              # opt in
ANTHROPIC_RESEARCH_MODEL=claude-sonnet-4-6   # optional; this is the default
```

Save (`Ctrl+X` → `Y` → `Enter`). The next cron firing picks them up
— nothing else to restart, env is read fresh per run.

### 3. (If you also run from GitHub Actions) — store the same key as a secret

`https://github.com/edstellarmarketing/course-agent/settings/secrets/actions`:

- New repository secret → `ANTHROPIC_API_KEY` → paste

And in **Variables** (next tab over) → New repository variable:

- `RESEARCH_LLM_PROVIDER` = `anthropic`
- `ANTHROPIC_RESEARCH_MODEL` = `claude-sonnet-4-6` (optional)

Vars are non-secret; secrets are masked. The workflow at
`.github/workflows/agent-daily.yml` already references both.

## How it works internally

1. The graph router fans out one `research_one` branch per category
   the agent decided to target.
2. In each branch, `research.py` reads `RESEARCH_LLM_PROVIDER`.
3. **OpenRouter path** (default) → the existing `or_client.complete`
   call. Same model selection, same prompt, same Serper hits in the
   user message. The LLM's references come from its training data
   memory plus whatever it can infer from the Serper snippets.
4. **Anthropic path** → constructs a fresh `AnthropicClient` with
   the `web_search_20250305` tool enabled. The Anthropic Messages
   API runs the model in a server-side loop: model thinks → model
   issues a search → API runs the search → model reads results →
   model emits next text. The model only emits URLs from pages it
   actually opened. Final text is parsed as JSON candidates the
   same way as the OpenRouter response.
5. Both paths drop a normalised `Completion` into the same
   `RunCostLedger`, so the per-run cost ceiling
   (`ENGINE_RUN_COST_CEILING_USD`) still works as the circuit
   breaker. The Anthropic path also records its `web_search` calls
   as a separate ledger line (span suffixed `.web_search`) for
   post-run audit.

## When Rule 7 starts catching less

When you flip to Anthropic, expect the Rule 7 (`rule_07_references`)
"dropped_404=N" counts on a run to drop. The model is no longer
guessing URLs — it's emitting ones it just opened. Rule 7 is still
worth keeping (the model occasionally cites a working URL whose
content doesn't actually back the claim — the `unverified_quote`
path catches those), but the `dropped_404` line should go from
typically 3-4 per category to 0-1.

## Switching back

```bash
sed -i 's/^RESEARCH_LLM_PROVIDER=.*/RESEARCH_LLM_PROVIDER=openrouter/' /opt/course-agent/engine/.env
```

Or just delete the line — `openrouter` is the default. Leave
`ANTHROPIC_API_KEY` set; it's free until the toggle is on.

## Smoke test (compare the two side-by-side)

After setting the env, run one category twice — once with each
provider — and compare:

```bash
cd /opt/course-agent/engine

# OpenRouter — current behaviour
RESEARCH_LLM_PROVIDER=openrouter \
  /root/.local/bin/uv run agent run \
  --category "Cybersecurity" --top-k 1 --max-candidates 3 --dry-run

# Anthropic + web_search
RESEARCH_LLM_PROVIDER=anthropic \
  /root/.local/bin/uv run agent run \
  --category "Cybersecurity" --top-k 1 --max-candidates 3 --dry-run
```

Read the tail of each output. Look at the candidates' `references[]`
arrays — the Anthropic run should have noticeably more accessible
URLs (no `HTTP 404` cascade on the next live run).

Cost of the smoke test: < $0.05 each, both dry-run so nothing lands
in Supabase.
