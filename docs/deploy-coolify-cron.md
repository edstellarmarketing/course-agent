# Deploy: run the agent on the Coolify VPS via cron

This is the **alternative to GitHub Actions** for running the five
Phase 9 automation jobs (the daily agent run + three monitoring
alerts + auto-promote). Use this when GitHub Actions can't reach
Supabase — the sslip.io hostname rate-limits Azure runners, which
is where GitHub-hosted runners live.

Picking VPS cron over the doc's GitHub Actions plan is fine. The
trade-off is monitoring: cron has no GUI, so you tail logs on the
VPS instead of clicking through the Actions tab.

The script at `scripts/setup-coolify-cron.sh` does the install and
the cron wiring. This doc tells you how to use it.

---

## What you'll end up with

- `/opt/course-agent/` — clone of the repo, kept on `main`
- `/opt/course-agent/engine/.env` — secrets, `chmod 600`
- `/var/log/course-agent/*.log` — one log per cron job
- Crontab entries (delimited by `# >>> course-agent cron`) that fire:

| Schedule (UTC) | Job | Log file |
|---|---|---|
| 03:00 Mon–Sat | `agent run --top-k 5 --max-candidates 12` | `agent-daily.log` |
| 06:15 Mon–Sat | `check_daily_run` | `alert-daily-missing.log` |
| Mon 08:00 | `check_approval_rate` | `alert-approval-rate.log` |
| 23:55 daily | `check_spend` | `alert-spend.log` |
| 04:00 daily | `auto_promote` (dry-run by default) | `auto-promote.log` |

For your timezone (IST = UTC + 5:30), the main daily run fires at
**08:30 IST Mon–Sat**, with the GitHub-Actions-style ~15 min drift
buffer NOT applicable here — system cron is precise.

---

## Prerequisites

- Hostinger (or any) VPS with root access
- The Coolify-hosted Supabase resource is on the same VPS
- `git`, `curl`, `bash` already on the host (Hostinger Ubuntu has these by default)
- Your local `engine/.env` contents — you'll paste them onto the VPS

---

## Step 1 — Get into the VPS shell

Two options, pick whichever is easier:

### Option 1a — Browser SSH (no client install)

1. Sign in to **<https://hpanel.hostinger.com>**
2. **VPS** → click your VPS → **Manage**
3. Left sidebar → **Browser terminal**
4. You land at a `root@vps:~#` prompt in the browser

### Option 1b — SSH from your terminal

```powershell
ssh root@187.127.140.202
```

Password is in the Hostinger VPS dashboard (under "Access" or
"Overview"). Better long-term: paste your public key into
`/root/.ssh/authorized_keys` so you can skip the password.

---

## Step 2 — Run the setup script (first pass)

On the VPS, paste:

```bash
curl -fsSL https://raw.githubusercontent.com/edstellarmarketing/course-agent/main/scripts/setup-coolify-cron.sh | sudo bash
```

The script will:

1. Install `uv` (Astral's Python package manager) — ~30 s
2. Clone the repo to `/opt/course-agent` — ~5 s
3. Notice `engine/.env` doesn't exist yet and exit with
   copy-paste instructions

This first-pass exit is expected. The script prints exactly what
to do next.

---

## Step 3 — Create `engine/.env` on the VPS

Open your **local** `engine/.env` file in Notepad on Windows
(`C:\Users\Edstellar\Downloads\New folder (82)\engine\.env`).
Keep that window open while you build the VPS one.

On the VPS, paste this template and replace each placeholder with
the value from your local file:

```bash
cat > /opt/course-agent/engine/.env <<'EOF'
SUPABASE_URL=https://supabasekong-dfpiopwrqgdf8iods10d4546.187.127.140.202.sslip.io
SUPABASE_SERVICE_ROLE_KEY=<paste from local engine/.env line 2>
OPENROUTER_API_KEY=<paste from local engine/.env>
VOYAGE_API_KEY=<paste from local engine/.env>
SERPER_API_KEY=<paste from local engine/.env>
LANGFUSE_PUBLIC_KEY=<paste from local engine/.env>
LANGFUSE_SECRET_KEY=<paste from local engine/.env>
LANGFUSE_HOST=https://us.cloud.langfuse.com
SENTRY_DSN=<paste from local engine/.env>
EOF
chmod 600 /opt/course-agent/engine/.env
```

The `'EOF'` (single quotes) prevents bash from expanding `$` in
JWTs, which would otherwise mangle the service-role key.

**Optional:** if you've set up a Slack webhook later, add:

```bash
echo 'SLACK_WEBHOOK_URL=https://hooks.slack.com/...' >> /opt/course-agent/engine/.env
echo 'ALERTS_SLACK_WEBHOOK_URL=https://hooks.slack.com/...' >> /opt/course-agent/engine/.env
```

---

## Step 4 — Re-run the setup script (second pass)

Now that `engine/.env` exists, run the script again:

```bash
sudo bash /opt/course-agent/scripts/setup-coolify-cron.sh
```

This time it gets past the env check, runs `uv sync` (installs the
Python dependencies — ~1 min), and writes the cron block.

Final output:

```
✅ Setup complete.
Logs:
    /var/log/course-agent/agent-daily.log
    /var/log/course-agent/alert-daily-missing.log
    /var/log/course-agent/alert-approval-rate.log
    /var/log/course-agent/alert-spend.log
    /var/log/course-agent/auto-promote.log
```

---

## Step 5 — Verify end-to-end

A **dry-run agent invocation** confirms every wire — Supabase,
OpenRouter, Voyage, Serper, Langfuse, Sentry — without writing
any rows or burning much credit:

```bash
cd /opt/course-agent/engine && /root/.local/bin/uv run agent run --top-k 2 --max-candidates 5 --dry-run
```

Wall time ~3 minutes. Watch for `run end final_candidates=N` near
the bottom. Cost will be in the $0.03–0.05 range.

Then confirm cron is queued:

```bash
crontab -l
```

You should see the block bracketed by:

```
# >>> course-agent cron (managed by setup-coolify-cron.sh)
...
# <<< course-agent cron
```

---

## Step 6 — Tomorrow's verification

Day 2, after the 03:00 UTC fire:

```bash
tail -50 /var/log/course-agent/agent-daily.log
```

You should see the `run end` line dated within ~5 minutes of
03:00 UTC. In Supabase Studio:

```sql
select id, started_at, finished_at, candidates_persisted, cost_usd
from "course-agent".agent_runs
order by started_at desc limit 3;
```

The freshest row should be from the cron fire.

---

## Updates: pulling new code

The setup script is idempotent. Re-running it pulls the latest
commit from `main` (via `git reset --hard origin/main`), refreshes
dependencies, and replaces the cron block in place:

```bash
sudo bash /opt/course-agent/scripts/setup-coolify-cron.sh
```

Re-run after merging Phase 10 work or any engine code change you
want production to pick up.

---

## Removing the cron block

If you ever want to switch back to GitHub Actions (or just stop
the automation):

```bash
crontab -l \
  | sed '/# >>> course-agent cron/,/# <<< course-agent cron/d' \
  | crontab -
```

The repo at `/opt/course-agent` stays — delete it separately if
you also want the code gone:

```bash
rm -rf /opt/course-agent /var/log/course-agent
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl: command not found` | `apt update && apt install -y curl git` |
| `uv: command not found` after install | `export PATH="/root/.local/bin:$PATH"` then re-run the script |
| Script exits "engine/.env missing" right after creating it | Check `ls -la /opt/course-agent/engine/.env` — should be `-rw-------`. If the file is empty (`-rw------- 1 root root 0 ...`), the heredoc didn't take; re-paste the `cat > ... <<'EOF'` block including the final `EOF` line. |
| `pydantic.ValidationError: X` on the dry-run test | Env value missing or malformed. Look at the field name in the error and re-check the corresponding line in `engine/.env`. |
| Dry-run hangs at "Supabase reachable" | This is the same network test that's broken from GitHub Actions. On the VPS it should NOT hang — Supabase is local. If it does, check that the Coolify Supabase Kong service is up: `curl -I http://localhost:8000/`. |
| `RunCostCeilingExceeded` on the dry-run | You crossed `ENGINE_RUN_COST_CEILING_USD` (default $5). Either bump it in `engine/.env` (`ENGINE_RUN_COST_CEILING_USD=10`) or use smaller `--top-k`. |
| Cron entries run but logs stay empty | Check `/var/log/syslog` for `CRON` lines; ensure `crontab -u root -l` matches what you expect. |

---

## What's NOT in this setup

Three pieces from Phase 9 that you'd still need to configure
separately if you want them:

1. **Backup workflow** (`backup-schema.yml`) — needs an
   S3-compatible bucket + credentials. Run pg_dump directly on
   the VPS with a separate cron line once you've picked a target
   (AWS S3 / Cloudflare R2 / MinIO):

   ```cron
   0 2 * * * pg_dump --schema='course-agent' --no-owner --no-acl \
              -h <db-host> -U postgres -d postgres \
            | gzip > /opt/course-agent/backups/backup-$(date -u +%Y%m%d).sql.gz \
            && aws s3 cp /opt/course-agent/backups/backup-*.sql.gz s3://<bucket>/
   ```

2. **Slack webhook** for the three alerts — they no-op silently
   when `SLACK_WEBHOOK_URL` is unset. Add it to `engine/.env`
   later if you want the alerts to fire.

3. **Auto-promote real promotion** — `auto_promote` runs in
   dry-run by default (`PROMPT_AUTO_PROMOTE_ENABLED=false`).
   After ~1 month of dry-run logs that match `/learning` math,
   flip the flag in `engine/.env`:

   ```bash
   echo 'PROMPT_AUTO_PROMOTE_ENABLED=true' >> /opt/course-agent/engine/.env
   ```
