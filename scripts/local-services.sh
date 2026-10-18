#!/usr/bin/env bash
# Start a throwaway PostgreSQL + Redis without Docker (used for local dev/CI-like runs).
# Usage: scripts/local-services.sh [start|stop]   (data lives in ${GH_LOCAL_DIR:-/tmp/globalhub-local})
set -euo pipefail
DIR="${GH_LOCAL_DIR:-/tmp/globalhub-local}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT:-5432}"
case "${1:-start}" in
  start)
    mkdir -p "$DIR"
    if [ ! -d "$DIR/pg" ]; then "$PGBIN/initdb" -D "$DIR/pg" -U postgres --auth=trust >/dev/null; fi
    "$PGBIN/pg_ctl" -D "$DIR/pg" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/pg.log" -w start >/dev/null || true
    for db in globalhub globalhub_test globalhub_node_b globalhub_e2e_a globalhub_e2e_b; do
      psql -h 127.0.0.1 -p "$PORT" -U postgres -tc "select 1 from pg_database where datname='$db'" | grep -q 1 || psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "create database $db" ;
    done
    (redis-cli ping >/dev/null 2>&1) || redis-server --daemonize yes --port 6379 --save '' --dir "$DIR" >/dev/null
    echo "postgres://postgres@127.0.0.1:$PORT  redis://127.0.0.1:6379  ready"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DIR/pg" stop >/dev/null || true; redis-cli shutdown nosave >/dev/null 2>&1 || true ;;
esac
