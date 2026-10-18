# Security Policy

## Reporting a vulnerability
Please **do not** open public issues for security problems. Email the maintainers (set your address here before publishing, e.g. `security@your-domain`) or use GitHub private vulnerability reporting. We aim to acknowledge within 72 hours.

## Supported versions
Only the latest `main` release receives security fixes during the 0.x series.

## Security design (summary)
- Passwords: argon2id (OWASP parameters). Sessions: random 256-bit tokens, stored hashed, httpOnly + SameSite=Lax cookies, Secure in production.
- CSRF: double-submit token required for cookie-authenticated state-changing requests; Bearer-token API clients are exempt.
- Brute force: per-route rate limits (`AUTH_RATE_LIMIT_MAX`) and account lock after 5 failed logins (15 min).
- Authorization: RBAC + resource ownership checks in every service function; non-participants receive 404 for orders.
- Injection: Prisma parameterised queries; raw SQL uses tagged templates only. Zod validation on every input.
- XSS: React escaping, strict security headers (Helmet CSP on the API, frame/nosniff/referrer headers on the web), SVG/HTML uploads rejected.
- Uploads: allow-list of MIME types verified by magic bytes, size limits, random storage keys, attachment access checks.
- SSRF: all outbound requests (federation, connectors) go through `safeFetch`: http(s) only, DNS resolved and every address checked against private/reserved ranges, connection pinned to the vetted IP (DNS-rebinding protection), no redirects, response size and time limits.
- Federation: Ed25519 request signatures over method, path, timestamp, nonce, node ID and body hash; ±5 min clock skew; nonce replay protection; signed catalog responses; strict schema validation of every remote item; key-change and URL-change refusal; node banning.
- Payments: webhook signature, event-id uniqueness, payment/order ownership, amount, currency and order state all verified before marking PAID; browser redirects are never proof of payment. Mock payments are refused in production unless `DEMO_MODE=true`.
- Secrets: env vars only; production startup fails on missing/weak secrets; connector credentials encrypted with AES-256-GCM; logs redact auth headers, cookies and secret-like fields.
- Audit: admin actions, verification changes, payments, refunds, disputes and risk events (bad signatures, replays, rejected webhooks, lockouts) are written to `AuditLog`.
- Privacy: users can export their data and delete (anonymise) their account.

## Operator responsibilities
Run behind HTTPS, keep Postgres/Redis off the public internet, rotate secrets, back up regularly (`scripts/backup.sh`), keep dependencies updated (`pnpm audit`), and review the compliance notes in `docs/limitations.md` before handling real payments or cross-border personal data.
