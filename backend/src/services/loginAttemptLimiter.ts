import { getRedisClient } from '../config/redis';

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_USER_AND_IP = 5;
export const MAX_FAILURES_PER_IP = 20;

const PREFIX = 'auth:local:failures:';
// Usernames come from user input; encoding keeps the key free of separators.
const userAndIpKey = (username: string, ip: string): string =>
  `${PREFIX}user-ip:${Buffer.from(username).toString('base64url')}:${ip}`;
const ipKey = (ip: string): string => `${PREFIX}ip:${ip}`;

const countOf = async (key: string): Promise<number> => Number((await getRedisClient().get(key)) ?? 0);

// INCR and EXPIRE run in one MULTI so a key can never exist without its TTL.
// EXPIRE ... NX sets the window only when none exists, so a running window is never extended.
const increment = async (key: string): Promise<void> => {
  const results = await getRedisClient().multi().incr(key).expire(key, LOGIN_WINDOW_SECONDS, 'NX').exec();
  if (!results) throw new Error('Login attempt counter transaction was aborted');
  const failed = results.find(([error]) => error !== null);
  if (failed?.[0]) throw failed[0];
};

export const isLoginBlocked = async (username: string, ip: string): Promise<boolean> => {
  const [pairFailures, ipFailures] = await Promise.all([countOf(userAndIpKey(username, ip)), countOf(ipKey(ip))]);
  return pairFailures >= MAX_FAILURES_PER_USER_AND_IP || ipFailures >= MAX_FAILURES_PER_IP;
};

export const registerFailedLogin = async (username: string, ip: string): Promise<void> => {
  await Promise.all([increment(userAndIpKey(username, ip)), increment(ipKey(ip))]);
};

export const clearFailedLogins = async (username: string, ip: string): Promise<void> => {
  await getRedisClient().del(userAndIpKey(username, ip));
};
