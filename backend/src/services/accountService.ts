import type { User, UserStore } from '../repositories/userRepository';
import type { AuthSession } from './authSessionService';

export type AccountStore = Pick<UserStore, 'findById' | 'findByOidcSub' | 'upsertOidcUser'>;

export const resolveAccount = async (session: AuthSession, users: AccountStore): Promise<User | null> => {
  if (session.provider === 'local') {
    const account = await users.findById(session.localUserId);
    if (!account || account.provider !== 'local' || account.credentialVersion !== session.credentialVersion) return null;
    return account;
  }
  // The authentication layer verifies this issuer against the operation context first.
  if (!session.issuer) return null;
  return await users.findByOidcSub(session.issuer, session.user.sub)
    ?? users.upsertOidcUser({ issuer: session.issuer, sub: session.user.sub, name: session.user.name, email: session.user.email });
};

export interface AccountView {
  userId: string;
  sub: string;
  name?: string;
  email?: string;
  provider: 'local' | 'oidc';
  role: 'admin' | 'operator';
  mustChangePassword: boolean;
}

export const toAccountView = (session: AuthSession, account: User): AccountView => ({
  userId: account.id,
  sub: session.user.sub,
  ...(account.name || account.username ? { name: account.name ?? account.username! } : {}),
  ...(account.email ? { email: account.email } : {}),
  provider: account.provider,
  role: account.role,
  mustChangePassword: account.mustChangePassword,
});
