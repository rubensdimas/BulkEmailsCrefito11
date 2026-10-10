# Configurações administrativas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir perfis (admin/operador) e uma área de Configurações só para admins, com gestão de usuários, Mailgrid e OIDC lidos do banco em vez do `.env`, e uma barra superior única no frontend.

**Architecture:** A tabela `local_users` vira `users` (locais + intranet, com `role`). O middleware de autenticação passa a carregar a conta do banco a cada requisição (perfil/situação imediatos) e ganha `requireAdmin` e `requirePasswordCurrent`. Mailgrid e OIDC são lidos da tabela `configurations` a cada uso (sem cache, logo aplicados em todas as réplicas e no worker); no start, uma importação única copia o ambiente para o banco quando ele está vazio. O `oidcService` deixa de ler variáveis de ambiente e passa a usar uma fonte de configuração injetável. No frontend, um `AppHeader` substitui os headers copiados nas páginas e `/settings` vira um layout com menu lateral.

**Tech Stack:** Express 4 + TypeScript, Knex 3 / PostgreSQL 18, ioredis, Jest 29 (ts-jest), React 18 + React Router 7 + Tailwind 3 + clsx, Playwright.

**Spec:** `docs/stories/4.2.feat-settings-admin.story.md` (ACs 1–24).

## Global Constraints

- Perfis: `'admin' | 'operator'`; origens: `'local' | 'oidc'`. Usuário local criado pelo CLI: `admin`, sem troca obrigatória; pela tela: perfil escolhido (padrão `admin`) e `must_change_password = true`.
- Nome de usuário local: `^[a-z0-9._-]{3,64}$` após `trim().toLowerCase()` (reusar `USERNAME_PATTERN` e `normalizeUsername`). Senha: política existente (`validatePasswordPolicy`, 12–128).
- Rotas novas da API: `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/password`, `GET|POST /api/config/oidc`, `POST /api/config/oidc/test`, `POST /api/auth/password`. `/api/config/*` e `/api/admin/*` exigem admin.
- Códigos de erro: `403 forbidden`, `403 password_change_required`, `409 last_active_admin`, `409 username_taken`, `404 not_found`, `400 invalid_request|invalid_username|invalid_role|invalid_password|not_local|invalid_current_password|same_password|invalid_oidc_settings|oidc_test_failed`; `auth_error` do login: `unauthorized`, `not_configured`.
- Respostas de erro de domínio: `{ success: false, error: <código>, message: <texto em português> }`.
- Rotas do frontend: `/settings` → `/settings/users`, `/settings/email`, `/settings/oidc`; troca de senha em `/account/password`.
- Textos da interface em português. Rótulos exatos: barra superior "Novo Envio", "Dashboard", "Configurações"; menu da conta "Minha senha"; menu lateral "Usuários", "E-mail", "Login intranet"; origem "Local"/"Intranet"; perfis "Administrador"/"Operador".
- Segredos (senha Mailgrid, token do webhook, client secret OIDC, hashes) nunca aparecem em respostas da API nem em logs. Campo de segredo vazio ao salvar mantém o valor atual.
- Sem cache de configurações: Mailgrid e OIDC são lidos do banco a cada uso.
- Nenhuma dependência nova (backend ou frontend).
- Commits convencionais com `[Story 4.2]`; push é exclusivo do @devops.

## Review Focus

1. **Sessão OIDC aberta antes do deploy (sem linha em `users`).** Esperado: o usuário é registrado como `operator` na primeira requisição e segue usando o sistema. Teste: "registers users of sessions opened before Story 4.2" (Task 4).
2. **Admin rebaixando ou desativando a si mesmo.** Esperado: permitido se houver outro admin ativo; recusado com 409 se for o último. Testes: "rejects demoting the last active admin" e "allows demoting an admin when another admin remains" (Task 2).
3. **Instalação nova sem Mailgrid configurado, mas com `MAILGRID_HOST` no ambiente depois da importação.** Esperado: o ambiente é ignorado; a configuração vem só do banco. Teste: "ignores Mailgrid environment variables once reading" (Task 3).
4. **Salvar OIDC com client secret vazio.** Esperado: mantém o secret atual. Teste: "keeps the stored client secret when the field is empty" (Task 6).
5. **Duas réplicas importando o ambiente ao mesmo tempo.** Esperado: só uma grava; nenhuma falha. Teste: "inserts a configuration only once" (Task 3, integração).

---

## File Structure

**Backend — criar**
- `backend/src/migrations/20261010120000_users_roles.ts` — renomeia `local_users` → `users` e adiciona colunas de perfil/origem.
- `backend/src/repositories/userRepository.ts` — substitui `localUserRepository.ts` (renomeado com `git mv`): tipos `User`, `LocalUser`, `UserStore`, erros de acesso.
- `backend/src/repositories/userRepository.integration.test.ts` — substitui o teste de integração de `local_users`.
- `backend/src/repositories/systemConfigRepository.integration.test.ts` — `insertIfAbsent`.
- `backend/src/services/accountService.ts` (+ teste) — resolve a conta da sessão e monta a visão `/me`.
- `backend/src/services/settingsAudit.ts` — log `[Settings]`.
- `backend/src/services/userAdminService.ts` (+ teste) — regras de gestão de usuários e troca da própria senha.
- `backend/src/routes/userAdminRoutes.ts` (+ teste) — `/api/admin/users`.

**Backend — modificar**
- `services/databaseService.ts`, `services/localAuthService.ts`, `services/localUserAdminService.ts`, `scripts/manageLocalAdmin.ts`, `controllers/localAuthController.ts` e testes relacionados (tipos e nomes do repositório).
- `models/SystemConfig.ts`, `repositories/systemConfigRepository.ts`, `services/configService.ts`, `queue/processors.ts`.
- `services/oidcService.ts` (+ teste), `app.ts`.
- `middlewares/authentication.ts` (+ teste), `routes/authRoutes.ts` (+ teste).
- `controllers/configController.ts` (+ teste), `routes/configRoutes.ts` (+ teste).
- `backend/package.json` (`test:integration`).

**Frontend — criar**
- `src/components/Layout/AppHeader.tsx`, `src/components/Auth/AdminRoute.tsx`, `src/pages/ChangePasswordPage.tsx`, `src/pages/settings/SettingsLayout.tsx`, `src/pages/settings/SettingsUsersPage.tsx`, `src/pages/settings/SettingsEmailPage.tsx` (conteúdo movido de `SettingsPage.tsx`, que é removido), `src/pages/settings/SettingsOidcPage.tsx`.
- `e2e/auth/navigation.spec.ts`, `e2e/auth/settings.spec.ts`.

**Frontend — modificar**
- `src/services/api.ts`, `src/components/Auth/AuthProvider.tsx`, `src/components/Auth/AccountMenu.tsx`, `src/App.tsx`, `src/pages/LoginPage.tsx`, `src/pages/HomePage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/StatusPage.tsx`, `e2e/auth/login.spec.ts`.

**Infra/docs — modificar**
- `docker-compose.prod.yml`, `docker-compose.yml`, `deploy/production.env.example`, `.env.example`, `docs/production.md`, `docs/stories/4.2.feat-settings-admin.story.md`.

**Banco de teste (integração):** quando uma task pede Postgres, use um container descartável e remova-o no fim:
```bash
docker run -d --name bulkmail-sdd-it-pg -e POSTGRES_USER=bulkmail -e POSTGRES_PASSWORD=bulkmail123 -e POSTGRES_DB=bulkmail -p 55432:5432 postgres:18.4-alpine
until docker exec bulkmail-sdd-it-pg pg_isready -U bulkmail -d bulkmail; do sleep 1; done
(cd backend && POSTGRES_PORT=55432 npm run migrate)
# ... RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest <arquivo>
docker rm -f bulkmail-sdd-it-pg
```

---

### Task 1: Tabela `users` e repositório (AC 1, 12)

**Files:**
- Create: `backend/src/migrations/20261010120000_users_roles.ts`
- Rename+rewrite: `backend/src/repositories/localUserRepository.ts` → `backend/src/repositories/userRepository.ts`
- Rename+rewrite: `backend/src/repositories/localUserRepository.integration.test.ts` → `backend/src/repositories/userRepository.integration.test.ts`
- Modify: `backend/src/services/databaseService.ts`, `backend/src/services/localAuthService.ts`, `backend/src/services/localUserAdminService.ts`, `backend/src/scripts/manageLocalAdmin.ts`, `backend/src/routes/authRoutes.ts`, `backend/package.json`
- Modify tests: `backend/src/services/localAuthService.test.ts`, `backend/src/services/localUserAdminService.test.ts`, `backend/src/controllers/localAuthController.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UserRole = 'admin' | 'operator';
  export type UserProvider = 'local' | 'oidc';
  export interface User {
    id: string; provider: UserProvider; role: UserRole;
    username: string | null; oidcSub: string | null; email: string | null; name: string | null;
    passwordHash: string | null; mustChangePassword: boolean;
    disabledAt: Date | null; lastLoginAt: Date | null;
  }
  export interface LocalUser extends User { provider: 'local'; username: string; passwordHash: string }
  export interface LocalUserStore {
    findByUsername(username: string): Promise<LocalUser | null>;
    create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }): Promise<LocalUser>;
    updatePassword(id: string, passwordHash: string, mustChangePassword?: boolean): Promise<void>;
    setDisabled(id: string, disabled: boolean): Promise<void>;
    recordLogin(id: string): Promise<void>;
  }
  export interface UserStore extends LocalUserStore {
    findById(id: string): Promise<User | null>;
    findByOidcSub(sub: string): Promise<User | null>;
    upsertOidcUser(input: { sub: string; email?: string; name?: string }): Promise<User>;
    list(): Promise<User[]>;
  }
  export class UserRepository implements UserStore
  export const createUserRepository: (db: Knex) => UserRepository
  // databaseService.ts (substitui getLocalUserRepository)
  export const getUserRepository: () => UserRepository
  ```
  - `create` sem `role` grava `admin`; sem `mustChangePassword` grava `false`. `updatePassword` sem o terceiro argumento grava `must_change_password = false`.
  - `upsertOidcUser` cria com `role = 'operator'` ou atualiza só `email`/`name` de quem já existe.

- [ ] **Step 1: Rename files and write the failing integration test**

```bash
git mv backend/src/repositories/localUserRepository.ts backend/src/repositories/userRepository.ts
git mv backend/src/repositories/localUserRepository.integration.test.ts backend/src/repositories/userRepository.integration.test.ts
```

Substituir todo o conteúdo do teste:

```ts
// backend/src/repositories/userRepository.integration.test.ts
import knex, { Knex } from 'knex';
import { UserRepository } from './userRepository';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('UserRepository PostgreSQL integration', () => {
  let database: Knex;
  let repository: UserRepository;
  const suffix = Date.now();
  const username = `it-${suffix}`;
  const sub = `oidc-it-${suffix}`;

  beforeAll(async () => {
    database = knex({
      client: 'pg',
      connection: {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER || 'bulkmail',
        password: process.env.POSTGRES_PASSWORD || 'bulkmail123',
        database: process.env.POSTGRES_DB || 'bulkmail',
      },
      pool: { min: 0, max: 4 },
    });
    repository = new UserRepository(database);
  });

  afterAll(async () => {
    await database('users').where({ username }).orWhere({ oidc_sub: sub }).delete();
    await database.destroy();
  });

  it('creates local admins by default and finds them by username and id', async () => {
    const created = await repository.create({ username, passwordHash: 'hash-1' });
    expect(created).toMatchObject({
      provider: 'local', role: 'admin', username, passwordHash: 'hash-1', mustChangePassword: false, oidcSub: null,
    });
    await expect(repository.findByUsername(username)).resolves.toMatchObject({ id: created.id });
    await expect(repository.findById(created.id)).resolves.toMatchObject({ username });
  });

  it('stores password changes with the must-change flag', async () => {
    const user = await repository.findByUsername(username);
    await repository.updatePassword(user!.id, 'hash-2', true);
    await expect(repository.findById(user!.id)).resolves.toMatchObject({ passwordHash: 'hash-2', mustChangePassword: true });
    await repository.updatePassword(user!.id, 'hash-3');
    await expect(repository.findById(user!.id)).resolves.toMatchObject({ passwordHash: 'hash-3', mustChangePassword: false });
  });

  it('registers intranet users as operators and refreshes their name and e-mail', async () => {
    const first = await repository.upsertOidcUser({ sub, email: 'old@crefito.gov.br', name: 'Nome Antigo' });
    expect(first).toMatchObject({ provider: 'oidc', role: 'operator', oidcSub: sub, username: null, passwordHash: null });

    const second = await repository.upsertOidcUser({ sub, email: 'new@crefito.gov.br', name: 'Nome Novo' });
    expect(second).toMatchObject({ id: first.id, email: 'new@crefito.gov.br', name: 'Nome Novo', role: 'operator' });
    await expect(repository.findByOidcSub(sub)).resolves.toMatchObject({ id: first.id });
  });

  it('does not find intranet users by username', async () => {
    await expect(repository.findByUsername(sub)).resolves.toBeNull();
  });

  it('lists local and intranet users', async () => {
    const all = await repository.list();
    expect(all.map((user) => user.username ?? user.oidcSub)).toEqual(expect.arrayContaining([username, sub]));
  });

  it('rejects an intranet user without oidc_sub at the database level', async () => {
    await expect(database('users').insert({ id: '00000000-0000-0000-0000-000000000001', provider: 'oidc', role: 'operator' }))
      .rejects.toThrow(/users_identity_check/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Com o Postgres descartável (seção "Banco de teste" acima, sem rodar a migration nova ainda):
Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: FAIL — `UserRepository` não exportado / tabela `users` inexistente.

- [ ] **Step 3: Write the migration**

```ts
// backend/src/migrations/20261010120000_users_roles.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable("local_users", "users");
  await knex.raw("ALTER TABLE users RENAME CONSTRAINT local_users_username_lowercase TO users_username_lowercase");
  await knex.raw("ALTER TRIGGER update_local_users_updated_at ON users RENAME TO update_users_updated_at");

  await knex.schema.alterTable("users", (table) => {
    table.string("provider", 16).notNullable().defaultTo("local");
    // Existing rows were created by the admin CLI, so they become admins.
    table.string("role", 16).notNullable().defaultTo("admin");
    table.text("oidc_sub").nullable().unique();
    table.text("email").nullable();
    table.text("name").nullable();
    table.boolean("must_change_password").notNullable().defaultTo(false);
  });

  await knex.raw("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'operator'");
  await knex.raw("ALTER TABLE users ALTER COLUMN username DROP NOT NULL");
  await knex.raw("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL");
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_provider_check CHECK (provider IN ('local', 'oidc'))");
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator'))");
  await knex.raw(`
    ALTER TABLE users ADD CONSTRAINT users_identity_check CHECK (
      (provider = 'local' AND username IS NOT NULL AND password_hash IS NOT NULL AND oidc_sub IS NULL)
      OR (provider = 'oidc' AND oidc_sub IS NOT NULL AND username IS NULL AND password_hash IS NULL)
    )
  `);
  await knex.raw("COMMENT ON TABLE users IS 'Local and intranet (OIDC) accounts with roles'");
}

export async function down(knex: Knex): Promise<void> {
  await knex("users").where({ provider: "oidc" }).delete();
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_identity_check");
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_role_check");
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_provider_check");
  await knex.raw("ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL");
  await knex.raw("ALTER TABLE users ALTER COLUMN username SET NOT NULL");
  await knex.schema.alterTable("users", (table) => {
    table.dropColumns("provider", "role", "oidc_sub", "email", "name", "must_change_password");
  });
  await knex.raw("ALTER TRIGGER update_users_updated_at ON users RENAME TO update_local_users_updated_at");
  await knex.raw("ALTER TABLE users RENAME CONSTRAINT users_username_lowercase TO local_users_username_lowercase");
  await knex.schema.renameTable("users", "local_users");
}
```

- [ ] **Step 4: Rewrite the repository**

```ts
// backend/src/repositories/userRepository.ts
/**
 * User Repository
 * Persistence for local and intranet (OIDC) accounts
 */
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
  email: string | null;
  name: string | null;
  passwordHash: string | null;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
}

export interface LocalUser extends User {
  provider: 'local';
  username: string;
  passwordHash: string;
}

export interface LocalUserStore {
  findByUsername(username: string): Promise<LocalUser | null>;
  create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }): Promise<LocalUser>;
  updatePassword(id: string, passwordHash: string, mustChangePassword?: boolean): Promise<void>;
  setDisabled(id: string, disabled: boolean): Promise<void>;
  recordLogin(id: string): Promise<void>;
}

export interface UserStore extends LocalUserStore {
  findById(id: string): Promise<User | null>;
  findByOidcSub(sub: string): Promise<User | null>;
  upsertOidcUser(input: { sub: string; email?: string; name?: string }): Promise<User>;
  list(): Promise<User[]>;
}

interface UserRow {
  id: string;
  provider: UserProvider;
  role: UserRole;
  username: string | null;
  oidc_sub: string | null;
  email: string | null;
  name: string | null;
  password_hash: string | null;
  must_change_password: boolean;
  disabled_at: Date | null;
  last_login_at: Date | null;
}

const fromRow = (row: UserRow): User => ({
  id: row.id,
  provider: row.provider,
  role: row.role,
  username: row.username,
  oidcSub: row.oidc_sub,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  mustChangePassword: row.must_change_password,
  disabledAt: row.disabled_at,
  lastLoginAt: row.last_login_at,
});

export class UserRepository implements UserStore {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db<UserRow>('users').where({ id }).first();
    return row ? fromRow(row) : null;
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    const row = await this.db<UserRow>('users').where({ username, provider: 'local' }).first();
    return row ? (fromRow(row) as LocalUser) : null;
  }

  async findByOidcSub(sub: string): Promise<User | null> {
    const row = await this.db<UserRow>('users').where({ oidc_sub: sub }).first();
    return row ? fromRow(row) : null;
  }

  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }): Promise<LocalUser> {
    const [row] = await this.db<UserRow>('users')
      .insert({
        id: uuidv4(),
        provider: 'local',
        role: input.role ?? 'admin',
        username: input.username,
        password_hash: input.passwordHash,
        must_change_password: input.mustChangePassword ?? false,
      })
      .returning('*');
    return fromRow(row as UserRow) as LocalUser;
  }

  async upsertOidcUser(input: { sub: string; email?: string; name?: string }): Promise<User> {
    const [row] = await this.db<UserRow>('users')
      .insert({
        id: uuidv4(),
        provider: 'oidc',
        role: 'operator',
        oidc_sub: input.sub,
        email: input.email ?? null,
        name: input.name ?? null,
      })
      .onConflict('oidc_sub')
      .merge({ email: input.email ?? null, name: input.name ?? null })
      .returning('*');
    return fromRow(row as UserRow);
  }

  async list(): Promise<User[]> {
    const rows = await this.db<UserRow>('users').select('*').orderByRaw('coalesce(name, username, oidc_sub)');
    return rows.map((row) => fromRow(row as UserRow));
  }

  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    await this.db('users').where({ id }).update({ password_hash: passwordHash, must_change_password: mustChangePassword });
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await this.db('users').where({ id }).update({ disabled_at: disabled ? this.db.fn.now() : null });
  }

  async recordLogin(id: string): Promise<void> {
    await this.db('users').where({ id }).update({ last_login_at: this.db.fn.now() });
  }
}

export const createUserRepository = (db: Knex): UserRepository => new UserRepository(db);
```

- [ ] **Step 5: Update consumers**

`backend/src/services/databaseService.ts`: trocar o import de `localUserRepository` por

```ts
import {
  UserRepository,
  createUserRepository,
} from "../repositories/userRepository";
```

renomear o singleton `localUserRepository` para `userRepository` (tipo `UserRepository | null`, criado com `createUserRepository(db)` e zerado no shutdown) e o getter para:

```ts
/**
 * Get UserRepository instance
 */
export const getUserRepository = (): UserRepository => {
  if (!userRepository) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return userRepository;
};
```

`backend/src/routes/authRoutes.ts`: `import { getUserRepository } from '../services/databaseService';` e `users: getUserRepository(),` no lugar de `getLocalUserRepository()`.

`backend/src/services/localAuthService.ts` e `backend/src/services/localUserAdminService.ts`: trocar `'../repositories/localUserRepository'` por `'../repositories/userRepository'`.

`backend/src/services/localUserAdminService.ts` — o CLI cria admins sem troca obrigatória e o reset pelo CLI limpa a obrigação:

```ts
      return deps.users.create({
        username: normalized,
        passwordHash: await deps.hash(password),
        role: 'admin',
        mustChangePassword: false,
      });
```

```ts
      await deps.users.updatePassword(user.id, await deps.hash(password), false);
```

`backend/src/scripts/manageLocalAdmin.ts`: `import { createUserRepository } from '../repositories/userRepository';` e `users: createUserRepository(db),`.

`backend/package.json`, script `test:integration`: trocar `src/repositories/localUserRepository.integration.test.ts` por `src/repositories/userRepository.integration.test.ts`.

- [ ] **Step 6: Update unit-test fixtures to the new `LocalUser` shape**

Em `localAuthService.test.ts` (`activeAdmin`) e `localAuthController.test.ts` (`admin`), completar os objetos com:

```ts
  provider: 'local' as const,
  role: 'admin' as const,
  oidcSub: null,
  email: null,
  name: null,
  mustChangePassword: false,
```

Em `localUserAdminService.test.ts`, a classe `InMemoryLocalUsers` passa a criar:

```ts
  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }): Promise<LocalUser> {
    const user: LocalUser = {
      id: `id-${this.users.size + 1}`,
      provider: 'local',
      role: input.role ?? 'admin',
      username: input.username,
      passwordHash: input.passwordHash,
      oidcSub: null,
      email: null,
      name: null,
      mustChangePassword: input.mustChangePassword ?? false,
      disabledAt: null,
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    const user = this.byId(id);
    user.passwordHash = passwordHash;
    user.mustChangePassword = mustChangePassword;
  }
```

(importando `LocalUser`, `LocalUserStore`, `UserRole` de `'../repositories/userRepository'`), e acrescentar ao teste "creates a user with a normalized username and hashed password":

```ts
    expect(created).toMatchObject({ role: 'admin', mustChangePassword: false });
```

- [ ] **Step 7: Migrate and run tests**

Run: `cd backend && POSTGRES_PORT=55432 npm run migrate && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: migration `20261010120000_users_roles` aplicada; 6 testes PASS.
Run: `cd backend && POSTGRES_PORT=55432 npx knex migrate:rollback && POSTGRES_PORT=55432 npm run migrate`
Expected: rollback e reaplicação sem erro (o `down` funciona).
Run: `cd backend && npx tsc --noEmit && npx jest && npx eslint src/repositories src/services src/scripts src/routes src/migrations`
Expected: sem erros; suíte unitária verde.

- [ ] **Step 8: Commit**

```bash
git add -A backend/src/repositories backend/src/migrations/20261010120000_users_roles.ts backend/src/services backend/src/scripts/manageLocalAdmin.ts backend/src/routes/authRoutes.ts backend/src/controllers/localAuthController.test.ts backend/package.json
git commit -m "feat: unify local and intranet accounts in users table with roles [Story 4.2]"
```

---

### Task 2: Alteração de perfil/situação protegida (AC 6)

**Files:**
- Modify: `backend/src/repositories/userRepository.ts`
- Test: `backend/src/repositories/userRepository.integration.test.ts`

**Interfaces:**
- Consumes: `UserRepository`, `User`, `UserRole` (Task 1).
- Produces:
  ```ts
  export class LastActiveAdminError extends Error {}
  export class UserNotFoundError extends Error {}
  // added to UserStore and UserRepository:
  updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<User>;
  ```
  - Em transação: trava as linhas de admins ativos (`FOR UPDATE`), aplica a mudança e, se não restar nenhum admin ativo, lança `LastActiveAdminError` (rollback). Id inexistente → `UserNotFoundError`. `change` vazio → devolve o usuário sem alterar.

- [ ] **Step 1: Write the failing tests**

Acrescentar ao `describeDatabase` de `userRepository.integration.test.ts` (importar `LastActiveAdminError`, `UserNotFoundError`):

```ts
  // Each case runs inside a transaction that is rolled back, so existing admins in the
  // database never interfere and nothing is left behind.
  const inRolledBackTransaction = async (work: (repo: UserRepository, trx: Knex.Transaction) => Promise<void>) => {
    await database.transaction(async (trx) => {
      await trx('users').delete();
      await work(new UserRepository(trx), trx);
      throw new Error('rollback');
    }).catch((error: Error) => {
      if (error.message !== 'rollback') throw error;
    });
  };

  it('rejects demoting the last active admin', async () => {
    await inRolledBackTransaction(async (repo) => {
      const admin = await repo.create({ username: 'only-admin', passwordHash: 'h' });
      await expect(repo.updateAccess(admin.id, { role: 'operator' })).rejects.toBeInstanceOf(LastActiveAdminError);
      await expect(repo.findById(admin.id)).resolves.toMatchObject({ role: 'admin' });
    });
  });

  it('rejects disabling the last active admin', async () => {
    await inRolledBackTransaction(async (repo) => {
      const admin = await repo.create({ username: 'only-admin', passwordHash: 'h' });
      await repo.create({ username: 'disabled-admin', passwordHash: 'h' }).then((other) => repo.setDisabled(other.id, true));
      await expect(repo.updateAccess(admin.id, { disabled: true })).rejects.toBeInstanceOf(LastActiveAdminError);
      await expect(repo.findById(admin.id)).resolves.toMatchObject({ disabledAt: null });
    });
  });

  it('allows demoting an admin when another admin remains', async () => {
    await inRolledBackTransaction(async (repo) => {
      const first = await repo.create({ username: 'first-admin', passwordHash: 'h' });
      await repo.create({ username: 'second-admin', passwordHash: 'h' });
      await expect(repo.updateAccess(first.id, { role: 'operator' })).resolves.toMatchObject({ role: 'operator' });
    });
  });

  it('disables and re-enables operators freely', async () => {
    await inRolledBackTransaction(async (repo) => {
      await repo.create({ username: 'the-admin', passwordHash: 'h' });
      const operator = await repo.create({ username: 'operator-1', passwordHash: 'h', role: 'operator' });
      const disabled = await repo.updateAccess(operator.id, { disabled: true });
      expect(disabled.disabledAt).toBeInstanceOf(Date);
      await expect(repo.updateAccess(operator.id, { disabled: false })).resolves.toMatchObject({ disabledAt: null });
    });
  });

  it('reports unknown ids', async () => {
    await inRolledBackTransaction(async (repo) => {
      await expect(repo.updateAccess('00000000-0000-0000-0000-000000000000', { role: 'admin' }))
        .rejects.toBeInstanceOf(UserNotFoundError);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: FAIL — `updateAccess` / `LastActiveAdminError` não existem.

- [ ] **Step 3: Implement**

Em `userRepository.ts`, após os tipos:

```ts
export class LastActiveAdminError extends Error {
  constructor() {
    super('At least one active admin must remain');
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
  }
}
```

Acrescentar ao `UserStore`:

```ts
  updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<User>;
```

E ao `UserRepository`:

```ts
  async updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<User> {
    return this.db.transaction(async (trx) => {
      // Locking every active admin serializes concurrent changes, so two admins
      // cannot demote or disable each other at the same time.
      await trx.raw("SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE");

      const patch: Record<string, unknown> = {};
      if (change.role !== undefined) patch.role = change.role;
      if (change.disabled !== undefined) patch.disabled_at = change.disabled ? trx.fn.now() : null;

      const [row] = Object.keys(patch).length > 0
        ? await trx<UserRow>('users').where({ id }).update(patch).returning('*')
        : await trx<UserRow>('users').where({ id }).select('*');
      if (!row) throw new UserNotFoundError();

      const [{ count }] = await trx('users').where({ role: 'admin' }).whereNull('disabled_at').count({ count: '*' });
      if (Number(count) === 0) throw new LastActiveAdminError();
      return fromRow(row as UserRow);
    });
  }
```

Se o `tsc` reclamar do tipo de `count`, use `.count<{ count: string }[]>({ count: '*' })`.

- [ ] **Step 4: Run tests**

Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts && npx tsc --noEmit && npx eslint src/repositories`
Expected: 11 testes PASS; sem erros.
`localUserAdminService.test.ts` usa `LocalUserStore` (sem `updateAccess`), então continua compilando; confirme com `npx jest`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/userRepository.ts backend/src/repositories/userRepository.integration.test.ts
git commit -m "feat: guard role and status changes so an active admin always remains [Story 4.2]"
```

---

### Task 3: Configurações do Mailgrid e OIDC no banco (AC 13, 19)

**Files:**
- Modify: `backend/src/models/SystemConfig.ts`, `backend/src/repositories/systemConfigRepository.ts`, `backend/src/services/configService.ts`, `backend/src/queue/processors.ts`, `backend/src/app.ts`
- Test: `backend/src/services/configService.test.ts`, `backend/src/repositories/systemConfigRepository.integration.test.ts` (novo), `backend/package.json` (`test:integration`)

**Interfaces:**
- Produces:
  ```ts
  // models/SystemConfig.ts
  export interface OidcSettings { enabled: boolean; issuer: string; clientId: string; clientSecret: string; backchannelOrigin: string }
  // SystemConfigRepository
  insertIfAbsent(key: string, value: ConfigValue): Promise<boolean>;
  // ConfigService
  getMailgridConfig(): Promise<MailgridConfig>;          // só banco; vazio se não configurado
  getOidcSettings(): Promise<OidcSettings | null>;       // clientSecret descriptografado
  updateOidcSettings(settings: OidcSettings): Promise<void>; // clientSecret criptografado
  importFromEnvironment(env?: NodeJS.ProcessEnv): Promise<{ mailgrid: boolean; oidc: boolean }>;
  ```
  - Chaves na tabela `configurations`: `smtp` (existente) e `oidc`.

- [ ] **Step 1: Write the failing unit tests**

Em `backend/src/services/configService.test.ts`, substituir os testes que esperavam fallback para o ambiente (qualquer `it` que configure `process.env.MAILGRID_*` / `SMTP_*` esperando esses valores) por estes, e acrescentar os demais dentro do `describe('ConfigService')`:

```ts
  describe('without stored Mailgrid configuration', () => {
    const originalEnv = process.env;
    afterEach(() => { process.env = originalEnv; });

    it('ignores Mailgrid environment variables once reading', async () => {
      process.env = { ...originalEnv, MAILGRID_HOST: 'env.host', MAILGRID_USER: 'env-user', MAILGRID_PASS: 'env-pass' };
      mockRepository.getByKey.mockResolvedValue(null);
      await expect(configService.getMailgridConfig()).resolves.toEqual({
        host: '', user: '', pass: '', from_address: '', from_name: 'BulkMail Pro', webhook_token: '',
      });
    });
  });

  describe('OIDC settings', () => {
    it('returns null when nothing is stored', async () => {
      mockRepository.getByKey.mockResolvedValue(null);
      await expect(configService.getOidcSettings()).resolves.toBeNull();
    });

    it('stores and returns the client secret', async () => {
      const settings = {
        enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: 'secret', backchannelOrigin: '',
      };
      await configService.updateOidcSettings(settings);
      const stored = mockRepository.set.mock.calls[0][0];
      expect(stored.key).toBe('oidc');
      mockRepository.getByKey.mockResolvedValue({ id: 2, key: 'oidc', value: stored.value, created_at: new Date(), updated_at: new Date() });
      await expect(configService.getOidcSettings()).resolves.toEqual(settings);
    });
  });

  describe('importFromEnvironment', () => {
    it('copies Mailgrid and OIDC settings when the database has none', async () => {
      mockRepository.insertIfAbsent.mockResolvedValue(true);
      const result = await configService.importFromEnvironment({
        MAILGRID_HOST: 'smtp.mailgrid.net.br', MAILGRID_USER: 'user', MAILGRID_PASS: 'pass',
        MAILGRID_SENDER: 'no-reply@crefito11.gov.br', MAILGRID_SENDER_NAME: 'CREFITO11', MAILGRID_WEBHOOK_TOKEN: 'hook',
        OIDC_ISSUER: 'https://intranet.example/', OIDC_CLIENT_ID: 'client', OIDC_CLIENT_SECRET: 'secret',
      });
      expect(result).toEqual({ mailgrid: true, oidc: true });
      expect(mockRepository.insertIfAbsent).toHaveBeenCalledWith('smtp', expect.objectContaining({
        host: 'smtp.mailgrid.net.br', user: 'user', from_address: 'no-reply@crefito11.gov.br', from_name: 'CREFITO11',
      }));
      expect(mockRepository.insertIfAbsent).toHaveBeenCalledWith('oidc', expect.objectContaining({
        enabled: true, issuer: 'https://intranet.example', clientId: 'client', backchannelOrigin: '',
      }));
    });

    it('skips sections without environment values', async () => {
      await expect(configService.importFromEnvironment({})).resolves.toEqual({ mailgrid: false, oidc: false });
      expect(mockRepository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('reports nothing imported when the database already has the settings', async () => {
      mockRepository.insertIfAbsent.mockResolvedValue(false);
      await expect(configService.importFromEnvironment({ MAILGRID_HOST: 'h', OIDC_ISSUER: 'https://i', OIDC_CLIENT_ID: 'c' }))
        .resolves.toEqual({ mailgrid: false, oidc: false });
    });
  });
```

(O `jest.mock` automático do repositório já cria `insertIfAbsent` como `jest.fn()` assim que o método existir na classe.)

- [ ] **Step 2: Write the failing integration test**

```ts
// backend/src/repositories/systemConfigRepository.integration.test.ts
import knex, { Knex } from 'knex';
import { SystemConfigRepository } from './systemConfigRepository';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('SystemConfigRepository PostgreSQL integration', () => {
  let database: Knex;
  const key = `it-config-${Date.now()}`;

  beforeAll(() => {
    database = knex({
      client: 'pg',
      connection: {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER || 'bulkmail',
        password: process.env.POSTGRES_PASSWORD || 'bulkmail123',
        database: process.env.POSTGRES_DB || 'bulkmail',
      },
      pool: { min: 0, max: 4 },
    });
  });

  afterAll(async () => {
    await database('configurations').where({ key }).delete();
    await database.destroy();
  });

  it('inserts a configuration only once', async () => {
    const repository = new SystemConfigRepository(database);
    const results = await Promise.all([
      repository.insertIfAbsent(key, { source: 'first' }),
      repository.insertIfAbsent(key, { source: 'second' }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await repository.getByKey(key);
    expect(['first', 'second']).toContain((stored?.value as { source: string }).source);
    await expect(repository.insertIfAbsent(key, { source: 'third' })).resolves.toBe(false);
  });
});
```

Acrescentar `src/repositories/systemConfigRepository.integration.test.ts` à lista do script `test:integration` em `backend/package.json`.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && npx jest src/services/configService.test.ts`
Expected: FAIL — `getOidcSettings`/`importFromEnvironment` inexistentes; o teste de ambiente recebe os valores do `.env`.
Run (Postgres descartável): `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/systemConfigRepository.integration.test.ts`
Expected: FAIL — `insertIfAbsent is not a function`.

- [ ] **Step 4: Implement the model and repository**

Em `backend/src/models/SystemConfig.ts`, após `MailgridConfig`:

```ts
/**
 * Intranet (OIDC) login configuration
 */
export interface OidcSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  backchannelOrigin: string;
}
```

e `export type ConfigValue = MailgridConfig | OidcSettings | Record<string, unknown>;`.

Em `systemConfigRepository.ts`, novo método na classe:

```ts
  /**
   * Insert a configuration only when the key does not exist yet.
   * Safe when several replicas start at the same time.
   */
  async insertIfAbsent(key: string, value: ConfigValue): Promise<boolean> {
    const rows = await this.db(this.tableName)
      .insert({ key, value: JSON.stringify(value), created_at: new Date(), updated_at: new Date() })
      .onConflict('key')
      .ignore()
      .returning('id');
    return rows.length > 0;
  }
```

(importar `ConfigValue` de `'../models/SystemConfig'`).

- [ ] **Step 5: Implement `ConfigService`**

Substituir `getMailgridConfig` e acrescentar os novos métodos:

```ts
import { readFileSync } from 'fs';
import { MailgridConfig, OidcSettings } from '../models/SystemConfig';

const EMPTY_MAILGRID: MailgridConfig = {
  host: '',
  user: '',
  pass: '',
  from_address: '',
  from_name: 'BulkMail Pro',
  webhook_token: '',
};

const trimSlash = (value: string | undefined): string => (value || '').trim().replace(/\/$/, '');

// Reads NAME or the Docker secret file referenced by NAME_FILE.
const environmentSecret = (env: NodeJS.ProcessEnv, name: string): string => {
  if (env[name]) return String(env[name]).trim();
  const file = env[`${name}_FILE`];
  if (!file) return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};
```

```ts
  /**
   * Get Mailgrid configuration from the database (empty when not configured)
   */
  async getMailgridConfig(): Promise<MailgridConfig> {
    const dbConfig = await this.repository.getByKey('smtp');
    if (!dbConfig?.value) return { ...EMPTY_MAILGRID };

    const smtp = dbConfig.value as MailgridConfig;
    return {
      host: smtp.host || '',
      user: smtp.user || '',
      pass: decryptSecret(smtp.pass || ''),
      from_address: smtp.from_address || '',
      from_name: smtp.from_name || 'BulkMail Pro',
      webhook_token: decryptSecret(smtp.webhook_token || ''),
    };
  }

  /**
   * Get intranet (OIDC) login configuration from the database
   */
  async getOidcSettings(): Promise<OidcSettings | null> {
    const stored = await this.getConfig<Partial<OidcSettings>>('oidc');
    if (!stored) return null;
    return {
      enabled: stored.enabled === true,
      issuer: stored.issuer || '',
      clientId: stored.clientId || '',
      clientSecret: decryptSecret(stored.clientSecret || ''),
      backchannelOrigin: stored.backchannelOrigin || '',
    };
  }

  /**
   * Store intranet (OIDC) login configuration
   */
  async updateOidcSettings(settings: OidcSettings): Promise<void> {
    await this.repository.set({
      key: 'oidc',
      value: { ...settings, clientSecret: encryptSecret(settings.clientSecret) },
    });
  }

  /**
   * One-time import of the legacy environment configuration.
   * Each section is written only when the database does not have it yet.
   */
  async importFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<{ mailgrid: boolean; oidc: boolean }> {
    let mailgrid = false;
    let oidc = false;

    const host = env.MAILGRID_HOST || env.SMTP_HOST;
    if (host) {
      const user = env.MAILGRID_USER || env.SMTP_USER || '';
      mailgrid = await this.repository.insertIfAbsent('smtp', {
        host,
        user,
        pass: encryptSecret(environmentSecret(env, 'MAILGRID_PASS') || env.SMTP_PASS || ''),
        from_address: env.MAILGRID_SENDER || env.SMTP_SENDER || user,
        from_name: env.MAILGRID_SENDER_NAME || env.SMTP_SENDER_NAME || 'BulkMail Pro',
        webhook_token: encryptSecret(environmentSecret(env, 'MAILGRID_WEBHOOK_TOKEN')),
      });
    }

    if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID) {
      oidc = await this.repository.insertIfAbsent('oidc', {
        enabled: true,
        issuer: trimSlash(env.OIDC_ISSUER),
        clientId: env.OIDC_CLIENT_ID.trim(),
        clientSecret: encryptSecret(environmentSecret(env, 'OIDC_CLIENT_SECRET')),
        backchannelOrigin: trimSlash(env.OIDC_BACKCHANNEL_ORIGIN),
      });
    }

    return { mailgrid, oidc };
  }
```

Remover o bloco `try/catch` com fallback para `process.env` do `getMailgridConfig` antigo.

- [ ] **Step 6: Remove the environment fallback from the worker**

Em `backend/src/queue/processors.ts`, substituir o bloco que monta `config` por:

```ts
    if (!isDatabaseReady()) throw new Error("Database not available");
    const config = await getConfigService().getMailgridConfig();
    if (!config.host) throw new Error("Mailgrid não configurado");
```

- [ ] **Step 7: Import on backend start**

Em `backend/src/app.ts`, dentro de `startServer`, logo após `await initializeDatabase();` (no mesmo `try`):

```ts
    const { getConfigService } = await import('./services/databaseService');
    const imported = await getConfigService().importFromEnvironment();
    if (imported.mailgrid || imported.oidc) {
      console.log('[Settings]', JSON.stringify({ actor: 'system', action: 'settings.import_environment', fields: Object.keys(imported).filter((key) => imported[key as keyof typeof imported]) }));
    }
```

(Ajuste o import dinâmico existente para trazer `initializeDatabase` e `getConfigService` juntos.)

- [ ] **Step 8: Run tests**

Run: `cd backend && npx jest src/services/configService.test.ts src/queue src/controllers/webhookController.test.ts src/controllers/configController.test.ts && npx tsc --noEmit && npx eslint src/services/configService.ts src/repositories/systemConfigRepository.ts src/models/SystemConfig.ts src/queue/processors.ts src/app.ts`
Expected: PASS. Se algum teste de `processors` dependia do fallback para o ambiente, ajuste-o para mockar `isDatabaseReady`/`getConfigService` e registre no relatório.
Run (Postgres descartável): `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/systemConfigRepository.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/models/SystemConfig.ts backend/src/repositories/systemConfigRepository.ts backend/src/repositories/systemConfigRepository.integration.test.ts backend/src/services/configService.ts backend/src/services/configService.test.ts backend/src/queue/processors.ts backend/src/app.ts backend/package.json
git commit -m "feat: read Mailgrid and OIDC settings from the database with one-time env import [Story 4.2]"
```

---

### Task 4: OIDC configurado pelo banco (AC 17, 18)

**Files:**
- Modify: `backend/src/services/oidcService.ts`, `backend/src/services/oidcService.test.ts`, `backend/src/app.ts`, `backend/src/controllers/localAuthController.ts` (+ teste), `backend/src/routes/authRoutes.ts` (+ teste)

**Interfaces:**
- Consumes: `OidcSettings`, `ConfigService.getOidcSettings()` via `getConfigService()` (Task 3).
- Produces:
  ```ts
  export type OidcSettingsSource = () => Promise<OidcSettings | null>;
  export const setOidcSettingsSource: (source: OidcSettingsSource) => void; // also clears metadata cache
  export const validateOidcSettings: (settings: OidcSettings, appOrigin?: string) => OidcConfiguration; // throws OidcError('configuration_error') with Portuguese message
  export const isOidcEnabled: () => Promise<boolean>;
  export const probeOidcProvider: (settings: OidcSettings) => Promise<void>; // validates + discovery + JWKS, no cache
  export const assertSessionEncryptionKey: () => void; // replaces assertOidcConfiguration
  // OidcError code 'not_configured' when settings are absent or disabled
  // localAuthController deps gain: oidcEnabled: () => Promise<boolean>; options becomes async
  // GET /api/auth/options → { success: true, data: { localLoginEnabled: boolean, oidcEnabled: boolean } }
  ```

- [ ] **Step 1: Write the failing tests**

Em `oidcService.test.ts`, no `beforeEach`, remover `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e `OIDC_BACKCHANNEL_ORIGIN` do ambiente (mantenha `NODE_ENV`, `OIDC_SESSION_ENCRYPTION_KEY` e `APP_ORIGIN`) e configurar a fonte:

```ts
import { isOidcEnabled, probeOidcProvider, setOidcSettingsSource, validateOidcSettings } from './oidcService';

const baseSettings = { enabled: true, issuer, clientId, clientSecret: 'test-client-secret', backchannelOrigin: '' };
const useSettings = (overrides: Partial<typeof baseSettings> = {}) =>
  setOidcSettingsSource(async () => ({ ...baseSettings, ...overrides }));
```

com `useSettings();` no `beforeEach`, e, nos testes que hoje definem `process.env.OIDC_BACKCHANNEL_ORIGIN = 'http://host.docker.internal:8080'`, trocar por `useSettings({ backchannelOrigin: 'http://host.docker.internal:8080' });`. Acrescentar:

```ts
  describe('settings from the database', () => {
    it('reports disabled or absent settings', async () => {
      setOidcSettingsSource(async () => null);
      await expect(isOidcEnabled()).resolves.toBe(false);
      useSettings({ enabled: false });
      await expect(isOidcEnabled()).resolves.toBe(false);
      useSettings();
      await expect(isOidcEnabled()).resolves.toBe(true);
    });

    it('refuses to start a login when the intranet login is not configured', async () => {
      useSettings({ enabled: false });
      await expect(createAuthorizationRequest()).rejects.toMatchObject({ code: 'not_configured' });
    });

    it.each([
      [{ issuer: '' }, 'Informe issuer, client ID e client secret.'],
      [{ clientSecret: '' }, 'Informe issuer, client ID e client secret.'],
      [{ issuer: 'not a url' }, 'Issuer, backchannel origin e APP_ORIGIN precisam ser URLs válidas.'],
      [{ issuer: 'http://intranet.example' }, 'O issuer precisa usar HTTPS fora do ambiente local.'],
      [{ backchannelOrigin: 'ftp://host' }, 'Backchannel origin precisa usar HTTP ou HTTPS.'],
    ])('rejects invalid settings %p', (overrides, message) => {
      expect(() => validateOidcSettings({ ...baseSettings, ...overrides }, 'http://localhost:5173'))
        .toThrow(message);
    });

    it('requires HTTPS and forbids the backchannel in production', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => validateOidcSettings({ ...baseSettings, issuer: 'https://intranet.example' }, 'http://app.example'))
          .toThrow('APP_ORIGIN precisa usar HTTPS em produção.');
        expect(() => validateOidcSettings(
          { ...baseSettings, issuer: 'https://intranet.example', backchannelOrigin: 'http://internal' },
          'https://app.example',
        )).toThrow('Backchannel origin só é permitido fora de produção.');
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('builds the callback URL from APP_ORIGIN', () => {
      expect(validateOidcSettings(baseSettings, 'http://localhost:5173/').redirectUri)
        .toBe('http://localhost:5173/api/auth/oidc/callback');
    });

    it('probes discovery and signing keys without using the cache', async () => {
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(response(metadata))
        .mockResolvedValueOnce(response({ keys: [{ kty: 'RSA', use: 'sig', kid: 'k', alg: 'RS256', n: 'x', e: 'AQAB' }] }));
      await expect(probeOidcProvider(baseSettings)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(`${issuer}/.well-known/openid-configuration`, undefined);
    });

    it('explains incompatible providers', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(response({ ...metadata, code_challenge_methods_supported: ['plain'] }));
      await expect(probeOidcProvider(baseSettings))
        .rejects.toThrow('O discovery do issuer não é compatível (requer RS256 e PKCE S256).');
    });
  });
```

(`response`, `metadata`, `issuer` e `clientId` já existem no topo do arquivo. Se o `fetch` existente é chamado com um segundo argumento diferente de `undefined` para o discovery, ajuste a asserção para `expect.anything()` ou para o que `fetchJson` realmente passa — o objetivo é provar que a URL é a do issuer configurado.)

Em `localAuthController.test.ts`, adicionar ao `setup` a dependência `oidcEnabled: jest.fn().mockResolvedValue(true)` e trocar o teste de `options` por:

```ts
  it('reports which login methods are available', async () => {
    const { controller, deps, response } = setup(false);
    deps.oidcEnabled.mockResolvedValue(true);
    await controller.options({} as Request, response as unknown as Response);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { localLoginEnabled: false, oidcEnabled: true } });
  });
```

Em `authRoutes.test.ts`, no mock de `../services/oidcService` acrescentar `isOidcEnabled: jest.fn().mockResolvedValue(true),` e trocar a classe mock por uma que guarde o código:

```ts
  OidcError: class OidcError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  },
```

e acrescentar:

```ts
  it('sends visitors back to the login page when the intranet login is not configured', async () => {
    const { OidcError } = jest.requireMock('../services/oidcService');
    (createAuthorizationRequest as jest.Mock).mockRejectedValue(new OidcError('off', 'not_configured'));
    const response = mockResponse();
    await finalHandler('get', '/oidc/login')({ query: {} } as unknown as Request, response as unknown as Response, next);
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=not_configured');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/oidcService.test.ts src/controllers/localAuthController.test.ts src/routes/authRoutes.test.ts`
Expected: FAIL — `setOidcSettingsSource`, `validateOidcSettings`, `isOidcEnabled`, `probeOidcProvider` inexistentes; `options` sem `oidcEnabled`; `/oidc/login` chama `next(error)`.

- [ ] **Step 3: Implement in `oidcService.ts`**

Imports:

```ts
import type { OidcSettings } from '../models/SystemConfig';
import { getConfigService } from './databaseService';
```

Substituir `getConfiguration` (síncrona, baseada em `process.env`) por:

```ts
export type OidcSettingsSource = () => Promise<OidcSettings | null>;

let settingsSource: OidcSettingsSource = () => getConfigService().getOidcSettings();

export const setOidcSettingsSource = (source: OidcSettingsSource): void => {
  settingsSource = source;
  metadataCache = null;
};

const configurationError = (message: string): OidcError => new OidcError(message, 'configuration_error');

export const validateOidcSettings = (
  settings: OidcSettings,
  appOrigin: string = process.env.APP_ORIGIN || '',
): OidcConfiguration => {
  const issuer = settings.issuer.trim().replace(/\/$/, '');
  const clientId = settings.clientId.trim();
  const backchannelOrigin = settings.backchannelOrigin.trim().replace(/\/$/, '');
  if (!issuer || !clientId || !settings.clientSecret) {
    throw configurationError('Informe issuer, client ID e client secret.');
  }
  if (!appOrigin) throw configurationError('APP_ORIGIN não está configurado no servidor.');

  let issuerUrl: URL;
  let originUrl: URL;
  let backchannelUrl: URL | undefined;
  try {
    issuerUrl = new URL(issuer);
    originUrl = new URL(appOrigin);
    backchannelUrl = backchannelOrigin ? new URL(backchannelOrigin) : undefined;
  } catch {
    throw configurationError('Issuer, backchannel origin e APP_ORIGIN precisam ser URLs válidas.');
  }

  const production = process.env.NODE_ENV === 'production';
  const localIssuer = issuerUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(issuerUrl.hostname);
  if (production && issuerUrl.protocol !== 'https:') throw configurationError('O issuer precisa usar HTTPS em produção.');
  if (production && originUrl.protocol !== 'https:') throw configurationError('APP_ORIGIN precisa usar HTTPS em produção.');
  if (issuerUrl.protocol !== 'https:' && !localIssuer) {
    throw configurationError('O issuer precisa usar HTTPS fora do ambiente local.');
  }
  if (backchannelUrl && production) throw configurationError('Backchannel origin só é permitido fora de produção.');
  if (backchannelUrl && !['http:', 'https:'].includes(backchannelUrl.protocol)) {
    throw configurationError('Backchannel origin precisa usar HTTP ou HTTPS.');
  }

  return {
    issuer,
    ...(backchannelOrigin ? { backchannelOrigin } : {}),
    clientId,
    clientSecret: settings.clientSecret,
    redirectUri: `${originUrl.origin}/api/auth/oidc/callback`,
    appOrigin: originUrl.origin,
  };
};

const getConfiguration = async (): Promise<OidcConfiguration> => {
  const settings = await settingsSource();
  if (!settings?.enabled) throw new OidcError('Intranet login is not configured', 'not_configured');
  return validateOidcSettings(settings);
};

export const isOidcEnabled = async (): Promise<boolean> => {
  try {
    await getConfiguration();
    return true;
  } catch {
    return false;
  }
};
```

Remover a função `getSecret` apenas se não for mais usada; `getSessionEncryptionKey` ainda precisa dela (para `OIDC_SESSION_ENCRYPTION_KEY`) — mantenha-a.

Trocar `assertOidcConfiguration` por:

```ts
export const assertSessionEncryptionKey = (): void => {
  getSessionEncryptionKey();
};
```

Extrair a busca do discovery para reuso pelo teste de conexão e trocar a mensagem de incompatibilidade:

```ts
const fetchMetadata = async (config: OidcConfiguration): Promise<OidcMetadata> => {
  const metadata = await fetchJson<OidcMetadata>(oidcUrl(`${config.issuer}/.well-known/openid-configuration`, config, true));
  if (
    metadata.issuer !== config.issuer ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.userinfo_endpoint ||
    !metadata.jwks_uri ||
    !metadata.id_token_signing_alg_values_supported?.includes('RS256') ||
    !metadata.code_challenge_methods_supported?.includes('S256')
  ) {
    throw new OidcError('O discovery do issuer não é compatível (requer RS256 e PKCE S256).', 'configuration_error');
  }
  return metadata;
};

export const getOidcMetadata = async (): Promise<OidcMetadata> => {
  const config = await getConfiguration();
  const cacheKey = `${config.issuer}|${config.backchannelOrigin || ''}`;
  if (metadataCache && metadataCache.expiresAt > Date.now() && metadataCache.cacheKey === cacheKey) {
    return metadataCache.value;
  }
  const metadata = await fetchMetadata(config);
  metadataCache = { value: metadata, expiresAt: Date.now() + DISCOVERY_TTL_MS, cacheKey };
  return metadata;
};

export const probeOidcProvider = async (settings: OidcSettings): Promise<void> => {
  const config = validateOidcSettings(settings);
  const metadata = await fetchMetadata(config);
  const jwks = await fetchJson<JwksResponse>(oidcUrl(metadata.jwks_uri, config, true));
  if (!Array.isArray(jwks.keys) || !jwks.keys.some((key) => key.kty === 'RSA' && key.use === 'sig')) {
    throw new OidcError('O issuer não publicou chaves de assinatura RSA.', 'configuration_error');
  }
};
```

Em todas as demais funções (`createAuthorizationRequest`, `exchange`, `exchangeAuthorizationCode`, `validateIdToken`, `getUserInfo`, `revokeRefreshToken`) trocar `getConfiguration()` por `await getConfiguration()` (em `getUserInfo`, o argumento inline vira `await getConfiguration()`).

Em `backend/src/app.ts`: trocar o import e a chamada `assertOidcConfiguration()` por `assertSessionEncryptionKey()`.

- [ ] **Step 4: Implement `options` and the not-configured redirect**

`localAuthController.ts`:

```ts
export interface LocalAuthControllerDependencies {
  enabled: () => boolean;
  oidcEnabled: () => Promise<boolean>;
  authenticate: (input: LocalAuthInput) => Promise<LocalAuthResult>;
  createSession: (user: AuthenticatedUser, localUserId: string) => Promise<string>;
  deleteSession: (sessionId: string | undefined) => Promise<void>;
}
```

```ts
  options: async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      success: true,
      data: { localLoginEnabled: deps.enabled(), oidcEnabled: await deps.oidcEnabled() },
    });
  },
```

`authRoutes.ts`: importar `isOidcEnabled` e passar `oidcEnabled: isOidcEnabled,` para `createLocalAuthController`. No `catch` de `GET /oidc/login`:

```ts
  } catch (error) {
    if (error instanceof OidcError && error.code === 'not_configured') {
      response.redirect(302, `${appOrigin()}/login?auth_error=not_configured`);
      return;
    }
    next(error);
  }
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/services/oidcService.ts src/services/oidcService.test.ts src/controllers/localAuthController.ts src/routes/authRoutes.ts src/app.ts`
Expected: suíte verde; sem erros.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/oidcService.ts backend/src/services/oidcService.test.ts backend/src/app.ts backend/src/controllers/localAuthController.ts backend/src/controllers/localAuthController.test.ts backend/src/routes/authRoutes.ts backend/src/routes/authRoutes.test.ts
git commit -m "feat: configure intranet login from the database and start without it [Story 4.2]"
```

---

### Task 5: Conta, perfil e situação em cada requisição (AC 2, 3, 4, 5, 7, 11)

**Files:**
- Create: `backend/src/services/accountService.ts`, `backend/src/services/accountService.test.ts`
- Modify: `backend/src/middlewares/authentication.ts` (+ teste), `backend/src/routes/authRoutes.ts` (+ teste), `backend/src/controllers/localAuthController.ts` (+ teste), `backend/src/app.ts`

**Interfaces:**
- Consumes: `UserStore`, `User`, `getUserRepository()` (Task 1); `AuthSession`, `deleteSession` (Story 4.1).
- Produces:
  ```ts
  // accountService.ts
  export type AccountStore = Pick<UserStore, 'findById' | 'findByOidcSub' | 'upsertOidcUser'>;
  export const resolveAccount: (session: AuthSession, users: AccountStore) => Promise<User | null>;
  export interface AccountView { userId: string; sub: string; name?: string; email?: string; provider: 'local' | 'oidc'; role: 'admin' | 'operator'; mustChangePassword: boolean }
  export const toAccountView: (session: AuthSession, account: User) => AccountView;
  // authentication.ts
  export interface AuthenticatedRequest extends Request { auth?: { sessionId: string; session: AuthSession; account: User } }
  export const requireAdmin: RequestHandler;            // 403 { success:false, error:'forbidden' }
  export const requirePasswordCurrent: RequestHandler;  // 403 { success:false, error:'password_change_required' }
  ```
  - `requireAuthentication`: conta inexistente ou desativada → apaga a sessão, limpa o cookie, `401 { success:false, error:'Account disabled' }`.
  - `GET /api/auth/me` → `data: AccountView`. Login local responde `data` com `{ userId, sub, name, provider:'local', role, mustChangePassword }`.
  - Callback OIDC registra/atualiza a conta; desativada → `/login?auth_error=unauthorized`; senão `recordLogin`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/services/accountService.test.ts
import type { User } from '../repositories/userRepository';
import type { AuthSession } from './authSessionService';
import { resolveAccount, toAccountView } from './accountService';

const account = (overrides: Partial<User> = {}): User => ({
  id: 'u-1', provider: 'oidc', role: 'operator', username: null, oidcSub: 'sub-1', email: 'a@crefito.gov.br',
  name: 'Ana', passwordHash: null, mustChangePassword: false, disabledAt: null, lastLoginAt: null, ...overrides,
});

const store = () => ({
  findById: jest.fn().mockResolvedValue(null),
  findByOidcSub: jest.fn().mockResolvedValue(null),
  upsertOidcUser: jest.fn(),
});

const oidcSession: AuthSession = {
  provider: 'oidc', user: { sub: 'sub-1', name: 'Ana', email: 'a@crefito.gov.br' }, refreshToken: 'r', accessTokenExpiresAt: 1,
};

describe('resolveAccount', () => {
  it('loads local accounts by id', async () => {
    const users = store();
    users.findById.mockResolvedValue(account({ id: 'local-1', provider: 'local' }));
    await resolveAccount({ provider: 'local', user: { sub: 'local:local-1', name: 'admin' }, localUserId: 'local-1' }, users);
    expect(users.findById).toHaveBeenCalledWith('local-1');
  });

  it('loads intranet accounts by subject', async () => {
    const users = store();
    users.findByOidcSub.mockResolvedValue(account());
    await expect(resolveAccount(oidcSession, users)).resolves.toMatchObject({ id: 'u-1' });
    expect(users.upsertOidcUser).not.toHaveBeenCalled();
  });

  it('registers users of sessions opened before Story 4.2', async () => {
    const users = store();
    users.upsertOidcUser.mockResolvedValue(account());
    await expect(resolveAccount(oidcSession, users)).resolves.toMatchObject({ role: 'operator' });
    expect(users.upsertOidcUser).toHaveBeenCalledWith({ sub: 'sub-1', email: 'a@crefito.gov.br', name: 'Ana' });
  });
});

describe('toAccountView', () => {
  it('never exposes the password hash', () => {
    const view = toAccountView(
      { provider: 'local', user: { sub: 'local:l', name: 'admin' }, localUserId: 'l' },
      account({ id: 'l', provider: 'local', username: 'admin', name: null, email: null, passwordHash: 'secret-hash', role: 'admin', mustChangePassword: true }),
    );
    expect(view).toEqual({ userId: 'l', sub: 'local:l', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: true });
    expect(JSON.stringify(view)).not.toContain('secret-hash');
  });
});
```

Em `authentication.test.ts`, acrescentar mocks e casos:

```ts
const mockUsers = { findById: jest.fn(), findByOidcSub: jest.fn(), upsertOidcUser: jest.fn() };
jest.mock('../services/databaseService', () => ({ getUserRepository: () => mockUsers }));
```

(e incluir `deleteSession: jest.fn()` no mock existente de `authSessionService`; importar `deleteSession`, `requireAdmin`, `requirePasswordCurrent`). No teste existente "attaches a verified session to the request", fazer `mockUsers.findByOidcSub.mockResolvedValue({ id: 'u', role: 'operator', disabledAt: null, mustChangePassword: false })` antes da chamada e acrescentar a asserção de `auth.account`. Novos casos:

```ts
  it('ends the session of a disabled account', async () => {
    const session = { provider: 'oidc', user: { sub: 'user-1' }, refreshToken: 'r', accessTokenExpiresAt: Date.now() + 60_000 };
    (getSession as jest.Mock).mockResolvedValue(session);
    (refreshSessionIfNeeded as jest.Mock).mockResolvedValue(session);
    mockUsers.findByOidcSub.mockResolvedValue({ id: 'u', role: 'admin', disabledAt: new Date(), mustChangePassword: false });
    const request = { headers: { cookie: `${SESSION_COOKIE}=session-id` } } as Request;

    await requireAuthentication(request, { status, clearCookie } as unknown as Response, next);
    expect(deleteSession).toHaveBeenCalledWith('session-id');
    expect(clearCookie).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['operator', 403],
    ['admin', undefined],
  ])('lets only admins through requireAdmin (%s)', (role, expectedStatus) => {
    const request = { auth: { account: { role } } } as unknown as Request;
    requireAdmin(request, { status } as unknown as Response, next);
    if (expectedStatus) {
      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ success: false, error: 'forbidden' });
    } else {
      expect(next).toHaveBeenCalled();
    }
  });

  it('blocks the API until a required password change happens', () => {
    const request = { auth: { account: { mustChangePassword: true } } } as unknown as Request;
    requirePasswordCurrent(request, { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'password_change_required' });
  });
```

(Esses casos usam os `next`, `status`, `json` e `clearCookie` do `describe('authentication middleware')` — coloque-os dentro dele.)

Em `authRoutes.test.ts`, acrescentar ao topo:

```ts
const mockUsers = { upsertOidcUser: jest.fn(), recordLogin: jest.fn(), findByUsername: jest.fn() };
jest.mock('../services/databaseService', () => ({ getUserRepository: () => mockUsers }));
```

No teste "returns to the stored path after a successful OIDC callback", antes da chamada: `mockUsers.upsertOidcUser.mockResolvedValue({ id: 'acc-1', disabledAt: null });` e depois: `expect(mockUsers.recordLogin).toHaveBeenCalledWith('acc-1');`. Novo caso:

```ts
  it('refuses intranet users disabled in BulkMail', async () => {
    (consumeLoginTransaction as jest.Mock).mockResolvedValue({ state: 's', nonce: 'n', codeVerifier: 'v' });
    (exchangeAuthorizationCode as jest.Mock).mockResolvedValue({ refresh_token: 'r', id_token: 'i', access_token: 'a', expires_in: 300 });
    (validateIdToken as jest.Mock).mockResolvedValue({ sub: 'u' });
    (getUserInfo as jest.Mock).mockResolvedValue({ sub: 'u', name: 'Usuária', email: 'u@crefito.gov.br' });
    mockUsers.upsertOidcUser.mockResolvedValue({ id: 'acc-1', disabledAt: new Date() });
    const response = mockResponse();
    await finalHandler('get', '/oidc/callback')(
      { query: { code: 'c', state: 's' }, headers: {} } as unknown as Request,
      response as unknown as Response,
      next,
    );
    expect(mockUsers.upsertOidcUser).toHaveBeenCalledWith({ sub: 'u', email: 'u@crefito.gov.br', name: 'Usuária' });
    expect(createSession).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=unauthorized');
  });
```

E trocar o teste de `/me` por:

```ts
  it('reports the account view on /me', async () => {
    const response = mockResponse();
    const session = { provider: 'local', user: { sub: 'local:l', name: 'admin' }, localUserId: 'l' };
    const account = {
      id: 'l', provider: 'local', role: 'admin', username: 'admin', name: null, email: null,
      passwordHash: 'h', mustChangePassword: false, disabledAt: null, lastLoginAt: null, oidcSub: null,
    };
    await finalHandler('get', '/me')({ auth: { sessionId: 'sid', session, account } } as unknown as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { userId: 'l', sub: 'local:l', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false },
    });
  });
```

Em `localAuthController.test.ts`, no teste de sucesso, a resposta esperada passa a ser:

```ts
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { userId: 'user-1', sub: 'local:user-1', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false },
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/accountService.test.ts src/middlewares/authentication.test.ts src/routes/authRoutes.test.ts src/controllers/localAuthController.test.ts`
Expected: FAIL — módulo `accountService` inexistente; `requireAdmin`/`requirePasswordCurrent` inexistentes; callback não registra a conta; `/me` e login local sem `role`.

- [ ] **Step 3: Implement `accountService.ts`**

```ts
// backend/src/services/accountService.ts
import type { User, UserStore } from '../repositories/userRepository';
import type { AuthSession } from './authSessionService';

export type AccountStore = Pick<UserStore, 'findById' | 'findByOidcSub' | 'upsertOidcUser'>;

export interface AccountView {
  userId: string;
  sub: string;
  name?: string;
  email?: string;
  provider: 'local' | 'oidc';
  role: 'admin' | 'operator';
  mustChangePassword: boolean;
}

export const resolveAccount = async (session: AuthSession, users: AccountStore): Promise<User | null> => {
  if (session.provider === 'local') return users.findById(session.localUserId);
  const existing = await users.findByOidcSub(session.user.sub);
  if (existing) return existing;
  // Sessions opened before Story 4.2 belong to users that were never registered.
  return users.upsertOidcUser({ sub: session.user.sub, email: session.user.email, name: session.user.name });
};

export const toAccountView = (session: AuthSession, account: User): AccountView => {
  const name = account.name ?? account.username ?? session.user.name;
  const email = account.email ?? session.user.email;
  return {
    userId: account.id,
    sub: session.user.sub,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    provider: account.provider,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  };
};
```

- [ ] **Step 4: Implement the middleware**

Em `authentication.ts`:

```ts
import { NextFunction, Request, Response } from 'express';
import type { User } from '../repositories/userRepository';
import { resolveAccount } from '../services/accountService';
import { AuthSession, deleteSession, getSession, refreshSessionIfNeeded } from '../services/authSessionService';
import { getUserRepository } from '../services/databaseService';
```

```ts
export interface AuthenticatedRequest extends Request {
  auth?: { sessionId: string; session: AuthSession; account: User };
}
```

Em `requireAuthentication`, substituir `request.auth = { sessionId, session: currentSession };` por:

```ts
    // Role and status are read on every request so changes apply immediately.
    const account = await resolveAccount(currentSession, getUserRepository());
    if (!account || account.disabledAt) {
      await deleteSession(sessionId);
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'Account disabled' });
      return;
    }
    request.auth = { sessionId, session: currentSession, account };
```

E acrescentar:

```ts
export const requireAdmin = (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
  if (request.auth?.account.role !== 'admin') {
    response.status(403).json({ success: false, error: 'forbidden' });
    return;
  }
  next();
};

export const requirePasswordCurrent = (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
  if (request.auth?.account.mustChangePassword) {
    response.status(403).json({ success: false, error: 'password_change_required' });
    return;
  }
  next();
};
```

- [ ] **Step 5: Wire routes, callback, login response and app guards**

`authRoutes.ts` — callback, entre a checagem `claims.sub !== user.sub` e `createSession`:

```ts
    const account = await getUserRepository().upsertOidcUser({ sub: user.sub, email: user.email, name: user.name });
    if (account.disabledAt) {
      fail('unauthorized');
      return;
    }
    await getUserRepository().recordLogin(account.id);
```

`/me`:

```ts
router.get('/me', requireAuthentication, (request: AuthenticatedRequest, response: Response) => {
  const auth = request.auth;
  response.status(200).json({
    success: true,
    data: auth ? toAccountView(auth.session, auth.account) : undefined,
  });
});
```

(importar `toAccountView` de `'../services/accountService'`).

`localAuthController.ts`, no sucesso:

```ts
      const user: AuthenticatedUser = { sub: `local:${result.user.id}`, name: result.user.username };
      await deps.deleteSession(getCookie(request, SESSION_COOKIE));
      const sessionId = await deps.createSession(user, result.user.id);
      response.cookie(SESSION_COOKIE, sessionId, cookieOptions(SESSION_COOKIE_MAX_AGE));
      response.status(200).json({
        success: true,
        data: {
          userId: result.user.id,
          ...user,
          provider: 'local',
          role: result.user.role,
          mustChangePassword: result.user.mustChangePassword,
        },
      });
```

`app.ts`:

```ts
import { requireAdmin, requireAuthentication, requirePasswordCurrent, requireTrustedOrigin } from './middlewares/authentication';
```

```ts
// Every remaining API route is an authenticated operation.
app.use('/api', requireAuthentication, requireTrustedOrigin, requirePasswordCurrent);
```

```ts
app.use('/api/config', requireAdmin, configLimiter, configRoutes);
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/services/accountService.ts src/middlewares src/routes/authRoutes.ts src/controllers/localAuthController.ts src/app.ts`
Expected: suíte verde; sem erros.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/accountService.ts backend/src/services/accountService.test.ts backend/src/middlewares backend/src/routes/authRoutes.ts backend/src/routes/authRoutes.test.ts backend/src/controllers/localAuthController.ts backend/src/controllers/localAuthController.test.ts backend/src/app.ts
git commit -m "feat: load account role and status on every request and restrict settings to admins [Story 4.2]"
```

---

### Task 6: API de usuários, minha senha e configuração OIDC (AC 8–11, 14–17, 24)

**Files:**
- Create: `backend/src/services/settingsAudit.ts`, `backend/src/services/userAdminService.ts` (+ teste), `backend/src/routes/userAdminRoutes.ts` (+ teste)
- Modify: `backend/src/routes/authRoutes.ts` (+ teste), `backend/src/controllers/configController.ts` (+ teste), `backend/src/routes/configRoutes.ts` (+ teste), `backend/src/app.ts`

**Interfaces:**
- Consumes: `UserStore`, `User`, `UserRole`, `LastActiveAdminError`, `UserNotFoundError` (Tasks 1–2); `USERNAME_PATTERN` (`localUserAdminService.ts`); `normalizeUsername`; `validatePasswordPolicy`, `hashPassword`, `verifyPassword`; `revokeLocalUserSessions`; `requireAdmin` (Task 5); `getOidcSettings`/`updateOidcSettings` (Task 3); `validateOidcSettings`, `probeOidcProvider`, `OidcError` (Task 4).
- Produces:
  ```ts
  // settingsAudit.ts
  export interface SettingsAuditEvent { actor: string; action: string; target?: string; fields?: string[] }
  export const logSettingsChange: (event: SettingsAuditEvent) => void;
  // userAdminService.ts
  export class UserAdminError extends Error { readonly code: string; readonly status: number }
  export interface UserView { id: string; provider: 'local'|'oidc'; username: string|null; name: string|null; email: string|null; role: 'admin'|'operator'; disabled: boolean; mustChangePassword: boolean; lastLoginAt: string|null }
  export const accountLabel: (user: User) => string;
  export const createUserAdminService: (deps: UserAdminDependencies) => {
    list(): Promise<UserView[]>;
    createLocal(actor: string, input: Record<string, unknown>): Promise<UserView>;
    updateAccess(actor: string, id: string, change: Record<string, unknown>): Promise<UserView>;
    resetPassword(actor: string, id: string, password: unknown): Promise<void>;
    changeOwnPassword(account: User, currentPassword: unknown, newPassword: unknown): Promise<void>;
  };
  ```
  - HTTP: `GET /api/admin/users` → `{ success, data: UserView[] }`; `POST /api/admin/users` `{ username, password, role? }` → `201 { success, data: UserView }`; `PATCH /api/admin/users/:id` `{ role?, disabled? }` → `{ success, data: UserView }`; `POST /api/admin/users/:id/password` `{ password }` → `{ success: true }`; `POST /api/auth/password` `{ currentPassword, newPassword }` → `{ success: true }`.
  - `GET /api/config/oidc` → `{ success, data: { enabled, issuer, clientId, clientSecret: '', clientSecretConfigured, backchannelOrigin, callbackUrl } }`; `POST /api/config/oidc` (mesmos campos) → `{ success, message }`; `POST /api/config/oidc/test` → `{ success, message }`.

- [ ] **Step 1: Write the failing service tests**

```ts
// backend/src/services/userAdminService.test.ts
import {
  LastActiveAdminError, LocalUser, User, UserNotFoundError, UserRole, UserStore,
} from '../repositories/userRepository';
import { createUserAdminService, UserAdminError } from './userAdminService';

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

class InMemoryUsers implements UserStore {
  readonly users = new Map<string, User>();

  add(user: Partial<User> & { id: string }): User {
    const full: User = {
      provider: 'local', role: 'admin', username: null, oidcSub: null, email: null, name: null,
      passwordHash: null, mustChangePassword: false, disabledAt: null, lastLoginAt: null, ...user,
    };
    this.users.set(full.id, full);
    return full;
  }

  async findById(id: string) { return this.users.get(id) ?? null; }
  async findByUsername(username: string) {
    return ([...this.users.values()].find((u) => u.provider === 'local' && u.username === username) as LocalUser) ?? null;
  }
  async findByOidcSub(sub: string) { return [...this.users.values()].find((u) => u.oidcSub === sub) ?? null; }
  async upsertOidcUser(): Promise<User> { throw new Error('not used'); }
  async list() { return [...this.users.values()]; }
  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }) {
    return this.add({
      id: ID(this.users.size + 1), username: input.username, passwordHash: input.passwordHash,
      role: input.role ?? 'admin', mustChangePassword: input.mustChangePassword ?? false,
    }) as LocalUser;
  }
  async updatePassword(id: string, passwordHash: string, mustChangePassword = false) {
    Object.assign(this.users.get(id)!, { passwordHash, mustChangePassword });
  }
  async setDisabled(id: string, disabled: boolean) { this.users.get(id)!.disabledAt = disabled ? new Date() : null; }
  async recordLogin() { /* not used */ }
  async updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }) {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError();
    const next = { ...user, ...(change.role ? { role: change.role } : {}), ...(change.disabled !== undefined ? { disabledAt: change.disabled ? new Date() : null } : {}) };
    const others = [...this.users.values()].filter((u) => u.id !== id);
    if (![next, ...others].some((u) => u.role === 'admin' && !u.disabledAt)) throw new LastActiveAdminError();
    this.users.set(id, next);
    return next;
  }
}

const setup = () => {
  const users = new InMemoryUsers();
  const deps = {
    users,
    hash: jest.fn(async (password: string) => `hashed:${password}`),
    verify: jest.fn(async (password: string, stored: string) => stored === `hashed:${password}`),
    revokeSessions: jest.fn().mockResolvedValue(1),
    audit: jest.fn(),
  };
  return { users, deps, service: createUserAdminService(deps) };
};

const expectError = async (promise: Promise<unknown>, code: string, status: number) => {
  await expect(promise).rejects.toBeInstanceOf(UserAdminError);
  await expect(promise).rejects.toMatchObject({ code, status });
};

describe('userAdminService', () => {
  it('lists users without password hashes', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'hashed:x', lastLoginAt: new Date('2026-10-10T12:00:00Z') });
    const [view] = await service.list();
    expect(view).toEqual({
      id: ID(1), provider: 'local', username: 'admin', name: null, email: null, role: 'admin',
      disabled: false, mustChangePassword: false, lastLoginAt: '2026-10-10T12:00:00.000Z',
    });
  });

  it('creates local users that must change the initial password', async () => {
    const { deps, service } = setup();
    const view = await service.createLocal('admin', { username: ' Maria.Silva ', password: 'senha-inicial-123', role: 'operator' });
    expect(view).toMatchObject({ username: 'maria.silva', role: 'operator', mustChangePassword: true });
    expect(deps.audit).toHaveBeenCalledWith({ actor: 'admin', action: 'user.create', target: 'maria.silva', fields: ['role'] });
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain('senha-inicial-123');
  });

  it('creates admins by default', async () => {
    const { service } = setup();
    await expect(service.createLocal('admin', { username: 'joao', password: 'senha-inicial-123' })).resolves.toMatchObject({ role: 'admin' });
  });

  it.each([
    [{ username: 'a b', password: 'senha-inicial-123' }, 'invalid_username'],
    [{ username: 'joao', password: 'curta' }, 'invalid_password'],
    [{ username: 'joao', password: 'senha-inicial-123', role: 'root' }, 'invalid_role'],
    [{ username: 42, password: 'senha-inicial-123' }, 'invalid_request'],
  ])('rejects invalid creation input %p', async (input, code) => {
    const { service } = setup();
    await expectError(service.createLocal('admin', input as Record<string, unknown>), code, 400);
  });

  it('refuses duplicated usernames', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'joao', passwordHash: 'h' });
    await expectError(service.createLocal('admin', { username: 'JOAO', password: 'senha-inicial-123' }), 'username_taken', 409);
  });

  it('changes roles and status and revokes sessions of disabled local users', async () => {
    const { users, deps, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    users.add({ id: ID(2), username: 'joao', passwordHash: 'h', role: 'operator' });
    await expect(service.updateAccess('admin', ID(2), { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
    await expect(service.updateAccess('admin', ID(2), { disabled: true })).resolves.toMatchObject({ disabled: true });
    expect(deps.revokeSessions).toHaveBeenCalledWith(ID(2));
    expect(deps.audit).toHaveBeenLastCalledWith({ actor: 'admin', action: 'user.update_access', target: 'joao', fields: ['disabled'] });
  });

  it('rejects demoting or disabling the last active admin', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    await expectError(service.updateAccess('admin', ID(1), { role: 'operator' }), 'last_active_admin', 409);
    await expectError(service.updateAccess('admin', ID(1), { disabled: true }), 'last_active_admin', 409);
  });

  it.each([
    [ID(9), { role: 'admin' }, 'not_found', 404],
    ['not-a-uuid', { role: 'admin' }, 'not_found', 404],
    [ID(1), {}, 'invalid_request', 400],
    [ID(1), { disabled: 'yes' }, 'invalid_request', 400],
    [ID(1), { role: 'root' }, 'invalid_role', 400],
  ])('rejects invalid access changes (%s %p)', async (id, change, code, status) => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    await expectError(service.updateAccess('admin', id, change as Record<string, unknown>), code, status);
  });

  it('resets local passwords, forcing a change and ending sessions', async () => {
    const { users, deps, service } = setup();
    users.add({ id: ID(1), username: 'joao', passwordHash: 'h' });
    await service.resetPassword('admin', ID(1), 'nova-senha-1234');
    expect(users.users.get(ID(1))).toMatchObject({ passwordHash: 'hashed:nova-senha-1234', mustChangePassword: true });
    expect(deps.revokeSessions).toHaveBeenCalledWith(ID(1));
  });

  it('does not manage intranet passwords', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), provider: 'oidc', oidcSub: 's', role: 'operator' });
    await expectError(service.resetPassword('admin', ID(1), 'nova-senha-1234'), 'not_local', 400);
  });

  it('changes the own password after checking the current one', async () => {
    const { users, service } = setup();
    const me = users.add({ id: ID(1), username: 'joao', passwordHash: 'hashed:senha-atual-123', mustChangePassword: true });
    await expectError(service.changeOwnPassword(me, 'errada-errada-1', 'nova-senha-1234'), 'invalid_current_password', 400);
    await expectError(service.changeOwnPassword(me, 'senha-atual-123', 'senha-atual-123'), 'same_password', 400);
    await expectError(service.changeOwnPassword(me, 'senha-atual-123', 'curta'), 'invalid_password', 400);
    await service.changeOwnPassword(me, 'senha-atual-123', 'nova-senha-1234');
    expect(users.users.get(ID(1))).toMatchObject({ passwordHash: 'hashed:nova-senha-1234', mustChangePassword: false });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/userAdminService.test.ts`
Expected: FAIL — `Cannot find module './userAdminService'`.

- [ ] **Step 3: Implement `settingsAudit.ts` and `userAdminService.ts`**

```ts
// backend/src/services/settingsAudit.ts
export interface SettingsAuditEvent {
  actor: string;
  action: string;
  target?: string;
  fields?: string[];
}

// Never pass secret values here: only field names are logged.
export const logSettingsChange = (event: SettingsAuditEvent): void => {
  console.log('[Settings]', JSON.stringify(event));
};
```

```ts
// backend/src/services/userAdminService.ts
import {
  LastActiveAdminError, User, UserNotFoundError, UserRole, UserStore,
} from '../repositories/userRepository';
import { normalizeUsername } from './localAuthService';
import { USERNAME_PATTERN } from './localUserAdminService';
import { validatePasswordPolicy } from './passwordHasher';
import type { SettingsAuditEvent } from './settingsAudit';

export class UserAdminError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

export interface UserAdminDependencies {
  users: UserStore;
  hash: (password: string) => Promise<string>;
  verify: (password: string, stored: string) => Promise<boolean>;
  revokeSessions: (userId: string) => Promise<number>;
  audit: (event: SettingsAuditEvent) => void;
}

export interface UserView {
  id: string;
  provider: 'local' | 'oidc';
  username: string | null;
  name: string | null;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

const ROLES: UserRole[] = ['admin', 'operator'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accountLabel = (user: User): string => user.username ?? user.email ?? user.oidcSub ?? user.id;

const toUserView = (user: User): UserView => ({
  id: user.id,
  provider: user.provider,
  username: user.username,
  name: user.name,
  email: user.email,
  role: user.role,
  disabled: Boolean(user.disabledAt),
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
});

const invalidRequest = (message: string) => new UserAdminError('invalid_request', 400, message);

const assertPassword = (password: string): void => {
  const problem = validatePasswordPolicy(password);
  if (problem) throw new UserAdminError('invalid_password', 400, problem);
};

const isRole = (value: unknown): value is UserRole => ROLES.includes(value as UserRole);

export const createUserAdminService = (deps: UserAdminDependencies) => {
  const find = async (id: string): Promise<User> => {
    const user = UUID_PATTERN.test(id) ? await deps.users.findById(id) : null;
    if (!user) throw new UserAdminError('not_found', 404, 'Usuário não encontrado.');
    return user;
  };

  const assertLocal = (user: User): void => {
    if (user.provider !== 'local') {
      throw new UserAdminError('not_local', 400, 'A senha de usuários da intranet é gerenciada na intranet.');
    }
  };

  return {
    async list(): Promise<UserView[]> {
      return (await deps.users.list()).map(toUserView);
    },

    async createLocal(actor: string, input: Record<string, unknown>): Promise<UserView> {
      if (typeof input.username !== 'string' || typeof input.password !== 'string') {
        throw invalidRequest('Informe usuário e senha.');
      }
      const username = normalizeUsername(input.username);
      if (!USERNAME_PATTERN.test(username)) {
        throw new UserAdminError('invalid_username', 400, 'Nome de usuário inválido: use de 3 a 64 caracteres entre a-z, 0-9, ".", "_" e "-".');
      }
      const role = input.role === undefined ? 'admin' : input.role;
      if (!isRole(role)) throw new UserAdminError('invalid_role', 400, 'Perfil inválido.');
      assertPassword(input.password);
      if (await deps.users.findByUsername(username)) {
        throw new UserAdminError('username_taken', 409, `O usuário "${username}" já existe.`);
      }

      const created = await deps.users.create({
        username,
        passwordHash: await deps.hash(input.password),
        role,
        mustChangePassword: true,
      });
      deps.audit({ actor, action: 'user.create', target: username, fields: ['role'] });
      return toUserView(created);
    },

    async updateAccess(actor: string, id: string, change: Record<string, unknown>): Promise<UserView> {
      const target = await find(id);
      if (change.role === undefined && change.disabled === undefined) throw invalidRequest('Nada para alterar.');
      if (change.role !== undefined && !isRole(change.role)) throw new UserAdminError('invalid_role', 400, 'Perfil inválido.');
      if (change.disabled !== undefined && typeof change.disabled !== 'boolean') throw invalidRequest('Situação inválida.');

      try {
        const updated = await deps.users.updateAccess(id, {
          role: change.role as UserRole | undefined,
          disabled: change.disabled as boolean | undefined,
        });
        if (change.disabled === true && updated.provider === 'local') await deps.revokeSessions(id);
        deps.audit({
          actor,
          action: 'user.update_access',
          target: accountLabel(target),
          fields: ['role', 'disabled'].filter((field) => change[field] !== undefined),
        });
        return toUserView(updated);
      } catch (error) {
        if (error instanceof LastActiveAdminError) {
          throw new UserAdminError('last_active_admin', 409, 'Não é possível desativar ou rebaixar o último administrador ativo.');
        }
        if (error instanceof UserNotFoundError) throw new UserAdminError('not_found', 404, 'Usuário não encontrado.');
        throw error;
      }
    },

    async resetPassword(actor: string, id: string, password: unknown): Promise<void> {
      const target = await find(id);
      assertLocal(target);
      if (typeof password !== 'string') throw invalidRequest('Informe a nova senha.');
      assertPassword(password);
      await deps.users.updatePassword(id, await deps.hash(password), true);
      await deps.revokeSessions(id);
      deps.audit({ actor, action: 'user.reset_password', target: accountLabel(target) });
    },

    async changeOwnPassword(account: User, currentPassword: unknown, newPassword: unknown): Promise<void> {
      assertLocal(account);
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !account.passwordHash) {
        throw invalidRequest('Informe a senha atual e a nova senha.');
      }
      if (!(await deps.verify(currentPassword, account.passwordHash))) {
        throw new UserAdminError('invalid_current_password', 400, 'A senha atual está incorreta.');
      }
      if (currentPassword === newPassword) {
        throw new UserAdminError('same_password', 400, 'A nova senha precisa ser diferente da atual.');
      }
      assertPassword(newPassword);
      await deps.users.updatePassword(account.id, await deps.hash(newPassword), false);
      deps.audit({ actor: accountLabel(account), action: 'user.change_own_password', target: accountLabel(account) });
    },
  };
};
```

Run: `cd backend && npx jest src/services/userAdminService.test.ts` → PASS.

- [ ] **Step 4: Write the failing route and controller tests**

```ts
// backend/src/routes/userAdminRoutes.test.ts
import type { NextFunction, Request, Response } from 'express';

const mockService = { list: jest.fn(), createLocal: jest.fn(), updateAccess: jest.fn(), resetPassword: jest.fn() };
jest.mock('../services/userAdminService', () => ({
  ...jest.requireActual('../services/userAdminService'),
  createUserAdminService: () => mockService,
}));
jest.mock('../services/databaseService', () => ({ getUserRepository: jest.fn() }));

import userAdminRoutes from './userAdminRoutes';
import { UserAdminError } from '../services/userAdminService';

type Handler = (request: Request, response: Response, next: NextFunction) => Promise<void>;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const handler = (method: string, path: string): Handler => {
  const layer = (userAdminRoutes as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const mockResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};

const adminRequest = (extra: object = {}) => ({
  auth: { account: { id: 'a', username: 'admin', email: null, oidcSub: null } }, body: {}, params: {}, ...extra,
}) as unknown as Request;

describe('user admin routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists users', async () => {
    mockService.list.mockResolvedValue([{ id: '1' }]);
    const response = mockResponse();
    await handler('get', '/')(adminRequest(), response as unknown as Response, jest.fn());
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [{ id: '1' }] });
  });

  it('creates users with 201 and passes the acting admin', async () => {
    mockService.createLocal.mockResolvedValue({ id: '2' });
    const response = mockResponse();
    await handler('post', '/')(adminRequest({ body: { username: 'joao' } }), response as unknown as Response, jest.fn());
    expect(mockService.createLocal).toHaveBeenCalledWith('admin', { username: 'joao' });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('maps domain errors to their status and Portuguese message', async () => {
    mockService.updateAccess.mockRejectedValue(new UserAdminError('last_active_admin', 409, 'Mensagem'));
    const response = mockResponse();
    await handler('patch', '/:id')(adminRequest({ params: { id: 'x' }, body: { role: 'operator' } }), response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'last_active_admin', message: 'Mensagem' });
  });

  it('forwards unexpected errors', async () => {
    const failure = new Error('db down');
    mockService.resetPassword.mockRejectedValue(failure);
    const next = jest.fn();
    await handler('post', '/:id/password')(adminRequest({ params: { id: 'x' }, body: { password: 'p' } }), mockResponse() as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
```

Em `authRoutes.test.ts`, acrescentar ao mock de `databaseService` o necessário e um caso para `/password`:

```ts
const mockChangeOwnPassword = jest.fn();
jest.mock('../services/userAdminService', () => ({
  ...jest.requireActual('../services/userAdminService'),
  createUserAdminService: () => ({ changeOwnPassword: mockChangeOwnPassword }),
}));
```

```ts
  it('changes the own password and reports domain errors', async () => {
    const { UserAdminError } = jest.requireActual('../services/userAdminService');
    const account = { id: 'l', provider: 'local' };
    const request = { auth: { account }, body: { currentPassword: 'a', newPassword: 'b' } } as unknown as Request;

    let response = mockResponse();
    await finalHandler('post', '/password')(request, response as unknown as Response, next);
    expect(mockChangeOwnPassword).toHaveBeenCalledWith(account, 'a', 'b');
    expect(response.json).toHaveBeenCalledWith({ success: true });

    mockChangeOwnPassword.mockRejectedValueOnce(new UserAdminError('invalid_current_password', 400, 'A senha atual está incorreta.'));
    response = mockResponse();
    await finalHandler('post', '/password')(request, response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'invalid_current_password', message: 'A senha atual está incorreta.' });
  });
```

Em `configController.test.ts`, mockar o `oidcService` e acrescentar:

```ts
jest.mock('../services/oidcService', () => ({
  ...jest.requireActual('../services/oidcService'),
  probeOidcProvider: jest.fn(),
}));
import { probeOidcProvider } from '../services/oidcService';
```

```ts
  describe('OIDC configuration', () => {
    const stored = { enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: 'stored-secret', backchannelOrigin: '' };
    const service = {
      getOidcSettings: jest.fn().mockResolvedValue(stored),
      updateOidcSettings: jest.fn(),
    };
    const request = (body: object = {}) => ({ body, auth: { account: { username: 'admin', email: null, oidcSub: null, id: 'a' } } }) as unknown as Request;

    beforeEach(() => {
      process.env.APP_ORIGIN = 'http://localhost:5173';
      (isDatabaseReady as jest.Mock).mockReturnValue(true);
      (getConfigService as jest.Mock).mockReturnValue(service);
      service.updateOidcSettings.mockClear();
    });

    it('returns settings without the client secret and with the callback URL', async () => {
      await configController.getOidcConfig(request(), mockResponse as Response, nextFunction);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: {
          enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: '', clientSecretConfigured: true,
          backchannelOrigin: '', callbackUrl: 'http://localhost:5173/api/auth/oidc/callback',
        },
      });
    });

    it('keeps the stored client secret when the field is empty', async () => {
      await configController.updateOidcConfig(
        request({ enabled: true, issuer: 'https://intranet.example', clientId: 'novo', clientSecret: '', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, clientId: 'novo' });
    });

    it('rejects invalid settings with a Portuguese message', async () => {
      await configController.updateOidcConfig(
        request({ enabled: true, issuer: 'http://intranet.example', clientId: 'c', clientSecret: 's', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false, error: 'invalid_oidc_settings', message: 'O issuer precisa usar HTTPS fora do ambiente local.',
      });
      expect(service.updateOidcSettings).not.toHaveBeenCalled();
    });

    it('saves disabled settings without validating them', async () => {
      await configController.updateOidcConfig(
        request({ enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, enabled: false, issuer: '', clientId: '' });
    });

    it('tests the provider with the stored secret and reports failures', async () => {
      (probeOidcProvider as jest.Mock).mockResolvedValueOnce(undefined);
      await configController.testOidcConfig(request({ ...stored, clientSecret: '' }), mockResponse as Response, nextFunction);
      expect(probeOidcProvider).toHaveBeenCalledWith(stored);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' });

      const { OidcError } = jest.requireActual('../services/oidcService');
      (probeOidcProvider as jest.Mock).mockRejectedValueOnce(new OidcError('Identity provider is unavailable', 'provider_unavailable'));
      await configController.testOidcConfig(request(stored), mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenLastCalledWith({
        success: false, error: 'oidc_test_failed', message: 'Não foi possível conectar ao issuer.',
      });
    });
  });
```

Em `configRoutes.test.ts`, acrescentar ao `arrayContaining`:

```ts
      expect.objectContaining({ path: '/oidc', methods: ['get'], handler: configController.getOidcConfig }),
      expect.objectContaining({ path: '/oidc', methods: ['post'], handler: configController.updateOidcConfig }),
      expect.objectContaining({ path: '/oidc/test', methods: ['post'], handler: configController.testOidcConfig }),
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd backend && npx jest src/routes/userAdminRoutes.test.ts src/routes/authRoutes.test.ts src/controllers/configController.test.ts src/routes/configRoutes.test.ts`
Expected: FAIL — rotas e handlers inexistentes.

- [ ] **Step 6: Implement the routes**

```ts
// backend/src/routes/userAdminRoutes.ts
import { NextFunction, Request, Response, Router } from 'express';
import type { AuthenticatedRequest } from '../middlewares/authentication';
import { revokeLocalUserSessions } from '../services/authSessionService';
import { getUserRepository } from '../services/databaseService';
import { hashPassword, verifyPassword } from '../services/passwordHasher';
import { logSettingsChange } from '../services/settingsAudit';
import { accountLabel, createUserAdminService, UserAdminError } from '../services/userAdminService';

const router = Router();

// Built per request: the repository only exists after the database is initialized.
const service = () => createUserAdminService({
  users: getUserRepository(),
  hash: hashPassword,
  verify: verifyPassword,
  revokeSessions: revokeLocalUserSessions,
  audit: logSettingsChange,
});

const actor = (request: Request): string => {
  const account = (request as AuthenticatedRequest).auth?.account;
  return account ? accountLabel(account) : 'unknown';
};

export const handleUserAdmin = (work: (request: Request, response: Response) => Promise<void>) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      await work(request, response);
    } catch (error) {
      if (error instanceof UserAdminError) {
        response.status(error.status).json({ success: false, error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };

router.get('/', handleUserAdmin(async (_request, response) => {
  response.status(200).json({ success: true, data: await service().list() });
}));

router.post('/', handleUserAdmin(async (request, response) => {
  response.status(201).json({ success: true, data: await service().createLocal(actor(request), request.body ?? {}) });
}));

router.patch('/:id', handleUserAdmin(async (request, response) => {
  const data = await service().updateAccess(actor(request), request.params.id, request.body ?? {});
  response.status(200).json({ success: true, data });
}));

router.post('/:id/password', handleUserAdmin(async (request, response) => {
  await service().resetPassword(actor(request), request.params.id, request.body?.password);
  response.status(200).json({ success: true });
}));

export default router;
```

Em `authRoutes.ts` (importar `handleUserAdmin` de `./userAdminRoutes`, `createUserAdminService` de `../services/userAdminService`, `hashPassword`, `revokeLocalUserSessions`, `logSettingsChange`):

```ts
router.post('/password', requireAuthentication, requireTrustedOrigin, handleUserAdmin(async (request, response) => {
  const account = (request as AuthenticatedRequest).auth?.account;
  if (!account) {
    response.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  const { currentPassword, newPassword } = (request.body ?? {}) as Record<string, unknown>;
  await createUserAdminService({
    users: getUserRepository(),
    hash: hashPassword,
    verify: verifyPassword,
    revokeSessions: revokeLocalUserSessions,
    audit: logSettingsChange,
  }).changeOwnPassword(account, currentPassword, newPassword);
  response.status(200).json({ success: true });
}));
```

Em `app.ts`:

```ts
import userAdminRoutes from './routes/userAdminRoutes';
```

```ts
app.use('/api/admin/users', requireAdmin, configLimiter, userAdminRoutes);
```

- [ ] **Step 7: Implement the OIDC configuration handlers**

Em `configController.ts` (imports: `OidcSettings` de `'../models/SystemConfig'`; `OidcError`, `probeOidcProvider`, `validateOidcSettings` de `'../services/oidcService'`; `logSettingsChange` de `'../services/settingsAudit'`; `accountLabel` de `'../services/userAdminService'`; `AuthenticatedRequest` de `'../middlewares/authentication'`):

```ts
const actorOf = (req: Request): string => {
  const account = (req as AuthenticatedRequest).auth?.account;
  return account ? accountLabel(account) : 'unknown';
};

const OIDC_FIELDS: Array<keyof OidcSettings> = ['enabled', 'issuer', 'clientId', 'clientSecret', 'backchannelOrigin'];

const EMPTY_OIDC: OidcSettings = { enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// Empty secret keeps the stored one.
const readOidcInput = (body: Record<string, unknown>, stored: OidcSettings): OidcSettings => ({
  enabled: body.enabled === true,
  issuer: text(body.issuer).replace(/\/$/, ''),
  clientId: text(body.clientId),
  clientSecret: text(body.clientSecret) || stored.clientSecret,
  backchannelOrigin: text(body.backchannelOrigin).replace(/\/$/, ''),
});

const OIDC_TEST_MESSAGES: Record<string, string> = {
  provider_unavailable: 'Não foi possível conectar ao issuer.',
  provider_error: 'O issuer respondeu de forma inválida.',
};

/**
 * GET /api/config/oidc
 */
export const getOidcConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = (await getConfigService().getOidcSettings()) ?? EMPTY_OIDC;
    res.status(200).json({
      success: true,
      data: {
        enabled: settings.enabled,
        issuer: settings.issuer,
        clientId: settings.clientId,
        clientSecret: '',
        clientSecretConfigured: Boolean(settings.clientSecret),
        backchannelOrigin: settings.backchannelOrigin,
        callbackUrl: `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}/api/auth/oidc/callback`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/config/oidc
 */
export const updateOidcConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const configService = getConfigService();
    const stored = (await configService.getOidcSettings()) ?? EMPTY_OIDC;
    const settings = readOidcInput(req.body ?? {}, stored);
    if (settings.enabled) validateOidcSettings(settings);

    await configService.updateOidcSettings(settings);
    logSettingsChange({
      actor: actorOf(req),
      action: 'settings.update_oidc',
      fields: OIDC_FIELDS.filter((field) => settings[field] !== stored[field]),
    });
    res.status(200).json({ success: true, message: 'Configuração do login pela intranet salva.' });
  } catch (error) {
    if (error instanceof OidcError) {
      res.status(400).json({ success: false, error: 'invalid_oidc_settings', message: error.message });
      return;
    }
    next(error);
  }
};

/**
 * POST /api/config/oidc/test
 */
export const testOidcConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stored = (await getConfigService().getOidcSettings()) ?? EMPTY_OIDC;
    await probeOidcProvider({ ...readOidcInput(req.body ?? {}, stored), enabled: true });
    res.status(200).json({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' });
  } catch (error) {
    if (error instanceof OidcError) {
      res.status(400).json({
        success: false,
        error: 'oidc_test_failed',
        message: OIDC_TEST_MESSAGES[error.code] ?? error.message,
      });
      return;
    }
    next(error);
  }
};
```

Acrescentar os três ao `export default`. No `updateMailgridConfig` existente, logo após `await configService.updateMailgridConfig(config);`:

```ts
    logSettingsChange({
      actor: actorOf(req),
      action: 'settings.update_mailgrid',
      fields: ['host', 'user', 'from_address', 'from_name', ...(req.body?.pass ? ['pass'] : []), ...(req.body?.webhook_token ? ['webhook_token'] : [])],
    });
```

(capture `req.body?.pass`/`webhook_token` antes do código que preenche o valor atual, para registrar só os segredos efetivamente enviados).

Em `configRoutes.ts`:

```ts
/**
 * Intranet (OIDC) login configuration
 */
router.get('/oidc', configController.getOidcConfig);
router.post('/oidc', configController.updateOidcConfig);
router.post('/oidc/test', configController.testOidcConfig);
```

- [ ] **Step 8: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/routes src/controllers src/services/userAdminService.ts src/services/settingsAudit.ts src/app.ts`
Expected: suíte verde; sem erros.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/settingsAudit.ts backend/src/services/userAdminService.ts backend/src/services/userAdminService.test.ts backend/src/routes backend/src/controllers/configController.ts backend/src/controllers/configController.test.ts backend/src/app.ts
git commit -m "feat: add user administration, own password and OIDC settings APIs [Story 4.2]"
```

---

### Task 7: Barra superior, perfis e troca de senha no frontend (AC 5, 11, 18, 22)

**Files:**
- Create: `frontend/src/components/Layout/AppHeader.tsx`, `frontend/src/components/Auth/AdminRoute.tsx`, `frontend/src/pages/ChangePasswordPage.tsx`, `frontend/e2e/auth/navigation.spec.ts`
- Modify: `frontend/src/services/api.ts`, `frontend/src/components/Auth/AuthProvider.tsx`, `frontend/src/components/Auth/AccountMenu.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/StatusPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/e2e/auth/login.spec.ts`

**Interfaces:**
- Consumes (HTTP): `/api/auth/options` com `oidcEnabled`; `/api/auth/me` com `role`, `mustChangePassword`, `provider`; `POST /api/auth/password`; erro `403 password_change_required`; `auth_error=unauthorized|not_configured`.
- Produces:
  - `api.ts`: `UserRole`, `AuthUser` (+ `userId?`, `role?`, `mustChangePassword?`), `AuthOptions` (+ `oidcEnabled`), `changeOwnPassword(currentPassword, newPassword): Promise<void>`, `apiErrorMessage(error, fallback): string`.
  - `useAuth()` ganha `isAdmin: boolean` (verdadeiro quando a autenticação está desligada).
  - `<AppHeader />`, `<AdminRoute />` (layout route com `<Outlet />`), página `/account/password`.

- [ ] **Step 1: Write the failing e2e tests**

Em `frontend/e2e/auth/login.spec.ts`, no `mockApi`, o mock de options passa a responder `{ localLoginEnabled, oidcEnabled: true }`.

```ts
// frontend/e2e/auth/navigation.spec.ts
import { test, expect, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockSession = async (page: Page, user: Record<string, unknown>) => {
  const state = { user };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: true, data: state.user })));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } })));
  await page.route('**/api/config/mailgrid', (route: Route) => route.fulfill(json({ success: true, data: { host: '', user: '', pass: '', from_address: '', from_name: '', webhook_token: '', webhook_token_configured: false } })));
  return state;
};

const admin = { userId: 'a', sub: 'local:a', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false };
const operator = { userId: 'o', sub: 'oidc-o', name: 'Operadora', provider: 'oidc', role: 'operator', mustChangePassword: false };

test.describe('Navigation by role', () => {
  test('shows the settings link to admins', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Novo Envio' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Configurações' })).toBeVisible();
  });

  test('hides settings from operators and sends them away from /settings', async ({ page }) => {
    await mockSession(page, operator);
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/$/);
  });

  test('offers "Minha senha" only to local users', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Minha senha' })).toBeVisible();
  });

  test('forces a password change before anything else', async ({ page }) => {
    const state = await mockSession(page, { ...admin, mustChangePassword: true });
    await page.route('**/api/auth/password', async (route: Route) => {
      const body = route.request().postDataJSON() as { currentPassword: string; newPassword: string };
      if (body.currentPassword !== 'senha-inicial-123') {
        await route.fulfill(json({ success: false, error: 'invalid_current_password', message: 'A senha atual está incorreta.' }, 400));
        return;
      }
      state.user = { ...admin, mustChangePassword: false };
      await route.fulfill(json({ success: true }));
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByText('Defina uma nova senha para continuar.')).toBeVisible();

    await page.getByLabel('Senha atual').fill('errada-errada-1');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-1234');
    await page.getByLabel('Confirme a nova senha').fill('nova-senha-1234');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('A senha atual está incorreta.');

    await page.getByLabel('Senha atual').fill('senha-inicial-123');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('checks that both new password fields match', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/account/password');
    await page.getByLabel('Senha atual').fill('senha-inicial-123');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-1234');
    await page.getByLabel('Confirme a nova senha').fill('outra-senha-1234');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('As senhas não conferem.');
  });
});

test.describe('Login page options', () => {
  test('hides the intranet button when the intranet login is not configured', async ({ page }) => {
    await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: false }, 401)));
    await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: false } })));
    await page.goto('/login');
    await expect(page.getByLabel('Usuário')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' })).toHaveCount(0);
  });

  test('explains when an intranet user is not authorized', async ({ page }) => {
    await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: false }, 401)));
    await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
    await page.goto('/login?auth_error=unauthorized');
    await expect(page.getByRole('alert')).toHaveText('Acesso não autorizado. Procure um administrador do BulkMail.');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx playwright test --project=auth-chromium e2e/auth/navigation.spec.ts`
Expected: FAIL — sem navegação "Principal", sem `/account/password`, botão da intranet sempre visível.

- [ ] **Step 3: Extend `api.ts`**

```ts
export type UserRole = 'admin' | 'operator';

export interface AuthUser {
  userId?: string;
  sub: string;
  name?: string;
  email?: string;
  provider?: AuthProviderName;
  role?: UserRole;
  mustChangePassword?: boolean;
}

export interface AuthOptions {
  localLoginEnabled: boolean;
  oidcEnabled: boolean;
}
```

```ts
export const changeOwnPassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  await api.post('/auth/password', { currentPassword, newPassword });
};

// Domain errors carry a Portuguese message from the backend.
export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
};
```

No interceptor de resposta, depois do tratamento de `401`:

```ts
      const errorCode = (error.response.data as { error?: string } | undefined)?.error;
      if (status === 403 && authEnabled && errorCode === 'password_change_required' && window.location.pathname !== '/account/password') {
        window.location.assign('/account/password');
      }
```

- [ ] **Step 4: `AuthProvider`, `AdminRoute`, `AccountMenu`, `AppHeader`**

Em `AuthProvider.tsx`: acrescentar `isAdmin: boolean` a `AuthContextValue`, calcular `const isAdmin = !authEnabled || user?.role === 'admin';`, incluí-lo no `useMemo` (`[loading, user, logout, isAdmin]`) e, no `AuthGate`, antes do `return <>{children}</>` para usuário autenticado:

```tsx
  if (user?.mustChangePassword && location.pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />;
  }
```

(o hook `useLocation` já existe no `AuthGate`; mova a checagem `if (!enabled || user) return <>{children}</>;` para depois dela.)

```tsx
// frontend/src/components/Auth/AdminRoute.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function AdminRoute() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}
```

`AccountMenu.tsx`: dentro do `<div className="flex items-center gap-3">`, antes do botão "Sair":

```tsx
      {user.provider === 'local' && (
        <Link to="/account/password" className="px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900">
          Minha senha
        </Link>
      )}
```

(importar `Link` de `react-router-dom`).

```tsx
// frontend/src/components/Layout/AppHeader.tsx
import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { AccountMenu } from '../Auth/AccountMenu';
import { useAuth } from '../Auth/AuthProvider';

const navLinkClass = ({ isActive }: { isActive: boolean }) => clsx(
  'px-3 py-2 text-sm font-medium rounded-md transition-colors',
  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-100',
);

export function AppHeader() {
  const { isAdmin } = useAuth();

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-bold text-gray-900">BulkMail Pro</Link>
          <nav aria-label="Principal" className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>Novo Envio</NavLink>
            <NavLink to="/dashboard" className={navLinkClass}>Dashboard</NavLink>
            {isAdmin && <NavLink to="/settings" className={navLinkClass}>Configurações</NavLink>}
          </nav>
        </div>
        <AccountMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Replace the page headers**

Em cada página, trocar o bloco `<header ...>…</header>` por `<AppHeader />` seguido do título como cabeçalho da página, mantendo a largura do conteúdo de cada uma, e remover imports que ficarem sem uso (`Link`, `AccountMenu`):

`HomePage.tsx`:

```tsx
      <AppHeader />
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-gray-900">Novo Envio</h1>
        <p className="text-gray-600 mt-1">Envio de emails em massa via planilha ou lista manual</p>
      </div>
```

`DashboardPage.tsx`:

```tsx
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard de Envios</h1>
        <p className="text-gray-600 mt-1 text-sm">Gerencie o histórico de suas campanhas</p>
      </div>
```

`StatusPage.tsx`:

```tsx
      <AppHeader />
      <div className="max-w-6xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-gray-900">Status do Envio</h1>
        <p className="text-gray-600 mt-1">Acompanhe o progresso do envio de emails</p>
      </div>
```

`SettingsPage.tsx` (temporário até a Task 8):

```tsx
      <AppHeader />
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-gray-600 mt-1">Gerencie as credenciais da API Mailgrid</p>
      </div>
```

(Os `<main>` existentes continuam como estão; se algum `<main>` tinha `py-8`, mude para `pb-8 pt-6` para não duplicar o espaçamento.)

- [ ] **Step 6: `ChangePasswordPage` and routes**

```tsx
// frontend/src/pages/ChangePasswordPage.tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/Layout/AppHeader';
import { useAuth } from '../components/Auth/AuthProvider';
import { apiErrorMessage, changeOwnPassword } from '../services/api';

const inputClassName = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

export default function ChangePasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user && user.provider !== 'local') {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <main className="max-w-md mx-auto px-4 py-8">
          <p className="text-gray-700">Sua senha é gerenciada pela intranet.</p>
        </main>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmation) {
      setError('As senhas não conferem.');
      return;
    }
    setSaving(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      if (user) setUser({ ...user, mustChangePassword: false });
      navigate('/', { replace: true });
    } catch (saveError) {
      setError(apiErrorMessage(saveError, 'Não foi possível alterar a senha. Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Minha senha</h1>
        {user?.mustChangePassword && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Defina uma nova senha para continuar.</p>
        )}
        <form className="mt-6 space-y-4 rounded-lg bg-white p-6 shadow-sm" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-gray-700">Senha atual</label>
            <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className={inputClassName} />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">Nova senha</label>
            <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={inputClassName} />
            <p className="mt-1 text-xs text-gray-500">Mínimo de 12 caracteres.</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">Confirme a nova senha</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClassName} />
          </div>
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={saving || !currentPassword || !newPassword || !confirmation}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {saving ? 'Salvando...' : 'Salvar senha'}
          </button>
        </form>
      </main>
    </div>
  );
}
```

`App.tsx`:

```tsx
import ChangePasswordPage from './pages/ChangePasswordPage';
import { AdminRoute } from './components/Auth/AdminRoute';
```

```tsx
    <Route element={<ProtectedRoutes />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/status/:jobId" element={<StatusPage />} />
      <Route path="/account/password" element={<ChangePasswordPage />} />
      <Route element={<AdminRoute />}>
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Route>
```

- [ ] **Step 7: Login page**

Em `LoginPage.tsx`: estado `const [oidcEnabled, setOidcEnabled] = useState(false);`, preenchido junto com `localLoginEnabled` a partir de `getAuthOptions()` (`false` no `catch`); envolver o botão "Entrar no login intranet" em `{oidcEnabled && (...)}` e o divisor "ou" em `{oidcEnabled && localLoginEnabled && (...)}`; acrescentar ao `OIDC_ERROR_MESSAGES`:

```ts
  unauthorized: 'Acesso não autorizado. Procure um administrador do BulkMail.',
  not_configured: 'O login pela intranet não está configurado.',
```

e, quando nenhum método estiver disponível (depois de carregar as opções):

```tsx
          {optionsLoaded && !oidcEnabled && !localLoginEnabled && (
            <p className="text-center text-sm text-gray-600">Nenhuma forma de login está disponível. Procure o suporte.</p>
          )}
```

com `const [optionsLoaded, setOptionsLoaded] = useState(false);` marcado no `finally` da busca das opções.

- [ ] **Step 8: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: todos PASS (incluindo `login.spec.ts` e os specs existentes do projeto `chromium`); lint e build limpos. Restaure `frontend/playwright-report/index.html` com `git checkout -- frontend/playwright-report` se o Playwright o reescrever.

- [ ] **Step 9: Commit**

```bash
git add frontend/src frontend/e2e
git commit -m "feat: shared navigation bar, admin-only settings link and own password page [Story 4.2]"
```

---

### Task 8: Layout de Configurações, Usuários e E-mail (AC 8–10, 14, 23)

**Files:**
- Create: `frontend/src/pages/settings/SettingsLayout.tsx`, `frontend/src/pages/settings/SettingsUsersPage.tsx`, `frontend/src/pages/settings/SettingsEmailPage.tsx`, `frontend/e2e/auth/settings.spec.ts`
- Delete: `frontend/src/pages/SettingsPage.tsx` (conteúdo movido)
- Modify: `frontend/src/services/api.ts`, `frontend/src/App.tsx`

**Interfaces:**
- Consumes (HTTP, Task 6): `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/password`; erros `{ error, message }`.
- Produces: `api.ts` — `ManagedUser`, `listUsers()`, `createLocalUser(input)`, `updateUserAccess(id, change)`, `resetUserPassword(id, password)`; rotas `/settings` (index → `users`), `/settings/users`, `/settings/email`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
// frontend/e2e/auth/settings.spec.ts
import { test, expect, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const admin = { userId: 'a', sub: 'local:a', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false };

const users = () => ([
  { id: '00000000-0000-4000-8000-000000000001', provider: 'local', username: 'admin', name: null, email: null, role: 'admin', disabled: false, mustChangePassword: false, lastLoginAt: '2026-10-10T12:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000002', provider: 'oidc', username: null, name: 'Ana Souza', email: 'ana@crefito11.gov.br', role: 'operator', disabled: false, mustChangePassword: false, lastLoginAt: null },
]);

const mockAdmin = async (page: Page) => {
  const state = { users: users() };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: true, data: admin })));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
  await page.route('**/api/config/mailgrid', (route: Route) => route.fulfill(json({ success: true, data: { host: 'smtp.mailgrid.net.br', user: 'u', pass: '', from_address: 'no-reply@crefito11.gov.br', from_name: 'CREFITO11', webhook_token: '', webhook_token_configured: true } })));
  await page.route('**/api/admin/users', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { username: string; role: string };
      if (body.username === 'admin') {
        await route.fulfill(json({ success: false, error: 'username_taken', message: 'O usuário "admin" já existe.' }, 409));
        return;
      }
      const created = { id: '00000000-0000-4000-8000-000000000003', provider: 'local', username: body.username, name: null, email: null, role: body.role, disabled: false, mustChangePassword: true, lastLoginAt: null };
      state.users.push(created);
      await route.fulfill(json({ success: true, data: created }, 201));
      return;
    }
    await route.fulfill(json({ success: true, data: state.users }));
  });
  await page.route('**/api/admin/users/*', async (route: Route) => {
    const id = route.request().url().split('/').pop();
    const change = route.request().postDataJSON() as { role?: string; disabled?: boolean };
    if (id === users()[0].id) {
      await route.fulfill(json({ success: false, error: 'last_active_admin', message: 'Não é possível desativar ou rebaixar o último administrador ativo.' }, 409));
      return;
    }
    const target = state.users.find((user) => user.id === id)!;
    Object.assign(target, change);
    await route.fulfill(json({ success: true, data: target }));
  });
  return state;
};

test.describe('Settings', () => {
  test('opens Users from /settings with a side menu', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/users$/);
    const menu = page.getByRole('navigation', { name: 'Configurações' }).filter({ visible: true });
    await expect(menu.getByRole('link', { name: 'Usuários' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'E-mail' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Login intranet' })).toBeVisible();
  });

  test('lists local and intranet users', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    const anaRow = page.getByRole('row', { name: /Ana Souza/ });
    await expect(anaRow).toContainText('Intranet');
    await expect(anaRow).toContainText('Operador');
    await expect(anaRow).toContainText('Nunca');
    await expect(page.getByRole('row', { name: /admin/ }).first()).toContainText('Administrador');
  });

  test('creates a local operator', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByLabel('Novo usuário').fill('joao.silva');
    await page.getByLabel('Senha inicial').fill('senha-inicial-123');
    await page.getByLabel('Perfil').selectOption('operator');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByRole('status')).toHaveText('Usuário "joao.silva" criado. A senha deverá ser trocada no primeiro acesso.');
    await expect(page.getByRole('row', { name: /joao\.silva/ })).toContainText('Operador');
  });

  test('shows the backend message when the action is refused', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByRole('row', { name: /admin/ }).first().getByRole('button', { name: 'Tornar operador' }).click();
    await expect(page.getByRole('alert')).toHaveText('Não é possível desativar ou rebaixar o último administrador ativo.');
  });

  test('promotes and disables other users', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    const anaRow = page.getByRole('row', { name: /Ana Souza/ });
    await anaRow.getByRole('button', { name: 'Tornar administrador' }).click();
    await expect(anaRow).toContainText('Administrador');
    await anaRow.getByRole('button', { name: 'Desativar' }).click();
    await expect(anaRow).toContainText('Desativado');
  });

  test('keeps the Mailgrid form under E-mail', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/email');
    await expect(page.locator('input[value="smtp.mailgrid.net.br"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx playwright test --project=auth-chromium e2e/auth/settings.spec.ts`
Expected: FAIL — `/settings/users` inexistente.

- [ ] **Step 3: API functions**

Em `api.ts`:

```ts
export interface ManagedUser {
  id: string;
  provider: 'local' | 'oidc';
  username: string | null;
  name: string | null;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export const listUsers = async (): Promise<ManagedUser[]> => {
  const response = await api.get<ConfigResponse<ManagedUser[]>>('/admin/users');
  return response.data.data;
};

export const createLocalUser = async (input: { username: string; password: string; role: UserRole }): Promise<ManagedUser> => {
  const response = await api.post<ConfigResponse<ManagedUser>>('/admin/users', input);
  return response.data.data;
};

export const updateUserAccess = async (id: string, change: { role?: UserRole; disabled?: boolean }): Promise<ManagedUser> => {
  const response = await api.patch<ConfigResponse<ManagedUser>>(`/admin/users/${id}`, change);
  return response.data.data;
};

export const resetUserPassword = async (id: string, password: string): Promise<void> => {
  await api.post(`/admin/users/${id}/password`, { password });
};
```

- [ ] **Step 4: Layout and Email page**

```tsx
// frontend/src/pages/settings/SettingsLayout.tsx
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { AppHeader } from '../../components/Layout/AppHeader';

const SECTIONS = [
  { to: '/settings/users', label: 'Usuários' },
  { to: '/settings/email', label: 'E-mail' },
  { to: '/settings/oidc', label: 'Login intranet' },
];

const sideLinkClass = ({ isActive }: { isActive: boolean }) => clsx(
  'block rounded-md px-3 py-2 text-sm font-medium',
  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-100',
);

const tabLinkClass = ({ isActive }: { isActive: boolean }) => clsx(
  'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
  isActive ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-600 hover:text-gray-900',
);

export function SettingsLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>

        <nav aria-label="Configurações" className="mt-4 flex gap-2 overflow-x-auto border-b border-gray-200 md:hidden">
          {SECTIONS.map((section) => (
            <NavLink key={section.to} to={section.to} className={tabLinkClass}>{section.label}</NavLink>
          ))}
        </nav>

        <div className="mt-6 flex gap-8">
          <aside className="hidden md:block w-56 shrink-0">
            <nav aria-label="Configurações" className="flex flex-col gap-1">
              {SECTIONS.map((section) => (
                <NavLink key={section.to} to={section.to} className={sideLinkClass}>{section.label}</NavLink>
              ))}
            </nav>
          </aside>
          <section className="flex-1 min-w-0">
            <Outlet />
          </section>
        </div>
      </div>
    </div>
  );
}
```

`SettingsEmailPage.tsx`: `git mv frontend/src/pages/SettingsPage.tsx frontend/src/pages/settings/SettingsEmailPage.tsx`, depois:
- renomear o componente para `export default function SettingsEmailPage()` (remova o export nomeado `SettingsPage` e qualquer `export default SettingsPage` antigo);
- ajustar os imports relativos (`'../services/api'` → `'../../services/api'`);
- remover o wrapper `<div className="min-h-screen bg-gray-50">`, o `<AppHeader />` e o bloco de título adicionados na Task 7; o retorno passa a começar pelo conteúdo do antigo `<main>`, com `<h2 className="text-lg font-semibold text-gray-900">E-mail (Mailgrid)</h2>` e `<p className="text-sm text-gray-600 mt-1 mb-6">Credenciais da API Mailgrid usadas nos envios.</p>` no topo e o `<main>` trocado por `<div>`;
- o estado de carregamento (spinner em tela cheia) vira `<div className="flex justify-center py-12">…spinner…</div>`.

- [ ] **Step 5: Users page**

```tsx
// frontend/src/pages/settings/SettingsUsersPage.tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  apiErrorMessage, createLocalUser, listUsers, resetUserPassword, updateUserAccess,
  type ManagedUser, type UserRole,
} from '../../services/api';

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Administrador', operator: 'Operador' };
const inputClassName = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const actionClassName = 'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60';

const displayName = (user: ManagedUser): string => user.name ?? user.username ?? user.email ?? user.id;

const formatLastLogin = (value: string | null): string =>
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca';

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('admin');
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Não foi possível carregar os usuários.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const replace = (updated: ManagedUser) => setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(apiErrorMessage(actionError, 'Não foi possível concluir a ação.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createLocalUser({ username, password, role });
      setUsers((current) => [...current, created]);
      setNotice(`Usuário "${created.username}" criado. A senha deverá ser trocada no primeiro acesso.`);
      setUsername('');
      setPassword('');
      setRole('admin');
    } catch (createError) {
      setError(apiErrorMessage(createError, 'Não foi possível criar o usuário.'));
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>, user: ManagedUser) => {
    event.preventDefault();
    await run(user.id, async () => {
      await resetUserPassword(user.id, newPassword);
      setNotice(`Senha de "${displayName(user)}" definida. Ela deverá ser trocada no próximo acesso.`);
      setPasswordFor(null);
      setNewPassword('');
      replace({ ...user, mustChangePassword: true });
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Usuários</h2>
        <p className="text-sm text-gray-600 mt-1">Usuários da intranet aparecem aqui após o primeiro acesso.</p>
      </div>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Último acesso</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Carregando...</td></tr>
            )}
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{displayName(user)}</div>
                  {user.email && <div className="text-xs text-gray-500">{user.email}</div>}
                </td>
                <td className="px-4 py-3 text-gray-700">{user.provider === 'local' ? 'Local' : 'Intranet'}</td>
                <td className="px-4 py-3 text-gray-700">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-3 text-gray-700">
                  {user.disabled ? 'Desativado' : 'Ativo'}
                  {user.mustChangePassword && <div className="text-xs text-amber-700">Troca de senha pendente</div>}
                </td>
                <td className="px-4 py-3 text-gray-700">{formatLastLogin(user.lastLoginAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={actionClassName}
                      disabled={busyId === user.id}
                      onClick={() => void run(user.id, async () => replace(await updateUserAccess(user.id, { role: user.role === 'admin' ? 'operator' : 'admin' })))}
                    >
                      {user.role === 'admin' ? 'Tornar operador' : 'Tornar administrador'}
                    </button>
                    <button
                      type="button"
                      className={actionClassName}
                      disabled={busyId === user.id}
                      onClick={() => void run(user.id, async () => replace(await updateUserAccess(user.id, { disabled: !user.disabled })))}
                    >
                      {user.disabled ? 'Reativar' : 'Desativar'}
                    </button>
                    {user.provider === 'local' && (
                      <button type="button" className={actionClassName} onClick={() => { setPasswordFor(user.id); setNewPassword(''); }}>
                        Definir senha
                      </button>
                    )}
                  </div>
                  {passwordFor === user.id && (
                    <form className="mt-2 flex gap-2" onSubmit={(event) => void handleResetPassword(event, user)}>
                      <label htmlFor={`password-${user.id}`} className="sr-only">Nova senha para {displayName(user)}</label>
                      <input id={`password-${user.id}`} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900" />
                      <button type="submit" className={actionClassName} disabled={!newPassword || busyId === user.id}>Salvar</button>
                      <button type="button" className={actionClassName} onClick={() => setPasswordFor(null)}>Cancelar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="rounded-lg bg-white p-6 shadow-sm space-y-4" onSubmit={(event) => void handleCreate(event)} noValidate>
        <h3 className="text-base font-semibold text-gray-900">Criar usuário local</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="new-username" className="block text-sm font-medium text-gray-700">Novo usuário</label>
            <input id="new-username" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className={inputClassName} />
          </div>
          <div>
            <label htmlFor="initial-password" className="block text-sm font-medium text-gray-700">Senha inicial</label>
            <input id="initial-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClassName} />
          </div>
          <div>
            <label htmlFor="new-role" className="block text-sm font-medium text-gray-700">Perfil</label>
            <select id="new-role" value={role} onChange={(event) => setRole(event.target.value as UserRole)} className={inputClassName}>
              <option value="admin">Administrador</option>
              <option value="operator">Operador</option>
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !username.trim() || !password}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {creating ? 'Criando...' : 'Criar usuário'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Routes**

`App.tsx` — remover o import de `SettingsPage` e:

```tsx
import { Navigate } from 'react-router-dom';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import SettingsUsersPage from './pages/settings/SettingsUsersPage';
import SettingsEmailPage from './pages/settings/SettingsEmailPage';
```

```tsx
      <Route element={<AdminRoute />}>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<SettingsUsersPage />} />
          <Route path="email" element={<SettingsEmailPage />} />
        </Route>
      </Route>
```

(`Navigate` pode vir no mesmo import de `react-router-dom` já existente.)

- [ ] **Step 7: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: PASS; restaure `frontend/playwright-report` se alterado.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src frontend/e2e
git commit -m "feat: settings layout with side menu, users and e-mail sections [Story 4.2]"
```

---

### Task 9: Configuração do login pela intranet (AC 15, 16, 17)

**Files:**
- Create: `frontend/src/pages/settings/SettingsOidcPage.tsx`
- Modify: `frontend/src/services/api.ts`, `frontend/src/App.tsx`, `frontend/e2e/auth/settings.spec.ts`

**Interfaces:**
- Consumes (HTTP, Task 6): `GET|POST /api/config/oidc`, `POST /api/config/oidc/test`.
- Produces: `api.ts` — `OidcConfig`, `getOidcConfig()`, `saveOidcConfig(input)`, `testOidcConfig(input)`; rota `/settings/oidc`.

- [ ] **Step 1: Write the failing e2e tests**

Acrescentar a `settings.spec.ts`:

```ts
const oidcConfig = {
  enabled: true, issuer: 'https://intranet.crefito11.gov.br', clientId: 'bulkmail', clientSecret: '',
  clientSecretConfigured: true, backchannelOrigin: '', callbackUrl: 'http://127.0.0.1:5174/api/auth/oidc/callback',
};

test.describe('Intranet login settings', () => {
  test('shows the stored settings and the callback URL', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', (route: Route) => route.fulfill(json({ success: true, data: oidcConfig })));
    await page.goto('/settings/oidc');
    await expect(page.getByLabel('Ativar login pela intranet')).toBeChecked();
    await expect(page.getByLabel('Issuer')).toHaveValue('https://intranet.crefito11.gov.br');
    await expect(page.getByLabel('Client secret')).toHaveAttribute('placeholder', 'Configurado — deixe em branco para manter');
    await expect(page.getByLabel('URL de callback')).toHaveValue('http://127.0.0.1:5174/api/auth/oidc/callback');
  });

  test('tests the connection without saving', async ({ page }) => {
    await mockAdmin(page);
    let saved = false;
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') saved = true;
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.route('**/api/config/oidc/test', (route: Route) => route.fulfill(json({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' })));
    await page.goto('/settings/oidc');
    await page.getByRole('button', { name: 'Testar' }).click();
    await expect(page.getByRole('status')).toHaveText('Conexão validada: discovery e chaves de assinatura encontrados.');
    expect(saved).toBe(false);
  });

  test('saves and shows validation errors from the server', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { issuer: string; clientSecret: string };
        expect(body.clientSecret).toBe('');
        if (body.issuer.startsWith('http://')) {
          await route.fulfill(json({ success: false, error: 'invalid_oidc_settings', message: 'O issuer precisa usar HTTPS fora do ambiente local.' }, 400));
          return;
        }
        await route.fulfill(json({ success: true, message: 'Configuração do login pela intranet salva.' }));
        return;
      }
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.goto('/settings/oidc');
    await page.getByLabel('Issuer').fill('http://intranet.crefito11.gov.br');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('alert')).toHaveText('O issuer precisa usar HTTPS fora do ambiente local.');
    await page.getByLabel('Issuer').fill('https://intranet.crefito11.gov.br');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Configuração do login pela intranet salva.');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx playwright test --project=auth-chromium e2e/auth/settings.spec.ts`
Expected: FAIL — `/settings/oidc` inexistente.

- [ ] **Step 3: API functions**

```ts
export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientSecretConfigured: boolean;
  backchannelOrigin: string;
  callbackUrl: string;
}

export type OidcConfigInput = Pick<OidcConfig, 'enabled' | 'issuer' | 'clientId' | 'clientSecret' | 'backchannelOrigin'>;

export const getOidcConfig = async (): Promise<OidcConfig> => {
  const response = await api.get<ConfigResponse<OidcConfig>>('/config/oidc');
  return response.data.data;
};

export const saveOidcConfig = async (input: OidcConfigInput): Promise<string> => {
  const response = await api.post<{ success: boolean; message: string }>('/config/oidc', input);
  return response.data.message;
};

export const testOidcConfig = async (input: OidcConfigInput): Promise<string> => {
  const response = await api.post<{ success: boolean; message: string }>('/config/oidc/test', input);
  return response.data.message;
};
```

- [ ] **Step 4: Page and route**

```tsx
// frontend/src/pages/settings/SettingsOidcPage.tsx
import { useEffect, useState, type FormEvent } from 'react';
import {
  apiErrorMessage, getOidcConfig, saveOidcConfig, testOidcConfig, type OidcConfig, type OidcConfigInput,
} from '../../services/api';

const inputClassName = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const secondaryButton = 'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60';

export default function SettingsOidcPage() {
  const [config, setConfig] = useState<OidcConfig | null>(null);
  const [form, setForm] = useState<OidcConfigInput>({ enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getOidcConfig()
      .then((loaded) => {
        setConfig(loaded);
        setForm({ enabled: loaded.enabled, issuer: loaded.issuer, clientId: loaded.clientId, clientSecret: '', backchannelOrigin: loaded.backchannelOrigin });
      })
      .catch((loadError) => setError(apiErrorMessage(loadError, 'Não foi possível carregar a configuração.')));
  }, []);

  const update = <K extends keyof OidcConfigInput>(key: K, value: OidcConfigInput[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (kind: 'save' | 'test') => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      setNotice(kind === 'save' ? await saveOidcConfig(form) : await testOidcConfig(form));
      if (kind === 'save' && form.clientSecret && config) {
        setConfig({ ...config, clientSecretConfigured: true });
        update('clientSecret', '');
      }
    } catch (submitError) {
      setError(apiErrorMessage(submitError, kind === 'save' ? 'Não foi possível salvar.' : 'Não foi possível testar a conexão.'));
    } finally {
      setBusy(null);
    }
  };

  const copyCallback = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(config.callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit('save');
  };

  if (!config && !error) return <div className="py-12 text-center text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Login intranet</h2>
        <p className="text-sm text-gray-600 mt-1">Conexão OIDC com a intranet do CREFITO 11.</p>
      </div>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {config && (
        <form className="space-y-4 rounded-lg bg-white p-6 shadow-sm" onSubmit={handleSubmit} noValidate>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} />
            Ativar login pela intranet
          </label>

          <div>
            <label htmlFor="oidc-issuer" className="block text-sm font-medium text-gray-700">Issuer</label>
            <input id="oidc-issuer" value={form.issuer} onChange={(event) => update('issuer', event.target.value)} className={inputClassName} placeholder="https://intranet.crefito11.gov.br" />
          </div>
          <div>
            <label htmlFor="oidc-client-id" className="block text-sm font-medium text-gray-700">Client ID</label>
            <input id="oidc-client-id" value={form.clientId} onChange={(event) => update('clientId', event.target.value)} className={inputClassName} />
          </div>
          <div>
            <label htmlFor="oidc-client-secret" className="block text-sm font-medium text-gray-700">Client secret</label>
            <input
              id="oidc-client-secret"
              type="password"
              autoComplete="new-password"
              value={form.clientSecret}
              onChange={(event) => update('clientSecret', event.target.value)}
              className={inputClassName}
              placeholder={config.clientSecretConfigured ? 'Configurado — deixe em branco para manter' : ''}
            />
          </div>
          <div>
            <label htmlFor="oidc-backchannel" className="block text-sm font-medium text-gray-700">Backchannel origin</label>
            <input id="oidc-backchannel" value={form.backchannelOrigin} onChange={(event) => update('backchannelOrigin', event.target.value)} className={inputClassName} />
            <p className="mt-1 text-xs text-gray-500">Somente para desenvolvimento local; deixe em branco em produção.</p>
          </div>
          <div>
            <label htmlFor="oidc-callback" className="block text-sm font-medium text-gray-700">URL de callback</label>
            <div className="mt-1 flex gap-2">
              <input id="oidc-callback" readOnly value={config.callbackUrl} className={`${inputClassName} mt-0 bg-gray-50`} />
              <button type="button" className={secondaryButton} onClick={() => void copyCallback()}>{copied ? 'Copiado!' : 'Copiar'}</button>
            </div>
            <p className="mt-1 text-xs text-gray-500">Cadastre esta URL no cliente OIDC da intranet.</p>
          </div>

          <div className="flex gap-3">
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void submit('test')}>
              {busy === 'test' ? 'Testando...' : 'Testar'}
            </button>
            <button type="submit" disabled={busy !== null} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
              {busy === 'save' ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
```

`App.tsx`: `import SettingsOidcPage from './pages/settings/SettingsOidcPage';` e, dentro de `/settings`, `<Route path="oidc" element={<SettingsOidcPage />} />`.

- [ ] **Step 5: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: PASS; restaure `frontend/playwright-report` se alterado.

- [ ] **Step 6: Commit**

```bash
git add frontend/src frontend/e2e
git commit -m "feat: intranet login settings page with connection test [Story 4.2]"
```

---

### Task 10: Deploy, runbook e verificação (AC 19, 20, 21)

**Files:**
- Modify: `docker-compose.prod.yml`, `docker-compose.yml`, `deploy/production.env.example`, `.env.example`, `docs/production.md`, `docs/stories/4.2.feat-settings-admin.story.md`

- [ ] **Step 1: Make OIDC variables optional**

`docker-compose.prod.yml` (backend): `OIDC_ISSUER: ${OIDC_ISSUER:-}` e `OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-}` no lugar das formas `:?`.
`docker-compose.yml` (backend): `OIDC_ISSUER: ${OIDC_ISSUER:-}` e `OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-}`.

`deploy/production.env.example`, antes das linhas `OIDC_*` e `MAILGRID_*`:

```bash
# Apenas importação inicial (Story 4.2): no primeiro start estes valores são copiados
# para o banco se ele ainda não tiver a configuração. Depois, configure em
# Configurações → Login intranet / E-mail; estas variáveis passam a ser ignoradas.
```

`.env.example`: o mesmo comentário antes de `OIDC_ISSUER` e antes de `MAILGRID_HOST`.

- [ ] **Step 2: Runbook**

Em `docs/production.md`, nova seção antes de `## Usuários locais (login por senha)`:

````markdown
## Configurações no banco (Mailgrid e login pela intranet)

Desde a Story 4.2, Mailgrid e OIDC são configurados em **Configurações** (somente
administradores) e ficam na tabela `configurations`, com segredos criptografados por
`CONFIG_ENCRYPTION_KEY`. Continuam no ambiente: Postgres, Redis, `APP_ORIGIN`,
`CONFIG_ENCRYPTION_KEY`, `OIDC_SESSION_ENCRYPTION_KEY`, `TRUST_PROXY_HOPS` e
`LOCAL_LOGIN_ENABLED`.

No primeiro start da nova versão, se o banco não tiver a configuração, o backend copia
uma única vez os valores atuais de `MAILGRID_*` e `OIDC_*` (incluindo os Docker secrets).
Confirme a importação:

```bash
docker service logs --since 10m bulkmail_backend | grep 'settings.import_environment'
```

Depois, entre como administrador e confira **Configurações → E-mail** e
**Configurações → Login intranet** (use **Testar**). A partir daí, alterações feitas no
`.env` ou nos secrets do Mailgrid/OIDC não têm efeito.

### Perfis

- Usuários da intranet entram como **Operador** no primeiro acesso; promova-os em
  **Configurações → Usuários**.
- Sessões abertas antes do deploy continuam válidas; os usuários aparecem como Operador.
  Garanta que exista ao menos um administrador local (`npm run user:admin -- create`)
  antes de depender da tela.

### Retirada das variáveis antigas (follow-up)

Depois de validar a importação em produção, uma story seguinte remove de
`docker-compose.prod.yml`, `deploy/production.env`, `scripts/production/bootstrap.sh` e
`scripts/production/deploy.sh` as variáveis `MAILGRID_*`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_BACKCHANNEL_ORIGIN` e os secrets `bulkmail_mailgrid_password`,
`bulkmail_mailgrid_webhook_token` e `bulkmail_oidc_client_secret`. Não remova
`bulkmail_config_encryption_key` nem `bulkmail_oidc_session_encryption_key`.
````

Na seção `## Usuários locais (login por senha)`, acrescentar no início:

```markdown
Administradores também criam usuários, definem senhas, alteram perfis e desativam
contas em **Configurações → Usuários**. Os comandos abaixo continuam disponíveis como
acesso de emergência e sempre criam administradores.
```

- [ ] **Step 3: Full verification**

```bash
cd backend && npx tsc --noEmit && npm run lint && npx jest
cd ../frontend && npm run lint && npm run build && npx playwright test --project=auth-chromium --project=chromium
git checkout -- playwright-report 2>/dev/null || true
```

Com Postgres descartável (seção "Banco de teste"):

```bash
cd backend && POSTGRES_PORT=55432 npm run migrate && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories --runInBand
```

Validar os compose:

```bash
POSTGRES_USER=x POSTGRES_DB=x APP_ORIGIN=x CREFITO11_LOGO_URL=x BACKEND_IMAGE=x FRONTEND_IMAGE=x docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml config --quiet
```

Expected: tudo verde; os compose validam sem `OIDC_ISSUER`/`OIDC_CLIENT_ID`.

- [ ] **Step 4: Story record**

Em `docs/stories/4.2.feat-settings-admin.story.md`: `status: "InReview"` e `InReview` em `## Status`; `### File List` com a saída de `git diff --name-only main..HEAD` mais os arquivos desta task; Change Log: `| 2026-10-10 | 0.2 | Implementação concluída; status Draft → InReview | Claude |`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml docker-compose.yml deploy/production.env.example .env.example docs/production.md docs/stories/4.2.feat-settings-admin.story.md
git commit -m "docs: settings in database runbook and optional OIDC env [Story 4.2]"
```

- [ ] **Step 6: Post-deploy checklist (executado pelo usuário)**

1. `./scripts/production/deploy.sh`; conferir o log `settings.import_environment`.
2. Entrar com o admin local; abrir **Configurações → E-mail** e **Login intranet**; usar **Testar**.
3. Entrar pela intranet numa janela anônima: deve aparecer como Operador, sem o link Configurações; promover pelo admin e recarregar.
4. Criar um usuário local de teste, entrar com ele, confirmar a troca obrigatória de senha e depois desativá-lo.
