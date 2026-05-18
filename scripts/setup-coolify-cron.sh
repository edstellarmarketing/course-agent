#!/usr/bin/env bash
#
# Phase 9 Step 3 alternative — run the course-agent automation on
# the Coolify VPS via system cron, bypassing the GitHub-Actions DNS
# problem with sslip.io.
#
# Idempotent. Re-running is safe: it pulls the latest code, refreshes
# dependencies, and replaces the cron block in place (not appended).
#
# Usage:
#     curl -fsSL https://raw.githubusercontent.com/edstellarmarketing/course-agent/main/scripts/setup-coolify-cron.sh | sudo bash
#
# Or, if you've already cloned the repo:
#     sudo bash /opt/course-agent/scripts/setup-coolify-cron.sh
#
# Prerequisites:
#     - Linux VPS with root (the Coolify host is fine)
#     - git, curl, bash already installed (true on Hostinger Ubuntu)
#     - engine/.env present at /opt/course-agent/engine/.env with all
#       real secrets (see "Creating engine/.env" below). The script
#       exits with instructions if the file is missing on first run.
#

set -euo pipefail

REPO_URL="https://github.com/edstellarmarketing/course-agent.git"
INSTALL_DIR="/opt/course-agent"
LOG_DIR="/var/log/course-agent"
ENV_FILE="$INSTALL_DIR/engine/.env"

# Marker comments so we can replace our cron block in place on re-runs
# without nuking other crontab entries the operator may have added.
CRON_BEGIN_MARK="# >>> course-agent cron (managed by setup-coolify-cron.sh)"
CRON_END_MARK="# <<< course-agent cron"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\n\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash $0)"

# ─── 1. Install uv if missing ───────────────────────────────────
log "Checking for uv"
if ! command -v uv >/dev/null 2>&1; then
    log "Installing uv (Astral)…"
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# uv installs to ~/.local/bin by default. We're root, so $HOME = /root.
# Cron has a minimal PATH, so we resolve the absolute path now.
export PATH="/root/.local/bin:$PATH"
UV_BIN="$(command -v uv || true)"
[[ -n "$UV_BIN" ]] || die "uv install succeeded but binary not found on PATH"
log "uv binary: $UV_BIN"
$UV_BIN --version

# ─── 2. Clone or update the repo ────────────────────────────────
log "Repo: $INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Pulling latest main"
    git -C "$INSTALL_DIR" fetch origin main
    git -C "$INSTALL_DIR" reset --hard origin/main
else
    log "Cloning fresh"
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ─── 3. Log directory ────────────────────────────────────────────
log "Log dir: $LOG_DIR"
mkdir -p "$LOG_DIR"

# ─── 4. engine/.env must exist with real secrets ────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    cat >&2 <<MISSING_ENV

‼️  $ENV_FILE is missing.

Create it now with your real secrets. The shape (no quotes, no spaces
around the equals sign):

    SUPABASE_URL=...
    SUPABASE_SERVICE_ROLE_KEY=...
    OPENROUTER_API_KEY=...
    VOYAGE_API_KEY=...
    SERPER_API_KEY=...
    LANGFUSE_PUBLIC_KEY=...
    LANGFUSE_SECRET_KEY=...
    LANGFUSE_HOST=...
    SENTRY_DSN=...
    # Optional:
    SLACK_WEBHOOK_URL=
    ALERTS_SLACK_WEBHOOK_URL=

Copy the contents of your local engine/.env (the one you've been
using to run the agent from your dev machine). Easiest path:

    cat > $ENV_FILE <<'EOF'
    SUPABASE_URL=https://...
    SUPABASE_SERVICE_ROLE_KEY=...
    # ...paste all your keys here...
    EOF
    chmod 600 $ENV_FILE

After saving, re-run this setup script:

    sudo bash $INSTALL_DIR/scripts/setup-coolify-cron.sh

MISSING_ENV
    exit 1
fi

# Lock the env down so only root can read it.
chmod 600 "$ENV_FILE"

# ─── 5. Install Python deps ─────────────────────────────────────
log "Installing engine dependencies (uv sync)"
cd "$INSTALL_DIR/engine"
$UV_BIN sync

# ─── 6. Cron block ──────────────────────────────────────────────
# Pull the existing crontab (or empty if none). Strip any old
# course-agent block so re-runs are idempotent.
log "Installing cron block (idempotent — replaces old block in place)"

TMP_CRON="$(mktemp)"
(crontab -l 2>/dev/null || true) \
    | awk -v b="$CRON_BEGIN_MARK" -v e="$CRON_END_MARK" '
        BEGIN { inblock=0 }
        $0==b { inblock=1; next }
        $0==e { inblock=0; next }
        !inblock { print }
    ' > "$TMP_CRON"

cat >> "$TMP_CRON" <<CRON_BLOCK
$CRON_BEGIN_MARK
# Daily agent run — 03:00 UTC Mon–Sat (no Sunday digest by design)
0 3 * * 1-6 cd $INSTALL_DIR/engine && $UV_BIN run agent run --top-k 5 --max-candidates 12 >> $LOG_DIR/agent-daily.log 2>&1

# Daily-run-missing alert — 06:15 UTC Mon–Sat
15 6 * * 1-6 cd $INSTALL_DIR/engine && $UV_BIN run check_daily_run >> $LOG_DIR/alert-daily-missing.log 2>&1

# Approval-rate drop alert — weekly Mon 08:00 UTC
0 8 * * 1 cd $INSTALL_DIR/engine && $UV_BIN run check_approval_rate >> $LOG_DIR/alert-approval-rate.log 2>&1

# Daily spend ceiling alert — 23:55 UTC every day
55 23 * * * cd $INSTALL_DIR/engine && $UV_BIN run check_spend >> $LOG_DIR/alert-spend.log 2>&1

# Auto-promote prompt versions (flag-gated, dry-run by default) — 04:00 UTC
0 4 * * * cd $INSTALL_DIR/engine && $UV_BIN run auto_promote >> $LOG_DIR/auto-promote.log 2>&1
$CRON_END_MARK
CRON_BLOCK

crontab "$TMP_CRON"
rm -f "$TMP_CRON"

# ─── 7. Done ─────────────────────────────────────────────────────
log "Installed cron entries:"
crontab -l | sed -n "/$CRON_BEGIN_MARK/,/$CRON_END_MARK/p" | sed 's/^/    /'

cat <<DONE

✅ Setup complete.

Logs:
    $LOG_DIR/agent-daily.log
    $LOG_DIR/alert-daily-missing.log
    $LOG_DIR/alert-approval-rate.log
    $LOG_DIR/alert-spend.log
    $LOG_DIR/auto-promote.log

Watch the next scheduled run land:
    tail -f $LOG_DIR/agent-daily.log

Trigger a manual run right now to confirm wiring (uses real LLM
credits, ~\$0.05–0.20):
    cd $INSTALL_DIR/engine && $UV_BIN run agent run --top-k 2 --max-candidates 5 --dry-run

To remove the cron block later:
    crontab -l | sed '/$CRON_BEGIN_MARK/,/$CRON_END_MARK/d' | crontab -

DONE
