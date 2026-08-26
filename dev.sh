#!/bin/bash
# Maestro — ONE command brings the whole dev instance up.
#
# Spins up: family-board relay (Node http/tsx on :8787, libSQL file storage — no external DB)
# + client (Vite/TanStack on :5173, phone-width app; board relay URL from VITE_BOARD_URL,
# default localhost:8787).
#
# First boot self-heals: installs apps/server and apps/client deps when node_modules are missing.
# Steady loop: edit server → tsx watch reloads (npm run dev uses plain tsx; pass --watch via
# `./dev.sh --watch`); edit client → vite HMR. Contracts (apps/contracts) have their own
# toolchain (scarb/snforge/scripts) and are NOT booted here — see apps/contracts/README.md.
#
# Layout mirrors agentix/dev.sh: config → helpers → phases → a flat main flow.
# bash 3.2 compatible (macOS default).
set -eo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RELAY_PORT="${RELAY_PORT:-8787}"
APP_PORT="${APP_PORT:-5173}"
RELAY_URL="http://localhost:$RELAY_PORT"
APP_URL="http://localhost:$APP_PORT"

WATCH="${1:-}"
[ "$WATCH" = "--watch" ] && SERVER_DEV="dev:watch" || SERVER_DEV="dev"

# The shell on this machine exports NODE_ENV=production globally, which silently breaks
# `npm install` (drops devDependencies, poisons the lockfile) and vite dev. Children must not see it.
unset NODE_ENV
export -n NODE_ENV 2>/dev/null || true

RELAY_PID=""
APP_PID=""

G='\033[0;32m' Y='\033[0;33m' R='\033[0;31m' N='\033[0m'
log()  { echo -e "${G}→${N} $1"; }
warn() { echo -e "${Y}!${N} $1"; }
err()  { echo -e "${R}✗${N} $1"; }

# `npm run dev` wrappers don't forward signals to their tsx/vite child — kill by PATTERN so the
# real servers die, not just the wrapper. Port sweep catches orphans holding the ports.
KILL_PATTERNS=("tsx src/index.ts" "tsx watch src/index.ts" "vite dev")
kill_servers() {
  local pat p
  for pat in "${KILL_PATTERNS[@]}"; do
    pkill -9 -f "$pat" 2>/dev/null || true
  done
  for p in "$RELAY_PORT" "$APP_PORT"; do lsof -ti:"$p" 2>/dev/null | xargs kill -9 2>/dev/null || true; done
}

cleanup() {
  [ -n "${_CLEANED:-}" ] && return
  _CLEANED=1
  log "Shutting down..."
  kill_servers
}

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

# ══════════════════════════════════════════════════════════════════════════════════════════════
# Phases
# ══════════════════════════════════════════════════════════════════════════════════════════════

clean_slate() {
  log "Killing stale processes..."
  kill_servers
  sleep 1

  # Per-app installs: this repo is not an npm workspace. Install only what's missing
  # (first boot / fresh clone) — steady reboots skip straight to booting.
  if [ ! -d "$ROOT/apps/server/node_modules" ]; then
    log "Installing server deps (first boot)..."
    ( cd "$ROOT/apps/server" && npm install ) > /tmp/maestro-install-server.log 2>&1 \
      || { err "server npm install failed — see /tmp/maestro-install-server.log"; exit 1; }
  fi
  if [ ! -d "$ROOT/apps/client/node_modules" ]; then
    log "Installing client deps (first boot)..."
    ( cd "$ROOT/apps/client" && npm install ) > /tmp/maestro-install-client.log 2>&1 \
      || { err "client npm install failed — see /tmp/maestro-install-client.log"; exit 1; }
  fi
}

# Bring the relay up and wait until it actually ANSWERS (/health returns ok) — a fixed sleep is
# not enough on cold starts (first libSQL file creation).
relay_up() {
  log "Starting board relay (:$RELAY_PORT)..."
  ( cd "$ROOT/apps/server" && npm run "$SERVER_DEV" ) > /tmp/maestro-relay.log 2>&1 &
  RELAY_PID=$!
  local _ body
  for _ in $(seq 1 30); do
    body="$(curl -s -m 2 "$RELAY_URL/health" 2>/dev/null || true)"
    if [ -n "$body" ] && [ "$body" != "{*error*}" ]; then
      log "Relay ready (PID $RELAY_PID) — $RELAY_URL ($body)"
      return 0
    fi
    kill -0 "$RELAY_PID" 2>/dev/null || { err "Relay died during startup. See /tmp/maestro-relay.log"; exit 1; }
    sleep 1
  done
  err "Relay did not become ready. See /tmp/maestro-relay.log"
  exit 1
}

app_up() {
  log "Starting client (:$APP_PORT)..."
  ( cd "$ROOT/apps/client" && npx vite dev --port "$APP_PORT" --strictPort ) > /tmp/maestro-client.log 2>&1 &
  APP_PID=$!
  local code
  for _ in $(seq 1 40); do
    code="$(curl -s -o /dev/null -w "%{http_code}" -m 2 "$APP_URL/" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then
      log "Client ready (PID $APP_PID) — $APP_URL"
      return 0
    fi
    kill -0 "$APP_PID" 2>/dev/null || { err "Client died during startup. See /tmp/maestro-client.log"; exit 1; }
    sleep 1
  done
  warn "Client not answering yet (non-fatal). See /tmp/maestro-client.log"
}

print_summary() {
  echo ""
  echo -e "${G}✓ Maestro live dev instance${N}"
  echo "  Board relay → $RELAY_URL   (/health, /board/:familyId; SQLite file at apps/server/data/boards.db)"
  echo "  Client      → $APP_URL   (~390px phone width recommended)"
  echo ""
  echo "  Onboard via /welcome (create family / import recovery / kid join), or:"
  echo "    seed demo state →  node apps/server/scripts/seed-demo.mjs"
  echo "    dev money moves →  /dev/money   (needs VITE_ENABLE_DEV_MONEY=1 in apps/client/.env.local)"
  echo "    contracts       →  see apps/contracts/README.md (deploy.sh / verify.sh / e2e.sh)"
  echo ""
  echo "  Logs: /tmp/maestro-relay.log  /tmp/maestro-client.log"
  [ "$SERVER_DEV" = "dev:watch" ] || warn "relay runs without auto-reload — restart ./dev.sh after editing apps/server (or use ./dev.sh --watch)"
  echo ""
  echo "Press Ctrl+C to stop both"
  echo ""
}

# dev:watch is defined inline here rather than in package.json: one place owns process flags.
ensure_watch_script() {
  if [ "$SERVER_DEV" = "dev:watch" ] && ! grep -q '"dev:watch"' "$ROOT/apps/server/package.json"; then
    log "Adding dev:watch script to apps/server..."
    ( cd "$ROOT/apps/server" && npm pkg set scripts.dev:watch="tsx watch src/index.ts" )
  fi
}

# ══════════════════════════════════════════════════════════════════════════════════════════════
# Main flow
# ══════════════════════════════════════════════════════════════════════════════════════════════
ensure_watch_script
clean_slate
relay_up
app_up
print_summary
wait
