# GlobalHub — Open-Source Global Sourcing Network

GlobalHub is self-hostable sourcing infrastructure for cross-border trade between buyers and suppliers anywhere in the world. Buyers (consumers, retailers, wholesalers, e-commerce sellers, procurement teams) find products, post buying requests, compare supplier quotes, place orders and track fulfilment. Suppliers, factories, distributors, sourcing agents and warehouses manage products, quotes and orders from their own workspace. Independent operators run their own nodes; nodes can optionally discover each other and exchange signed catalogs and RFQs. No central server run by the project authors is required.

> **Truthful by design.** Only stock, capacity and prices a supplier actually confirmed are shown as confirmed. Unverified inventory is labelled `Unverified`. Demo data is always `[DEMO]`. Mock payment/shipping/email providers are labelled as such in the UI and refused in production. Nothing pretends an external service is connected when it is not.

## Four sourcing modes
| Mode | What happens |
|---|---|
| **A. In-stock products** | Suppliers list products with variants, tiered prices, MOQ, stock status (`IN_STOCK`, `LOW_STOCK`, `MADE_TO_ORDER`, `ON_REQUEST`, `OUT_OF_STOCK`, `UNVERIFIED`), lead time, ship-to countries. Buyers search, ask, order. |
| **B. Buying requests (RFQ)** | Buyers describe what they need in plain language (optionally parsed by AI or a rule-based parser). Matching suppliers are notified, submit structured quotes; buyers compare and accept a quote, which becomes an order. |
| **C. Sourcing agents** | Agents publish service regions, languages and fees, take sourcing tasks, contact factories, inspect and consolidate. |
| **D. Federated network** | Nodes sign and publish catalogs (`globalhub-fed/1`, Ed25519). A buyer on node A can browse and send an RFQ to a listing on node B; the quote flows back signed. |

## Features
- Accounts with roles (buyer, supplier, agent, platform admin), argon2id passwords, sessions, CSRF, lockout, email verification/reset (email provider pluggable).
- Supplier workspace: store setup, products & variants, inventory, CSV import with preview / commit / rollback, connectors (HTTP / mock) for ERP inventory sync.
- Buyer workspace: favorites, sourcing list, addresses, requests, quote comparison, orders, disputes, data export & account deletion.
- Order lifecycle state machine: confirmation, payments (mock / manual bank transfer / Stripe interface), shipments & tracking events, refunds, disputes, reviews only from completed orders.
- Messaging, notifications, reports & moderation, audit log, risk events.
- Admin console: users, supplier/agent verification, products, requests, orders, disputes, categories, connectors, settings, system health, jobs.
- Background worker (BullMQ): quote expiry, node heartbeats & catalog sync, connector sync, cleanup.
- Optional AI assistant (OpenAI-compatible): parse requests, optional translation, normalise specs, draft messages — with a rule-based fallback when `AI_PROVIDER=none`.
- REST API under `/api/v1` with an OpenAPI document (`docs/openapi.json`) and a typed client (`packages/api-client`).

## Tech stack
TypeScript monorepo (pnpm). **API**: Fastify + Zod. **Web**: Next.js (App Router) + Tailwind. **DB**: PostgreSQL + Prisma (59 models, pg_trgm search). **Queue/cache**: Redis + BullMQ. **Storage**: local disk or S3-compatible (MinIO/S3/R2). **Tests**: Vitest (unit + integration against real Postgres), Playwright (E2E, two nodes). **Deploy**: Docker Compose + Nginx.

```
apps/api        Fastify HTTP API (transport only)
apps/web        Next.js web app (English UI; i18n-ready)
apps/worker     BullMQ background jobs
packages/shared pure domain logic: money, pricing tiers, state machines, permissions, schemas, parser
packages/core   services (auth, catalog, sourcing, orders, payments, federation…) + providers
packages/database Prisma schema, migrations, seed
packages/federation protocol, Ed25519 signing, SSRF-safe fetch
packages/connectors CSV import, HTTP & mock supplier connectors
packages/i18n   UI dictionaries (English; add locales with the same typed keys)
packages/api-client typed client
```

## Quick start (Docker Compose)
```bash
git clone <your-fork-url> globalhub && cd globalhub
cp .env.example .env
# fill AUTH_SECRET, APP_ENCRYPTION_KEY (openssl rand -hex 32), POSTGRES_PASSWORD, URLs
docker compose up -d --build
docker compose run --rm migrate pnpm admin:create --email you@example.com   # prompts for a password
```
Open `https://your-domain` (Nginx terminates TLS → web, `/api/` → API). Put certificates in `deploy/nginx/certs/` first. Full guide: **[docs/deployment.md](docs/deployment.md)**.

## Local development (no Docker needed)
```bash
pnpm install
cp .env.example .env   # set DATABASE_URL=postgresql://postgres@127.0.0.1:5432/globalhub, REDIS_URL=redis://127.0.0.1:6379, AUTH_SECRET
pnpm services:local    # starts throwaway Postgres + Redis from system packages; or: docker compose -f docker-compose.dev.yml up -d
pnpm db:generate && pnpm db:migrate
SEED_DEMO=true pnpm db:seed          # prints demo account emails + password
pnpm --filter @globalhub/api dev      # http://localhost:4000
pnpm --filter @globalhub/web dev      # http://localhost:3000
pnpm --filter @globalhub/worker dev
```

## Tests
```bash
pnpm typecheck && pnpm lint
pnpm test:unit
pnpm test:integration                 # needs Postgres (TEST_DATABASE_URL, TEST_DATABASE_URL_B)
pnpm --filter @globalhub/api build && pnpm --filter @globalhub/web build
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e   # two API nodes + web, real browser
```
See [docs/testing.md](docs/testing.md) for what each suite covers.

## Documentation
- [Architecture](docs/architecture.md) · [Deployment](docs/deployment.md) · [Federation protocol](docs/federation.md)
- [API](docs/api.md) · [Integrations (payment, shipping, AI, email, connectors)](docs/integrations.md)
- [Testing](docs/testing.md) · [Known limitations & compliance](docs/limitations.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## License
MIT. GlobalHub is software, not a marketplace operator: each node's operator is responsible for its users, payments, tax, customs and legal compliance.
