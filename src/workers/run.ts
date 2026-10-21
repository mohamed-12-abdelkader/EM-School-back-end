import { connectRedis } from '../config/redis';
import { logger } from '../utils';
import { startWorkers } from './index';

async function main() {
  await connectRedis();
  startWorkers();
  logger.info('Standalone BullMQ workers process running');
}

main().catch((err) => {
  logger.error(err, 'Workers failed to start');
  process.exit(1);
});
