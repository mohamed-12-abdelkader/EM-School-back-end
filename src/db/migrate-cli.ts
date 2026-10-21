import { applyMigrations } from './migrate';
import { config } from '../config/env';

const direction = (process.argv[2] === 'down' ? 'down' : 'up') as 'up' | 'down';

applyMigrations(config.DATABASE_URL, direction)
  .then(() => {
    console.log(`Migrations ${direction} complete`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
