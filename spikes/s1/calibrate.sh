#!/bin/sh
# S1 (d): 5 prompts of increasing size; records tokens + rate_limit utilization per call.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/spikes/evidence/S1-d-calibration.jsonl"
: > "$OUT"
SRC="$ROOT/Project-Raw.md"
run() { # label, prompt
  claude -p "$2" --output-format stream-json --verbose < /dev/null 2>/dev/null | python3 -c "
import sys,json
label=sys.argv[1]; rl=None; res=None
for l in sys.stdin:
    d=json.loads(l)
    if d.get('type')=='rate_limit_event': rl=d['rate_limit_info']['unifiedWindows']
    if d.get('type')=='result': res=d
u=res['usage']
print(json.dumps({'label':label,'five_hour':rl['five_hour']['utilization'],'seven_day':rl['seven_day']['utilization'],
 'input':u['input_tokens'],'cache_create':u['cache_creation_input_tokens'],'cache_read':u['cache_read_input_tokens'],'output':u['output_tokens'],'cost_usd':res['total_cost_usd']}))
" "$1" >> "$OUT"
}
run c0-baseline "Reply with OK"
run c1-5kb "Summarise in one sentence: $(head -c 5000 "$SRC")"
run c2-15kb "Summarise in one sentence: $(head -c 15000 "$SRC" | tail -c 10000)"
run c3-out2k "Write about 1500 words on the history of the printing press."
run c4-35kb "Summarise in one sentence: $(tail -c 35000 "$SRC")"
run c5-final "Reply with OK"
cat "$OUT"
