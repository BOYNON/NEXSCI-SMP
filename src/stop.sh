#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  NexSci SMP — stop.sh  v10.0
#  Graceful RCON stop → SIGTERM → SIGKILL fallback (15s + 10s timeouts)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/bridge/.env" ]]; then
  set -a; source "$SCRIPT_DIR/bridge/.env"; set +a
fi

PIDFILE="$SCRIPT_DIR/.mc.pid"
RCON_HOST="${RCON_HOST:-127.0.0.1}"
RCON_PORT="${RCON_PORT:-25575}"
RCON_PASS="${RCON_PASSWORD:-}"

# ── Check PID ────────────────────────────────────────────────────────────────
if [[ ! -f "$PIDFILE" ]]; then
  echo "No PID file found. Server may already be stopped."
  exit 0
fi

PID="$(cat "$PIDFILE")"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID not found. Cleaning up stale PID file."
  rm -f "$PIDFILE"
  exit 0
fi

# ── Step 1: Try graceful RCON stop ────────────────────────────────────────────
echo "Sending 'stop' via RCON..."
if command -v mcrcon &>/dev/null && [[ -n "$RCON_PASS" ]]; then
  mcrcon -H "$RCON_HOST" -P "$RCON_PORT" -p "$RCON_PASS" "stop" 2>/dev/null || true
fi

# ── Step 2: Wait up to 15s for clean exit ─────────────────────────────────────
for i in $(seq 1 15); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server stopped cleanly after ${i}s."
    rm -f "$PIDFILE"
    exit 0
  fi
done

# ── Step 3: SIGTERM ───────────────────────────────────────────────────────────
echo "Server still running. Sending SIGTERM..."
kill -TERM "$PID" 2>/dev/null || true

for i in $(seq 1 10); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server terminated (SIGTERM) after ${i}s."
    rm -f "$PIDFILE"
    exit 0
  fi
done

# ── Step 4: SIGKILL (last resort) ─────────────────────────────────────────────
echo "Server unresponsive. Sending SIGKILL..."
kill -KILL "$PID" 2>/dev/null || true
sleep 2
rm -f "$PIDFILE"
echo "Server killed (SIGKILL)."
