import type { LocalUser, LocalUserStore } from '../repositories/localUserRepository';

export interface LocalAuthInput {
  username: string;
  password: string;
  ip: string;
}

export type LocalAuthResult =
  | { ok: true; user: LocalUser }
  | { ok: false; reason: 'invalid_credentials' | 'blocked' };

type FailureReason = 'unknown_user' | 'wrong_password' | 'disabled';

export interface LocalAuthLogEvent {
  outcome: 'success' | 'failure' | 'blocked';
  username: string;
  ip: string;
  reason?: FailureReason | 'too_many_attempts';
}

export interface LocalAuthDependencies {
  users: Pick<LocalUserStore, 'findByUsername' | 'recordLogin'>;
  attempts: {
    isBlocked(username: string, ip: string): Promise<boolean>;
    registerFailure(username: string, ip: string): Promise<void>;
    clear(username: string, ip: string): Promise<void>;
  };
  passwords: {
    verify(password: string, stored: string): Promise<boolean>;
    verifyDummy(password: string): Promise<void>;
  };
  log?: (event: LocalAuthLogEvent) => void;
}

export const normalizeUsername = (username: string): string => username.trim().toLowerCase();

const defaultLog = (event: LocalAuthLogEvent): void => {
  const write = event.outcome === 'success' ? console.log : console.warn;
  write('[LocalAuth]', JSON.stringify(event));
};

export const createLocalAuthService = (deps: LocalAuthDependencies) => {
  const log = deps.log ?? defaultLog;

  const failureReason = async (user: LocalUser | null, password: string): Promise<FailureReason | null> => {
    if (!user) {
      await deps.passwords.verifyDummy(password);
      return 'unknown_user';
    }
    if (!(await deps.passwords.verify(password, user.passwordHash))) return 'wrong_password';
    // Checked after the password so a disabled account is indistinguishable without it.
    if (user.disabledAt) return 'disabled';
    return null;
  };

  return {
    async authenticate({ username, password, ip }: LocalAuthInput): Promise<LocalAuthResult> {
      const normalized = normalizeUsername(username);
      if (await deps.attempts.isBlocked(normalized, ip)) {
        log({ outcome: 'blocked', username: normalized, ip, reason: 'too_many_attempts' });
        return { ok: false, reason: 'blocked' };
      }

      const user = await deps.users.findByUsername(normalized);
      const reason = await failureReason(user, password);
      if (reason || !user) {
        await deps.attempts.registerFailure(normalized, ip);
        log({ outcome: 'failure', username: normalized, ip, reason: reason ?? 'unknown_user' });
        return { ok: false, reason: 'invalid_credentials' };
      }

      await deps.attempts.clear(normalized, ip);
      await deps.users.recordLogin(user.id);
      log({ outcome: 'success', username: normalized, ip });
      return { ok: true, user };
    },
  };
};
