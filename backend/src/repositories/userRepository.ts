import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export type UserRole = 'admin' | 'operator';
export type UserProvider = 'local' | 'oidc';
export interface User {
  id: string;
  provider: UserProvider;
  role: UserRole;
  username: string | null;
  oidcSub: string | null;
  oidcIssuer: string | null;
  email: string | null;
  name: string | null;
  passwordHash: string | null;
  credentialVersion: number;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
}
export interface LocalUser extends User {
  provider: 'local';
  username: string;
  passwordHash: string;
}
export interface CreateLocalUserInput {
  username: string;
  passwordHash: string;
  role?: UserRole;
  mustChangePassword?: boolean;
}
export interface LocalUserStore {
  findByUsername(username: string): Promise<LocalUser | null>;
  create(input: CreateLocalUserInput): Promise<LocalUser>;
  updatePassword(id: string, passwordHash: string, mustChangePassword?: boolean): Promise<void>;
  changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string): Promise<boolean>;
  setDisabled(id: string, disabled: boolean): Promise<void>;
  recordLogin(id: string): Promise<void>;
}
export interface UserStore extends LocalUserStore {
  findById(id: string): Promise<User | null>;
  findByOidcSub(issuer: string, sub: string): Promise<User | null>;
  upsertOidcUser(input: { issuer: string; sub: string; email?: string; name?: string }): Promise<User>;
  list(): Promise<User[]>;
}
interface UserRow {
  id: string;
  provider: UserProvider;
  role: UserRole;
  username: string | null;
  oidc_sub: string | null;
  oidc_issuer: string | null;
  email: string | null;
  name: string | null;
  password_hash: string | null;
  credential_version: number;
  must_change_password: boolean;
  disabled_at: Date | null;
  last_login_at: Date | null;
}
const fromRow = (row: UserRow): User => ({
  id: row.id, provider: row.provider, role: row.role, username: row.username,
  oidcSub: row.oidc_sub, oidcIssuer: row.oidc_issuer, email: row.email, name: row.name,
  passwordHash: row.password_hash, credentialVersion: row.credential_version,
  mustChangePassword: row.must_change_password, disabledAt: row.disabled_at, lastLoginAt: row.last_login_at,
});

export class UserRepository implements UserStore {
  constructor(private readonly db: Knex) {}

  async findByUsername(username: string): Promise<LocalUser | null> {
    const row = await this.db<UserRow>('users').where({ provider: 'local', username }).first();
    return row ? fromRow(row) as LocalUser : null;
  }
  async findById(id: string): Promise<User | null> {
    const row = await this.db<UserRow>('users').where({ id }).first();
    return row ? fromRow(row) : null;
  }
  async findByOidcSub(issuer: string, sub: string): Promise<User | null> {
    const row = await this.db<UserRow>('users').where({ provider: 'oidc', oidc_issuer: issuer, oidc_sub: sub }).first();
    return row ? fromRow(row) : null;
  }
  async create(input: CreateLocalUserInput): Promise<LocalUser> {
    const [row] = await this.db<UserRow>('users').insert({
      id: uuidv4(), provider: 'local', role: input.role ?? 'admin', username: input.username,
      password_hash: input.passwordHash, must_change_password: input.mustChangePassword ?? false,
    }).returning('*');
    return fromRow(row) as LocalUser;
  }
  async upsertOidcUser(input: { issuer: string; sub: string; email?: string; name?: string }): Promise<User> {
    const profile = { email: input.email ?? null, name: input.name ?? null };
    const [row] = await this.db<UserRow>('users').insert({
      id: uuidv4(), provider: 'oidc', role: 'operator', oidc_issuer: input.issuer, oidc_sub: input.sub, ...profile,
    }).onConflict(['oidc_issuer', 'oidc_sub']).merge(profile).returning('*');
    return fromRow(row);
  }
  async list(): Promise<User[]> {
    return (await this.db<UserRow>('users').select('*').orderBy('created_at').orderBy('id')).map(fromRow);
  }
  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    await this.db('users').where({ id, provider: 'local' }).update({
      password_hash: passwordHash, must_change_password: mustChangePassword,
      credential_version: this.db.raw('credential_version + 1'),
    });
  }
  async changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string): Promise<boolean> {
    const updated = await this.db('users').where({
      id, provider: 'local', password_hash: expectedHash, credential_version: expectedVersion,
    }).update({ password_hash: nextHash, must_change_password: false });
    return updated === 1;
  }
  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await this.db('users').where({ id }).update({ disabled_at: disabled ? this.db.fn.now() : null });
  }
  async recordLogin(id: string): Promise<void> {
    await this.db('users').where({ id }).update({ last_login_at: this.db.fn.now() });
  }
}
export const createUserRepository = (db: Knex): UserRepository => new UserRepository(db);
