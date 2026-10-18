#!/usr/bin/env bash
# Backup PostgreSQL (custom format) and uploaded files. Usage: scripts/backup.sh [backup-dir]
set -euo pipefail
DIR="${1:-./backups}"; TS="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$DIR"
if docker compose ps postgres >/dev/null 2>&1 && [ -n "$(docker compose ps -q postgres)" ]; then
  docker compose exec -T postgres pg_dump -U globalhub -Fc globalhub > "$DIR/globalhub-$TS.dump"
  docker compose exec -T api tar -C /app -czf - storage > "$DIR/uploads-$TS.tgz" 2>/dev/null || echo "(no local uploads volume — using S3?)"
else
  : "${DATABASE_URL:?DATABASE_URL not set}"
  pg_dump -Fc "$DATABASE_URL" > "$DIR/globalhub-$TS.dump"
  [ -d storage ] && tar -czf "$DIR/uploads-$TS.tgz" storage || true
fi
echo "Backup written to $DIR (globalhub-$TS.dump). Store it off-site and encrypted."
