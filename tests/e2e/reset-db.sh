#!/usr/bin/env bash
# Prepares the two E2E databases: migrate, truncate business tables (keeps RBAC tables), seed node A.
# Invoked from playwright.config.ts because Playwright starts webServers before globalSetup.
set -euo pipefail
PG="${E2E_PG:-postgresql://postgres@127.0.0.1:5432}"
for db in globalhub_e2e_a globalhub_e2e_b; do
  psql "$PG/postgres" -tc "select 1 from pg_database where datname='$db'" | grep -q 1 || psql "$PG/postgres" -qc "create database $db"
  (cd packages/database && DATABASE_URL="$PG/$db" pnpm exec prisma migrate deploy >/dev/null)
  tables=$(psql "$PG/$db" -Atc "select string_agg(format('%I',tablename),',') from pg_tables where schemaname='public' and tablename not in ('_prisma_migrations','Role','Permission','RolePermission')")
  [ -n "$tables" ] && psql "$PG/$db" -qc "TRUNCATE $tables CASCADE"
done
DATABASE_URL="$PG/globalhub_e2e_a" SEED_DEMO=false pnpm db:seed >/dev/null
echo "[e2e] databases reset"
