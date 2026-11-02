#!/bin/sh
# S1 experiments (a)+(b). Raw outputs -> docs/spikes/evidence/S1-*.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EV="$ROOT/docs/spikes/evidence"
HERE="$ROOT/spikes/s1"
mkdir -p "$EV"
claude --version > "$EV/S1-version.txt" 2>&1

claude -p "Reply with OK" --output-format json > "$EV/S1-a-json.json" 2> "$EV/S1-a-json.stderr.txt"
echo "json exit=$?" >> "$EV/S1-a-json.stderr.txt"

claude -p "Reply with OK" --output-format stream-json --verbose > "$EV/S1-a-stream.jsonl" 2> "$EV/S1-a-stream.stderr.txt"
echo "stream exit=$?" >> "$EV/S1-a-stream.stderr.txt"

SETTINGS="$(mktemp)"
cat > "$SETTINGS" <<JSON
{"statusLine":{"type":"command","command":"$HERE/statusline-dump.sh"}}
JSON
: > "$EV/S1-b-statusline-headless.jsonl"
S1_STATUS_OUT="$EV/S1-b-statusline-headless.jsonl" \
  claude -p "Reply with OK" --settings "$SETTINGS" --output-format json \
  > "$EV/S1-b-headless.json" 2> "$EV/S1-b-headless.stderr.txt"
echo "statusline headless exit=$? ; dump lines: $(wc -l < "$EV/S1-b-statusline-headless.jsonl")" >> "$EV/S1-b-headless.stderr.txt"
rm -f "$SETTINGS"
