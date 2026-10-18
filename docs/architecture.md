# Architecture

GlobalHub is a **modular monolith** in a pnpm TypeScript monorepo. Boundaries are enforced by package dependencies:

```
packages/shared   (pure: no I/O)  ← money, pricing tiers, fees, inventory rules, state machines,
                                     permissions, Zod schemas, request parser, matching score
packages/database (Prisma schema, migrations, seed)
packages/federation (protocol schemas, Ed25519 signing, SSRF-safe fetch)
packages/connectors (CSV import, HTTP and mock supplier connectors)
packages/core     ← services; every function takes (core, actor, input) and checks identity,
                     permission and ownership server-side; providers (payment, shipping, AI, email, storage)
apps/api          ← Fastify transport: auth cookies/Bearer, CSRF, rate limits, Zod parsing, OpenAPI
apps/worker       ← BullMQ jobs calling core.maintenance
apps/web          ← Next.js App Router; server components call the API with the user's cookie
```

## Data
PostgreSQL is the source of truth (59 Prisma models). Redis holds rate-limit counters and BullMQ scheduling state only. Money is stored as integer minor units plus ISO-4217 currency. Search uses `pg_trgm` indexes on titles (EN + ZH) and descriptions.

Key aggregates: `User`/`Role`/`Permission`, `SupplierProfile`→`Store`→`Product`→`ProductVariant`→`Inventory` + `PriceTier`, `BuyingRequest`→`Quote`, `Order`→`OrderItem`/`Payment`/`Shipment`/`Refund`/`Dispute`, `Conversation`/`Message`, `Node`/`RemoteListing`/`FederationOutbox`, `ImportJob`, `Connector`, `AuditLog`, `RiskEvent`.

## Truthfulness rules (enforced in code)
- Stock is only shown as confirmed when the supplier verified it (`Inventory.verifiedAt`); otherwise it is `UNVERIFIED`.
- Inventory reservation uses a conditional `UPDATE "Inventory" … WHERE "verifiedAt" IS NOT NULL AND "onHand" - "reserved" >= qty`, so concurrent buyers cannot oversell (E2E scenario 8).
- Reviews require a completed order by that buyer.
- Payments are marked `PAID` only from a verified provider webhook (signature, event-id uniqueness, amount, currency, order state). Browser redirects are never proof.
- Mock providers are flagged in API responses and labelled in the UI; production refuses them unless `DEMO_MODE=true`.

## State machines
Defined in `packages/shared/src/state-machines.ts` with the actor allowed for each step, and unit-tested: order (`DRAFT → PENDING_SUPPLIER_CONFIRMATION → AWAITING_PAYMENT → PAID → PROCESSING → READY_TO_SHIP → SHIPPED → IN_TRANSIT → DELIVERED → COMPLETED`, with `CANCELLATION_REQUESTED`, `REFUND_REQUESTED`, `REFUNDED`/`PARTIALLY_REFUNDED`, `DISPUTED` and `CANCELLED` branches; only `system` — a verified webhook — moves an order to `PAID`), refunds and quotes.

## Background jobs (apps/worker)
| Job | Every |
|---|---|
| expire-quotes | 10 min |
| release-reservations | 5 min |
| deliver-emails | 1 min |
| federation-outbox | 1 min |
| federation-sync | 30 min |
| federation-heartbeat | 15 min |
| federation-housekeeping | 60 min |

Admins can trigger any job from the console (`POST /api/v1/admin/jobs/{job}/run`).
