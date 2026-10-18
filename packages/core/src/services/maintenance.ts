import type { Core } from '../context.js';
import { expireQuotesAndRequests } from './quotes.js';
import { expireReservations } from './orders.js';
import { deliverQueuedEmails } from './notifications.js';
import { processOutbox, syncAllNodes, sendHeartbeats, federationHousekeeping } from './federation.js';

/** All periodic jobs. The worker schedules these through BullMQ; tests can call them directly. */
export const maintenanceJobs = {
  'expire-quotes': (core: Core) => expireQuotesAndRequests(core),
  'release-reservations': (core: Core) => expireReservations(core),
  'deliver-emails': (core: Core) => deliverQueuedEmails(core),
  'federation-outbox': (core: Core) => processOutbox(core),
  'federation-sync': (core: Core) => syncAllNodes(core),
  'federation-heartbeat': (core: Core) => sendHeartbeats(core),
  'federation-housekeeping': (core: Core) => federationHousekeeping(core),
} as const;

export type MaintenanceJob = keyof typeof maintenanceJobs;

export const JOB_SCHEDULE: Record<MaintenanceJob, number> = {
  'expire-quotes': 10 * 60_000,
  'release-reservations': 5 * 60_000,
  'deliver-emails': 60_000,
  'federation-outbox': 60_000,
  'federation-sync': 30 * 60_000,
  'federation-heartbeat': 15 * 60_000,
  'federation-housekeeping': 60 * 60_000,
};
