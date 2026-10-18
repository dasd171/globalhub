# Contributing to GlobalHub

Thanks for helping build open sourcing infrastructure!

## Ground rules
- **No fake data presented as real.** Demo seed data must be `isDemo=true` and labelled `[DEMO]`. Never seed reviews, ratings, orders or verification badges.
- **No fake integrations.** If an external service is not available, add an interface + mock + tests and label the mock clearly in the UI.
- **Server-side authorization for everything.** Hiding a button is not access control. Every service function checks identity, permission and ownership.
- **Money is integer minor units + ISO currency.** No floats.
- **Do not scrape or copy** other marketplaces' private code, images, trademarks or product databases.

## Development
```bash
pnpm install
cp .env.example .env            # set AUTH_SECRET etc.
bash scripts/local-services.sh  # or: docker compose -f docker-compose.dev.yml up postgres redis
pnpm db:generate && pnpm db:migrate && SEED_DEMO=true pnpm db:seed
pnpm --filter @globalhub/api dev   # :4000
pnpm --filter @globalhub/web dev   # :3000
```

## Before opening a PR
```bash
pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration
pnpm --filter @globalhub/api build && pnpm --filter @globalhub/web build
pnpm test:e2e   # needs built apps + Chromium
```
- Add/adjust tests for every behaviour change (unit for pure logic in `packages/shared`, integration for services/API).
- Schema changes: `pnpm db:migrate:dev --name <change>`; commit the migration. Check `prisma migrate diff` is empty.
- New UI text goes into `packages/i18n/src/en.ts`. Additional locales must provide every key (type-checked against `MessageKey`).
- Keep the modular monolith boundaries: `packages/shared` (pure), `packages/core` (services), `apps/*` (transport).

## Commit style
Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `infra:`). One logical change per PR.

## Licensing
By contributing you agree your contribution is licensed under the MIT License. Only add dependencies with MIT/Apache-2.0/BSD/ISC-compatible licenses.
