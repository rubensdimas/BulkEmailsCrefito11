import runtimeConfig from './database';
import knexfile from './knexfile';

// Docker Swarm's IPVS load balancer silently drops TCP connections that stay
// idle for 900s. Pooled connections must never outlive that window, otherwise
// the first query after an idle period fails with "Connection terminated
// unexpectedly".
const SWARM_IPVS_IDLE_TIMEOUT_MS = 900_000;

const configs = {
  'runtime (database.ts)': runtimeConfig,
  'migrations (knexfile.ts production)': knexfile.production,
};

describe.each(Object.entries(configs))('%s pool', (_name, config) => {
  const pool = config.pool as { min?: number; idleTimeoutMillis?: number };
  const connection = config.connection as { keepAlive?: boolean };

  it('does not keep idle connections alive indefinitely', () => {
    expect(pool.min).toBe(0);
  });

  it('releases idle connections before Swarm drops them', () => {
    expect(pool.idleTimeoutMillis).toBeDefined();
    expect(pool.idleTimeoutMillis).toBeLessThan(SWARM_IPVS_IDLE_TIMEOUT_MS);
  });

  it('enables TCP keepalive on connections', () => {
    expect(connection.keepAlive).toBe(true);
  });
});
