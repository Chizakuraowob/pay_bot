import { startApi } from './api/index.js';
import { startBot } from './bot/index.js';
import { logger } from './lib/logger.js';
import { disconnectDb } from './db/index.js';

async function main() {
  await startApi();
  await startBot();
  logger.info('Designed by Chizakura.');
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});

const shutdown = async (sig) => {
  logger.info(`${sig} received, shutting down`);
  await disconnectDb();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
