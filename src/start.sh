#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  NexSci SMP — start.sh  v10.0
#  Oracle Cloud Free Tier · ARM Ampere A1 · Ubuntu LTS
#  Called exclusively by the Node bridge. Never run this as root.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load env if .env exists next to this script
if [[ -f "$SCRIPT_DIR/bridge/.env" ]]; then
  # shellcheck source=/dev/null
  set -a; source "$SCRIPT_DIR/bridge/.env"; set +a
fi

MC_DIR="${MC_SERVER_PATH:-/home/ubuntu/minecraft}"
JAR="${MC_JAR_NAME:-paper.jar}"
JVM_FLAGS="${MC_JVM_FLAGS:--Xms1G -Xmx3G -XX:+UseG1GC}"
PIDFILE="$SCRIPT_DIR/.mc.pid"
LOG="$MC_DIR/logs/bridge-start.log"

# ── Guard: already running? ──────────────────────────────────────────────────
if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "Server already running (PID $PID). Aborting." >&2
    exit 0
  fi
  # Stale PID file — remove it
  rm -f "$PIDFILE"
fi

# ── Guard: server directory exists ───────────────────────────────────────────
if [[ ! -d "$MC_DIR" ]]; then
  echo "ERROR: MC_SERVER_PATH does not exist: $MC_DIR" >&2
  exit 1
fi

if [[ ! -f "$MC_DIR/$JAR" ]]; then
  echo "ERROR: JAR not found: $MC_DIR/$JAR" >&2
  exit 1
fi

# ── Launch ────────────────────────────────────────────────────────────────────
cd "$MC_DIR"
echo "[$(date -u +%FT%TZ)] Starting NexSci SMP..." >> "$LOG"

# Launch in background using nohup; detach from this shell completely
# shellcheck disable=SC2086
nohup java $JVM_FLAGS -jar "$JAR" nogui >> "$LOG" 2>&1 &

MC_PID=$!
echo "$MC_PID" > "$PIDFILE"

echo "[$(date -u +%FT%TZ)] Launched with PID $MC_PID" >> "$LOG"
echo "Started. PID=$MC_PID"
