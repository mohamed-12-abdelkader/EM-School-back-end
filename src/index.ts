import { applyMigrations } from './db/migrate';
import { config, logger } from './utils';
import { app } from './app';

const startServer = async () => {
  try {
    logger.info('Applying database migrations...');
    await applyMigrations(config.DATABASE_URL, 'up');

    const PORT = 8000;

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server is running on port ${PORT}`);
    });

    // Graceful shutdown
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
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
