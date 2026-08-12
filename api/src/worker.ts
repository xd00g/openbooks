/**
 * OpenBooks background worker.
 *
 * Runs BullMQ queues for bank-feed sync, report generation, email, receipt
 * thumbnailing, etc. Shares the API image; started with `node dist/worker.js`.
 *
 * This is a stub: it connects to Redis and registers an empty worker so the
 * container has something to run. Real processors land here as features ship.
 */
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  maxRetriesPerRequest: null,
});

export const QUEUES = {
  bankSync: 'bank-sync',
  reports: 'reports',
  email: 'email',
  attachments: 'attachments',
} as const;

// Example queue handle other parts of the app can enqueue to.
export const bankSyncQueue = new Queue(QUEUES.bankSync, { connection });

async function main() {
  // eslint-disable-next-line no-console
  console.log('OpenBooks worker starting...');

  new Worker(
    QUEUES.bankSync,
    async (job) => {
      // TODO: pull transactions via the configured BankFeedProvider,
      // upsert into bank_transaction (idempotent on externalId).
      // eslint-disable-next-line no-console
      console.log(`[bank-sync] job ${job.id} (${job.name}) — not yet implemented`);
    },
    { connection },
  );

  // eslint-disable-next-line no-console
  console.log('OpenBooks worker ready. Listening for jobs.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker failed to start', err);
  process.exit(1);
});
