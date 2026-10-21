import { applyMigrations } from './db/migrate';
import { config, logger } from './utils';
import { app } from './app';
import { connectRedis, disconnectRedis } from './config/redis';
import { startWorkers } from './workers';

const startServer = async () => {
  try {
    logger.info('Applying database migrations...');
    await applyMigrations(config.DATABASE_URL, 'up');

    try {
      await connectRedis();
      startWorkers();
      logger.info('Redis connected; BullMQ workers started');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'Redis unavailable — API will run without async workers (set REDIS_URL when ready)',
      );
      await disconnectRedis();
    }

    const PORT = config.PORT;

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server is running on port ${PORT}`);
      logger.info(`PRD Phase 1 API: http://localhost:${PORT}/api/v1/health`);
    });

    const shutdown = () => {
      logger.info('Received shutdown signal. Closing server...');
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
