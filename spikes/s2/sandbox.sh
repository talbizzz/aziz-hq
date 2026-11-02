#!/bin/bash
# Topology A sandbox lifecycle. Usage: sandbox.sh up|start|test|stop|down <slot> [exclude-list]
# Requires DOCKER_HOST pointing at the s2 Colima socket.
set -euo pipefail
: "${DOCKER_HOST:?set DOCKER_HOST to the s2 colima socket}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CMD=$1; SLOT=$2; EXCLUDE=${3:-}
NAME=s2-sbx-$SLOT
WT=$HERE/work/slot$SLOT          # identical absolute path on host, VM and container
PID=s2slot$SLOT
OFF=$((SLOT*100))

case $CMD in
up)
  mkdir -p "$WT" "$HERE/work/remote.git"
  [ -d "$HERE/work/remote.git/objects" ] || git init -q --bare "$HERE/work/remote.git"
  docker run -d --name "$NAME" --network host \
    -v /var/run/docker.sock:/var/run/docker.sock -v "$WT:$WT" -v "$HERE/work/remote.git:$HERE/work/remote.git" \
    -w "$WT" ${SBX_LIMITS:-} s2-sandbox sleep infinity >/dev/null
  docker exec "$NAME" sh -c "git init -q -b main . && supabase init --force >/dev/null"
  # port scheme: every 543xx port + 100*slot; unique project_id
  docker exec "$NAME" sh -c "
    sed -i -E 's/^project_id = .*/project_id = \"$PID\"/' supabase/config.toml
    perl -pi -e 's/(port\\s*=\\s*)(543\\d\\d)/\$1.(\$2+$OFF)/e' supabase/config.toml
    grep -nE 'port' supabase/config.toml | head -20"
  mkdir -p "$WT/supabase/tests/database"
  cat > "$WT/supabase/tests/database/trivial.test.sql" <<SQL
begin; select plan(1); select ok(true, 'trivial'); select * from finish(); rollback;
SQL
  ;;
start)
  X=""; [ -n "$EXCLUDE" ] && X="-x $EXCLUDE"
  docker exec "$NAME" supabase start $X
  ;;
test)
  docker exec "$NAME" sh -c "supabase status >/dev/null && echo STATUS_OK"
  docker exec "$NAME" supabase db reset
  docker exec "$NAME" supabase test db
  docker exec "$NAME" sh -c "echo x > f.txt && git add -A && git commit -qm t && git remote add origin $HERE/work/remote.git 2>/dev/null; git push -q origin HEAD:refs/heads/slot$SLOT && echo PUSH_OK"
  ;;
stop)
  docker exec "$NAME" supabase stop --no-backup --project-id "$PID"
  ;;
down)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WT"
  ;;
esac
