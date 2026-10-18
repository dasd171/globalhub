#!/usr/bin/env bash
# Restore a backup made by backup.sh. DESTRUCTIVE: replaces the current database.
# Usage: scripts/restore.sh backups/globalhub-<ts>.dump [backups/uploads-<ts>.tgz]
set -euo pipefail
DUMP="${1:?path to .dump}"; UPLOADS="${2:-}"
read -r -p "This will overwrite the current database. Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || exit 1
if [ -n "$(docker compose ps -q postgres 2>/dev/null)" ]; then
  docker compose stop api worker || true
  docker compose exec -T postgres pg_restore -U globalhub -d globalhub --clean --if-exists < "$DUMP"
  [ -n "$UPLOADS" ] && docker compose run --rm -T api tar -C /app -xzf - < "$UPLOADS"
  docker compose up -d api worker
else
  : "${DATABASE_URL:?DATABASE_URL not set}"
  pg_restore -d "$DATABASE_URL" --clean --if-exists "$DUMP"
  [ -n "$UPLOADS" ] && tar -xzf "$UPLOADS"
fi
echo "Restore complete. Run migrations if the backup predates the current version: docker compose run --rm migrate"
