const mockCounters = new Map<string, number>();
const mockRedis = {
  get: jest.fn(async (key: string) => (mockCounters.has(key) ? String(mockCounters.get(key)) : null)),
  incr: jest.fn(async (key: string) => {
    const value = (mockCounters.get(key) ?? 0) + 1;
    mockCounters.set(key, value);
    return value;
  }),
  expire: jest.fn(async (..._args: unknown[]) => 1),
  del: jest.fn(async (key: string) => (mockCounters.delete(key) ? 1 : 0)),
  // Chainable MULTI fake: queues commands, runs them in order on exec(), and
  // reports per-command errors as [err, result] pairs like ioredis does.
  multi: jest.fn(() => {
    const queued: Array<() => Promise<unknown>> = [];
    const chain = {
      incr: (key: string) => {
        queued.push(() => mockRedis.incr(key));
        return chain;
      },
      expire: (key: string, seconds: number, option: string) => {
        queued.push(() => mockRedis.expire(key, seconds, option));
        return chain;
      },
      exec: async (): Promise<Array<[Error | null, unknown]>> => {
        const results: Array<[Error | null, unknown]> = [];
        for (const command of queued) {
          try {
            results.push([null, await command()]);
          } catch (error) {
            results.push([error as Error, null]);
          }
        }
        return results;
      },
    };
    return chain;
  }),
};

jest.mock('../config/redis', () => ({ getRedisClient: () => mockRedis }));

import {
  clearFailedLogins,
  isLoginBlocked,
  LOGIN_WINDOW_SECONDS,
  registerFailedLogin,
} from './loginAttemptLimiter';

const failTimes = async (count: number, username: string, ip: string): Promise<void> => {
  for (let attempt = 0; attempt < count; attempt += 1) await registerFailedLogin(username, ip);
};

describe('loginAttemptLimiter', () => {
  beforeEach(() => {
    mockCounters.clear();
    jest.clearAllMocks();
  });

  it('does not block before any failure', async () => {
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(false);
  });

  it('blocks a username and IP pair after five failures only for that pair', async () => {
    await failTimes(5, 'admin', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(true);
    await expect(isLoginBlocked('admin', '198.51.100.9')).resolves.toBe(false);
    await expect(isLoginBlocked('outro', '203.0.113.1')).resolves.toBe(false);
  });

  it('does not block a username and IP pair after four failures', async () => {
    await failTimes(4, 'admin', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(false);
  });

  it('blocks an IP after twenty failures across usernames', async () => {
    for (let index = 0; index < 20; index += 1) await registerFailedLogin(`user-${index}`, '203.0.113.1');
    await expect(isLoginBlocked('novo-usuario', '203.0.113.1')).resolves.toBe(true);
  });

  it('does not block an IP after nineteen failures across usernames', async () => {
    for (let index = 0; index < 19; index += 1) await registerFailedLogin(`user-${index}`, '203.0.113.1');
    await expect(isLoginBlocked('novo-usuario', '203.0.113.1')).resolves.toBe(false);
  });

  it('clears only the username and IP pair after a success', async () => {
    await failTimes(5, 'admin', '203.0.113.1');
    await clearFailedLogins('admin', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(false);
    await failTimes(15, 'outro', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(true);
  });

  it('sets the fifteen minute window with NX on every increment so a running window is never extended', async () => {
    await failTimes(2, 'admin', '203.0.113.1');
    // Two increments per failure (pair key and IP key), two failures.
    expect(mockRedis.multi).toHaveBeenCalledTimes(4);
    expect(mockRedis.expire).toHaveBeenCalledTimes(4);
    for (const call of mockRedis.expire.mock.calls) {
      expect(call).toEqual([expect.any(String), LOGIN_WINDOW_SECONDS, 'NX']);
    }
  });

  it('propagates a failed command inside the increment transaction instead of swallowing it', async () => {
    mockRedis.expire.mockRejectedValueOnce(new Error('expire failed'));
    await expect(registerFailedLogin('admin', '203.0.113.1')).rejects.toThrow('expire failed');
  });
});
