import { env } from './config/env';
import { logger } from './config/logger';
import { connectDb, disconnectDb } from './config/db';
import { createApp } from './app';
import { ensureSystemData } from './seed/system';
import { scheduleBirthdayJob } from './services/birthdays';

async function main() {
  await connectDb(env.MONGODB_URI);
  await ensureSystemData();
  scheduleBirthdayJob();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}/api/v1`));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
