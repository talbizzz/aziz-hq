#!/bin/bash
# S2 assertions for topology A: 3 parallel sandboxes pass status + pgTAP + push; teardown leaves nothing.
set -u
: "${DOCKER_HOST:?}"
cd "$(dirname "$0")"
X=studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
rm -rf work/remote.git
for i in 0 1 2; do ./sandbox.sh down $i; ./sandbox.sh up $i >/dev/null 2>&1; done
for i in 0 1 2; do ./sandbox.sh start $i $X >/tmp/s2c-start$i.log 2>&1 & done; wait
for i in 0 1 2; do ./sandbox.sh test $i >/tmp/s2c-test$i.log 2>&1 & done; wait
for i in 0 1 2; do
  grep -q STATUS_OK /tmp/s2c-test$i.log && ok "slot$i supabase status" || bad "slot$i supabase status"
  grep -q 'Result: PASS' /tmp/s2c-test$i.log && ok "slot$i supabase test db" || bad "slot$i supabase test db"
  grep -q PUSH_OK /tmp/s2c-test$i.log && ok "slot$i git push" || bad "slot$i git push"
done
for i in 0 1 2; do ./sandbox.sh stop $i >/dev/null 2>&1; ./sandbox.sh down $i; done
[ -z "$(docker ps -a -q)" ] && ok "no containers left" || bad "containers left"
[ -z "$(docker volume ls -q)" ] && ok "no volumes left" || bad "volumes left"
[ -z "$(docker network ls --format '{{.Name}}' | grep -i supabase)" ] && ok "no supabase networks left" || bad "networks left"
exit $fail
