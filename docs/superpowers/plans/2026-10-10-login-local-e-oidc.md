# Login local e OIDC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a página `/login` com duas formas de entrada — intranet do CREFITO 11 (OIDC, já existente) e usuário/senha locais — e um comando para administrar o usuário admin local.

**Architecture:** O backend ganha uma tabela `local_users`, um serviço de autenticação local (scrypt + limite de tentativas no Redis) e um segundo tipo de sessão no Redis (`provider: 'local'`) ao lado da sessão OIDC existente. O frontend deixa de redirecionar automaticamente para o OIDC: rotas protegidas mandam para `/login?next=...`, que oferece o botão da intranet e o formulário local. Um CLI compilado (`npm run user:admin`) cria, reseta, desativa e reativa usuários locais dentro do container.

**Tech Stack:** Express 4 + TypeScript, Knex 3 / PostgreSQL 18, ioredis, Jest 29 (ts-jest), React 18 + React Router 7 + Tailwind 3 (Vite 5), Playwright.

**Spec:** `docs/stories/4.1.feat-login-local-e-oidc.story.md` (ACs numerados 1–23; cada task cita os ACs que cobre).

## Global Constraints

- Hash de senha: `crypto.scrypt` do Node, sal de 16 bytes, `N=16384`, `r=8`, `p=1`, chave de 64 bytes. Nenhuma dependência nova de hash.
- Política de senha: mínimo 12, máximo 128 caracteres (contados por code point).
- Nome de usuário: `^[a-z0-9._-]{3,64}$` após `trim().toLowerCase()`.
- Limite de tentativas: 5 falhas por par usuário+IP **ou** 20 falhas por IP, janela de 15 minutos (900 s).
- Sessão local: 8 horas fixas (`SESSION_TTL_SECONDS` existente), sem renovação.
- Cookie de sessão: mesmo `SESSION_COOKIE`/`cookieOptions` existentes.
- Respostas do login local: `200` sucesso, `400 invalid_request`, `401 invalid_credentials`, `404` quando desativado, `429 too_many_attempts`.
- `LOCAL_LOGIN_ENABLED` padrão `true`; `TRUST_PROXY_HOPS` padrão `1`.
- Textos da interface em português; o botão da intranet diz exatamente **"Entrar no login intranet"**.
- Nenhuma senha em log, resposta HTTP, arquivo, secret ou migration.
- Não alterar o prefixo Redis `oidc:session:` (sessões existentes precisam continuar válidas).
- Commits convencionais com `[Story 4.1]`; push é exclusivo do @devops.

## Review Focus

1. **IP real atrás de Traefik → Nginx → backend.** Com `trust proxy = 1`, `req.ip` pode ser o IP do Traefik para todos os usuários, e o limite por IP vira um bloqueio global. Esperado: o hop é configurável e o runbook manda verificar o IP logado após o deploy. Teste: `trustProxyHops` (Task 7).
2. **Sessões OIDC já abertas no Redis no momento do deploy (sem `provider`).** Esperado: continuam válidas como `oidc`. Teste: "accepts legacy sessions without provider as OIDC" (Task 5).
3. **Usuário digitado como `" Admin "`.** Esperado: autentica como `admin`, e o contador de tentativas usa o nome normalizado. Teste: "normalizes the username before every lookup" (Task 4).
4. **Senha resetada ou usuário desativado com sessão aberta.** Esperado: a sessão cai imediatamente, não em até 8 h. Testes: "revokes every session of a local user" (Task 5) e "reset-password revokes active sessions" (Task 8).
5. **Redis indisponível durante o login.** Esperado: erro 500 genérico pelo handler de erros, sem cookie e sem sessão. Teste: "forwards infrastructure failures to the error handler" (Task 6).

---

## File Structure

**Backend — criar**
- `backend/src/services/passwordHasher.ts` — hash/verificação scrypt, política de senha, verificação simulada.
- `backend/src/services/loginAttemptLimiter.ts` — contadores de falhas no Redis.
- `backend/src/migrations/20261010000000_create_local_users.ts` — tabela `local_users`.
- `backend/src/repositories/localUserRepository.ts` — `LocalUserStore` + implementação Knex.
- `backend/src/services/localAuthService.ts` — regra de autenticação local (sem HTTP).
- `backend/src/services/localUserAdminService.ts` — criar/resetar/desativar/reativar.
- `backend/src/controllers/localAuthController.ts` — handlers HTTP `options` e `login`.
- `backend/src/config/localAuth.ts` — flag `LOCAL_LOGIN_ENABLED`.
- `backend/src/utils/returnTo.ts` — saneamento do `next`.
- `backend/src/scripts/manageLocalAdmin.ts` — CLI.
- Testes: `*.test.ts` ao lado de cada arquivo; `backend/src/routes/authRoutes.test.ts`; `backend/src/repositories/localUserRepository.integration.test.ts`; `backend/src/middlewares/security.test.ts`.

**Backend — modificar**
- `backend/src/services/authSessionService.ts` — sessão `local`/`oidc`, `returnTo` na transação OIDC, revogação por usuário.
- `backend/src/middlewares/authentication.ts` — exportar `SESSION_COOKIE_MAX_AGE`.
- `backend/src/routes/authRoutes.ts` — novas rotas, `next` no OIDC, logout e `/me` por provider.
- `backend/src/middlewares/security.ts` — `trustProxyHops()`.
- `backend/src/services/databaseService.ts` — `getLocalUserRepository()`.
- `backend/package.json` — scripts `user:admin`, `user:admin:dev`, `test:integration`.

**Frontend — criar**
- `frontend/src/pages/LoginPage.tsx`, `frontend/src/utils/returnTo.ts`, `frontend/src/assets/crefito11-logo-negativo.png`, `frontend/e2e/auth/login.spec.ts`.

**Frontend — modificar**
- `frontend/src/services/api.ts`, `frontend/src/components/Auth/AuthProvider.tsx`, `frontend/src/App.tsx`, `frontend/playwright.config.ts`.

**Infra/docs — modificar**
- `docker-compose.prod.yml`, `docker-compose.yml`, `deploy/production.env.example`, `.env.example`, `docs/production.md`, `docs/stories/4.1.feat-login-local-e-oidc.story.md`.

---

### Task 1: Password hasher (AC 11)

**Files:**
- Create: `backend/src/services/passwordHasher.ts`
- Test: `backend/src/services/passwordHasher.test.ts`

**Interfaces:**
- Produces:
  - `PASSWORD_MIN_LENGTH = 12`, `PASSWORD_MAX_LENGTH = 128`
  - `validatePasswordPolicy(password: string): string | null` (mensagem em português ou `null`)
  - `hashPassword(password: string): Promise<string>` → `scrypt$16384$8$1$<saltB64>$<keyB64>`
  - `verifyPassword(password: string, stored: string): Promise<boolean>` (nunca lança para hash malformado)
  - `verifyAgainstDummy(password: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/passwordHasher.test.ts
import {
  hashPassword,
  validatePasswordPolicy,
  verifyAgainstDummy,
  verifyPassword,
} from './passwordHasher';

describe('passwordHasher', () => {
  it('verifies the original password and rejects a different one', async () => {
    const stored = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', stored)).resolves.toBe(false);
  });

  it('stores scrypt parameters and a random salt', async () => {
    const first = await hashPassword('same password here');
    const second = await hashPassword('same password here');
    expect(first.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(first).not.toBe(second);
  });

  it.each(['', 'bcrypt$abc', 'scrypt$x$8$1$c2FsdA==$a2V5', 'scrypt$16384$8$1$c2FsdA==$c2hvcnQ=', 'scrypt$1073741824$8$1$c2FsdA==$a2V5'])(
    'treats malformed stored hash %p as a mismatch',
    async (stored) => {
      await expect(verifyPassword('anything at all', stored)).resolves.toBe(false);
    },
  );

  it.each([
    ['a'.repeat(11), 'A senha deve ter pelo menos 12 caracteres.'],
    ['a'.repeat(12), null],
    ['a'.repeat(128), null],
    ['a'.repeat(129), 'A senha deve ter no máximo 128 caracteres.'],
    ['ç'.repeat(12), null],
  ])('applies the password policy to %p', (password, expected) => {
    expect(validatePasswordPolicy(password)).toBe(expected);
  });

  it('runs a dummy verification without throwing', async () => {
    await expect(verifyAgainstDummy('whatever password')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/passwordHasher.test.ts`
Expected: FAIL — `Cannot find module './passwordHasher'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/passwordHasher.ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const ALGORITHM = 'scrypt';
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_ACCEPTED_COST = 1_048_576;
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

export const validatePasswordPolicy = (password: string): string | null => {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (length > PASSWORD_MAX_LENGTH) return `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  return null;
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION });
  return [ALGORITHM, COST, BLOCK_SIZE, PARALLELIZATION, salt.toString('base64'), key.toString('base64')].join('$');
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;
  const [cost, blockSize, parallelization] = parts.slice(1, 4).map(Number);
  if (![cost, blockSize, parallelization].every(Number.isSafeInteger) || cost > MAX_ACCEPTED_COST) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await scrypt(password, salt, KEY_LENGTH, { N: cost, r: blockSize, p: parallelization });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

let dummyHash: Promise<string> | null = null;

// Equalizes response time for unknown usernames so they cannot be enumerated.
export const verifyAgainstDummy = async (password: string): Promise<void> => {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/passwordHasher.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/passwordHasher.ts backend/src/services/passwordHasher.test.ts
git commit -m "feat: add scrypt password hasher [Story 4.1]"
```

---

### Task 2: Login attempt limiter (AC 10)

**Files:**
- Create: `backend/src/services/loginAttemptLimiter.ts`
- Test: `backend/src/services/loginAttemptLimiter.test.ts`

**Interfaces:**
- Consumes: `getRedisClient()` de `backend/src/config/redis.ts` (ioredis: `get`, `incr`, `expire`, `del`).
- Produces:
  - `LOGIN_WINDOW_SECONDS = 900`, `MAX_FAILURES_PER_USER_AND_IP = 5`, `MAX_FAILURES_PER_IP = 20`
  - `isLoginBlocked(username: string, ip: string): Promise<boolean>`
  - `registerFailedLogin(username: string, ip: string): Promise<void>`
  - `clearFailedLogins(username: string, ip: string): Promise<void>` (zera só o par usuário+IP)
  - `username` já chega normalizado (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/loginAttemptLimiter.test.ts
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
```

(Duas chamadas de `expire`: uma para a chave do par e uma para a do IP, ambas na primeira falha.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/loginAttemptLimiter.test.ts`
Expected: FAIL — `Cannot find module './loginAttemptLimiter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/loginAttemptLimiter.ts
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

const increment = async (key: string): Promise<void> => {
  const redis = getRedisClient();
  const total = await redis.incr(key);
  if (total === 1) await redis.expire(key, LOGIN_WINDOW_SECONDS);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/loginAttemptLimiter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/loginAttemptLimiter.ts backend/src/services/loginAttemptLimiter.test.ts
git commit -m "feat: add Redis login attempt limiter [Story 4.1]"
```

---

### Task 3: `local_users` table and repository (AC 18)

**Files:**
- Create: `backend/src/migrations/20261010000000_create_local_users.ts`
- Create: `backend/src/repositories/localUserRepository.ts`
- Modify: `backend/src/services/databaseService.ts` (novo singleton e getter)
- Modify: `backend/package.json` (`test:integration`)
- Test: `backend/src/repositories/localUserRepository.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
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
  export class LocalUserRepository implements LocalUserStore
  export const createLocalUserRepository: (db: Knex) => LocalUserRepository
  // databaseService.ts
  export const getLocalUserRepository: () => LocalUserRepository
  ```

- [ ] **Step 1: Write the failing integration test**

```ts
// backend/src/repositories/localUserRepository.integration.test.ts
import knex, { Knex } from 'knex';
import { LocalUserRepository } from './localUserRepository';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('LocalUserRepository PostgreSQL integration', () => {
  let database: Knex;
  let repository: LocalUserRepository;
  const username = `it-${Date.now()}`;

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
      pool: { min: 0, max: 2 },
    });
    repository = new LocalUserRepository(database);
  });

  afterAll(async () => {
    await database('local_users').where({ username }).delete();
    await database.destroy();
  });

  it('creates, finds, updates, disables and records logins', async () => {
    const created = await repository.create({ username, passwordHash: 'hash-1' });
    await expect(repository.findByUsername(username)).resolves.toEqual({
      id: created.id,
      username,
      passwordHash: 'hash-1',
      disabledAt: null,
      lastLoginAt: null,
    });

    await repository.updatePassword(created.id, 'hash-2');
    await repository.setDisabled(created.id, true);
    await repository.recordLogin(created.id);
    const updated = await repository.findByUsername(username);
    expect(updated?.passwordHash).toBe('hash-2');
    expect(updated?.disabledAt).toBeInstanceOf(Date);
    expect(updated?.lastLoginAt).toBeInstanceOf(Date);

    await repository.setDisabled(created.id, false);
    expect((await repository.findByUsername(username))?.disabledAt).toBeNull();
  });

  it('returns null for an unknown username', async () => {
    await expect(repository.findByUsername('nobody-here')).resolves.toBeNull();
  });

  it('rejects usernames that are not lowercase', async () => {
    await expect(repository.create({ username: `UP-${Date.now()}`, passwordHash: 'hash' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Pré-requisito: Postgres de desenvolvimento ativo (`docker compose up -d postgres`).
Run: `cd backend && RUN_DATABASE_INTEGRATION=true npx jest src/repositories/localUserRepository.integration.test.ts`
Expected: FAIL — `Cannot find module './localUserRepository'`.
(Sem Postgres local, rode sem a variável: a suíte aparece como `skipped`; nesse caso registre na story que a verificação de integração ficou pendente e siga com `npx tsc --noEmit`.)

- [ ] **Step 3: Write the migration**

```ts
// backend/src/migrations/20261010000000_create_local_users.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("local_users", (table) => {
    table.uuid("id").primary();
    table.string("username", 64).notNullable().unique();
    table.text("password_hash").notNullable();
    table.timestamp("disabled_at", { useTz: true }).nullable();
    table.timestamp("last_login_at", { useTz: true }).nullable();
    table.timestamps(true, true);
  });

  await knex.raw(
    "ALTER TABLE local_users ADD CONSTRAINT local_users_username_lowercase CHECK (username = lower(username))",
  );

  await knex.raw(`
    CREATE TRIGGER update_local_users_updated_at
    BEFORE UPDATE ON local_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw("COMMENT ON TABLE local_users IS 'Local username/password accounts used alongside OIDC login'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("local_users");
}
```

- [ ] **Step 4: Write the repository**

```ts
// backend/src/repositories/localUserRepository.ts
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
```

- [ ] **Step 5: Register the repository in `databaseService.ts`**

Adicionar o import junto aos demais:

```ts
import {
  LocalUserRepository,
  createLocalUserRepository,
} from "../repositories/localUserRepository";
```

Adicionar o singleton ao lado de `configService`:

```ts
let localUserRepository: LocalUserRepository | null = null;
```

Dentro de `initializeDatabase`, depois de `configService = createConfigService(db);`:

```ts
    localUserRepository = createLocalUserRepository(db);
```

Adicionar o getter seguindo o padrão de `getJobRepository`:

```ts
/**
 * Get LocalUserRepository instance
 */
export const getLocalUserRepository = (): LocalUserRepository => {
  if (!localUserRepository) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return localUserRepository;
};
```

Se `shutdownDatabase` zera os singletons (`jobRepository = null` etc.), acrescentar `localUserRepository = null;` no mesmo bloco.

- [ ] **Step 6: Add the test to `test:integration` in `backend/package.json`**

```json
"test:integration": "RUN_DATABASE_INTEGRATION=true RUN_REDIS_INTEGRATION=true jest src/repositories/emailLogRepository.integration.test.ts src/repositories/localUserRepository.integration.test.ts src/queue/emailQueue.integration.test.ts --runInBand",
```

- [ ] **Step 7: Run migration and test**

Run: `cd backend && npm run migrate && RUN_DATABASE_INTEGRATION=true npx jest src/repositories/localUserRepository.integration.test.ts`
Expected: migration `20261010000000_create_local_users` aplicada; 3 testes PASS.
Run também: `cd backend && npx tsc --noEmit` → sem erros.

- [ ] **Step 8: Commit**

```bash
git add backend/src/migrations/20261010000000_create_local_users.ts backend/src/repositories/localUserRepository.ts backend/src/repositories/localUserRepository.integration.test.ts backend/src/services/databaseService.ts backend/package.json
git commit -m "feat: add local_users table and repository [Story 4.1]"
```

---

### Task 4: Local authentication service (AC 8, 9, 10, 12)

**Files:**
- Create: `backend/src/services/localAuthService.ts`
- Test: `backend/src/services/localAuthService.test.ts`

**Interfaces:**
- Consumes: `LocalUser`, `LocalUserStore` (Task 3); assinaturas do limitador (Task 2) e do hasher (Task 1), injetadas.
- Produces:
  ```ts
  export const normalizeUsername: (username: string) => string;
  export interface LocalAuthInput { username: string; password: string; ip: string }
  export type LocalAuthResult =
    | { ok: true; user: LocalUser }
    | { ok: false; reason: 'invalid_credentials' | 'blocked' };
  export interface LocalAuthLogEvent {
    outcome: 'success' | 'failure' | 'blocked';
    username: string;
    ip: string;
    reason?: 'unknown_user' | 'wrong_password' | 'disabled' | 'too_many_attempts';
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
  export const createLocalAuthService: (deps: LocalAuthDependencies) => {
    authenticate(input: LocalAuthInput): Promise<LocalAuthResult>;
  };
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/localAuthService.test.ts
import type { LocalUser } from '../repositories/localUserRepository';
import { createLocalAuthService, LocalAuthDependencies } from './localAuthService';

const activeAdmin: LocalUser = {
  id: 'user-1',
  username: 'admin',
  passwordHash: 'hash:correct password',
  disabledAt: null,
  lastLoginAt: null,
};

const setup = (user: LocalUser | null = activeAdmin, blocked = false) => {
  const deps = {
    users: {
      findByUsername: jest.fn(async (username: string) => (user && username === user.username ? user : null)),
      recordLogin: jest.fn(async () => undefined),
    },
    attempts: {
      isBlocked: jest.fn(async () => blocked),
      registerFailure: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    },
    passwords: {
      verify: jest.fn(async (password: string, stored: string) => stored === `hash:${password}`),
      verifyDummy: jest.fn(async () => undefined),
    },
    log: jest.fn(),
  } satisfies LocalAuthDependencies;
  return { deps, service: createLocalAuthService(deps) };
};

const ip = '203.0.113.7';

describe('localAuthService.authenticate', () => {
  it('normalizes the username before every lookup', async () => {
    const { deps, service } = setup();
    const result = await service.authenticate({ username: '  Admin ', password: 'correct password', ip });
    expect(result).toEqual({ ok: true, user: activeAdmin });
    expect(deps.attempts.isBlocked).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.findByUsername).toHaveBeenCalledWith('admin');
    expect(deps.attempts.clear).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.recordLogin).toHaveBeenCalledWith('user-1');
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'success', username: 'admin', ip });
  });

  it('rejects a wrong password and counts the failure', async () => {
    const { deps, service } = setup();
    await expect(service.authenticate({ username: 'admin', password: 'wrong password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.recordLogin).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'admin', ip, reason: 'wrong_password' });
  });

  it('answers an unknown user like a wrong password and still spends hashing time', async () => {
    const { deps, service } = setup(null);
    await expect(service.authenticate({ username: 'ghost', password: 'any password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.passwords.verifyDummy).toHaveBeenCalledWith('any password');
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('ghost', ip);
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'ghost', ip, reason: 'unknown_user' });
  });

  it('rejects a disabled user even with the right password', async () => {
    const { deps, service } = setup({ ...activeAdmin, disabledAt: new Date() });
    await expect(service.authenticate({ username: 'admin', password: 'correct password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('admin', ip);
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'admin', ip, reason: 'disabled' });
  });

  it('refuses blocked attempts without checking the password', async () => {
    const { deps, service } = setup(activeAdmin, true);
    await expect(service.authenticate({ username: 'admin', password: 'correct password', ip }))
      .resolves.toEqual({ ok: false, reason: 'blocked' });
    expect(deps.users.findByUsername).not.toHaveBeenCalled();
    expect(deps.passwords.verify).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'blocked', username: 'admin', ip, reason: 'too_many_attempts' });
  });

  it('never writes the password to the log', async () => {
    const { deps, service } = setup();
    await service.authenticate({ username: 'admin', password: 'wrong password', ip });
    await service.authenticate({ username: 'admin', password: 'correct password', ip });
    const logged = JSON.stringify(deps.log.mock.calls);
    expect(logged).not.toContain('wrong password');
    expect(logged).not.toContain('correct password');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/localAuthService.test.ts`
Expected: FAIL — `Cannot find module './localAuthService'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/localAuthService.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/localAuthService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/localAuthService.ts backend/src/services/localAuthService.test.ts
git commit -m "feat: add local authentication service [Story 4.1]"
```

---

### Task 5: Local sessions next to OIDC sessions (AC 14, 15, 20)

**Files:**
- Modify: `backend/src/services/authSessionService.ts`
- Test: `backend/src/services/authSessionService.test.ts` (novo)

**Interfaces:**
- Produces (substitui o `AuthSession` atual):
  ```ts
  export type AuthProvider = 'oidc' | 'local';
  export interface OidcAuthSession { provider: 'oidc'; user: AuthenticatedUser; refreshToken: string; accessTokenExpiresAt: number }
  export interface LocalAuthSession { provider: 'local'; user: AuthenticatedUser; localUserId: string }
  export type AuthSession = OidcAuthSession | LocalAuthSession;
  export const isLocalSession: (session: AuthSession) => session is LocalAuthSession;
  export const createLocalSession: (user: AuthenticatedUser, localUserId: string) => Promise<string>;
  export const revokeLocalUserSessions: (localUserId: string) => Promise<number>;
  export interface OidcLoginTransaction { state: string; nonce: string; codeVerifier: string; returnTo?: string }
  export const getRefreshTokenForSession: (session: OidcAuthSession) => string;
  ```
  - `getSession` sempre devolve `provider` preenchido (sessões antigas viram `'oidc'`).
  - `createSession`, `consumeLoginTransaction`, `saveLoginTransaction`, `deleteSession`, `refreshSessionIfNeeded` mantêm as assinaturas.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/authSessionService.test.ts
const mockStrings = new Map<string, string>();
const mockSets = new Map<string, Set<string>>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    mockStrings.set(key, value);
    return 'OK';
  }),
  get: jest.fn(async (key: string) => mockStrings.get(key) ?? null),
  del: jest.fn(async (...keys: string[]) => keys.filter((key) => mockStrings.delete(key) || mockSets.delete(key)).length),
  sadd: jest.fn(async (key: string, member: string) => {
    const members = mockSets.get(key) ?? new Set<string>();
    members.add(member);
    mockSets.set(key, members);
    return 1;
  }),
  smembers: jest.fn(async (key: string) => [...(mockSets.get(key) ?? [])]),
  expire: jest.fn(async () => 1),
};

jest.mock('../config/redis', () => ({ getRedisClient: () => mockRedis }));
jest.mock('./oidcService', () => ({
  refreshOidcTokens: jest.fn(),
  validateIdToken: jest.fn(),
  getUserInfo: jest.fn(),
  shouldRefreshToken: jest.fn(() => true),
  encryptRefreshToken: jest.fn((value: string) => `enc:${value}`),
  decryptRefreshToken: jest.fn((value: string) => value.replace(/^enc:/, '')),
}));

import { refreshOidcTokens } from './oidcService';
import {
  consumeLoginTransaction,
  createLocalSession,
  getSession,
  refreshSessionIfNeeded,
  revokeLocalUserSessions,
  saveLoginTransaction,
} from './authSessionService';

const localUser = { sub: 'local:user-1', name: 'admin' };

describe('authSessionService', () => {
  beforeEach(() => {
    mockStrings.clear();
    mockSets.clear();
    jest.clearAllMocks();
  });

  it('accepts legacy sessions without provider as OIDC', async () => {
    mockStrings.set('oidc:session:legacy', JSON.stringify({
      user: { sub: 'oidc-user' },
      refreshToken: 'enc:refresh',
      accessTokenExpiresAt: Date.now() + 60_000,
    }));
    await expect(getSession('legacy')).resolves.toEqual(expect.objectContaining({
      provider: 'oidc',
      user: { sub: 'oidc-user' },
    }));
  });

  it('rejects sessions with an unknown provider', async () => {
    mockStrings.set('oidc:session:odd', JSON.stringify({ provider: 'saml', user: { sub: 'x' } }));
    await expect(getSession('odd')).resolves.toBeNull();
  });

  it('round-trips a local session', async () => {
    const id = await createLocalSession(localUser, 'user-1');
    await expect(getSession(id)).resolves.toEqual({ provider: 'local', user: localUser, localUserId: 'user-1' });
    expect(mockRedis.set).toHaveBeenCalledWith(`oidc:session:${id}`, expect.any(String), 'EX', 8 * 60 * 60);
  });

  it('never refreshes a local session through OIDC', async () => {
    const id = await createLocalSession(localUser, 'user-1');
    const session = await getSession(id);
    await expect(refreshSessionIfNeeded(id, session!)).resolves.toBe(session);
    expect(refreshOidcTokens).not.toHaveBeenCalled();
  });

  it('revokes every session of a local user', async () => {
    const first = await createLocalSession(localUser, 'user-1');
    const second = await createLocalSession(localUser, 'user-1');
    const other = await createLocalSession({ sub: 'local:user-2', name: 'outro' }, 'user-2');

    await expect(revokeLocalUserSessions('user-1')).resolves.toBe(2);
    await expect(getSession(first)).resolves.toBeNull();
    await expect(getSession(second)).resolves.toBeNull();
    await expect(getSession(other)).resolves.not.toBeNull();
  });

  it('keeps the return path in the OIDC login transaction', async () => {
    const id = await saveLoginTransaction({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
    await expect(consumeLoginTransaction(id)).resolves.toEqual({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/authSessionService.test.ts`
Expected: FAIL — TypeScript: `Module './authSessionService' has no exported member 'createLocalSession'` (e `revokeLocalUserSessions`).

- [ ] **Step 3: Implement in `authSessionService.ts`**

Substituir as interfaces `OidcLoginTransaction`/`AuthSession` atuais por:

```ts
export interface OidcLoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string;
}

export interface AuthenticatedUser {
  sub: string;
  name?: string;
  email?: string;
}

export type AuthProvider = 'oidc' | 'local';

export interface OidcAuthSession {
  provider: 'oidc';
  user: AuthenticatedUser;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export interface LocalAuthSession {
  provider: 'local';
  user: AuthenticatedUser;
  localUserId: string;
}

export type AuthSession = OidcAuthSession | LocalAuthSession;

export const isLocalSession = (session: AuthSession): session is LocalAuthSession => session.provider === 'local';
```

Adicionar a chave do índice de sessões por usuário ao lado de `sessionKey`:

```ts
const LOCAL_USER_SESSIONS_PREFIX = 'auth:local:user-sessions:';
const localUserSessionsKey = (localUserId: string): string => `${LOCAL_USER_SESSIONS_PREFIX}${localUserId}`;
```

Em `createSession`, gravar o provider:

```ts
  const session: OidcAuthSession = {
    provider: 'oidc',
    user,
    refreshToken: encryptRefreshToken(refreshToken),
    accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
  };
```

Adicionar logo após `createSession`:

```ts
export const createLocalSession = async (user: AuthenticatedUser, localUserId: string): Promise<string> => {
  const id = createOpaqueId();
  const redis = getRedisClient();
  const session: LocalAuthSession = { provider: 'local', user, localUserId };
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  // Index lets password resets and deactivation end every open session at once.
  await redis.sadd(localUserSessionsKey(localUserId), id);
  await redis.expire(localUserSessionsKey(localUserId), SESSION_TTL_SECONDS);
  return id;
};

export const revokeLocalUserSessions = async (localUserId: string): Promise<number> => {
  const redis = getRedisClient();
  const ids = await redis.smembers(localUserSessionsKey(localUserId));
  if (ids.length > 0) await redis.del(...ids.map(sessionKey));
  await redis.del(localUserSessionsKey(localUserId));
  return ids.length;
};
```

Substituir `parseSession`:

```ts
type StoredSession = Partial<Omit<OidcAuthSession, 'provider'> & Omit<LocalAuthSession, 'provider'>> & {
  provider?: string;
};

const parseSession = (value: string | null): AuthSession | null => {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as StoredSession;
    if (!stored.user?.sub) return null;
    if (stored.provider === 'local') {
      return stored.localUserId ? { provider: 'local', user: stored.user, localUserId: stored.localUserId } : null;
    }
    // Sessions created before Story 4.1 have no provider and are OIDC sessions.
    if (stored.provider !== undefined && stored.provider !== 'oidc') return null;
    if (!stored.refreshToken || !Number.isFinite(stored.accessTokenExpiresAt)) return null;
    return {
      provider: 'oidc',
      user: stored.user,
      refreshToken: stored.refreshToken,
      accessTokenExpiresAt: stored.accessTokenExpiresAt as number,
    };
  } catch {
    return null;
  }
};
```

Em `consumeLoginTransaction`, a validação existente continua; o `returnTo` passa adiante porque o objeto parseado é retornado inteiro (nenhuma mudança necessária além do tipo).

No início de `refreshSessionIfNeeded`:

```ts
export const refreshSessionIfNeeded = async (id: string, session: AuthSession): Promise<AuthSession | null> => {
  if (isLocalSession(session)) return session;
  if (!shouldRefreshToken(session.accessTokenExpiresAt)) return session;
```

E no objeto `next` dentro dele, acrescentar `provider: 'oidc',` (tipo `OidcAuthSession`).

Trocar a assinatura de `getRefreshTokenForSession`:

```ts
export const getRefreshTokenForSession = (session: OidcAuthSession): string => decryptRefreshToken(session.refreshToken);
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest src/services/authSessionService.test.ts src/middlewares/authentication.test.ts`
Expected: PASS em ambos. `npx tsc --noEmit` vai apontar `authRoutes.ts` (uso de `getRefreshTokenForSession` com `AuthSession`) — esperado, corrigido na Task 6. Se quiser manter o build verde entre commits, aplique já o trecho de logout da Task 6, Step 5.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/authSessionService.ts backend/src/services/authSessionService.test.ts
git commit -m "feat: support local sessions alongside OIDC sessions [Story 4.1]"
```

---

### Task 6: Auth HTTP endpoints (AC 2, 4, 5, 7, 13, 15, 16)

**Files:**
- Create: `backend/src/config/localAuth.ts`
- Create: `backend/src/utils/returnTo.ts` + `backend/src/utils/returnTo.test.ts`
- Create: `backend/src/controllers/localAuthController.ts` + `backend/src/controllers/localAuthController.test.ts`
- Modify: `backend/src/middlewares/authentication.ts` (exportar `SESSION_COOKIE_MAX_AGE`)
- Modify: `backend/src/routes/authRoutes.ts`
- Test: `backend/src/routes/authRoutes.test.ts` (novo)

**Interfaces:**
- Consumes: `createLocalAuthService`, `LocalAuthInput`, `LocalAuthResult` (Task 4); `createLocalSession`, `deleteSession`, `isLocalSession`, `OidcLoginTransaction.returnTo` (Task 5); `getLocalUserRepository` (Task 3); limitador (Task 2); `verifyPassword`, `verifyAgainstDummy` (Task 1).
- Produces:
  - `isLocalLoginEnabled(): boolean`
  - `sanitizeReturnTo(value: unknown): string`
  - `SESSION_COOKIE_MAX_AGE` exportado por `middlewares/authentication.ts`
  - `createLocalAuthController(deps: LocalAuthControllerDependencies): { options: RequestHandler; login: (req, res, next) => Promise<void> }`
  - HTTP: `GET /api/auth/options` → `{ success: true, data: { localLoginEnabled: boolean } }`; `POST /api/auth/local/login`; `GET /api/auth/oidc/login?next=`; `GET /api/auth/me` → `data: { sub, name?, email?, provider }`; `POST /api/auth/logout` → `logoutUrl: null` para sessão local.

- [ ] **Step 1: Write the failing test for `sanitizeReturnTo`**

```ts
// backend/src/utils/returnTo.test.ts
import { sanitizeReturnTo } from './returnTo';

describe('sanitizeReturnTo', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/status/abc?page=2#top', '/status/abc?page=2#top'],
    [undefined, '/'],
    [['/dashboard'], '/'],
    ['', '/'],
    ['dashboard', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example/', '/'],
    ['/dash\nboard', '/'],
    ['/login', '/'],
    ['/login?next=%2F', '/'],
    [`/${'a'.repeat(2048)}`, '/'],
  ])('maps %p to %p', (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/utils/returnTo.test.ts`
Expected: FAIL — `Cannot find module './returnTo'`.

- [ ] **Step 3: Implement `returnTo.ts` and `localAuth.ts`**

```ts
// backend/src/utils/returnTo.ts
const MAX_RETURN_TO_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

/**
 * Accepts only same-origin paths so `next` cannot become an open redirect.
 */
export const sanitizeReturnTo = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > MAX_RETURN_TO_LENGTH) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARACTERS.test(value)) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return '/';
  return value;
};
```

```ts
// backend/src/config/localAuth.ts
export const isLocalLoginEnabled = (): boolean => process.env.LOCAL_LOGIN_ENABLED !== 'false';
```

Run: `cd backend && npx jest src/utils/returnTo.test.ts` → PASS.

- [ ] **Step 4: Write the failing controller test**

```ts
// backend/src/controllers/localAuthController.test.ts
import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../middlewares/authentication';
import { createLocalAuthController } from './localAuthController';

const admin = { id: 'user-1', username: 'admin', passwordHash: 'h', disabledAt: null, lastLoginAt: null };

const setup = (enabled = true) => {
  const deps = {
    enabled: jest.fn(() => enabled),
    authenticate: jest.fn(),
    createSession: jest.fn().mockResolvedValue('new-session'),
    deleteSession: jest.fn().mockResolvedValue(undefined),
  };
  const response = { status: jest.fn(), json: jest.fn(), cookie: jest.fn() };
  response.status.mockReturnValue(response);
  const next = jest.fn() as unknown as NextFunction;
  return { deps, response, next, controller: createLocalAuthController(deps) };
};

const request = (body: unknown, cookie?: string): Request =>
  ({ body, ip: '203.0.113.7', headers: cookie ? { cookie } : {} }) as unknown as Request;

describe('localAuthController', () => {
  it('reports whether local login is enabled', () => {
    const { controller, response } = setup(false);
    controller.options({} as Request, response as unknown as Response);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { localLoginEnabled: false } });
  });

  it('responds 404 when local login is disabled', async () => {
    const { controller, deps, response, next } = setup(false);
    await controller.login(request({ username: 'admin', password: 'x'.repeat(12) }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ username: 'admin' }],
    [{ username: '   ', password: 'x'.repeat(12) }],
    [{ username: 'a'.repeat(65), password: 'x'.repeat(12) }],
    [{ username: 'admin', password: 'x'.repeat(1025) }],
    [{ username: ['admin'], password: 'x'.repeat(12) }],
  ])('rejects malformed body %p with 400', async (body) => {
    const { controller, deps, response, next } = setup();
    await controller.login(request(body), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'invalid_request' });
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('answers invalid credentials with 401 and no cookie', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
    await controller.login(request({ username: 'admin', password: 'wrong password' }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'invalid_credentials' });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('answers blocked attempts with 429', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: false, reason: 'blocked' });
    await controller.login(request({ username: 'admin', password: 'whatever pass' }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'too_many_attempts' });
  });

  it('replaces any previous session and sets the session cookie on success', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: true, user: admin });
    await controller.login(
      request({ username: 'Admin', password: 'correct password' }, `${SESSION_COOKIE}=old-session`),
      response as unknown as Response,
      next,
    );
    expect(deps.authenticate).toHaveBeenCalledWith({ username: 'Admin', password: 'correct password', ip: '203.0.113.7' });
    expect(deps.deleteSession).toHaveBeenCalledWith('old-session');
    expect(deps.createSession).toHaveBeenCalledWith({ sub: 'local:user-1', name: 'admin' }, 'user-1');
    expect(response.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'new-session', expect.objectContaining({ httpOnly: true }));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { sub: 'local:user-1', name: 'admin', provider: 'local' },
    });
  });

  it('forwards infrastructure failures to the error handler', async () => {
    const { controller, deps, response, next } = setup();
    const failure = new Error('Redis down');
    deps.authenticate.mockRejectedValue(failure);
    await controller.login(request({ username: 'admin', password: 'correct password' }), response as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd backend && npx jest src/controllers/localAuthController.test.ts`
Expected: FAIL — `Cannot find module './localAuthController'`.

- [ ] **Step 6: Implement the controller**

Em `backend/src/middlewares/authentication.ts`, logo abaixo de `LOGIN_COOKIE`:

```ts
export const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;
```

```ts
// backend/src/controllers/localAuthController.ts
import { NextFunction, Request, Response } from 'express';
import { cookieOptions, getCookie, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from '../middlewares/authentication';
import type { AuthenticatedUser } from '../services/authSessionService';
import type { LocalAuthInput, LocalAuthResult } from '../services/localAuthService';

export const MAX_USERNAME_INPUT_LENGTH = 64;
// Bounds scrypt input size; the 128 code point policy applies when passwords are set.
export const MAX_PASSWORD_INPUT_LENGTH = 1024;

export interface LocalAuthControllerDependencies {
  enabled: () => boolean;
  authenticate: (input: LocalAuthInput) => Promise<LocalAuthResult>;
  createSession: (user: AuthenticatedUser, localUserId: string) => Promise<string>;
  deleteSession: (sessionId: string | undefined) => Promise<void>;
}

const isValidCredentialInput = (username: unknown, password: unknown): username is string =>
  typeof username === 'string'
  && typeof password === 'string'
  && username.trim().length > 0
  && username.length <= MAX_USERNAME_INPUT_LENGTH
  && password.length > 0
  && password.length <= MAX_PASSWORD_INPUT_LENGTH;

export const createLocalAuthController = (deps: LocalAuthControllerDependencies) => ({
  options: (_request: Request, response: Response): void => {
    response.status(200).json({ success: true, data: { localLoginEnabled: deps.enabled() } });
  },

  login: async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (!deps.enabled()) {
      response.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const { username, password } = (request.body ?? {}) as Record<string, unknown>;
    if (!isValidCredentialInput(username, password)) {
      response.status(400).json({ success: false, error: 'invalid_request' });
      return;
    }

    try {
      const result = await deps.authenticate({ username, password: password as string, ip: request.ip ?? 'unknown' });
      if (!result.ok) {
        const blocked = result.reason === 'blocked';
        response.status(blocked ? 429 : 401).json({
          success: false,
          error: blocked ? 'too_many_attempts' : 'invalid_credentials',
        });
        return;
      }

      const user: AuthenticatedUser = { sub: `local:${result.user.id}`, name: result.user.username };
      await deps.deleteSession(getCookie(request, SESSION_COOKIE));
      const sessionId = await deps.createSession(user, result.user.id);
      response.cookie(SESSION_COOKIE, sessionId, cookieOptions(SESSION_COOKIE_MAX_AGE));
      response.status(200).json({ success: true, data: { ...user, provider: 'local' } });
    } catch (error) {
      next(error);
    }
  },
});
```

Run: `cd backend && npx jest src/controllers/localAuthController.test.ts` → PASS.

- [ ] **Step 7: Write the failing route test**

```ts
// backend/src/routes/authRoutes.test.ts
import type { NextFunction, Request, Response } from 'express';

jest.mock('../services/oidcService', () => ({
  createAuthorizationRequest: jest.fn(),
  exchangeAuthorizationCode: jest.fn(),
  getLogoutUrl: jest.fn(),
  getUserInfo: jest.fn(),
  revokeRefreshToken: jest.fn(),
  validateIdToken: jest.fn(),
  OidcError: class OidcError extends Error {},
}));
jest.mock('../services/authSessionService', () => ({
  ...jest.requireActual('../services/authSessionService'),
  saveLoginTransaction: jest.fn(),
  consumeLoginTransaction: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  getSession: jest.fn(),
  getRefreshTokenForSession: jest.fn(),
}));

import authRoutes from './authRoutes';
import { requireTrustedOrigin } from '../middlewares/authentication';
import {
  consumeLoginTransaction,
  createSession,
  getSession,
  saveLoginTransaction,
} from '../services/authSessionService';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getLogoutUrl,
  getUserInfo,
  revokeRefreshToken,
  validateIdToken,
} from '../services/oidcService';

type Handler = (request: Request, response: Response, next: NextFunction) => unknown;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const routeStack = (method: string, path: string): Handler[] => {
  const layer = (authRoutes as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack.map((item) => item.handle);
};
const finalHandler = (method: string, path: string): Handler => routeStack(method, path).slice(-1)[0];

const mockResponse = () => {
  const response = { redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn(), status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};
const next = jest.fn() as unknown as NextFunction;
const localSession = { provider: 'local', user: { sub: 'local:user-1', name: 'admin' }, localUserId: 'user-1' };

describe('auth routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ORIGIN = 'https://app.example';
  });

  it('protects local login with the trusted origin check', () => {
    expect(routeStack('post', '/local/login')).toContain(requireTrustedOrigin);
    expect(() => routeStack('get', '/options')).not.toThrow();
  });

  it.each([
    ['//evil.example', '/'],
    ['/status/abc?page=2', '/status/abc?page=2'],
  ])('stores the sanitized return path %p when starting OIDC login', async (nextParam, expected) => {
    (createAuthorizationRequest as jest.Mock).mockResolvedValue({
      authorizationUrl: 'https://idp.example/authorize', state: 's', nonce: 'n', codeVerifier: 'v',
    });
    (saveLoginTransaction as jest.Mock).mockResolvedValue('tx');
    const response = mockResponse();
    await finalHandler('get', '/oidc/login')({ query: { next: nextParam } } as unknown as Request, response as unknown as Response, next);
    expect(saveLoginTransaction).toHaveBeenCalledWith({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: expected });
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://idp.example/authorize');
  });

  it('sends OIDC callback failures to the login page', async () => {
    (consumeLoginTransaction as jest.Mock).mockResolvedValue(null);
    const response = mockResponse();
    await finalHandler('get', '/oidc/callback')({ query: {}, headers: {} } as unknown as Request, response as unknown as Response, next);
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=invalid_callback');
  });

  it('returns to the stored path after a successful OIDC callback', async () => {
    (consumeLoginTransaction as jest.Mock).mockResolvedValue({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
    (exchangeAuthorizationCode as jest.Mock).mockResolvedValue({ refresh_token: 'r', id_token: 'i', access_token: 'a', expires_in: 300 });
    (validateIdToken as jest.Mock).mockResolvedValue({ sub: 'u' });
    (getUserInfo as jest.Mock).mockResolvedValue({ sub: 'u', name: 'Usuária' });
    (createSession as jest.Mock).mockResolvedValue('sid');
    const response = mockResponse();
    await finalHandler('get', '/oidc/callback')(
      { query: { code: 'c', state: 's' }, headers: {} } as unknown as Request,
      response as unknown as Response,
      next,
    );
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/dashboard');
  });

  it('ends a local session without contacting the OIDC provider', async () => {
    (getSession as jest.Mock).mockResolvedValue(localSession);
    const response = mockResponse();
    await finalHandler('post', '/logout')(
      { auth: { sessionId: 'sid', session: localSession } } as unknown as Request,
      response as unknown as Response,
      next,
    );
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(getLogoutUrl).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ success: true, logoutUrl: null });
  });

  it.each([
    [localSession, 'local'],
    [{ provider: 'oidc', user: { sub: 'u' }, refreshToken: 'r', accessTokenExpiresAt: 1 }, 'oidc'],
  ])('reports the session provider on /me', async (session, provider) => {
    const response = mockResponse();
    await finalHandler('get', '/me')({ auth: { sessionId: 'sid', session } } as unknown as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { ...session.user, provider } });
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd backend && npx jest src/routes/authRoutes.test.ts`
Expected: FAIL — rota `POST /local/login` inexistente, `returnTo` ausente, redirect para `/?auth_error=` em vez de `/login?auth_error=`.

- [ ] **Step 9: Update `authRoutes.ts`**

Imports (substituem os atuais de `authSessionService` e `authentication`, e adicionam os novos):

```ts
import {
  createLocalSession,
  createSession,
  consumeLoginTransaction,
  deleteSession,
  getRefreshTokenForSession,
  getSession,
  isLocalSession,
  saveLoginTransaction,
} from '../services/authSessionService';
import {
  AuthenticatedRequest,
  cookieOptions,
  getCookie,
  LOGIN_COOKIE,
  requireAuthentication,
  requireTrustedOrigin,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from '../middlewares/authentication';
import { createLocalAuthController } from '../controllers/localAuthController';
import { isLocalLoginEnabled } from '../config/localAuth';
import { getLocalUserRepository } from '../services/databaseService';
import { createLocalAuthService } from '../services/localAuthService';
import { clearFailedLogins, isLoginBlocked, registerFailedLogin } from '../services/loginAttemptLimiter';
import { verifyAgainstDummy, verifyPassword } from '../services/passwordHasher';
import { sanitizeReturnTo } from '../utils/returnTo';
```

Remover a constante local `SESSION_COOKIE_MAX_AGE` (agora importada).

Logo após `const appOrigin = ...`:

```ts
const localAuth = createLocalAuthController({
  enabled: isLocalLoginEnabled,
  // Built per request: the repository only exists after the database is initialized.
  authenticate: (input) => createLocalAuthService({
    users: getLocalUserRepository(),
    attempts: { isBlocked: isLoginBlocked, registerFailure: registerFailedLogin, clear: clearFailedLogins },
    passwords: { verify: verifyPassword, verifyDummy: verifyAgainstDummy },
  }).authenticate(input),
  createSession: createLocalSession,
  deleteSession,
});

router.get('/options', localAuth.options);
router.post('/local/login', requireTrustedOrigin, localAuth.login);
```

Em `GET /oidc/login`, trocar `async (_request` por `async (request` e incluir o `returnTo`:

```ts
    const transactionId = await saveLoginTransaction({
      state: authorization.state,
      nonce: authorization.nonce,
      codeVerifier: authorization.codeVerifier,
      returnTo: sanitizeReturnTo(request.query.next),
    });
```

Em `GET /oidc/callback`, o `fail` passa a apontar para `/login`:

```ts
    response.redirect(302, `${appOrigin()}/login?auth_error=${encodeURIComponent(reason)}`);
```

e o redirect final de sucesso:

```ts
    response.redirect(302, `${appOrigin()}${sanitizeReturnTo(transaction.returnTo)}`);
```

`GET /me`:

```ts
router.get('/me', requireAuthentication, (request: AuthenticatedRequest, response: Response) => {
  const session = request.auth?.session;
  response.status(200).json({
    success: true,
    data: session ? { ...session.user, provider: session.provider } : undefined,
  });
});
```

`POST /logout`:

```ts
router.post('/logout', requireAuthentication, requireTrustedOrigin, async (request: AuthenticatedRequest, response: Response, next) => {
  try {
    const session = await getSession(request.auth?.sessionId);
    await deleteSession(request.auth?.sessionId);
    response.clearCookie(SESSION_COOKIE, cookieOptions());
    if (!session || isLocalSession(session)) {
      response.status(200).json({ success: true, logoutUrl: null });
      return;
    }
    await revokeRefreshToken(getRefreshTokenForSession(session));
    response.status(200).json({ success: true, logoutUrl: await getLogoutUrl() });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 10: Run all backend checks**

Run: `cd backend && npx jest src/routes/authRoutes.test.ts src/controllers/localAuthController.test.ts src/utils/returnTo.test.ts src/middlewares/authentication.test.ts && npx tsc --noEmit && npx eslint src/routes src/controllers src/utils src/config src/services`
Expected: todos PASS, `tsc` sem erros, ESLint sem erros.

- [ ] **Step 11: Commit**

```bash
git add backend/src/config/localAuth.ts backend/src/utils backend/src/controllers/localAuthController.ts backend/src/controllers/localAuthController.test.ts backend/src/middlewares/authentication.ts backend/src/routes/authRoutes.ts backend/src/routes/authRoutes.test.ts
git commit -m "feat: add local login endpoint and login-page redirects [Story 4.1]"
```

---

### Task 7: Real client IP and environment flags (AC 13, 22)

**Files:**
- Modify: `backend/src/middlewares/security.ts`
- Test: `backend/src/middlewares/security.test.ts` (novo)
- Modify: `docker-compose.prod.yml`, `docker-compose.yml`, `deploy/production.env.example`, `.env.example`

**Interfaces:**
- Produces: `trustProxyHops(): number` (inteiro ≥ 0; padrão 1; inválido → 1).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/middlewares/security.test.ts
import { trustProxyHops } from './security';

describe('trustProxyHops', () => {
  const original = process.env.TRUST_PROXY_HOPS;

  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = original;
  });

  it('defaults to a single proxy', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(trustProxyHops()).toBe(1);
  });

  it('reads the configured number of proxies', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(trustProxyHops()).toBe(2);
  });

  it.each(['abc', '-1', '1.5', ''])('falls back to one proxy for %p', (value) => {
    process.env.TRUST_PROXY_HOPS = value;
    expect(trustProxyHops()).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/middlewares/security.test.ts`
Expected: FAIL — `trustProxyHops is not a function` / não exportado.

- [ ] **Step 3: Implement**

Em `security.ts`, antes de `configureSecurity`:

```ts
// Production chain is Traefik -> Nginx -> backend; each hop appends to X-Forwarded-For.
export const trustProxyHops = (): number => {
  const raw = process.env.TRUST_PROXY_HOPS;
  const hops = raw === undefined || raw === '' ? 1 : Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
};
```

Trocar `if (isProduction) app.set('trust proxy', 1);` por:

```ts
  if (isProduction) app.set('trust proxy', trustProxyHops());
```

- [ ] **Step 4: Expose the flags in deploy files**

`docker-compose.prod.yml`, dentro de `backend.environment` (âncora `&backend_environment`), após `CREFITO11_LOGO_URL`:

```yaml
      LOCAL_LOGIN_ENABLED: ${LOCAL_LOGIN_ENABLED:-true}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-1}
```

`docker-compose.yml`, no `environment` do serviço backend, junto de `APP_ORIGIN`:

```yaml
      LOCAL_LOGIN_ENABLED: ${LOCAL_LOGIN_ENABLED:-true}
```

`deploy/production.env.example`, ao final:

```bash
# Login por usuário e senha locais (false oculta o formulário e desativa o endpoint)
LOCAL_LOGIN_ENABLED=true
# Proxies confiáveis à frente do backend (Traefik + Nginx). Veja docs/production.md, "IP real do cliente".
TRUST_PROXY_HOPS=1
```

`.env.example`, ao final:

```bash
LOCAL_LOGIN_ENABLED=true
```

- [ ] **Step 5: Verify**

Run: `cd backend && npx jest src/middlewares/security.test.ts src/scripts/productionDeployGuards.test.ts`
Expected: PASS.
Run (na raiz, se houver Docker local): `POSTGRES_USER=x POSTGRES_DB=x APP_ORIGIN=x OIDC_ISSUER=x OIDC_CLIENT_ID=x CREFITO11_LOGO_URL=x BACKEND_IMAGE=x FRONTEND_IMAGE=x docker compose -f docker-compose.prod.yml config --quiet`
Expected: sem saída (YAML válido).

- [ ] **Step 6: Commit**

```bash
git add backend/src/middlewares/security.ts backend/src/middlewares/security.test.ts docker-compose.prod.yml docker-compose.yml deploy/production.env.example .env.example
git commit -m "feat: configurable trusted proxies and local login flag [Story 4.1]"
```

---

### Task 8: Local admin management CLI (AC 19, 20, 21)

**Files:**
- Create: `backend/src/services/localUserAdminService.ts`
- Test: `backend/src/services/localUserAdminService.test.ts`
- Create: `backend/src/scripts/manageLocalAdmin.ts`
- Test: `backend/src/scripts/manageLocalAdmin.test.ts`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Consumes: `LocalUserStore`, `LocalUser`, `createLocalUserRepository` (Task 3); `hashPassword`, `validatePasswordPolicy` (Task 1); `normalizeUsername` (Task 4); `revokeLocalUserSessions` (Task 5); `initDatabase`, `closeDatabase` (`config/database.ts`); `closeRedisConnection` (`config/redis.ts`).
- Produces:
  ```ts
  export const USERNAME_PATTERN: RegExp; // /^[a-z0-9._-]{3,64}$/
  export class LocalAdminError extends Error {}
  export interface LocalAdminDependencies {
    users: LocalUserStore;
    hash: (password: string) => Promise<string>;
    revokeSessions: (localUserId: string) => Promise<number>;
  }
  export const createLocalAdminService: (deps: LocalAdminDependencies) => {
    create(username: string, password: string): Promise<LocalUser>;
    resetPassword(username: string, password: string): Promise<number>; // sessões encerradas
    setDisabled(username: string, disabled: boolean): Promise<number>;  // sessões encerradas
  };
  // manageLocalAdmin.ts
  export type LocalAdminCommand = 'create' | 'reset-password' | 'disable' | 'enable';
  export const parseArguments: (argv: string[]) => { command: LocalAdminCommand; username: string };
  ```
- CLI: `npm run user:admin -- <create|reset-password|disable|enable> --username=<nome>`.

- [ ] **Step 1: Write the failing service test**

```ts
// backend/src/services/localUserAdminService.test.ts
import type { LocalUser, LocalUserStore } from '../repositories/localUserRepository';
import { createLocalAdminService, LocalAdminError } from './localUserAdminService';

class InMemoryLocalUsers implements LocalUserStore {
  readonly users = new Map<string, LocalUser>();

  private byId(id: string): LocalUser {
    const user = this.users.get(id);
    if (!user) throw new Error(`Unknown user ${id}`);
    return user;
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async create(input: { username: string; passwordHash: string }): Promise<LocalUser> {
    const user: LocalUser = { id: `id-${this.users.size + 1}`, ...input, disabledAt: null, lastLoginAt: null };
    this.users.set(user.id, user);
    return user;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    this.byId(id).passwordHash = passwordHash;
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    this.byId(id).disabledAt = disabled ? new Date() : null;
  }

  async recordLogin(id: string): Promise<void> {
    this.byId(id).lastLoginAt = new Date();
  }
}

const setup = () => {
  const users = new InMemoryLocalUsers();
  const revokeSessions = jest.fn().mockResolvedValue(2);
  const service = createLocalAdminService({ users, hash: async (password) => `hashed:${password}`, revokeSessions });
  return { users, revokeSessions, service };
};

describe('localUserAdminService', () => {
  it('creates a user with a normalized username and hashed password', async () => {
    const { users, service } = setup();
    const created = await service.create('  Admin ', 'uma senha longa');
    expect(created.username).toBe('admin');
    expect((await users.findByUsername('admin'))?.passwordHash).toBe('hashed:uma senha longa');
  });

  it.each(['ab', 'com espaço', 'a'.repeat(65), 'admin@crefito'])('rejects the username %p', async (username) => {
    const { service } = setup();
    await expect(service.create(username, 'uma senha longa')).rejects.toBeInstanceOf(LocalAdminError);
  });

  it('rejects a password outside the policy', async () => {
    const { service } = setup();
    await expect(service.create('admin', 'curta')).rejects.toThrow('A senha deve ter pelo menos 12 caracteres.');
  });

  it('refuses to overwrite an existing user', async () => {
    const { service } = setup();
    await service.create('admin', 'uma senha longa');
    await expect(service.create('ADMIN', 'outra senha longa')).rejects.toThrow('já existe');
  });

  it('reset-password revokes active sessions', async () => {
    const { users, revokeSessions, service } = setup();
    const created = await service.create('admin', 'uma senha longa');
    await expect(service.resetPassword('admin', 'nova senha longa')).resolves.toBe(2);
    expect((await users.findByUsername('admin'))?.passwordHash).toBe('hashed:nova senha longa');
    expect(revokeSessions).toHaveBeenCalledWith(created.id);
  });

  it('fails clearly for an unknown user', async () => {
    const { service } = setup();
    await expect(service.resetPassword('ghost', 'nova senha longa')).rejects.toThrow('não existe');
    await expect(service.setDisabled('ghost', true)).rejects.toThrow('não existe');
  });

  it('disables with session revocation and enables without it', async () => {
    const { users, revokeSessions, service } = setup();
    await service.create('admin', 'uma senha longa');
    await expect(service.setDisabled('admin', true)).resolves.toBe(2);
    expect((await users.findByUsername('admin'))?.disabledAt).toBeInstanceOf(Date);

    revokeSessions.mockClear();
    await expect(service.setDisabled('admin', false)).resolves.toBe(0);
    expect((await users.findByUsername('admin'))?.disabledAt).toBeNull();
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/localUserAdminService.test.ts`
Expected: FAIL — `Cannot find module './localUserAdminService'`.

- [ ] **Step 3: Implement the service**

```ts
// backend/src/services/localUserAdminService.ts
import type { LocalUser, LocalUserStore } from '../repositories/localUserRepository';
import { normalizeUsername } from './localAuthService';
import { validatePasswordPolicy } from './passwordHasher';

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export class LocalAdminError extends Error {}

export interface LocalAdminDependencies {
  users: LocalUserStore;
  hash: (password: string) => Promise<string>;
  revokeSessions: (localUserId: string) => Promise<number>;
}

const assertPassword = (password: string): void => {
  const problem = validatePasswordPolicy(password);
  if (problem) throw new LocalAdminError(problem);
};

export const createLocalAdminService = (deps: LocalAdminDependencies) => {
  const existing = async (username: string): Promise<LocalUser> => {
    const normalized = normalizeUsername(username);
    const user = await deps.users.findByUsername(normalized);
    if (!user) throw new LocalAdminError(`O usuário "${normalized}" não existe.`);
    return user;
  };

  return {
    async create(username: string, password: string): Promise<LocalUser> {
      const normalized = normalizeUsername(username);
      if (!USERNAME_PATTERN.test(normalized)) {
        throw new LocalAdminError('Nome de usuário inválido: use de 3 a 64 caracteres entre a-z, 0-9, ".", "_" e "-".');
      }
      assertPassword(password);
      if (await deps.users.findByUsername(normalized)) {
        throw new LocalAdminError(`O usuário "${normalized}" já existe. Use reset-password para trocar a senha.`);
      }
      return deps.users.create({ username: normalized, passwordHash: await deps.hash(password) });
    },

    async resetPassword(username: string, password: string): Promise<number> {
      const user = await existing(username);
      assertPassword(password);
      await deps.users.updatePassword(user.id, await deps.hash(password));
      return deps.revokeSessions(user.id);
    },

    async setDisabled(username: string, disabled: boolean): Promise<number> {
      const user = await existing(username);
      await deps.users.setDisabled(user.id, disabled);
      return disabled ? deps.revokeSessions(user.id) : 0;
    },
  };
};
```

Run: `cd backend && npx jest src/services/localUserAdminService.test.ts` → PASS.

- [ ] **Step 4: Write the failing argument parser test**

```ts
// backend/src/scripts/manageLocalAdmin.test.ts
import { parseArguments } from './manageLocalAdmin';
import { LocalAdminError } from '../services/localUserAdminService';

describe('manageLocalAdmin parseArguments', () => {
  it.each([
    [['create', '--username=admin'], { command: 'create', username: 'admin' }],
    [['reset-password', '--username=admin'], { command: 'reset-password', username: 'admin' }],
    [['disable', '--username=admin'], { command: 'disable', username: 'admin' }],
    [['enable', '--username=admin'], { command: 'enable', username: 'admin' }],
  ])('parses %p', (argv, expected) => {
    expect(parseArguments(argv)).toEqual(expected);
  });

  it.each([[[]], [['create']], [['remove', '--username=admin']], [['create', '--username=']], [['create', '--password=x', '--username=admin']]])(
    'rejects %p with usage help',
    (argv) => {
      expect(() => parseArguments(argv)).toThrow(LocalAdminError);
      expect(() => parseArguments(argv)).toThrow('Uso: npm run user:admin');
    },
  );
});
```

(O último caso garante que ninguém passe senha por argumento — ela ficaria no histórico do shell.)

- [ ] **Step 5: Run it to verify it fails**

Run: `cd backend && npx jest src/scripts/manageLocalAdmin.test.ts`
Expected: FAIL — `Cannot find module './manageLocalAdmin'`.

- [ ] **Step 6: Implement the CLI**

```ts
// backend/src/scripts/manageLocalAdmin.ts
/**
 * Manage local username/password accounts.
 * Usage: npm run user:admin -- <create|reset-password|disable|enable> --username=<name>
 */
import { createInterface } from 'readline';
import { Writable } from 'stream';
import { closeDatabase, initDatabase } from '../config/database';
import { closeRedisConnection } from '../config/redis';
import { createLocalUserRepository } from '../repositories/localUserRepository';
import { revokeLocalUserSessions } from '../services/authSessionService';
import { createLocalAdminService, LocalAdminError } from '../services/localUserAdminService';
import { hashPassword } from '../services/passwordHasher';

export type LocalAdminCommand = 'create' | 'reset-password' | 'disable' | 'enable';

const COMMANDS: LocalAdminCommand[] = ['create', 'reset-password', 'disable', 'enable'];
const USAGE = 'Uso: npm run user:admin -- <create|reset-password|disable|enable> --username=<nome>';

export const parseArguments = (argv: string[]): { command: LocalAdminCommand; username: string } => {
  const [command, ...options] = argv;
  const username = options.length === 1 && options[0].startsWith('--username=')
    ? options[0].slice('--username='.length)
    : '';
  if (!COMMANDS.includes(command as LocalAdminCommand) || !username) throw new LocalAdminError(USAGE);
  return { command: command as LocalAdminCommand, username };
};

// Reads both entries from one interface so piped stdin (two lines) also works.
const readPasswordTwice = async (): Promise<string> => {
  const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const reader = createInterface({ input: process.stdin, output: silent, terminal: Boolean(process.stdin.isTTY) });
  const lines = reader[Symbol.asyncIterator]();
  const ask = async (label: string): Promise<string> => {
    process.stdout.write(label);
    const { value, done } = await lines.next();
    process.stdout.write('\n');
    if (done) throw new LocalAdminError('Entrada encerrada antes de informar a senha.');
    return value;
  };

  try {
    const password = await ask('Senha: ');
    if (password !== await ask('Confirme a senha: ')) throw new LocalAdminError('As senhas não conferem.');
    return password;
  } finally {
    reader.close();
  }
};

const main = async (): Promise<void> => {
  const { command, username } = parseArguments(process.argv.slice(2));
  const db = await initDatabase();
  try {
    const admin = createLocalAdminService({
      users: createLocalUserRepository(db),
      hash: hashPassword,
      revokeSessions: revokeLocalUserSessions,
    });

    if (command === 'create') {
      const user = await admin.create(username, await readPasswordTwice());
      console.log(`Usuário local "${user.username}" criado.`);
    } else if (command === 'reset-password') {
      const revoked = await admin.resetPassword(username, await readPasswordTwice());
      console.log(`Senha alterada. Sessões encerradas: ${revoked}.`);
    } else {
      const revoked = await admin.setDisabled(username, command === 'disable');
      console.log(`Usuário ${command === 'disable' ? 'desativado' : 'reativado'}. Sessões encerradas: ${revoked}.`);
    }
  } finally {
    await closeDatabase();
    await closeRedisConnection();
  }
};

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof LocalAdminError ? error.message : error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 7: Add the scripts to `backend/package.json`**

Ao lado de `reconcile:email-jobs`:

```json
    "user:admin": "node dist/scripts/manageLocalAdmin.js",
    "user:admin:dev": "ts-node src/scripts/manageLocalAdmin.ts",
```

- [ ] **Step 8: Verify**

Run: `cd backend && npx jest src/services/localUserAdminService.test.ts src/scripts/manageLocalAdmin.test.ts && npm run build && ls dist/scripts/manageLocalAdmin.js`
Expected: PASS, build sem erros, arquivo compilado existe.
Smoke manual (com Postgres e Redis de dev ativos e migration aplicada):

```bash
cd backend
printf 'senha-de-teste-123\nsenha-de-teste-123\n' | npm run user:admin:dev -- create --username=admin-teste
printf 'senha-de-teste-123\nsenha-de-teste-123\n' | npm run user:admin:dev -- create --username=admin-teste   # deve falhar: já existe
npm run user:admin:dev -- disable --username=admin-teste
```

Expected: `Usuário local "admin-teste" criado.`, depois a mensagem "já existe" com código de saída 1, depois `Usuário desativado. Sessões encerradas: 0.`. Remover o usuário de teste: `psql ... -c "delete from local_users where username='admin-teste'"`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/localUserAdminService.ts backend/src/services/localUserAdminService.test.ts backend/src/scripts/manageLocalAdmin.ts backend/src/scripts/manageLocalAdmin.test.ts backend/package.json
git commit -m "feat: add local admin management CLI [Story 4.1]"
```

---

### Task 9: Login page and protected routes (AC 1–6, 13, 15, 16)

**Files:**
- Create: `frontend/src/assets/crefito11-logo-negativo.png` (cópia do logo)
- Create: `frontend/src/utils/returnTo.ts`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/e2e/auth/login.spec.ts`
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/Auth/AuthProvider.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes (HTTP, Task 6): `GET /api/auth/options`, `POST /api/auth/local/login`, `GET /api/auth/me` (com `provider`), `POST /api/auth/logout` (`logoutUrl` pode ser `null`), `GET /api/auth/oidc/login?next=`.
- Produces:
  - `api.ts`: `AuthProviderName`, `AuthUser.provider?`, `AuthOptions`, `getAuthOptions()`, `loginWithPassword(username, password)`; interceptor 401 → `/login?next=`.
  - `AuthProvider`: contexto ganha `setUser(user: AuthUser): void`.
  - `sanitizeReturnTo(value: string | null): string` (mesmas regras do backend).
  - Projeto Playwright `auth-chromium` (porta 5174, `VITE_AUTH_ENABLED=true`, `VITE_API_URL=/api`).

- [ ] **Step 1: Add the Playwright auth project**

Em `frontend/playwright.config.ts`, abaixo de `devServerPort`:

```ts
const authBaseURL = process.env.PLAYWRIGHT_AUTH_BASE_URL || 'http://127.0.0.1:5174';
const authServerPort = new URL(authBaseURL).port || '5174';
```

Adicionar `testIgnore: /auth\//,` a cada um dos quatro projetos existentes (`chromium`, `firefox`, `webkit`, `chromium-light`) e acrescentar o projeto:

```ts
    // Runs against a dev server with authentication enabled (Story 4.1)
    {
      name: 'auth-chromium',
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: authBaseURL, colorScheme: 'light' },
    },
```

Trocar `webServer` por uma lista:

```ts
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${devServerPort}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Same-origin API path so mocked responses are not subject to CORS.
      command: `VITE_AUTH_ENABLED=true VITE_API_URL=/api npm run dev -- --host 127.0.0.1 --port ${authServerPort}`,
      url: authBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
```

- [ ] **Step 2: Write the failing e2e tests**

```ts
// frontend/e2e/auth/login.spec.ts
import { test, expect, type Page, type Route } from '@playwright/test';

const admin = { sub: 'local:user-1', name: 'admin', provider: 'local' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockApi = async (page: Page, { authenticated = false, localLoginEnabled = true } = {}) => {
  const state = { authenticated };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(
    state.authenticated
      ? json({ success: true, data: admin })
      : json({ success: false, error: 'Authentication required' }, 401),
  ));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({
    success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 },
  })));
  await page.route('**/api/auth/local/login', async (route: Route) => {
    const { username, password } = route.request().postDataJSON() as { username: string; password: string };
    if (username === 'admin' && password === 'senha-super-secreta') {
      state.authenticated = true;
      await route.fulfill(json({ success: true, data: admin }));
      return;
    }
    if (password === 'bloqueado-demais') {
      await route.fulfill(json({ success: false, error: 'too_many_attempts' }, 429));
      return;
    }
    await route.fulfill(json({ success: false, error: 'invalid_credentials' }, 401));
  });
  return state;
};

const fillAndSubmit = async (page: Page, username: string, password: string) => {
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
};

test.describe('Login page', () => {
  test('sends an unauthenticated visitor to /login with the requested path', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole('img', { name: 'CREFITO 11' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' }))
      .toHaveAttribute('href', '/api/auth/oidc/login?next=%2Fdashboard');
    await expect(page.getByLabel('Usuário')).toBeVisible();
    await expect(page.getByLabel('Senha')).toBeVisible();
  });

  test('logs in with username and password and returns to the requested page', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await fillAndSubmit(page, 'admin', 'senha-super-secreta');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('admin', { exact: true })).toBeVisible();
  });

  test('shows a generic message for invalid credentials', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');
    await fillAndSubmit(page, 'admin', 'senha-errada-aqui');
    await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Senha')).toHaveValue('');
  });

  test('explains when too many attempts were made', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');
    await fillAndSubmit(page, 'admin', 'bloqueado-demais');
    await expect(page.getByRole('alert')).toHaveText('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  });

  test('hides the password form when local login is disabled', async ({ page }) => {
    await mockApi(page, { localLoginEnabled: false });
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' })).toBeVisible();
    await expect(page.getByLabel('Usuário')).toHaveCount(0);
  });

  test('shows the intranet error returned by the OIDC callback', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login?auth_error=authentication_failed');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível concluir o login pela intranet. Tente novamente.');
  });

  test('ignores an external next parameter', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login?next=%2F%2Fevil.example');
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' }))
      .toHaveAttribute('href', '/api/auth/oidc/login?next=%2F');
    await fillAndSubmit(page, 'admin', 'senha-super-secreta');
    await expect.poll(() => new URL(page.url()).host).toBe('127.0.0.1:5174');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });

  test('sends an already authenticated user away from /login', async ({ page }) => {
    await mockApi(page, { authenticated: true });
    await page.goto('/login?next=%2Fdashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('returns to /login when the session expires during use', async ({ page }) => {
    const state = await mockApi(page, { authenticated: true });
    await page.route('**/api/jobs*', (route: Route) => {
      state.authenticated = false;
      return route.fulfill(json({ success: false, error: 'Session expired' }, 401));
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });
});
```

(Na última, o `page.route` de `/api/jobs*` registrado depois tem precedência sobre o do `mockApi`.)

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx playwright test --project=auth-chromium`
Expected: FAIL — a aplicação ainda redireciona para `/api/auth/oidc/login` e não existe `/login`.

- [ ] **Step 4: Copy the logo and add `returnTo.ts`**

```bash
mkdir -p frontend/src/assets
cp "assets/logos/CREFITO 11 - Marca - Neg 2 Completa.png" frontend/src/assets/crefito11-logo-negativo.png
```

```ts
// frontend/src/utils/returnTo.ts
const MAX_RETURN_TO_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

// Mirrors backend/src/utils/returnTo.ts: only same-origin paths are accepted.
export const sanitizeReturnTo = (value: string | null): string => {
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARACTERS.test(value)) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return '/';
  return value;
};
```

- [ ] **Step 5: Extend `api.ts`**

Substituir a interface `AuthUser` por:

```ts
export type AuthProviderName = 'oidc' | 'local';

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
  provider?: AuthProviderName;
}

export interface AuthOptions {
  localLoginEnabled: boolean;
}
```

Depois de `logout`:

```ts
export const getAuthOptions = async (): Promise<AuthOptions> => {
  const response = await api.get<ConfigResponse<AuthOptions>>('/auth/options');
  return response.data.data;
};

export const loginWithPassword = async (username: string, password: string): Promise<AuthUser> => {
  const response = await api.post<ConfigResponse<AuthUser>>('/auth/local/login', { username, password });
  return response.data.data;
};
```

No interceptor de resposta, dentro de `if (error.response) { ... }`, após o `console.error`:

```ts
      // An expired session during use sends the user back to the login page.
      const isAuthRequest = error.config?.url?.startsWith('/auth/') ?? false;
      if (status === 401 && authEnabled && !isAuthRequest && window.location.pathname !== '/login') {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      }
```

E, abaixo de `API_BASE_URL`:

```ts
const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';
```

- [ ] **Step 6: Update `AuthProvider.tsx`**

Arquivo completo:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthUser, getCurrentUser, logout as endSession } from '../../services/api';

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authEnabled);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!authEnabled) return;
    let active = true;
    getCurrentUser()
      .then((identity) => active && setUser(identity))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const logout = useCallback(async () => {
    if (!authEnabled) return;
    const { logoutUrl } = await endSession();
    window.location.assign(logoutUrl || '/login');
  }, []);

  const value = useMemo(() => ({ enabled: authEnabled, loading, user, setUser, logout }), [loading, user, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function AuthLoading() {
  return <main className="min-h-screen bg-gray-50 flex items-center justify-center"><span className="sr-only">Autenticando</span></main>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, user } = useAuth();
  const location = useLocation();

  if (!enabled || user) return <>{children}</>;
  if (loading) return <AuthLoading />;
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
```

- [ ] **Step 7: Create `LoginPage.tsx`**

```tsx
// frontend/src/pages/LoginPage.tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import logo from '../assets/crefito11-logo-negativo.png';
import { AuthLoading, useAuth } from '../components/Auth/AuthProvider';
import { getAuthOptions, loginWithPassword } from '../services/api';
import { sanitizeReturnTo } from '../utils/returnTo';

const OIDC_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'O acesso pela intranet foi cancelado.',
};
const DEFAULT_OIDC_ERROR = 'Não foi possível concluir o login pela intranet. Tente novamente.';

const loginErrorMessage = (error: unknown): string => {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401) return 'Usuário ou senha inválidos.';
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível entrar agora. Tente novamente.';
};

const inputClassName = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

export default function LoginPage() {
  const { enabled, loading, user, setUser } = useAuth();
  const [params] = useSearchParams();
  const next = sanitizeReturnTo(params.get('next'));
  const oidcError = params.get('auth_error');
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getAuthOptions()
      .then((options) => active && setLocalLoginEnabled(options.localLoginEnabled))
      .catch(() => active && setLocalLoginEnabled(false));
    return () => { active = false; };
  }, [enabled]);

  if (!enabled || user) return <Navigate to={next} replace />;
  if (loading) return <AuthLoading />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setUser(await loginWithPassword(username, password));
    } catch (loginError) {
      setError(loginErrorMessage(loginError));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="flex justify-center bg-slate-900 px-8 py-8">
          <img src={logo} alt="CREFITO 11" className="h-16 w-auto" />
        </div>

        <div className="space-y-6 px-8 py-8">
          <h1 className="text-center text-xl font-semibold text-gray-900">Acessar o BulkMail</h1>

          {oidcError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {OIDC_ERROR_MESSAGES[oidcError] ?? DEFAULT_OIDC_ERROR}
            </p>
          )}

          <a
            href={`/api/auth/oidc/login?next=${encodeURIComponent(next)}`}
            className="flex w-full items-center justify-center gap-3 rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
          >
            <img src="/apple-touch-icon.png" alt="" aria-hidden="true" className="h-6 w-6" />
            Entrar no login intranet
          </a>

          {localLoginEnabled && (
            <>
              <div className="flex items-center gap-3 text-xs uppercase text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                ou
                <span className="h-px flex-1 bg-gray-200" />
              </div>

              <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700">Usuário</label>
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">Senha</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClassName}
                  />
                </div>

                {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting || !username.trim() || !password}
                  className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {submitting ? 'Entrando...' : 'Entrar'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Route `/login` outside the gate in `App.tsx`**

```tsx
// Frontend App component with React Router
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import StatusPage from './pages/StatusPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import { AuthGate, AuthProvider } from './components/Auth/AuthProvider';

function ProtectedRoutes() {
  return <AuthGate><Outlet /></AuthGate>;
}

function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoutes />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/status/:jobId" element={<StatusPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
  </Routes></AuthProvider></BrowserRouter>;
}

export default App;
```

- [ ] **Step 9: Run e2e, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium`
Expected: 9 testes PASS.
Run: `cd frontend && npx playwright test --project=chromium e2e/dashboard.spec.ts e2e/home-routing.spec.ts`
Expected: PASS (auth desativado continua funcionando).
Run: `cd frontend && npm run lint && npm run build`
Expected: sem erros; `dist/assets/` contém o PNG do logo com hash.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/assets/crefito11-logo-negativo.png frontend/src/utils/returnTo.ts frontend/src/pages/LoginPage.tsx frontend/src/services/api.ts frontend/src/components/Auth/AuthProvider.tsx frontend/src/App.tsx frontend/playwright.config.ts frontend/e2e/auth/login.spec.ts
git commit -m "feat: add login page with intranet and local sign-in [Story 4.1]"
```

---

### Task 10: Runbook, story record and full verification (AC 23)

**Files:**
- Modify: `docs/production.md`
- Modify: `docs/stories/4.1.feat-login-local-e-oidc.story.md`

- [ ] **Step 1: Add the runbook section to `docs/production.md`**

Inserir antes de `## Backup sob demanda`:

````markdown
## Usuários locais (login por senha)

O login por usuário e senha convive com o login da intranet. Os comandos rodam
dentro de um container do backend, **no nó onde a task está em execução**:

```bash
docker service ps bulkmail_backend --filter desired-state=running --format '{{.Node}}'
# no nó indicado:
backend_container=$(docker ps --filter name=bulkmail_backend -q | head -1)
```

Criar o admin inicial (a senha é pedida duas vezes, sem eco; mínimo 12 caracteres):

```bash
docker exec -it "$backend_container" npm run user:admin -- create --username=admin
```

Trocar a senha (encerra as sessões abertas desse usuário):

```bash
docker exec -it "$backend_container" npm run user:admin -- reset-password --username=admin
```

Desativar ou reativar:

```bash
docker exec -it "$backend_container" npm run user:admin -- disable --username=admin
docker exec -it "$backend_container" npm run user:admin -- enable --username=admin
```

Para desligar totalmente o login por senha, defina `LOCAL_LOGIN_ENABLED=false`
em `deploy/production.env` e execute `./scripts/production/deploy.sh`.

Tentativas de login local aparecem nos logs com o prefixo `[LocalAuth]`:

```bash
docker service logs --since 1h bulkmail_backend | grep '\[LocalAuth\]'
```

### IP real do cliente

O bloqueio de tentativas usa o IP do cliente. Depois do primeiro deploy, faça
uma tentativa com senha errada a partir de uma máquina conhecida e confira o
campo `ip` do log `[LocalAuth]`:

- IP público/da rede do usuário: configuração correta.
- IP interno do Docker (por exemplo `10.0.x.x`) igual para todos: ajuste
  `TRUST_PROXY_HOPS=2` em `deploy/production.env` e refaça o deploy. Se mesmo
  assim o IP continuar interno, o Traefik está recebendo o tráfego pela rede
  ingress do Swarm, que oculta o IP de origem; publique as portas do Traefik em
  `mode: host` antes de confiar no bloqueio por IP.
````

- [ ] **Step 2: Full verification**

Run:

```bash
cd backend && npm run lint; npx tsc --noEmit && npx jest
cd ../frontend && npm run lint && npm run build && npx playwright test --project=auth-chromium --project=chromium
```

Expected:
- Backend: `tsc` sem erros; Jest sem falhas. O `npm run lint` do backend continua acusando apenas os 4 erros pré-existentes em `scripts/verifyProductionArtifacts.js` (não introduzidos por esta story); nenhum erro nos arquivos novos.
- Frontend: lint e build limpos; Playwright PASS.

- [ ] **Step 3: Update the story record**

Em `docs/stories/4.1.feat-login-local-e-oidc.story.md`:
- `status: "InReview"` no frontmatter e `InReview` em `## Status`.
- Em `## Dev Agent Record` → `### File List`, listar todos os arquivos criados/modificados nas Tasks 1–10.
- Acrescentar ao `## Change Log`: `| 2026-10-10 | 0.2 | Implementação concluída; status Draft → InReview | Claude |`.

- [ ] **Step 4: Commit**

```bash
git add docs/production.md docs/stories/4.1.feat-login-local-e-oidc.story.md
git commit -m "docs: document local admin operations [Story 4.1]"
```

- [ ] **Step 5: Post-deploy checklist (executado pelo usuário na VPS após `deploy.sh`)**

1. `docker exec -it <backend> npm run user:admin -- create --username=admin`.
2. Abrir `https://bulkmail.crefito.gov.br/dashboard` em janela anônima → cair em `/login?next=%2Fdashboard`.
3. Entrar com `admin` → voltar ao dashboard; "Sair" → voltar a `/login`.
4. Entrar pela intranet → voltar ao dashboard.
5. Errar a senha uma vez e conferir o `ip` no log `[LocalAuth]` (seção "IP real do cliente").
