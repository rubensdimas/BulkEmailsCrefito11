/**
 * Local User Repository
 * Persistence for username/password accounts
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export interface LocalUser {
  id: string;
  username: string;
  passwordHash: string;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
}

export interface LocalUserStore {
  findByUsername(username: string): Promise<LocalUser | null>;
  create(input: { username: string; passwordHash: string }): Promise<LocalUser>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  setDisabled(id: string, disabled: boolean): Promise<void>;
  recordLogin(id: string): Promise<void>;
}

interface LocalUserRow {
  id: string;
  username: string;
  password_hash: string;
  disabled_at: Date | null;
  last_login_at: Date | null;
}

const fromRow = (row: LocalUserRow): LocalUser => ({
  id: row.id,
  username: row.username,
  passwordHash: row.password_hash,
  disabledAt: row.disabled_at,
  lastLoginAt: row.last_login_at,
});

export class LocalUserRepository implements LocalUserStore {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    const row = await this.db<LocalUserRow>('local_users').where({ username }).first();
    return row ? fromRow(row) : null;
  }

  async create(input: { username: string; passwordHash: string }): Promise<LocalUser> {
    const [row] = await this.db<LocalUserRow>('local_users')
      .insert({ id: uuidv4(), username: input.username, password_hash: input.passwordHash })
      .returning('*');
    return fromRow(row as LocalUserRow);
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db('local_users').where({ id }).update({ password_hash: passwordHash });
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await this.db('local_users').where({ id }).update({ disabled_at: disabled ? this.db.fn.now() : null });
  }

  async recordLogin(id: string): Promise<void> {
    await this.db('local_users').where({ id }).update({ last_login_at: this.db.fn.now() });
  }
}

export const createLocalUserRepository = (db: Knex): LocalUserRepository => new LocalUserRepository(db);
