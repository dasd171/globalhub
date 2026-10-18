# Known limitations & compliance notes

## What is not connected out of the box
- **Real payments**: `mock` is for development only. `stripe` is implemented against Stripe's documented API but untested against live Stripe here; `manual` bank transfer needs a human to confirm receipt. No escrow, no card data ever touches GlobalHub.
- **International logistics**: no carrier API is integrated; `mock` estimates are labelled DEMO, `manual` relies on supplier-entered tracking.
- **Email**: needs a provider (`resend`) for verification and password reset to reach users.
- **AI**: optional; with `AI_PROVIDER=none` request parsing is rule-based and limited, and no machine translation is performed.
- **Third-party marketplaces**: not scraped or integrated. Suppliers bring their own data via CSV, API or connectors.
- **Docker**: the images were not built in the authoring sandbox (no Docker there); CI builds them.

## Product limitations (v0.1)
- Search is PostgreSQL trigram; no dedicated search engine.
- No FX conversion: quotes and orders stay in the currency the supplier quoted; comparisons across currencies are flagged, not converted.
- Supplier verification levels are set by node admins; there is no third-party KYB integration.
- Federation trust is per-node pinning; there is no global reputation system.

## Operator responsibilities
Running a node that handles real trade means you are responsible for: business registration, payment/AML rules, consumer-protection and return law in buyers' countries, export controls and customs (HS codes, duties, dangerous goods such as lithium batteries), product safety certification (CE, FCC, UKCA…), tax/VAT/sales tax, and data protection (GDPR, PIPL cross-border transfer rules, CCPA). GlobalHub provides data export, account deletion (anonymisation) and audit logs, but compliance is the operator's job.
