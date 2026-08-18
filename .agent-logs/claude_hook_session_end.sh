#!/usr/bin/env bash
#
# Shell wrapper for Claude Code SessionEnd hook.
# Runs the session-end consumers from the single hook-JSON stdin:
#   1. claude_transcript_to_md.py  — human-readable Markdown session log
#   2. claude_telemetry.py          — LOCAL token/turn telemetry (.agent-logs/telemetry.jsonl)
#   3. bmb_telemetry.py flush       — ship anonymous usage telemetry to ai-portal (opt-out)
# Each is guarded so one failing never breaks the others or the hook chain.
#

set -uo pipefail

# Directory where this script (and its sibling Python scripts) live.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find a Python 3 interpreter.
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null && python --version 2>&1 | grep -q "Python 3"; then
    PYTHON=python
else
    echo "ERROR: Python 3 not found — skipping session-end hooks" >&2
    exit 0   # never break the hook chain
fi

# The hook JSON arrives on stdin and can only be read once — capture it, then
# feed each consumer a copy.
INPUT="$(cat)"

printf '%s' "$INPUT" | "$PYTHON" "$SCRIPT_DIR/claude_transcript_to_md.py" || true
printf '%s' "$INPUT" | "$PYTHON" "$SCRIPT_DIR/claude_telemetry.py" || true

# Anonymous usage telemetry (opt-out). Reads the same hook JSON (for the token event) and
# ships buffered events to ai-portal. Fail-silent; opted-out sessions send nothing.
printf '%s' "$INPUT" | "$PYTHON" "$SCRIPT_DIR/bmb_telemetry.py" flush || true

exit 0
