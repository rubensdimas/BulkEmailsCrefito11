# Configurações administrativas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir perfis (admin/operador) e uma área de Configurações só para admins, com gestão de usuários, Mailgrid e OIDC lidos do banco em vez do `.env`, e uma barra superior única no frontend.

**Architecture:** A tabela `local_users` vira `users` (locais + intranet, com `role`). O middleware de autenticação passa a carregar a conta do banco a cada requisição (perfil/situação imediatos) e ganha `requireAdmin` e `requirePasswordCurrent`. Mailgrid e OIDC são lidos da tabela `configurations` a cada uso (sem cache, logo aplicados em todas as réplicas e no worker); no start, uma importação única copia o ambiente para o banco quando ele está vazio. O `oidcService` deixa de ler variáveis de ambiente e passa a usar uma fonte de configuração injetável. No frontend, um `AppHeader` substitui os headers copiados nas páginas e `/settings` vira um layout com menu lateral.

**Tech Stack:** Express 4 + TypeScript, Knex 3 / PostgreSQL 18, ioredis, Jest 29 (ts-jest), React 18 + React Router 7 + Tailwind 3 + clsx, Playwright.

**Spec:** `docs/stories/4.2.feat-settings-admin.story.md` (ACs 1–24).

## Andamento salvo para retomada — 2026-10-10

Registro documental do estado consultado, sem continuar a implementação. Branch `feat/4.2-settings-admin`; HEAD observado `39d944215c75c57416301b9aac72fd57b9964a9a`. Antes de retomar, conferir `git status`, `git log` e o ledger para identificar alterações posteriores a este registro.

| Task | Estado | Commits / revisão |
|---|---|---|
| 1 — Usuários e migration | Concluída e aprovada | `be620d1`; especificação e qualidade aprovadas |
| 2 — Último admin / CLI | Concluída e aprovada | `3a90784`, `6bc84d5`; teste prova conexões distintas e sobreposição |
| 3 — Configurações / importação | Concluída e aprovada | `e58941f`; importação transacional e binding original |
| 4 — OIDC por snapshot | Concluída e aprovada | `1e4b061`, `2e2da3b`; incompatibilidade preserva not_configured |
| 5 — Conta e guards | Concluída e aprovada | `e265f29`, `dede366`; ordem de middleware corrigida e testada no app real |
| 6 — APIs administrativas | Concluída e aprovada | `56e8efb`; CAS, redaction, auditoria e guards HTTP |
| 7 — Navegação e senha no frontend | Concluída e aprovada | `39d9442`, `9cb496c` |
| 8 — Layout, usuários e e-mail | Concluída e aprovada | `ac69437`, `b8ebadd` |
| 9 — Tela OIDC | Concluída e aprovada | `53e8c56`, `17584c7` |
| 10 — Deploy, runbook e gates | Concluída e aprovada | commit `docs: settings in database runbook and optional OIDC env` |

**Próxima ação:** revisão final da branch e handoff ao @qa/@devops.

**Evidências históricas verificadas nos relatórios:** Task 6: 393 testes backend, 19 integrações PostgreSQL e 17 verificações HTTP no app real passaram; lint, typecheck e build passaram. Task 7, antes da correção pendente: 40/40 testes de navegador e repetição auth 21/21 passaram, com lint/build aprovados. Esses resultados não certificam a correção ainda pendente nem a story completa. A revisão encontrou a corrida apesar dos testes anteriores passarem.

**Ambiente para retomar:** PostgreSQL descartável `bulkmail-sdd-it-pg`, `127.0.0.1:55432`; Redis descartável `bulkmail-sdd-it-redis`, `127.0.0.1:56379`. Verificar disponibilidade antes de usar e evitar os serviços de desenvolvimento nas portas 5432/6379. Para Playwright: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5175`, `PLAYWRIGHT_AUTH_BASE_URL=http://127.0.0.1:5174`, `VITE_AUTH_ENABLED=false`, `VITE_API_URL=/api`; o servidor auth sobrescreve o flag para true. A porta 5173 pertence ao frontend Docker e interferiu no baseline. Acessos localhost/Docker/Git podem exigir escalada conforme as permissões vigentes.

**Registros de apoio:** `.superpowers/sdd/2026-10-10-settings-admin/progress.md`, briefs e relatórios `task-N-report.md`, reviews e re-reviews no mesmo diretório. Esses arquivos são ignorados pelo Git; este checkpoint e a story guardam o resumo persistente. Para a pendência atual, ler `task-7-review.md` e o relatório/fix report da Task 7. CodeRabbit não está instalado; provider OIDC real e deploy não foram validados. Há artefatos gerados de navegador no working tree; não commitá-los como implementação. Nenhum push foi realizado.

## Global Constraints

- Perfis: `'admin' | 'operator'`; origens: `'local' | 'oidc'`. Usuário local criado pelo CLI: `admin`, sem troca obrigatória; pela tela: perfil escolhido (padrão `admin`) e `must_change_password = true`.
- Nome de usuário local: `^[a-z0-9._-]{3,64}$` após `trim().toLowerCase()` (reusar `USERNAME_PATTERN` e `normalizeUsername`). Senha: política existente (`validatePasswordPolicy`, 12–128).
- Rotas novas da API: `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/password`, `GET|POST /api/config/oidc`, `POST /api/config/oidc/test`, `POST /api/auth/password`. `/api/config/*` e `/api/admin/*` exigem admin.
- Códigos de erro: `403 forbidden`, `403 password_change_required`, `409 last_active_admin`, `409 username_taken`, `409 credentials_changed`, `404 not_found`, `400 invalid_request|invalid_username|invalid_role|invalid_password|not_local|invalid_current_password|same_password|invalid_oidc_settings|oidc_test_failed`; `auth_error` do login: `unauthorized`, `not_configured`.
- Respostas de erro de domínio: `{ success: false, error: <código>, message: <texto em português> }`.
- Rotas do frontend: `/settings` → `/settings/users`, `/settings/email`, `/settings/oidc`; troca de senha em `/account/password`.
- Textos da interface em português. Rótulos exatos: barra superior "Novo Envio", "Dashboard", "Configurações"; menu da conta "Minha senha"; menu lateral "Usuários", "E-mail", "Login intranet"; origem "Local"/"Intranet"; perfis "Administrador"/"Operador".
- Segredos (senha Mailgrid, token do webhook, client secret OIDC, hashes) nunca aparecem em respostas da API nem em logs. Campo de segredo vazio ao salvar mantém o valor atual.
- Sem cache de configurações: Mailgrid e OIDC são lidos do banco no início de cada operação e propagados como snapshot imutável.
- Nenhuma dependência nova (backend ou frontend).
- Commits convencionais com `[Story 4.2]`; push é exclusivo do @devops.

## Review Focus

Prioridade QA: issuer + sub (Task 1), snapshot e binding legado (Tasks 3–4), último admin pelo CLI/concorrência (Task 2), reset × troca/login (Tasks 5–6), secrets ilegíveis e validação disabled (Tasks 3/6). Cada cenário tem ciclo de teste nas decisões da task responsável.

1. **Sessão OIDC aberta antes do deploy (sem linha em `users`).** Esperado: o usuário é registrado como `operator` na primeira requisição e segue usando o sistema. Teste: "registers users of sessions opened before Story 4.2" (Task 4).
2. **Admin rebaixando ou desativando a si mesmo.** Esperado: permitido se houver outro admin ativo; recusado com 409 se for o último. Testes: "rejects demoting the last active admin" e "allows demoting an admin when another admin remains" (Task 2).
3. **Instalação nova sem Mailgrid configurado, mas com `MAILGRID_HOST` no ambiente depois da importação.** Esperado: o ambiente é ignorado; a configuração vem só do banco. Teste: "ignores Mailgrid environment variables once reading" (Task 3).
4. **Salvar OIDC com client secret vazio.** Esperado: mantém o secret atual. Teste: "keeps the stored client secret when the field is empty" (Task 6).
5. **Duas réplicas importando o ambiente ao mesmo tempo.** Esperado: só uma grava; nenhuma falha. Teste: "inserts a configuration only once" (Task 3, integração).

---

## Decisões após revisão QA (2026-10-10)

Esta revisão substitui os corpos de implementação anteriores por contratos e testes. Ler as decisões complementares junto com Interfaces antes de executar cada task. A revisão documental original antecedeu a implementação. A story agora está InProgress; consultar o checkpoint acima para tarefas aprovadas e pendências.

- Identidade OIDC: `(issuer, sub)`, sem unir contas por e-mail. Um issuer diferente cria outra conta `operator`, preservando perfis/situação da identidade original.
- Login, callback, refresh e logout usam um snapshot por operação. Uma configuração alterada não pode enviar segredos ou tokens antigos a endpoints novos.
- API e CLI compartilham a proteção do último admin. A invariável deve valer com transações concorrentes.
- Reset de senha incrementa `credential_version` no mesmo UPDATE da senha. Sessões carregam a versão autenticada; comparar com o banco em cada requisição torna revogação independente do índice Redis.
- Troca voluntária faz compare-and-swap do hash e da versão verificados; não incrementa a versão nem revoga todas as sessões. Reset concorrente vence uma troca baseada em credenciais antigas.
- Salvar OIDC desativado valida campos preenchidos e restrições ambientais. Segredo ilegível na importação inicial aborta a importação daquela seção sem persistir vazio; a próxima inicialização pode tentar novamente.

## Decisões da retomada (2026-10-10, sessão de grilling)

- Task 7: correção com contador de geração (`useRef`) no `AuthProvider`; `clearUser`, `auth-invalid`, `logout` e login aceito avançam a geração; só o refresh corrente grava conta/erros/loading.
- Task 8: cada usuário local tem formulário inline "Definir senha" (senha + confirmação; sucesso em `role=status`, erro do backend em `role=alert`) coberto por e2e.
- Task 8: alteração de perfil/situação no próprio usuário chama `refresh()`; os guards redirecionam após auto-rebaixamento/desativação (e2e).
- Task 8: e2e com viewport 375px confirma abas visíveis e menu lateral oculto (AC23).
- Task 10: status final `InReview` (não "Ready for Review"), Change Log 0.4; `Done` é do @qa; push/PR do @devops.
- Artefatos `frontend/test-results` são restaurados e não commitados.
- `InReview` aceito com OIDC real, deploy e CodeRabbit não verificados, registrados como limitações explícitas.

## File Structure

**Backend — criar**
- `backend/src/services/oidcConfiguration.ts` (+ teste) — fingerprint puro e tipos de binding/context.
- `backend/src/migrations/20261010120000_users_roles.ts` — renomeia `local_users` → `users` e adiciona colunas de perfil/origem.
- `backend/src/repositories/userRepository.ts` — substitui `localUserRepository.ts` (renomeado com `git mv`): tipos `User`, `LocalUser`, `UserStore`, erros de acesso.
- `backend/src/repositories/userRepository.integration.test.ts` — substitui o teste de integração de `local_users`.
- `backend/src/repositories/systemConfigRepository.integration.test.ts` — `insertIfAbsent`.
- `backend/src/services/accountService.ts` (+ teste) — resolve a conta da sessão e monta a visão `/me`.
- `backend/src/services/settingsAudit.ts` — log `[Settings]`.
- `backend/src/services/userAdminService.ts` (+ teste) — regras de gestão de usuários e troca da própria senha.
- `backend/src/routes/userAdminRoutes.ts` (+ teste) — `/api/admin/users`.

**Backend — modificar**
- `services/authSessionService.ts` (+ teste) — issuer/fingerprint OIDC, credentialVersion local e refresh por context.
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
rtk docker run -d --name bulkmail-sdd-it-pg -e POSTGRES_USER=bulkmail -e POSTGRES_PASSWORD=bulkmail123 -e POSTGRES_DB=bulkmail -p 55432:5432 postgres:18.4-alpine
until rtk docker exec bulkmail-sdd-it-pg pg_isready -U bulkmail -d bulkmail; do sleep 1; done
(cd backend && POSTGRES_PORT=55432 rtk npm run migrate)
# ... RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 rtk proxy npx jest <arquivo>
rtk docker rm -f bulkmail-sdd-it-pg
```

---

### Task 1: Tabela `users` e repositório (AC 1, 12)

**Contratos complementares — identidade e credenciais (AC1, 7, 10):**
- Migration adiciona `oidc_issuer` nullable e `credential_version integer NOT NULL DEFAULT 0`. Índice único composto `(oidc_issuer, oidc_sub)`; CHECK exige ambos para OIDC e username/password para local. Não criar UNIQUE de `oidc_sub` isolado.
- `User` expõe internamente `oidcIssuer: string | null` e `credentialVersion: number`; nunca retornar hash/versão pelo DTO público.
- `findByOidcSub(issuer: string, sub: string): Promise<User | null>` e `upsertOidcUser(input: { issuer: string; sub: string; email?: string; name?: string }): Promise<User>` usam a chave composta. Upsert só altera nome/e-mail; preserva perfil, disabled e versão.
- `updatePassword(id: string, passwordHash: string, mustChangePassword?: boolean): Promise<void>` é reset: incrementa versão atomicamente. CLI mantém `mustChangePassword=false`; API usa true.
- `changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string): Promise<boolean>` faz UPDATE condicional, limpa must-change e não incrementa versão. Nenhuma outra operação escreve senha diretamente.

- [x] **QA Step 1: Escrever teste de isolamento por issuer** em `userRepository.integration.test.ts`:
```ts
it('isolates the same subject across issuers', async () => {
  const a = await repository.upsertOidcUser({ issuer: 'https://a.example', sub: 'same' });
  await database('users').where({ id: a.id }).update({ role: 'admin' });
  const b = await repository.upsertOidcUser({ issuer: 'https://b.example', sub: 'same' });
  expect(b.id).not.toBe(a.id);
  expect(b.role).toBe('operator');
  expect((await repository.findByOidcSub('https://a.example', 'same'))?.role).toBe('admin');
});
```
Limpar as duas contas em afterAll. Acrescentar preservação dos admins existentes, CHECK rejeitando issuer ausente e reset incrementando versão.
- [x] **QA Step 2:** executar `rtk proxy npx jest src/repositories/userRepository.integration.test.ts --runInBand` em backend com `RUN_DATABASE_INTEGRATION=true` e Postgres descartável; FAIL antes das alterações.
- [x] **QA Step 3:** implementar migration, mapeamento e contratos acima; adaptar mocks e consumidores locais ao campo versão.
- [x] **QA Step 4:** repetir teste com PASS e executar `rtk proxy npx tsc --noEmit` em backend.

**Files:**
- Create: `backend/src/migrations/20261010120000_users_roles.ts`
- Rename+rewrite: `backend/src/repositories/localUserRepository.ts` → `backend/src/repositories/userRepository.ts`
- Rename+rewrite: `backend/src/repositories/localUserRepository.integration.test.ts` → `backend/src/repositories/userRepository.integration.test.ts`
- Modify: `backend/src/services/databaseService.ts`, `backend/src/services/localAuthService.ts`, `backend/src/services/localUserAdminService.ts`, `backend/src/scripts/manageLocalAdmin.ts`, `backend/src/routes/authRoutes.ts`, `backend/package.json`
- Modify tests: `backend/src/services/localAuthService.test.ts`, `backend/src/services/localUserAdminService.test.ts`, `backend/src/controllers/localAuthController.test.ts`

**Interfaces:**
- Produces:
  Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.

  - `create` sem `role` grava `admin`; sem `mustChangePassword` grava `false`. `updatePassword` sem o terceiro argumento grava `must_change_password = false`.
  - `upsertOidcUser` cria com `role = 'operator'` ou atualiza só `email`/`name` de quem já existe.

- [x] **Step 1: Rename files and write the failing integration test**

```bash
rtk git mv backend/src/repositories/localUserRepository.ts backend/src/repositories/userRepository.ts
rtk git mv backend/src/repositories/localUserRepository.integration.test.ts backend/src/repositories/userRepository.integration.test.ts
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
      provider: 'local', role: 'admin', username, passwordHash: 'hash-1', mustChangePassword: false, oidcSub: null, oidcIssuer: null, credentialVersion: 0,
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
    const first = await repository.upsertOidcUser({ issuer: 'https://intranet.example', sub, email: 'old@crefito.gov.br', name: 'Nome Antigo' });
    expect(first).toMatchObject({ provider: 'oidc', role: 'operator', oidcSub: sub, username: null, passwordHash: null });

    const second = await repository.upsertOidcUser({ issuer: 'https://intranet.example', sub, email: 'new@crefito.gov.br', name: 'Nome Novo' });
    expect(second).toMatchObject({ id: first.id, email: 'new@crefito.gov.br', name: 'Nome Novo', role: 'operator' });
    await expect(repository.findByOidcSub('https://intranet.example', sub)).resolves.toMatchObject({ id: first.id });
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

- [x] **Step 2: Run it to verify it fails**

Com o Postgres descartável (seção "Banco de teste" acima, sem rodar a migration nova ainda):
Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: FAIL — `UserRepository` não exportado / tabela `users` inexistente.

- [x] **Step 3: Write the migration**

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


- [x] **Step 4: Rewrite the repository**

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


- [x] **Step 5: Update consumers**

`backend/src/services/databaseService.ts`: trocar o import de `localUserRepository` por

```ts
import {
  UserRepository,
  createUserRepository,
} from "../repositories/userRepository";
```

renomear o singleton `localUserRepository` para `userRepository` (tipo `UserRepository | null`, criado com `createUserRepository(db)` e zerado no shutdown) e o getter para:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


`backend/src/routes/authRoutes.ts`: `import { getUserRepository } from '../services/databaseService';` e `users: getUserRepository(),` no lugar de `getLocalUserRepository()`.

`backend/src/services/localAuthService.ts` e `backend/src/services/localUserAdminService.ts`: trocar `'../repositories/localUserRepository'` por `'../repositories/userRepository'`.

`backend/src/services/localUserAdminService.ts` — o CLI cria admins sem troca obrigatória e o reset pelo CLI limpa a obrigação:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


`backend/src/scripts/manageLocalAdmin.ts`: `import { createUserRepository } from '../repositories/userRepository';` e `users: createUserRepository(db),`.

`backend/package.json`, script `test:integration`: trocar `src/repositories/localUserRepository.integration.test.ts` por `src/repositories/userRepository.integration.test.ts`.

- [x] **Step 6: Update unit-test fixtures to the new `LocalUser` shape**

Em `localAuthService.test.ts` (`activeAdmin`) e `localAuthController.test.ts` (`admin`), completar os objetos com:

```ts
  provider: 'local' as const,
  role: 'admin' as const,
  oidcSub: null, oidcIssuer: null, credentialVersion: 0,
  email: null,
  name: null,
  mustChangePassword: false,
```

Em `localUserAdminService.test.ts`, a classe `InMemoryLocalUsers` passa a criar:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


(importando `LocalUser`, `LocalUserStore`, `UserRole` de `'../repositories/userRepository'`), e acrescentar ao teste "creates a user with a normalized username and hashed password":

```ts
    expect(created).toMatchObject({ role: 'admin', mustChangePassword: false });
```

- [x] **Step 7: Migrate and run tests**

Run: `cd backend && POSTGRES_PORT=55432 npm run migrate && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: migration `20261010120000_users_roles` aplicada; todos os testes PASS, incluindo isolamento issuer + sub e versões de credenciais.
Run: `cd backend && POSTGRES_PORT=55432 npx knex migrate:rollback && POSTGRES_PORT=55432 npm run migrate`
Expected: rollback e reaplicação sem erro (o `down` funciona).
Run: `cd backend && npx tsc --noEmit && npx jest && npx eslint src/repositories src/services src/scripts src/routes src/migrations`
Expected: sem erros; suíte unitária verde.

- [x] **Step 8: Commit**

```bash
rtk git add -A backend/src/repositories backend/src/migrations/20261010120000_users_roles.ts backend/src/services backend/src/scripts/manageLocalAdmin.ts backend/src/routes/authRoutes.ts backend/src/controllers/localAuthController.test.ts backend/package.json
rtk git commit -m "feat: unify local and intranet accounts in users table with roles [Story 4.2]"
```

---

### Task 2: Alteração de perfil/situação protegida (AC 6)

**Contratos complementares — API e CLI (AC6, 12):**
- Modificar também `backend/src/services/localUserAdminService.ts`, seu teste e `backend/src/scripts/manageLocalAdmin.ts`.
- `setDisabled(id: string, disabled: boolean): Promise<void>` delega a `updateAccess(id, { disabled })`; não manter UPDATE alternativo.
- `updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<User>` serializa as mutações com `SELECT pg_advisory_xact_lock(420002)` dentro da transação, bloqueia a linha alvo, lê o estado atual e só recusa a remoção de um admin ativo quando nenhum outro restar. Retorna `LastActiveAdminError`; ausência retorna `UserNotFoundError`. Promoção/reativação de operator continua possível mesmo se instalação ainda não possui admin.
- O CLI traduz último admin para mensagem portuguesa e exit code não zero. Não revoga sessões se a alteração foi recusada.

- [x] **QA Step 1:** substituir teste somente sequencial por caso concorrente em `userRepository.integration.test.ts`; fixture isolada com exatamente dois admins ativos e pool >=2, sem transação externa envolvendo os dois calls:
Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.

Rodar em banco descartável, preservar/limpar fixture. Testar também self-demotion com outro admin e CLI tentando desativar último admin.
- [x] **QA Step 2:** rodar teste de integração e `rtk proxy npx jest src/services/localUserAdminService.test.ts`; FAIL antes da proteção.
- [x] **QA Step 3:** implementar operação comum e adaptação CLI; remover o algoritmo anterior de lock apenas nas linhas de admins.
- [x] **QA Step 4:** repetir testes com PASS e typecheck. Incluir arquivos CLI no commit desta task.

**Files:**
- Modify: `backend/src/repositories/userRepository.ts`
- Test: `backend/src/repositories/userRepository.integration.test.ts`

**Interfaces:**
- Consumes: `UserRepository`, `User`, `UserRole` (Task 1).
- Produces:
  Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.

  - Em transação: trava as linhas de admins ativos (`FOR UPDATE`), aplica a mudança e, se não restar nenhum admin ativo, lança `LastActiveAdminError` (rollback). Id inexistente → `UserNotFoundError`. `change` vazio → devolve o usuário sem alterar.

- [x] **Step 1: Write the failing tests**

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

- [x] **Step 2: Run them to verify they fail**

Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts`
Expected: FAIL — `updateAccess` / `LastActiveAdminError` não existem.

- [x] **Step 3: Implement**

Em `userRepository.ts`, após os tipos:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Acrescentar ao `UserStore`:

```ts
  updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<User>;
```

E ao `UserRepository`:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Se o `tsc` reclamar do tipo de `count`, use `.count<{ count: string }[]>({ count: '*' })`.

- [x] **Step 4: Run tests**

Run: `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/userRepository.integration.test.ts && npx tsc --noEmit && npx eslint src/repositories`
Expected: todos os testes PASS; sem erros.
`localUserAdminService.test.ts` deve comprovar que `setDisabled` delega à operação protegida e traduz `LastActiveAdminError`; confirme também reset com incremento de versão usando `npx jest`.

- [x] **Step 5: Commit**

```bash
rtk git add backend/src/repositories/userRepository.ts backend/src/repositories/userRepository.integration.test.ts
rtk git commit -m "feat: guard role and status changes so an active admin always remains [Story 4.2]"
```

---

### Task 3: Configurações do Mailgrid e OIDC no banco (AC 13, 19)

**Contratos complementares — importação e legado (AC7, 19):**
- `OidcSettings` permanece `{ enabled, issuer, clientId, clientSecret, backchannelOrigin }`. Armazenar na chave separada `oidc_legacy_binding` o `{ issuer: string; configurationFingerprint: string }` da configuração original. Binding é interno, insert-only e não aparece na API.
- Na primeira inicialização, importar OIDC e gravar binding no mesmo transaction. Se `oidc` já existir, derivar binding dessa configuração armazenada, nunca do ambiente. Não recalcular binding após salvar OIDC. Sem configuração, não criar binding.
- Produzir `getLegacyOidcBinding(): Promise<{ issuer: string; configurationFingerprint: string } | null>` em ConfigService. O helper puro `oidcConfigurationFingerprint(settings: OidcSettings, sessionEncryptionKey: Buffer): string` é produzido nesta task; importação e Task 4 o consomem, sem discovery ou dependência circular. Extrair loader da chave para este módulo e reexportar em oidcService se necessário, sem mudar criptografia de refresh tokens existente.
- `environmentSecret(env, name): string` prioriza variável já exportada pelo entrypoint; se só `_FILE` existir e leitura falhar, lançar erro com nome da variável, sem conteúdo/valor. Consultar existência da seção no banco antes de ler os secrets antigos: configuração existente ignora completamente ambiente e arquivos.
- `insertIfAbsent` continua `ON CONFLICT DO NOTHING`. Preparar/validar todos os campos e criptografar antes do insert; falha não pode gravar linha vazia. Falha operacional interrompe startup, log sanitizado e retry no próximo start.
- Files adicionais: `backend/src/services/oidcConfiguration.ts` (helper fingerprint puro, criado nesta task), `backend/src/services/oidcConfiguration.test.ts`.

- [x] **QA Step 1:** em configService.test, fornecer `_FILE` inexistente sem valor exportado, esperar rejeição e zero inserts; corrigir reader mock e esperar importação na próxima tentativa. Com seção existente, mesmo arquivo ilegível não deve ser lido. Comparar binding antes/depois de alteração de issuer: permanece original.
- [x] **QA Step 2:** rodar `rtk proxy npx jest src/services/configService.test.ts`; FAIL antes da mudança.
- [x] **QA Step 3:** implementar importação transacional e binding; `oidcConfigurationFingerprint` usa HMAC-SHA256 com chave obtida pelo mesmo loader de `OIDC_SESSION_ENCRYPTION_KEY`, sobre JSON de tupla estável `[enabled, issuer, clientId, clientSecret, backchannelOrigin]`. Não incluir APP_ORIGIN (fixo por ambiente). Não logar/expor fingerprint.
- [x] **QA Step 4:** repetir teste e integração `systemConfigRepository.integration.test.ts`. Manter teste real `Promise.all` de duas importações; uma grava, outra não falha, binding consistente com a vencedora.

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

- [x] **Step 1: Write the failing unit tests**

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

- [x] **Step 2: Write the failing integration test**

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

- [x] **Step 3: Run them to verify they fail**

Run: `cd backend && npx jest src/services/configService.test.ts`
Expected: FAIL — `getOidcSettings`/`importFromEnvironment` inexistentes; o teste de ambiente recebe os valores do `.env`.
Run (Postgres descartável): `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/systemConfigRepository.integration.test.ts`
Expected: FAIL — `insertIfAbsent is not a function`.

- [x] **Step 4: Implement the model and repository**

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


(importar `ConfigValue` de `'../models/SystemConfig'`).

- [x] **Step 5: Implement `ConfigService`**

Substituir `getMailgridConfig` e acrescentar os novos métodos:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


Remover o bloco `try/catch` com fallback para `process.env` do `getMailgridConfig` antigo.

- [x] **Step 6: Remove the environment fallback from the worker**

Em `backend/src/queue/processors.ts`, substituir o bloco que monta `config` por:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [x] **Step 7: Import on backend start**

Em `backend/src/app.ts`, dentro de `startServer`, logo após `await initializeDatabase();` (no mesmo `try`):

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


(Ajuste o import dinâmico existente para trazer `initializeDatabase` e `getConfigService` juntos.)

- [x] **Step 8: Run tests**

Run: `cd backend && npx jest src/services/configService.test.ts src/queue src/controllers/webhookController.test.ts src/controllers/configController.test.ts && npx tsc --noEmit && npx eslint src/services/configService.ts src/repositories/systemConfigRepository.ts src/models/SystemConfig.ts src/queue/processors.ts src/app.ts`
Expected: PASS. Se algum teste de `processors` dependia do fallback para o ambiente, ajuste-o para mockar `isDatabaseReady`/`getConfigService` e registre no relatório.
Run (Postgres descartável): `cd backend && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 npx jest src/repositories/systemConfigRepository.integration.test.ts`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
rtk git add backend/src/models/SystemConfig.ts backend/src/repositories/systemConfigRepository.ts backend/src/repositories/systemConfigRepository.integration.test.ts backend/src/services/configService.ts backend/src/services/configService.test.ts backend/src/queue/processors.ts backend/src/app.ts backend/package.json
rtk git commit -m "feat: read Mailgrid and OIDC settings from the database with one-time env import [Story 4.2]"
```

---

### Task 4: OIDC configurado pelo banco (AC 17, 18)

**Contratos complementares — snapshot por operação (AC7, 15–18):**
- Files adicionais: `backend/src/services/authSessionService.ts`, `backend/src/services/authSessionService.test.ts`, `backend/src/services/oidcConfiguration.ts` (Task 3).
- Produzir `OidcOperationContext = Readonly<{ configuration: OidcConfiguration; configurationFingerprint: string }>` e `loadOidcOperationContext(): Promise<OidcOperationContext>`. Configuração sem cache entre operações; context inclui issuer, clientId, secret, backchannel, redirectUri e appOrigin.
- `getOidcMetadata(context: OidcOperationContext): Promise<OidcMetadata>`; todos helpers de exchange, refresh, validação, userinfo e revogação recebem o mesmo context como primeiro argumento. Preservar parâmetros restantes e tipos de retorno existentes; atualizar todos consumidores/testes, sem overload que relê banco silenciosamente.
- `createAuthorizationRequest(context, returnTo?)` grava `issuer` e `configurationFingerprint` na `OidcLoginTransaction`. Sessão OIDC carrega esses dois campos. Callback carrega um context e compara com a transação antes do exchange; refresh/logout comparam com sessão antes de transmitir tokens. Divergência encerra sessão/fluxo e requer novo login (`auth_error=not_configured`); não enviar tokens ao issuer novo. O snapshot permanece estável mesmo se alguém salvar configuração após essa comparação.
- Sessões/transações legadas sem binding recebem o `oidc_legacy_binding` da Task 3, nunca issuer atual. Sem binding, recusar com segurança. Com configuração original inalterada, continuam válidas (AC7); alteração incompatível exige login novo. Salvar configuração passa a valer para novas operações em todas as réplicas.
- `validateStoredOidcSettings(settings: OidcSettings): void` sempre valida URLs preenchidas, HTTPS em produção, HTTP só localhost fora de produção, backchannel proibido em produção. Configuração desativada e vazia é válida. Se enabled, exigir issuer/clientId/secret; `validateOidcSettings` produz configuração utilizável e chama essa validação. `probeOidcProvider` exige campos de conexão mesmo com enabled=false e consulta discovery/JWKS sem salvar.
- `isOidcEnabled()` só retorna false para ausência/desativação/erro de validação conhecido; falha de banco deve propagar, sem fingir configuração ausente.

- [x] **QA Step 1:** escrever testes com fonte de config A/B e promises controladas. Iniciar callback/refresh com A, trocar fonte para B enquanto discovery está pendente; esperar URL e client secret exclusivamente de A e uma leitura de config. Com transação/session de A e context B, esperar zero chamadas de token/userinfo/revoke e sessão encerrada. Testar legado com binding A e issuer atual B: recusa antes de transmitir. Asserções mínimas com transport e fonte injetados:
```ts
expect(settingsSource).toHaveBeenCalledTimes(1);
expect(transport.tokenRequests.every(r => r.url === metadataA.token_endpoint && r.clientSecret === secretA)).toBe(true);
expect(transport.requestsToIssuerB).toHaveLength(0);
```
No caso incompatível, esperar tokenRequests vazio. `transport` é o mock do fetch já usado em oidcService.test.ts; registrar URL/body para assertions, sem logs reais.
- [x] **QA Step 2:** executar `rtk proxy npx jest src/services/oidcService.test.ts src/services/authSessionService.test.ts`; FAIL antes do context.
- [x] **QA Step 3:** propagar context e bindings em todo o fluxo, mantendo cache de discovery/JWKS somente por issuer/backchannel. Novo context não reutiliza segredo antigo.
- [x] **QA Step 4:** repetir testes, options sem OIDC e login redirect; backend typecheck PASS. Commit inclui sessions e helper configuration.

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

- [x] **Step 1: Write the failing tests**

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


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

- [x] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/oidcService.test.ts src/controllers/localAuthController.test.ts src/routes/authRoutes.test.ts`
Expected: FAIL — `setOidcSettingsSource`, `validateOidcSettings`, `isOidcEnabled`, `probeOidcProvider` inexistentes; `options` sem `oidcEnabled`; `/oidc/login` chama `next(error)`.

- [x] **Step 3: Implement in `oidcService.ts`**

Imports:

```ts
import type { OidcSettings } from '../models/SystemConfig';
import { getConfigService } from './databaseService';
```

Substituir `getConfiguration` (síncrona, baseada em `process.env`) por:

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


Remover a função `getSecret` apenas se não for mais usada; `getSessionEncryptionKey` ainda precisa dela (para `OIDC_SESSION_ENCRYPTION_KEY`) — mantenha-a.

Trocar `assertOidcConfiguration` por:

```ts
export const assertSessionEncryptionKey = (): void => {
  getSessionEncryptionKey();
};
```

Extrair a busca do discovery para reuso pelo teste de conexão e trocar a mensagem de incompatibilidade:

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


Em `createAuthorizationRequest`, `exchange`, `exchangeAuthorizationCode`, `refreshOidcTokens`, `validateIdToken`, `getUserInfo` e `revokeRefreshToken`, propagar o mesmo `OidcOperationContext` (definido nas decisões da Task 4). Nenhum helper relê configurações. Callback, refresh e logout comparam o fingerprint antes de enviar código, segredo ou token; configuração incompatível encerra a operação sem chamada ao novo provedor.

Em `backend/src/app.ts`: trocar o import e a chamada `assertOidcConfiguration()` por `assertSessionEncryptionKey()`.

- [x] **Step 4: Implement `options` and the not-configured redirect**

`localAuthController.ts`:

```ts
export interface LocalAuthControllerDependencies {
  enabled: () => boolean;
  oidcEnabled: () => Promise<boolean>;
  authenticate: (input: LocalAuthInput) => Promise<LocalAuthResult>;
  createSession: (user: AuthenticatedUser, localUserId: string, credentialVersion: number) => Promise<string>;
  deleteSession: (sessionId: string | undefined) => Promise<void>;
}
```

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


`authRoutes.ts`: importar `isOidcEnabled` e passar `oidcEnabled: isOidcEnabled,` para `createLocalAuthController`. No `catch` de `GET /oidc/login`:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [x] **Step 5: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/services/oidcService.ts src/services/oidcService.test.ts src/controllers/localAuthController.ts src/routes/authRoutes.ts src/app.ts`
Expected: suíte verde; sem erros.

- [x] **Step 6: Commit**

```bash
rtk git add backend/src/services/oidcService.ts backend/src/services/oidcService.test.ts backend/src/app.ts backend/src/controllers/localAuthController.ts backend/src/controllers/localAuthController.test.ts backend/src/routes/authRoutes.ts backend/src/routes/authRoutes.test.ts
rtk git commit -m "feat: configure intranet login from the database and start without it [Story 4.2]"
```

---

### Task 5: Conta, perfil e situação em cada requisição (AC 2, 3, 4, 5, 7, 11)

**Contratos complementares — sessões locais (AC3, 7, 10–11):**
- Files adicionais: `backend/src/services/authSessionService.ts` e teste; `backend/src/services/localAuthService.ts` e teste; `backend/src/controllers/localAuthController.ts` e teste.
- Resultado de authenticate local inclui `credentialVersion` do registro cujo hash foi verificado. `createLocalSession(user: AuthenticatedUser, localUserId: string, credentialVersion: number): Promise<string>` recebe essa versão; nunca reler versão mais nova para carimbar autenticação com senha velha.
- `LocalAuthSession.credentialVersion: number`; parser aceita legado sem versão como 0, pois migration inicializa todas contas em 0. Após reset que incrementa versão, legado também perde acesso.
- `resolveAccount(session: AuthSession, users: AccountStore): Promise<User | null>` compara versão local com conta carregada em cada requisição. Divergência/disabled encerra sessão e limpa cookie com 401. Redis cleanup permanece best-effort; falha de delete/index não autoriza sessão inválida.
- OIDC resolve exclusivamente issuer + sub já vinculados pela Task 4. Conta desativada não é reativada pelo upsert.

- [x] **QA Step 1:** em `backend/src/middlewares/authentication.test.ts`, teste `rejects sessions created after a concurrent reset with an old credential version`: autenticar versão 0, suspender createSession, reset para 1 e executar revokeSessions sem IDs, liberar criação da sessão 0; próxima requisição retorna 401. Acrescentar legado sem versão antes/depois de reset e profile/status imediato.
- [x] **QA Step 2:** rodar `rtk proxy npx jest src/middlewares/authentication.test.ts src/services/localAuthService.test.ts src/services/authSessionService.test.ts`; FAIL antes da versão.
- [x] **QA Step 3:** implementar contratos, atualizar mocks/login controller e parsing; não devolver credentialVersion em /me ou login.
- [x] **QA Step 4:** repetir testes com PASS e typecheck; commit inclui todos consumidores locais alterados.

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

- [x] **Step 1: Write the failing tests**

```ts
// backend/src/services/accountService.test.ts
import type { User } from '../repositories/userRepository';
import type { AuthSession } from './authSessionService';
import { resolveAccount, toAccountView } from './accountService';

const account = (overrides: Partial<User> = {}): User => ({
  id: 'u-1', provider: 'oidc', role: 'operator', username: null, oidcSub: 'sub-1', oidcIssuer: 'https://intranet.example', credentialVersion: 0, email: 'a@crefito.gov.br',
  name: 'Ana', passwordHash: null, mustChangePassword: false, disabledAt: null, lastLoginAt: null, ...overrides,
});

const store = () => ({
  findById: jest.fn().mockResolvedValue(null),
  findByOidcSub: jest.fn().mockResolvedValue(null),
  upsertOidcUser: jest.fn(),
});

const oidcSession: AuthSession = {
  provider: 'oidc', issuer: 'https://intranet.example', configurationFingerprint: 'fixture-fingerprint', user: { sub: 'sub-1', name: 'Ana', email: 'a@crefito.gov.br' }, refreshToken: 'r', accessTokenExpiresAt: 1,
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
    expect(users.upsertOidcUser).toHaveBeenCalledWith({ issuer: 'https://intranet.example', sub: 'sub-1', email: 'a@crefito.gov.br', name: 'Ana' });
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
    const session = { provider: 'oidc', issuer: 'https://intranet.example', configurationFingerprint: 'fixture-fingerprint', user: { sub: 'user-1' }, refreshToken: 'r', accessTokenExpiresAt: Date.now() + 60_000 };
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
    expect(mockUsers.upsertOidcUser).toHaveBeenCalledWith({ issuer: 'https://intranet.example', sub: 'u', email: 'u@crefito.gov.br', name: 'Usuária' });
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
      passwordHash: 'h', mustChangePassword: false, disabledAt: null, lastLoginAt: null, oidcSub: null, oidcIssuer: null, credentialVersion: 0,
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

- [x] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/accountService.test.ts src/middlewares/authentication.test.ts src/routes/authRoutes.test.ts src/controllers/localAuthController.test.ts`
Expected: FAIL — módulo `accountService` inexistente; `requireAdmin`/`requirePasswordCurrent` inexistentes; callback não registra a conta; `/me` e login local sem `role`.

- [x] **Step 3: Implement `accountService.ts`**

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


- [x] **Step 4: Implement the middleware**

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


E acrescentar:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [x] **Step 5: Wire routes, callback, login response and app guards**

`authRoutes.ts` — callback, entre a checagem `claims.sub !== user.sub` e `createSession`:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


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

- [x] **Step 6: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/services/accountService.ts src/middlewares src/routes/authRoutes.ts src/controllers/localAuthController.ts src/app.ts`
Expected: suíte verde; sem erros.

- [x] **Step 7: Commit**

```bash
rtk git add backend/src/services/accountService.ts backend/src/services/accountService.test.ts backend/src/middlewares backend/src/routes/authRoutes.ts backend/src/routes/authRoutes.test.ts backend/src/controllers/localAuthController.ts backend/src/controllers/localAuthController.test.ts backend/src/app.ts
rtk git commit -m "feat: load account role and status on every request and restrict settings to admins [Story 4.2]"
```

---

### Task 6: API de usuários, minha senha e configuração OIDC (AC 8–11, 14–17, 24)

**Contratos de serviço explícitos:** `createUserAdminService(deps)` produz `list(): Promise<UserView[]>`, `createLocal(actor: string, input: Record<string, unknown>): Promise<UserView>`, `updateAccess(actor: string, id: string, change: Record<string, unknown>): Promise<UserView>`, `resetPassword(actor: string, id: string, password: unknown): Promise<void>`, `changeOwnPassword(account: User, currentPassword: unknown, newPassword: unknown): Promise<void>`. Dependencies: UserStore, hash/verify existentes, revokeSessions e `audit(event: { actor: string; action: string; target?: string; fields?: string[] }): void`. `UserAdminError` carrega code/status/message. `UserView` tem id, provider, username/name/email nullable, role, disabled, mustChangePassword, lastLoginAt ISO nullable; nenhum hash/versão/binding. `createUserAdminRouter()` registra rotas das Global Constraints; handlers usam DTO e traduzem erros conhecidos. Auditoria nunca imprime valores dos campos.

**Contratos complementares — compare-and-swap e validação (AC10–11, 15–17, 24):**
- `changeOwnPassword(account: User, currentPassword: unknown, newPassword: unknown): Promise<void>` verifica senha atual, valida política, calcula novo hash e chama `changePasswordIfCurrent(account.id, account.passwordHash, account.credentialVersion, nextHash)`. False gera `409 credentials_changed` com mensagem "Sua senha foi alterada. Entre novamente para continuar."; não limpar flag, auditar sucesso ou sobrescrever reset. O frontend trata este erro na Task 7.
- `resetPassword` usa `updatePassword(..., true)`, que incrementa versão. CLI reset usa mesma escrita com false. Limpeza Redis é complementar e não define validade.
- `updateOidcConfig` chama sempre `validateStoredOidcSettings(settings)` após merge de segredo vazio; `testOidcConfig` chama probe sem persistir. Não colocar binding legado na resposta ou body de edição.

- [x] **QA Step 1:** acrescentar em `userRepository.integration.test.ts`:
```ts
it('does not overwrite a concurrent administrative reset', async () => {
  const before = await repository.create({ username: 'cas-user', passwordHash: 'hash-old' });
  await repository.updatePassword(before.id, 'hash-reset', true);
  const changed = await repository.changePasswordIfCurrent(before.id, before.passwordHash, before.credentialVersion, 'hash-own');
  expect(changed).toBe(false);
  expect(await repository.findById(before.id)).toMatchObject({ passwordHash: 'hash-reset', mustChangePassword: true, credentialVersion: 1 });
});
```
Limpar cas-user em afterAll. Teste unitário com barrier no hash permite reset entre verify e UPDATE; esperar credentials_changed e nenhum audit de sucesso.
- [x] **QA Step 2:** configController.test cobre **enabled=false** com issuer inválido → 400 invalid_oidc_settings; enabled=false vazio → sucesso; produção + backchannel não vazio → 400 mesmo disabled. Rodar testes alvo antes da implementação, esperar FAIL.
- [x] **QA Step 3:** implementar CAS no serviço e validação incondicional no controller; mapear 409 credentials_changed no contrato de erros.
- [x] **QA Step 4:** executar `rtk proxy npx jest src/services/userAdminService.test.ts src/controllers/configController.test.ts src/routes/userAdminRoutes.test.ts`; integração CAS e typecheck PASS.

**Files:**
- Create: `backend/src/services/settingsAudit.ts`, `backend/src/services/userAdminService.ts` (+ teste), `backend/src/routes/userAdminRoutes.ts` (+ teste)
- Modify: `backend/src/routes/authRoutes.ts` (+ teste), `backend/src/controllers/configController.ts` (+ teste), `backend/src/routes/configRoutes.ts` (+ teste), `backend/src/app.ts`

**Interfaces:**
- Consumes: `UserStore`, `User`, `UserRole`, `LastActiveAdminError`, `UserNotFoundError` (Tasks 1–2); `USERNAME_PATTERN` (`localUserAdminService.ts`); `normalizeUsername`; `validatePasswordPolicy`, `hashPassword`, `verifyPassword`; `revokeLocalUserSessions`; `requireAdmin` (Task 5); `getOidcSettings`/`updateOidcSettings` (Task 3); `validateOidcSettings`, `probeOidcProvider`, `OidcError` (Task 4).
- Produces:
  Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.

  - HTTP: `GET /api/admin/users` → `{ success, data: UserView[] }`; `POST /api/admin/users` `{ username, password, role? }` → `201 { success, data: UserView }`; `PATCH /api/admin/users/:id` `{ role?, disabled? }` → `{ success, data: UserView }`; `POST /api/admin/users/:id/password` `{ password }` → `{ success: true }`; `POST /api/auth/password` `{ currentPassword, newPassword }` → `{ success: true }`.
  - `GET /api/config/oidc` → `{ success, data: { enabled, issuer, clientId, clientSecret: '', clientSecretConfigured, backchannelAllowed, backchannelOrigin, callbackUrl } }`; `POST /api/config/oidc` (mesmos campos) → `{ success, message }`; `POST /api/config/oidc/test` → `{ success, message }`.

- [x] **Step 1: Write the failing service tests**

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
      provider: 'local', role: 'admin', username: null, oidcSub: null, oidcIssuer: null, credentialVersion: 0, email: null, name: null,
      passwordHash: null, mustChangePassword: false, disabledAt: null, lastLoginAt: null, ...user,
    };
    this.users.set(full.id, full);
    return full;
  }

  async findById(id: string) { return this.users.get(id) ?? null; }
  async findByUsername(username: string) {
    return ([...this.users.values()].find((u) => u.provider === 'local' && u.username === username) as LocalUser) ?? null;
  }
  async findByOidcSub(issuer: string, sub: string) { return [...this.users.values()].find((u) => u.oidcIssuer === issuer && u.oidcSub === sub) ?? null; }
  async upsertOidcUser(): Promise<User> { throw new Error('not used'); }
  async list() { return [...this.users.values()]; }
  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }) {
    return this.add({
      id: ID(this.users.size + 1), username: input.username, passwordHash: input.passwordHash,
      role: input.role ?? 'admin', mustChangePassword: input.mustChangePassword ?? false,
    }) as LocalUser;
  }
  async updatePassword(id: string, passwordHash: string, mustChangePassword = false) {
    const user = this.users.get(id)!;
    Object.assign(user, { passwordHash, mustChangePassword, credentialVersion: user.credentialVersion + 1 });
  }
  async changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string) {
    const user = this.users.get(id);
    if (!user || user.passwordHash !== expectedHash || user.credentialVersion !== expectedVersion) return false;
    Object.assign(user, { passwordHash: nextHash, mustChangePassword: false });
    return true;
  }
  async setDisabled(id: string, disabled: boolean) { await this.updateAccess(id, { disabled }); }
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

- [x] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/userAdminService.test.ts`
Expected: FAIL — `Cannot find module './userAdminService'`.

- [x] **Step 3: Implement `settingsAudit.ts` and `userAdminService.ts`**

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Run: `cd backend && npx jest src/services/userAdminService.test.ts` → PASS.

- [x] **Step 4: Write the failing route and controller tests**

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
    const request = (body: object = {}) => ({ body, auth: { account: { username: 'admin', email: null, oidcSub: null, oidcIssuer: null, credentialVersion: 0, id: 'a' } } }) as unknown as Request;

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
          enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: '', clientSecretConfigured: true, backchannelAllowed: true,
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

- [x] **Step 5: Run them to verify they fail**

Run: `cd backend && npx jest src/routes/userAdminRoutes.test.ts src/routes/authRoutes.test.ts src/controllers/configController.test.ts src/routes/configRoutes.test.ts`
Expected: FAIL — rotas e handlers inexistentes.

- [x] **Step 6: Implement the routes**

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


Em `authRoutes.ts` (importar `handleUserAdmin` de `./userAdminRoutes`, `createUserAdminService` de `../services/userAdminService`, `hashPassword`, `revokeLocalUserSessions`, `logSettingsChange`):

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


Em `app.ts`:

```ts
import userAdminRoutes from './routes/userAdminRoutes';
```

```ts
app.use('/api/admin/users', requireAdmin, configLimiter, userAdminRoutes);
```

- [x] **Step 7: Implement the OIDC configuration handlers**

Em `configController.ts` (imports: `OidcSettings` de `'../models/SystemConfig'`; `OidcError`, `probeOidcProvider`, `validateOidcSettings` de `'../services/oidcService'`; `logSettingsChange` de `'../services/settingsAudit'`; `accountLabel` de `'../services/userAdminService'`; `AuthenticatedRequest` de `'../middlewares/authentication'`):

Implementar no arquivo indicado conforme Interfaces e decisões de segurança desta task.


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

- [x] **Step 8: Run tests**

Run: `cd backend && npx jest && npx tsc --noEmit && npx eslint src/routes src/controllers src/services/userAdminService.ts src/services/settingsAudit.ts src/app.ts`
Expected: suíte verde; sem erros.

- [x] **Step 9: Commit**

```bash
rtk git add backend/src/services/settingsAudit.ts backend/src/services/userAdminService.ts backend/src/services/userAdminService.test.ts backend/src/routes backend/src/controllers/configController.ts backend/src/controllers/configController.test.ts backend/src/app.ts
rtk git commit -m "feat: add user administration, own password and OIDC settings APIs [Story 4.2]"
```

---

### Task 7: Barra superior, perfis e troca de senha no frontend (AC 5, 11, 18, 22)

**Contratos frontend explícitos:** em api.ts adicionar `UserRole = 'admin' | 'operator'`, AuthUser com userId/sub/provider/role/mustChangePassword e nome/e-mail opcionais, options com localLoginEnabled/oidcEnabled; `changeOwnPassword(currentPassword: string, newPassword: string): Promise<void>` POST /auth/password. AuthProvider expõe conta atual e refresh/logout; atualizar /me após troca bem-sucedida. `AdminRoute` renderiza Outlet só para admin e Navigate / para operator; guard de senha tem precedência e leva a /account/password. `AppHeader()` substitui headers em Home/Dashboard/Status/Settings; `AccountMenu` exibe Minha senha só para local. Guard deve responder a 403/401 posteriores sem depender apenas do perfil inicial.

**Complemento de contrato frontend (AC10–11):**
- Em `ChangePasswordPage`, 409 `credentials_changed` mostra mensagem do backend e oferece novo login; limpar estado da conta e navegar a /login, sem simular troca bem-sucedida. Atualizar interceptor/API para 401 e `password_change_required` sem loops em /api/auth/*.
- [ ] **QA Step 1:** em `frontend/e2e/auth/navigation.spec.ts`, mockar troca de senha com 409 credentials_changed; esperar erro legível e retorno ao login. Manter testes de admin/operator, Minha senha apenas local e troca obrigatória.
- [ ] **QA Step 2:** `rtk proxy npx playwright test --project=auth-chromium e2e/auth/navigation.spec.ts` em frontend → FAIL antes; implementar e repetir → PASS.

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


No interceptor de resposta, depois do tratamento de `401`:

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [ ] **Step 4: `AuthProvider`, `AdminRoute`, `AccountMenu`, `AppHeader`**

Em `AuthProvider.tsx`: acrescentar `isAdmin: boolean` a `AuthContextValue`, calcular `const isAdmin = !authEnabled || user?.role === 'admin';`, incluí-lo no `useMemo` (`[loading, user, logout, isAdmin]`) e, no `AuthGate`, antes do `return <>{children}</>` para usuário autenticado:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


(o hook `useLocation` já existe no `AuthGate`; mova a checagem `if (!enabled || user) return <>{children}</>;` para depois dela.)

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`AccountMenu.tsx`: dentro do `<div className="flex items-center gap-3">`, antes do botão "Sair":

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


(importar `Link` de `react-router-dom`).

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


- [ ] **Step 5: Replace the page headers**

Em cada página, trocar o bloco `<header ...>…</header>` por `<AppHeader />` seguido do título como cabeçalho da página, mantendo a largura do conteúdo de cada uma, e remover imports que ficarem sem uso (`Link`, `AccountMenu`):

`HomePage.tsx`:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`DashboardPage.tsx`:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`StatusPage.tsx`:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`SettingsPage.tsx` (temporário até a Task 8):

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


(Os `<main>` existentes continuam como estão; se algum `<main>` tinha `py-8`, mude para `pb-8 pt-6` para não duplicar o espaçamento.)

- [ ] **Step 6: `ChangePasswordPage` and routes**

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`App.tsx`:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


- [ ] **Step 7: Login page**

Em `LoginPage.tsx`: estado `const [oidcEnabled, setOidcEnabled] = useState(false);`, preenchido junto com `localLoginEnabled` a partir de `getAuthOptions()` (`false` no `catch`); envolver o botão "Entrar no login intranet" em `{oidcEnabled && (...)}` e o divisor "ou" em `{oidcEnabled && localLoginEnabled && (...)}`; acrescentar ao `OIDC_ERROR_MESSAGES`:

```ts
  unauthorized: 'Acesso não autorizado. Procure um administrador do BulkMail.',
  not_configured: 'O login pela intranet não está configurado.',
```

e, quando nenhum método estiver disponível (depois de carregar as opções):

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


com `const [optionsLoaded, setOptionsLoaded] = useState(false);` marcado no `finally` da busca das opções.

- [ ] **Step 8: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: todos PASS (incluindo `login.spec.ts` e os specs existentes do projeto `chromium`); lint e build limpos. Restaurar apenas relatórios gerados modificados pela execução, preservando alterações preexistentes.

- [ ] **Step 9: Commit**

```bash
rtk git add frontend/src frontend/e2e
rtk git commit -m "feat: shared navigation bar, admin-only settings link and own password page [Story 4.2]"
```

---

### Task 8: Layout de Configurações, Usuários e E-mail (AC 8–10, 14, 23)

**Contratos HTTP/API explícitos:** `ManagedUser` corresponde a UserView da Task 6; `listUsers(): Promise<ManagedUser[]>`, `createLocalUser(input: { username: string; password: string; role: UserRole }): Promise<ManagedUser>`, `updateUserAccess(id: string, change: { role?: UserRole; disabled?: boolean }): Promise<ManagedUser>`, `resetUserPassword(id: string, password: string): Promise<void>`. Preservar mensagens de erro do backend via `apiErrorMessage(error: unknown, fallback: string): string`. A página lista todos, permite criar, promover/rebaixar, ativar/desativar e resetar apenas locais; confirmação de reset e erro last_active_admin devem ser visíveis.

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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [ ] **Step 4: Layout and Email page**

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`SettingsEmailPage.tsx`: `git mv frontend/src/pages/SettingsPage.tsx frontend/src/pages/settings/SettingsEmailPage.tsx`, depois:
- renomear o componente para `export default function SettingsEmailPage()` (remova o export nomeado `SettingsPage` e qualquer `export default SettingsPage` antigo);
- ajustar os imports relativos (`'../services/api'` → `'../../services/api'`);
- remover o wrapper `<div className="min-h-screen bg-gray-50">`, o `<AppHeader />` e o bloco de título adicionados na Task 7; o retorno passa a começar pelo conteúdo do antigo `<main>`, com `<h2 className="text-lg font-semibold text-gray-900">E-mail (Mailgrid)</h2>` e `<p className="text-sm text-gray-600 mt-1 mb-6">Credenciais da API Mailgrid usadas nos envios.</p>` no topo e o `<main>` trocado por `<div>`;
- o estado de carregamento (spinner em tela cheia) vira `<div className="flex justify-center py-12">…spinner…</div>`.

- [ ] **Step 5: Users page**

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


- [ ] **Step 6: Routes**

`App.tsx` — remover o import de `SettingsPage` e:

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


(`Navigate` pode vir no mesmo import de `react-router-dom` já existente.)

- [ ] **Step 7: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: PASS; restaure `frontend/playwright-report` se alterado.

- [ ] **Step 8: Commit**

```bash
rtk git add -A frontend/src frontend/e2e
rtk git commit -m "feat: settings layout with side menu, users and e-mail sections [Story 4.2]"
```

---

### Task 9: Configuração do login pela intranet (AC 15, 16, 17)

**Contratos API explícitos:** `OidcConfig` corresponde ao DTO GET da Task 6 (todos campos string exceto enabled, clientSecretConfigured e backchannelAllowed boolean). `OidcConfigInput = Pick<OidcConfig, 'enabled' | 'issuer' | 'clientId' | 'clientSecret' | 'backchannelOrigin'>`; `getOidcConfig(): Promise<OidcConfig>`, `saveOidcConfig(input: OidcConfigInput): Promise<string>`, `testOidcConfig(input: OidcConfigInput): Promise<string>` retornam mensagens do backend. Copiar callback somente leitura e limpar input de segredo após sucesso.

**Complemento de contrato frontend (AC15, 17):**
- Resposta GET OIDC adiciona `backchannelAllowed: boolean` calculado no backend como NODE_ENV !== production; OidcConfig inclui campo somente leitura. Página só renderiza input Backchannel origin quando true; produção envia vazio.
- [ ] **QA Step 1:** em `frontend/e2e/auth/settings.spec.ts`, fixture de produção com backchannelAllowed=false; esperar `getByLabel('Backchannel origin')` ausente e POST com backchannelOrigin vazio. Fixture local true mostra campo. Fixture enabled=false e issuer inválido recebe 400 e exibe erro.
- [ ] **QA Step 2:** rodar teste alvo → FAIL; implementar DTO/controller/página; repetir → PASS. Incluir teste backend de backchannelAllowed em configController.test.ts.

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
  clientSecretConfigured: true, backchannelAllowed: true, backchannelOrigin: '', callbackUrl: 'http://127.0.0.1:5174/api/auth/oidc/callback',
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

Implementar no arquivo indicado conforme Interfaces, contratos complementares e testes desta task.


- [ ] **Step 4: Page and route**

Implementar o componente no arquivo indicado usando os contratos e os testes desta task; manter os textos e rotas definidos em Global Constraints.


`App.tsx`: `import SettingsOidcPage from './pages/settings/SettingsOidcPage';` e, dentro de `/settings`, `<Route path="oidc" element={<SettingsOidcPage />} />`.

- [ ] **Step 5: Run tests, lint and build**

Run: `cd frontend && npx playwright test --project=auth-chromium --project=chromium && npm run lint && npm run build`
Expected: PASS; restaure `frontend/playwright-report` se alterado.

- [ ] **Step 6: Commit**

```bash
rtk git add frontend/src frontend/e2e
rtk git commit -m "feat: intranet login settings page with connection test [Story 4.2]"
```

---

### Task 10: Deploy, runbook e verificação (AC 19, 20, 21)

**Complemento de runbook e verificação (AC7, 19–21):**
- Antes do deploy garantir admin local e guardar backup do banco; documentar binding de sessões legadas, exigência de novo login após alteração incompatível OIDC e recuperação de erro de secret file. Não imprimir segredos/fingerprints.
- Não fazer rolling deploy com versões antigas/nova simultâneas após rename local_users: parar backend/workers antigos, executar migration, iniciar nova versão. Registrar janela de manutenção e procedimento de recuperação pelo backup; rollback de migration destrutivo não é automático.
- Checklist pós-deploy inclui sessão OIDC pré-deploy com configuração inalterada, tentativa CLI de desativar último admin, reset e rejeição de sessão antiga, mudança de issuer sem transferência de perfil, importação sem secrets ausentes.
- Gate adicional: `rtk npm run build` em backend (não só tsc --noEmit). Frontend build inclui typecheck; backend não possui script typecheck, usar `rtk proxy npx tsc --noEmit`. Não adicionar scripts/dependências apenas para satisfazer nomes de comandos.
- Integrações concorrentes exigem Postgres descartável, sessões reais exigem Redis descartável; não tocar dados de produção. Atualizar test:integration para nomes novos e testes CAS/concorrência. Executar testes unitários completos, integrações PG/Redis, frontend lint/build e ambos projetos Playwright.
- Atualizar checklist e File List da story apenas com tarefas efetivamente concluídas. Nesta revisão registrar documentos, mantendo Draft; Ready for Review somente após implementação e gates executados.

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
rtk docker service logs --since 10m bulkmail_backend | grep 'settings.import_environment'
```

Depois, entre como administrador e confira **Configurações → E-mail** e
**Configurações → Login intranet** (use **Testar**). A partir daí, alterações feitas no
`.env` ou nos secrets do Mailgrid/OIDC não têm efeito.

### Perfis

- Usuários da intranet entram como **Operador** no primeiro acesso; promova-os em
  **Configurações → Usuários**.
- Sessões abertas antes do deploy continuam válidas enquanto a configuração importada permanecer compatível; sua identidade é vinculada ao issuer original e os usuários aparecem como Operador. Mudanças incompatíveis exigem novo login.
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
cd backend && rtk proxy npx tsc --noEmit && rtk npm run lint && rtk proxy npx jest
cd ../frontend && rtk npm run lint && rtk npm run build && rtk proxy npx playwright test --project=auth-chromium --project=chromium
rtk # Revisar git diff antes de restaurar apenas relatórios gerados.
```

Com Postgres descartável (seção "Banco de teste"):

```bash
cd backend && POSTGRES_PORT=55432 rtk npm run migrate && RUN_DATABASE_INTEGRATION=true POSTGRES_PORT=55432 rtk proxy npx jest src/repositories --runInBand
```

Validar os compose:

```bash
POSTGRES_USER=x POSTGRES_DB=x APP_ORIGIN=x CREFITO11_LOGO_URL=x BACKEND_IMAGE=x FRONTEND_IMAGE=x rtk docker compose -f docker-compose.prod.yml config --quiet
rtk docker compose -f docker-compose.yml config --quiet
```

Expected: tudo verde; os compose validam sem `OIDC_ISSUER`/`OIDC_CLIENT_ID`.

- [ ] **Step 4: Story record**

Em `docs/stories/4.2.feat-settings-admin.story.md`: `status: "Ready for Review"` e `Ready for Review` em `## Status`; `### File List` com a saída de `git diff --name-only main..HEAD` mais os arquivos desta task; Change Log: `| 2026-10-10 | 0.2 | Implementação concluída; status Draft → Ready for Review | Claude |`.

- [ ] **Step 5: Commit**

```bash
rtk git add docker-compose.prod.yml docker-compose.yml deploy/production.env.example .env.example docs/production.md docs/stories/4.2.feat-settings-admin.story.md
rtk git commit -m "docs: settings in database runbook and optional OIDC env [Story 4.2]"
```

- [ ] **Step 6: Post-deploy checklist (executado pelo usuário)**

1. `./scripts/production/deploy.sh`; conferir o log `settings.import_environment`.
2. Entrar com o admin local; abrir **Configurações → E-mail** e **Login intranet**; usar **Testar**.
3. Entrar pela intranet numa janela anônima: deve aparecer como Operador, sem o link Configurações; promover pelo admin e recarregar.
4. Criar um usuário local de teste, entrar com ele, confirmar a troca obrigatória de senha e depois desativá-lo.

## Auto-revisão documental

- AC1/12 → Task 1; AC6 → Task 2; AC13/19 → Task 3; AC17/18 → Task 4; AC2–5/7/11 → Task 5; AC8–11/14–17/24 → Task 6; AC5/11/18/22 → Task 7; AC8–10/14/23 → Task 8; AC15–17 → Task 9; AC19–21 → Task 10.
- Achados QA 1–7 incorporados com testes de identidade, snapshot, CLI, CAS/versão, validação disabled, concorrência e falha de secret file.
- Contratos novos têm produtores e consumidores identificados; exemplos remanescentes de testes devem incluir issuer/fingerprint/credentialVersion nas fixtures conforme Interfaces.
- Os ciclos QA complementares integram-se antes do commit da respectiva task; não são tarefas pós-implementação.
- Esta auto-revisão documental original não substitui testes ou aprovação da implementação; as evidências e os pareceres por tarefa estão resumidos no checkpoint de retomada.
