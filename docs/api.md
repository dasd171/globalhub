# REST API

Base path `/api/v1`. JSON in/out, validated with Zod. The full machine-readable spec is [`openapi.json`](openapi.json) (regenerate: `pnpm --filter @globalhub/api exec tsx src/scripts/export-openapi.ts`). A typed client lives in `packages/api-client`.

## Authentication
- Browser: `POST /auth/login` sets an httpOnly session cookie; state-changing requests need the `x-csrf-token` header matching the CSRF cookie.
- Scripts / integrations: `Authorization: Bearer <session token>` (CSRF-exempt).
- Errors: `{ "error": { "code": "NOT_FOUND", "message": "…" } }`. Non-participants get `404` for orders.

## Main groups
| Group | Examples |
|---|---|
| Auth & users | `/auth/register`, `/auth/login`, `/users/me`, `/users/me/export`, `/users/me/delete` |
| Catalog | `GET /products?q=&category=&stock=&shipsTo=`, `/products/{id}`, `/products/{id}/shipping-quote`, `/suppliers`, `/stores/{slug}` |
| Seller | `/seller/profile`, `/seller/products`, `/variants/{id}/inventory`, `/imports/preview → /imports/{id}/commit → /rollback`, `/connectors` |
| Sourcing | `/buying-requests`, `/buying-requests/{id}/matches`, `/quotes`, `/quotes/{id}/submit\|accept\|reject\|withdraw`, `/buying-requests/{id}/quotes/summary` |
| Orders | `/orders`, `/orders/{id}/confirm`, `/orders/{id}/transition`, `/orders/{id}/payments`, `/payments/webhooks/{provider}`, `/orders/{id}/shipments`, `/refunds/{id}/decision`, `/disputes` |
| Agents | `/agents`, `/agents/me/tasks` |
| AI | `/ai/status`, `/ai/parse-request`, `/ai/translate`, `/ai/normalize-specs`, `/ai/draft-message` |
| Messaging | `/conversations`, `/conversations/{id}/messages`, `/notifications` |
| Federation | `/nodes`, `/nodes/discover`, `/nodes/{id}/sync`, `/federation/*` (signed) |
| Admin | `/admin/dashboard`, `/admin/users`, `/admin/suppliers/{id}/verification`, `/admin/audit-logs`, `/admin/risk-events`, `/admin/jobs/{job}/run`, `/admin/system` |
| Health | `/health/live`, `/health` (DB + Redis) |

## Example
```bash
curl -s -X POST https://node.example/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","password":"…"}'   # → { token, user }
curl -s https://node.example/api/v1/products?q=usb-c%20hub -H "authorization: Bearer $TOKEN"
```
