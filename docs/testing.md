# Testing

| Suite | Command | Needs | Covers |
|---|---|---|---|
| Unit | `pnpm test:unit` | nothing | money & rounding, tiered pricing, fees, inventory status rules, state machines, permissions, request parser, matching, signing, SSRF guard (46 tests) |
| Integration | `pnpm test:integration` | Postgres (`TEST_DATABASE_URL`, `TEST_DATABASE_URL_B`), Redis | auth/lockout/CSRF, catalog & search, buying requests & quotes, orders/payments/webhook idempotency/refunds/disputes, admin & CSV import, two-node federation (35 tests) |
| E2E | `pnpm test:e2e` | built api + web, Postgres, Redis, Chromium (`CHROMIUM_PATH`) | 8 browser scenarios on two live nodes (below) |

E2E scenarios (`tests/e2e/scenarios.spec.ts`):
1. Register → search → product detail → request a quote
2. Post buying request → supplier quotes → buyer compares and accepts
3. Order → supplier confirms → mock payment → shipping → completed
4. Supplier CSV import → errors → fix → published
5. Two nodes exchange catalogs; buyer finds a remote product and requests a quote
6. A user cannot open another user's order
7. Duplicate payment webhooks do not double-process
8. Concurrent buyers cannot oversell limited stock

`playwright.config.ts` resets both E2E databases (`tests/e2e/reset-db.sh`) before starting two API nodes (:4000, :4002) and the web app (:3000, or `E2E_WEB_PORT` if that port is taken).
