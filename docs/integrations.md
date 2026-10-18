# Integrations

All external services sit behind interfaces in `packages/core/src/providers`. Each has a clearly-labelled development implementation; none claims to be connected when it is not.

| Area | Env | Implementations | Notes |
|---|---|---|---|
| Payments | `PAYMENT_PROVIDER` | `mock` (DEMO, no money, signed mock webhooks), `manual` (buyer registers a bank transfer, admin/supplier confirms), `stripe` | Stripe adapter implements checkout + webhook verification via `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`; it has not been exercised against live Stripe in this repo's tests. |
| Shipping | `SHIPPING_PROVIDER` | `mock` (DEMO estimates by weight/zone), `manual` (supplier enters carrier & tracking; events recorded) | Add a carrier by implementing `ShippingProvider`. |
| AI | `AI_PROVIDER` | `none` (rule-based parser; translation disabled — text is passed through unchanged), `openai-compatible` (any OpenAI-compatible `AI_BASE_URL`) | Per-user daily limit `AI_DAILY_USER_LIMIT`; outputs are suggestions the user confirms. |
| Email | `EMAIL_PROVIDER` | `none`, `log` (dev console), `resend` | Without a provider, emails are stored with status `NOT_CONFIGURED`. |
| Storage | `STORAGE_DRIVER` | `local`, `s3` (MinIO/AWS/R2) | MIME verified by magic bytes; SVG/HTML rejected. |
| Supplier systems | Seller → Connectors | CSV/XLSX-style CSV import (preview, row errors, commit, rollback), `http` connector (pull JSON inventory from an ERP URL via `safeFetch`, credentials AES-256-GCM encrypted), `mock` | Imported stock is `UNVERIFIED` until the supplier confirms. |

## Writing a new connector
Implement `SupplierConnector` from `packages/connectors/src/connector.ts` (`searchProducts`, `getProduct`, `getInventory`, `requestQuote`, `createOrder`, `getOrderStatus`, declaring which `capabilities` it supports), register it in `packages/connectors/src/index.ts`, and add tests next to the mock connector's.
