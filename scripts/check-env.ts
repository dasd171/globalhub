/** Validate environment variables exactly as the API/worker will (fails on unsafe production config). */
import { loadConfig } from '@globalhub/core';
try {
  const c = loadConfig();
  console.log(`✔ Configuration valid for NODE_ENV=${c.NODE_ENV}`);
  console.log(`  payment=${c.PAYMENT_PROVIDER}${c.mockPaymentsAllowed ? ' (DEMO — no real money)' : ''}, shipping=${c.SHIPPING_PROVIDER}, ai=${c.AI_PROVIDER}, email=${c.EMAIL_PROVIDER}, storage=${c.STORAGE_DRIVER}, federation=${c.FEDERATION_ENABLED}`);
  if (c.EMAIL_PROVIDER === 'none') console.log('  ! EMAIL_PROVIDER=none: emails are not sent (shown as NOT_CONFIGURED).');
  if (c.AI_PROVIDER === 'none') console.log('  ! AI_PROVIDER=none: rule-based parsing and glossary translation only.');
} catch (e) {
  console.error(`✘ ${(e as Error).message}`);
  process.exit(1);
}
