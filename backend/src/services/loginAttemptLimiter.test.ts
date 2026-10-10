const mockCounters = new Map<string, number>();
const mockRedis = {
  get: jest.fn(async (key: string) => (mockCounters.has(key) ? String(mockCounters.get(key)) : null)),
  incr: jest.fn(async (key: string) => {
    const value = (mockCounters.get(key) ?? 0) + 1;
    mockCounters.set(key, value);
    return value;
  }),
  expire: jest.fn(async () => 1),
  del: jest.fn(async (key: string) => (mockCounters.delete(key) ? 1 : 0)),
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

  it('blocks an IP after twenty failures across usernames', async () => {
    for (let index = 0; index < 20; index += 1) await registerFailedLogin(`user-${index}`, '203.0.113.1');
    await expect(isLoginBlocked('novo-usuario', '203.0.113.1')).resolves.toBe(true);
  });

  it('clears only the username and IP pair after a success', async () => {
    await failTimes(5, 'admin', '203.0.113.1');
    await clearFailedLogins('admin', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(false);
    await failTimes(15, 'outro', '203.0.113.1');
    await expect(isLoginBlocked('admin', '203.0.113.1')).resolves.toBe(true);
  });

  it('starts the fifteen minute window on the first failure', async () => {
    await failTimes(2, 'admin', '203.0.113.1');
    expect(mockRedis.expire).toHaveBeenCalledTimes(2);
    expect(mockRedis.expire).toHaveBeenCalledWith(expect.any(String), LOGIN_WINDOW_SECONDS);
  });
});
