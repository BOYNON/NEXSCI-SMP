#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  NexSci SMP — restart.sh  v10.0
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Restarting NexSci SMP..."
bash "$SCRIPT_DIR/stop.sh"
sleep 3
bash "$SCRIPT_DIR/start.sh"
echo "Restart complete."
