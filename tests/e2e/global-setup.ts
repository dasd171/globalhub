// Database preparation happens in tests/e2e/reset-db.sh (invoked from playwright.config.ts)
// because Playwright starts webServers before globalSetup runs.
export default async function setup() {}
