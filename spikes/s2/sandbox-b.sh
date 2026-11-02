#!/bin/bash
# Topology B (DinD) single sandbox. Usage: sandbox-b.sh run  -> up, start (slim), test, stop, down; prints timings.
set -euo pipefail
: "${DOCKER_HOST:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; WT=$HERE/work/b0; X=studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor
mkdir -p "$WT"
docker rm -f s2-b-sbx s2-b-dind >/dev/null 2>&1 || true
docker run -d --name s2-b-dind --privileged --memory ${B_MEM:-4g} -e DOCKER_TLS_CERTDIR= -v "$WT:$WT" docker:dind >/dev/null
for i in $(seq 30); do docker exec s2-b-dind docker info >/dev/null 2>&1 && break; sleep 1; done
docker run -d --name s2-b-sbx --network container:s2-b-dind -e DOCKER_HOST=tcp://127.0.0.1:2375 -v "$WT:$WT" -w "$WT" s2-sandbox sleep infinity >/dev/null
docker exec s2-b-sbx sh -c 'git init -q -b main . && supabase init --force >/dev/null'
S=$(date +%s); docker exec s2-b-sbx supabase start -x $X >"$HERE/work/b-start.log" 2>&1; echo "B start s: $(( $(date +%s)-S ))"
docker exec s2-b-sbx sh -c 'supabase status >/dev/null && echo STATUS_OK'
mkdir -p "$WT/supabase/tests/database"; echo "begin; select plan(1); select ok(true); select * from finish(); rollback;" > "$WT/supabase/tests/database/t.test.sql"
docker exec s2-b-sbx supabase test db 2>&1 | tail -3
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' s2-b-dind s2-b-sbx
docker exec s2-b-dind docker system df | head -3
docker exec s2-b-sbx supabase stop --no-backup
docker exec s2-b-dind sh -c 'docker ps -a -q | wc -l; docker volume ls -q | wc -l'
