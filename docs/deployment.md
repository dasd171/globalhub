# Deployment

## 1. Single VPS / cloud server with Docker Compose (recommended)
Requirements: Docker 24+, Compose v2, 2 vCPU / 4 GB RAM, a domain pointing at the server.

```bash
git clone <your-fork-url> globalhub && cd globalhub
cp .env.example .env
openssl rand -hex 32   # → AUTH_SECRET
openssl rand -hex 32   # → APP_ENCRYPTION_KEY
# edit .env: POSTGRES_PASSWORD (and the same password inside DATABASE_URL), APP_BASE_URL/API_BASE_URL=https://your-domain,
# COOKIE_SECURE=true, PAYMENT_PROVIDER=manual (or stripe), EMAIL_PROVIDER, STORAGE_*
pnpm env:check         # optional, validates .env (needs Node locally)
```

TLS: put `fullchain.pem` and `privkey.pem` into `deploy/nginx/certs/` (certbot/acme.sh) and set `server_name` in `deploy/nginx/globalhub.conf`.

```bash
docker compose up -d --build           # postgres, redis, migrate (one-shot), api, worker, web, nginx
docker compose run --rm migrate pnpm admin:create --email you@example.com --name "Admin"
docker compose ps && curl -fsS https://your-domain/api/v1/health
```
S3-compatible storage on the same host: `docker compose --profile minio up -d` and set `STORAGE_DRIVER=s3`, `STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_BUCKET`, keys.

Only Nginx publishes ports (80/443). Postgres, Redis and MinIO stay on the internal Docker network.

### Upgrades
```bash
git pull && docker compose build && docker compose run --rm migrate && docker compose up -d
```
### Backups
`scripts/backup.sh ./backups` (pg_dump custom format + uploads); restore with `scripts/restore.sh <dump>`. Schedule with cron and copy off-site, encrypted.

## 2. Without Docker (systemd / PM2)
Node 20.11+, pnpm 10, PostgreSQL 15+ (with `pg_trgm`), Redis 6+.
```bash
pnpm install --frozen-lockfile
pnpm db:generate && pnpm db:migrate
pnpm --filter @globalhub/api build && pnpm --filter @globalhub/worker build && pnpm --filter @globalhub/web build
NODE_ENV=production node apps/api/dist/main.js        # :4000
NODE_ENV=production node apps/worker/dist/main.js
node apps/web/.next/standalone/apps/web/server.js      # :3000 (copy .next/static and public next to it, as in the Dockerfile)
```
Put Nginx (see `deploy/nginx/globalhub.conf`) in front and set `TRUST_PROXY=true`.

## 3. Local development
See README → "Local development". `scripts/local-services.sh` starts a throwaway Postgres + Redis from system packages; `docker-compose.dev.yml` does the same with containers (ports bound to 127.0.0.1).

## Joining the federation (optional)
```bash
pnpm node:keygen        # prints NODE_KEY_ID / NODE_PRIVATE_KEY (base64 PKCS#8)
```
Set `FEDERATION_ENABLED=true`, a unique `NODE_ID`, `NODE_PUBLIC_URL=https://your-domain`, and `NODE_PUBLIC_SCOPES`. Add peers in Admin → Network (or `POST /api/v1/nodes/discover` with the peer URL). See [federation.md](federation.md).

## Production checklist
- [ ] Strong `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, DB password (startup fails on weak/missing values)
- [ ] HTTPS, `COOKIE_SECURE=true`, `TRUST_PROXY=true`
- [ ] `PAYMENT_PROVIDER` is `manual` or `stripe` (mock is refused) and webhook secret set
- [ ] Email provider configured, otherwise verification/reset emails show `NOT_CONFIGURED`
- [ ] `SEED_DEMO=false`
- [ ] Backups scheduled and a restore tested
- [ ] Read [limitations.md](limitations.md)

> Note: the Dockerfile and Compose files are written for these steps, but in the environment where this release was built Docker was not available, so the container build itself was not executed there. CI (`.github/workflows/ci.yml`) builds the `api` and `web` images on every push.
