# Federation protocol `globalhub-fed/1`

Federation is optional. Every node is fully functional alone; there is no central registry.

## Node identity
`GET /api/v1/federation/node-info` returns `{ protocol, nodeId, displayName, publicUrl, capabilities, publicScopes, keys[{keyId, algorithm:"ed25519", publicKey}] }`. A peer is added by URL; its node-info is fetched and its key pinned. A later change of key or URL is **refused** until an admin re-approves it. Admins can ban nodes.

Capabilities: `catalog.products`, `catalog.suppliers`, `rfq.receive`, `rfq.quote_return`, `buying_requests.public`. Public scopes (operator opt-in): `products`, `suppliers`, `buying_requests`, `rfq_inbox`. Nothing outside a scope is ever served.

## Request signing
Every node-to-node request carries:
```
x-globalhub-node, x-globalhub-key-id, x-globalhub-timestamp (unix s), x-globalhub-nonce, x-globalhub-signature, idempotency-key
```
Signature = Ed25519 over
```
METHOD \n PATH \n TIMESTAMP \n NONCE \n NODE_ID \n sha256hex(BODY)
```
Receivers reject clock skew > 300 s, replayed nonces (stored), unknown or banned nodes, and bad signatures; failures are written as `RiskEvent`s. Catalog responses are signed too.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/federation/node-info` | identity & keys |
| POST | `/federation/heartbeat` | liveness |
| GET | `/federation/catalog/{products\|suppliers}?cursor=` | signed, paginated catalog (max 500 items) with `removedIds` |
| GET | `/federation/listings/{id}` | one listing |
| POST | `/federation/inbox/rfq` | receive an RFQ (buyer identity never shared; only a label) |
| POST | `/federation/inbox/quote` | return a quote for an RFQ |

Remote items are validated strictly (`packages/federation/src/protocol.ts`) and stored as `RemoteListing`s, always shown with their origin node and **never** as locally verified stock. Outbound calls use `safeFetch` (http/https only, DNS pinned, private ranges blocked unless `FEDERATION_ALLOW_PRIVATE_NETWORK=true` for local testing, no redirects, size/time limits). Delivery is via a retrying outbox.

## Flow: remote quote
1. Node A syncs B's catalog (`federation-sync`).
2. Buyer on A opens the remote listing and requests a quote → A stores the RFQ and signs `POST B/federation/inbox/rfq`.
3. B creates a local buying request for the supplier; supplier submits a quote.
4. B signs `POST A/federation/inbox/quote`; buyer sees it in their quote comparison.

Covered by `tests/integration/federation.test.ts` and E2E scenario 5 (two real API processes).
