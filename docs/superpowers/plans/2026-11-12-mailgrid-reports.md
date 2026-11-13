# Relatórios Mailgrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** coletar o relatório da API Mailgrid (`/report/`) para o Postgres, com rotina diária e carga inicial de 90 dias, além de uma aba admin de operação e uma página de consulta com filtros e CSV.

**Architecture:**
- **Cliente HTTP:** função pura (`fetch` com timeout e retry) que devolve linhas já interpretadas no fuso `-03:00`.
- **Coleta:** um coletor grava uma execução em `mailgrid_report_runs` e as linhas em `mailgrid_report_entries`, com `ON CONFLICT DO NOTHING`.
- **Fila:** a fila Bull `mailgrid-report` é processada pelo worker existente. O agendamento é um repeatable job reaplicado no start do worker e a cada alteração da configuração (`system_config`, chave `mailgrid_report_schedule`).
- **Frontend:** reaproveita `SettingsLayout`, `AppHeader` e o padrão de mocks Playwright de `e2e/auth/settings.spec.ts`.

**Tech Stack:** Express, Knex/PostgreSQL, Bull/Redis, Jest (ts-jest), React 18, Tailwind, Playwright. Dependência nova: `@fast-csv/format`.

**Spec:** `docs/stories/5.1.feat-mailgrid-reports.story.md`

## Global Constraints

- Token: `readSecret('TOKEN_AUTH_MAILGRID', 'TOKEN_AUTH_MAILGRID_FILE')`. O placeholder `change-me-mailgrid-report-token` conta como não configurado. O token nunca aparece em log, em resposta ou em `error_message`.
- URL: `https://api.mailgrid.net.br/report/`, `POST`, JSON `{token_auth, dataini:'AAAA-MM-DD', horaini:'HH:MM', datafim, horafim}`.
- Fuso: offset fixo `-03:00` (`America/Sao_Paulo`, sem horário de verão), nunca o fuso do container.
- Falha de autenticação: o corpo é um array cujo primeiro item tem `codigo === '207'` (vem com HTTP 200).
- Chave única: `(msgid, email_para, event_at, tipo_status)`.
- Padrões: rotina ativa, `03:00`, janela de `48` h (1–168). A carga inicial cobre 90 dias em blocos de 7 dias.
- Paginação: 50 por página, ordenada por `event_at DESC, id DESC`. Limite do CSV: 100.000 linhas, acima disso `422 too_many_rows`.
- Papéis: `/api/admin/mailgrid-reports/*` exige `requireAdmin`. `/api/reports/*` aceita qualquer usuário autenticado.
- Auditoria: `logSettingsChange({actor, action, target, fields})`, nunca com valores.
- Commits: conventional, com sufixo `[Story 5.1]`, na branch `feat/5.1-mailgrid-reports`.

## Review Focus

1. **Linha com `msgid` vazio ou data `dd/mm/aaaa` inválida no meio do lote:** ela é ignorada e contada em `skipped`, e o restante do lote é gravado (Task 2 e Task 3).
2. **Evento às 23:30 de Brasília:** o `event_at` UTC cai no dia seguinte (02:30Z). O filtro de período "até 23:59" do dia local inclui esse evento (Task 2 e Task 6).
3. **Mensagem de erro de rede que contém o token** (ex.: a URL ou o corpo ecoado): o `error_message` gravado vem com o token substituído por `***` (Task 3).
4. **"Carga inicial" clicada duas vezes seguidas:** a segunda chamada responde `409 backfill_running` sem enfileirar blocos (Task 4).
5. **Busca com `%` ou `_` digitado pelo usuário:** é tratada como literal, não como curinga do ILIKE (Task 6).

---

### Task 1: Migration e repositório

**Files:**
- Create: `backend/src/migrations/20261112000000_create_mailgrid_reports.ts`
- Create: `backend/src/models/MailgridReport.ts`
- Create: `backend/src/repositories/mailgridReportRepository.ts`
- Test: `backend/src/repositories/mailgridReportRepository.integration.test.ts`
- Modify: `backend/package.json` (adicionar o teste ao script `test:integration`)
- Modify: `backend/src/services/databaseService.ts` (singleton `getMailgridReportRepository()`)

**Interfaces:**
- Produces (`models/MailgridReport.ts`):
  - `MailgridReportEntryInput`:
    - `{ msgid; email_de; email_para; status; tipo_status; sender; sender_ip; sender_host; size; delivery_ip; delivery_host; message_id; assunto }`, todos `string | null`, exceto `msgid` e `email_para`, que são `string`;
    - `event_at: Date`;
    - `sent_at: Date | null`;
    - `raw: Record<string, unknown>`.
  - `MailgridReportRunType = 'scheduled' | 'manual' | 'backfill'`
  - `MailgridReportRunStatus = 'running' | 'success' | 'failed'`
  - `MailgridReportErrorCode = 'auth_failed' | 'token_not_configured' | 'request_failed' | 'invalid_response'`
  - `MailgridReportRun`: `{ id: string; type; window_start: Date; window_end: Date; status; fetched; inserted; skipped: number; error_code: MailgridReportErrorCode | null; error_message: string | null; started_at: Date; finished_at: Date | null; triggered_by: string | null }`
  - `ReportQuery`: `{ from: Date; to: Date; recipient?; sender?; subject?; deliveryHost?; msgid?; senderHost?: string; tipoStatus?: string[]; page: number; pageSize: number }`
- Produces (`MailgridReportRepository`):
  - `createRun(input: { type; window_start; window_end; triggered_by: string | null }): Promise<MailgridReportRun>`
  - `finishRun(id: string, result: { status: 'success' | 'failed'; fetched; inserted; skipped: number; error_code?; error_message? }): Promise<void>`
  - `insertEntries(runId: string, entries: MailgridReportEntryInput[]): Promise<number>`: devolve quantas linhas foram realmente inseridas, em chunks de 500 com `.onConflict([...]).ignore()`.
  - `listRuns(limit: number): Promise<MailgridReportRun[]>`
  - `latestRun(): Promise<MailgridReportRun | null>`
  - `hasRunningBackfill(): Promise<boolean>`
  - `query(q: ReportQuery): Promise<{ rows: MailgridReportEntry[]; total: number }>`
  - `stream(q: Omit<ReportQuery,'page'|'pageSize'>, limit: number): AsyncIterable<MailgridReportEntry>`
  - `count(q): Promise<number>`
  - `listSenderHosts(): Promise<string[]>`
  - `MailgridReportEntry` é `MailgridReportEntryInput` mais `id` e `collected_at`, sem o campo `raw`.

- [ ] **Step 1: Escrever a migration**

  Tabela `mailgrid_report_runs`:
  - `id` uuid pk, com `gen_random_uuid()`, como na migration de users;
  - `type`, `status` e `error_code` como text com check;
  - `window_start` e `window_end` como timestamptz;
  - `fetched`, `inserted` e `skipped` como int default 0;
  - `error_message` text;
  - `started_at` default now;
  - `finished_at`;
  - `triggered_by` text.

  Tabela `mailgrid_report_entries`:
  - `id` bigserial;
  - as 13 colunas de texto da API;
  - `event_at` timestamptz not null;
  - `sent_at` timestamptz;
  - `raw` jsonb not null;
  - `collected_at` default now;
  - `run_id` uuid com FK para runs `ON DELETE SET NULL`.

  Unique `mailgrid_report_entries_event_uq (msgid, email_para, event_at, tipo_status)`. O `tipo_status` é `NOT NULL DEFAULT ''`, porque NULL quebraria a unicidade.

  Índices:
  - `(event_at DESC, id DESC)` em entries;
  - `(msgid)` em entries;
  - `(started_at DESC)` em runs.

  Sem pg_trgm: o período é sempre obrigatório, então o índice em `event_at` limita a varredura. O `down` derruba as duas tabelas.

- [ ] **Step 2: Escrever o teste de integração que falha**

  O teste fica em `describeDatabase`, como em `userRepository.integration.test.ts`, e aplica a migration num schema temporário (`SET LOCAL search_path`). Casos:
  - `insertEntries ignores identical events and keeps distinct events of the same msgid`: inserir os eventos A (Soft Bounce 10:00) e B (Aceita 10:05) do mesmo msgid gera 2 inserts; reinserir A e B gera 0. A contagem final é 2.
  - `query filters by period, tipoStatus and escapes LIKE wildcards`: `recipient: '100%'` não casa com `'1000@x'`.
  - `hasRunningBackfill is true only while a backfill run is running`.

- [ ] **Step 3: Rodar e conferir que falha**

  Run: `cd backend && RUN_DATABASE_INTEGRATION=true npx jest src/repositories/mailgridReportRepository.integration.test.ts`
  Expected: FAIL, porque o módulo ainda não existe.

- [ ] **Step 4: Implementar o repositório**

  O escape de LIKE é feito por um helper `escapeLike(v)`, que troca `\`, `%` e `_` por `\\$&`, e a consulta usa `whereRaw('?? ILIKE ? ESCAPE ?', [col, `%${escapeLike(v)}%`, '\\'])`. `total` vem de `count` com os mesmos filtros. `stream` usa `.stream()` do knex com `limit`.

- [ ] **Step 5: Rodar e conferir que passa**

  Run: o mesmo comando do Step 3. Expected: PASS. Rode também `cd backend && npx tsc --noEmit`.

- [ ] **Step 6: Commit** `feat: mailgrid report tables and repository [Story 5.1]`

---

### Task 2: Cliente e parser da API

**Files:**
- Create: `backend/src/services/mailgridReportClient.ts`
- Test: `backend/src/services/mailgridReportClient.test.ts`

**Interfaces:**
- Produces:
  - `MAILGRID_REPORT_URL = 'https://api.mailgrid.net.br/report/'`
  - `MAILGRID_REPORT_TOKEN_PLACEHOLDER = 'change-me-mailgrid-report-token'`
  - `readMailgridReportToken(): string | null`: devolve `null` se o token estiver vazio ou igual ao placeholder.
  - `class MailgridReportError extends Error { code: MailgridReportErrorCode }`
  - `toSaoPauloDateTime(date: Date): { date: 'AAAA-MM-DD'; time: 'HH:MM' }`
  - `parseSaoPauloDateTime(date: string, time: string): Date | null`: `'11/11/2026','10:58:28'` → `2026-11-11T13:58:28.000Z`.
  - `parseReportRows(body: unknown): { entries: MailgridReportEntryInput[]; skipped: number }`: lança `auth_failed` quando há `codigo 207` e `invalid_response` quando o corpo não é array.
  - `fetchMailgridReport(window: { start: Date; end: Date }, deps?: { token?: string | null; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<{ entries; fetched: number; skipped: number }>`

- [ ] **Step 1: Escrever os testes que falham**

  Os fixtures reproduzem as linhas reais, com e-mails trocados por `@example.com`. Casos:
  - `parses real rows into entries with -03:00 event_at and sent_at`
  - `23:30 local becomes next-day 02:30Z`: `parseSaoPauloDateTime('11/11/2026','23:30:00')` → `2026-11-12T02:30:00.000Z`.
  - `skips rows without msgid or with invalid date and counts them`
  - `throws auth_failed on [{"status":"STATUS: ERRO - FALHA DE AUTENTICACAO","codigo":"207"}]`
  - `throws token_not_configured for empty or placeholder token without calling fetch`
  - `retries 3 times on 5xx/network error then throws request_failed; does not retry auth_failed`: o fetch e o sleep são mocks, e o número de chamadas é `3` e `1`.
  - `sends dataini/horaini/datafim/horafim in São Paulo time`: a janela `2026-11-12T03:00Z..2026-11-12T05:00Z` gera `{dataini:'2026-11-12',horaini:'00:00',datafim:'2026-11-12',horafim:'02:00'}`.

- [ ] **Step 2: Rodar e conferir que falha**

  Run: `cd backend && npx jest src/services/mailgridReportClient.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implementar**

  - O offset é fixo: `new Date(\`${y}-${m}-${d}T${time}-03:00\`)`. Para formatar, desloque `-3h` e use os getters `getUTC*`.
  - O timeout de 30 s usa `AbortSignal.timeout(30_000)`.
  - O backoff tem 3 tentativas, com sleep de `1000 * 2^(n-1)`.
  - `email_de` e os demais campos vazios viram `null`. `tipo_status` ausente vira `''`.
  - `raw` guarda a linha original.

- [ ] **Step 4: Rodar e conferir que passa** (o mesmo comando do Step 2, Expected: PASS)

- [ ] **Step 5: Commit** `feat: mailgrid report API client [Story 5.1]`

---

### Task 3: Coletor (execução de uma janela)

**Files:**
- Create: `backend/src/services/mailgridReportCollector.ts`
- Test: `backend/src/services/mailgridReportCollector.test.ts`

**Interfaces:**
- Consumes: `fetchMailgridReport` e `readMailgridReportToken` da Task 2; `MailgridReportRepository` da Task 1.
- Produces:
  - `collectMailgridReport(input: { type: MailgridReportRunType; start: Date; end: Date; triggeredBy: string | null; runId?: string }, deps: { repository: Pick<MailgridReportRepository,'createRun'|'finishRun'|'insertEntries'>; fetchReport?: typeof fetchMailgridReport; token?: string | null }): Promise<MailgridReportRun['status']>`. Quando recebe `runId` (usado pelos blocos da carga inicial), reaproveita a execução já criada.
  - `sanitizeErrorMessage(message: string, token: string | null): string`: troca o token por `***` e corta em 500 caracteres.

- [ ] **Step 1: Escrever os testes que falham**
  - `records success with fetched/inserted/skipped counters`
  - `records failed auth_failed and inserts nothing`
  - `records token_not_configured without calling fetch`
  - `error_message never contains the token`: o fetch rejeita com `new Error('POST ... token_auth=SECRET123')`, e o `finishRun` recebe `error_message` sem `SECRET123`.

- [ ] **Step 2: Rodar e conferir que falha.** Run: `cd backend && npx jest src/services/mailgridReportCollector.test.ts`
- [ ] **Step 3: Implementar.** Um `MailgridReportError` gera seu próprio `error_code`; qualquer outro erro gera `request_failed`. O coletor nunca relança o erro: a falha fica registrada na execução.
- [ ] **Step 4: Rodar e conferir que passa**
- [ ] **Step 5: Commit** `feat: mailgrid report collector [Story 5.1]`

---

### Task 4: Configuração, fila, agendamento, carga inicial e CLI

**Files:**
- Create: `backend/src/services/mailgridReportSettings.ts`
- Create: `backend/src/queue/mailgridReportQueue.ts`
- Create: `backend/src/scripts/mailgridBackfill.ts`
- Modify: `backend/src/queue/emailWorker.ts` (registrar o processor e chamar `applyMailgridReportSchedule` no start)
- Modify: `backend/package.json` (`mailgrid:backfill`: `node dist/scripts/mailgridBackfill.js`; `mailgrid:backfill:dev`: `ts-node src/scripts/mailgridBackfill.ts`)
- Test: `backend/src/services/mailgridReportSettings.test.ts`, `backend/src/queue/mailgridReportQueue.test.ts`

**Interfaces:**
- Produces (`mailgridReportSettings.ts`):
  - `MAILGRID_REPORT_SETTINGS_KEY = 'mailgrid_report_schedule'`
  - `MailgridReportSettings = { enabled: boolean; time: string /* HH:MM */; windowHours: number }`
  - `DEFAULT_MAILGRID_REPORT_SETTINGS = { enabled: true, time: '03:00', windowHours: 48 }`
  - `validateMailgridReportSettings(input: unknown): MailgridReportSettings`: lança `MailgridReportSettingsError(code 'invalid_settings', field)` quando `time` não casa com `^([01]\d|2[0-3]):[0-5]\d$` ou quando `windowHours` não é inteiro entre 1 e 168.
  - `getMailgridReportSettings(repo: SystemConfigRepository): Promise<MailgridReportSettings>`
  - `saveMailgridReportSettings(repo, value): Promise<{ settings; changedFields: string[] }>`
- Produces (`mailgridReportQueue.ts`):
  - `MAILGRID_REPORT_QUEUE_NAME = 'mailgrid-report'`
  - `DAILY_JOB_ID = 'mailgrid-report-daily'`
  - `getMailgridReportQueue(): Queue<MailgridReportJobData>`, com a mesma conexão Redis de `emailQueue.ts`
  - `MailgridReportJobData = { kind: 'scheduled' } | { kind: 'manual'; triggeredBy: string } | { kind: 'backfill'; runId: string; start: string; end: string }`
  - `applyMailgridReportSchedule(settings, queue?): Promise<void>`: remove todos os repeatables (`getRepeatableJobs` + `removeRepeatableByKey`). Se `enabled`, adiciona `{kind:'scheduled'}` com `repeat: { cron: \`${mm} ${hh} * * *\`, tz: 'America/Sao_Paulo' }` e `jobId: DAILY_JOB_ID`.
  - `enqueueManualRun(triggeredBy: string, queue?): Promise<void>`
  - `backfillWindows(now: Date): Array<{ start: Date; end: Date }>`: 13 blocos de 7 dias, o primeiro começando em `now - 90d` e o último terminando em `now`.
  - `enqueueBackfill(triggeredBy: string, deps?): Promise<{ blocks: number }>`: lança `MailgridReportConflictError` (409 `backfill_running`) quando `hasRunningBackfill()`. Para cada bloco, cria uma execução `backfill` e enfileira o job com `runId`.
  - `processMailgridReportJob(job: { data: MailgridReportJobData }, deps?): Promise<void>`: em `scheduled` e `manual`, lê `windowHours` e chama o coletor com `end = now` e `start = now - windowHours`. Em `backfill`, usa `start`/`end`/`runId` do job.

- [ ] **Step 1: Escrever os testes que falham**
  - `validateMailgridReportSettings rejects '24:00' and windowHours 0/169, accepts defaults`
  - `getMailgridReportSettings returns defaults when key absent`
  - `applyMailgridReportSchedule removes previous repeatables and adds cron '30 4 * * *' tz America/Sao_Paulo with fixed jobId`: com fila mock.
  - `applyMailgridReportSchedule with enabled=false only removes`
  - `backfillWindows covers exactly 90 days in 13 contiguous blocks`: o primeiro `start` é `now - 90d`, o último `end` é `now`, e cada bloco tem no máximo 7 dias.
  - `enqueueBackfill throws backfill_running and enqueues nothing when a backfill is running`
  - `processMailgridReportJob scheduled uses windowHours from settings`

- [ ] **Step 2: Rodar e conferir que falha.** Run: `cd backend && npx jest src/services/mailgridReportSettings.test.ts src/queue/mailgridReportQueue.test.ts`
- [ ] **Step 3: Implementar.** O worker chama `getMailgridReportQueue().process(1, processMailgridReportJob)` e depois `applyMailgridReportSchedule(await getMailgridReportSettings(...))`; uma falha aí é logada, sem derrubar o worker de e-mail. O CLI inicializa o banco, chama `enqueueBackfill('cli')` e fecha a fila e o banco; o `409` sai com exit 1 e uma mensagem.
- [ ] **Step 4: Rodar e conferir que passa**
- [ ] **Step 5: Commit** `feat: mailgrid report queue, schedule and backfill [Story 5.1]`

---

### Task 5: API admin `/api/admin/mailgrid-reports`

**Files:**
- Create: `backend/src/routes/mailgridReportAdminRoutes.ts`
- Modify: `backend/src/app.ts` (`app.use('/api/admin/mailgrid-reports', requireAdmin, configLimiter, mailgridReportAdminRoutes)`)
- Test: `backend/src/routes/mailgridReportAdminRoutes.test.ts`, no padrão de `userAdminRoutes.test.ts`, extraindo o handler da stack

**Interfaces:**
- Consumes: Tasks 1, 2 e 4.
- Produces:
  - `MailgridTokenState = 'configured' | 'not_configured' | 'auth_failed'`: é `not_configured` quando `readMailgridReportToken()` é null, `auth_failed` quando `latestRun()` falhou com `auth_failed` ou `token_not_configured`, e `configured` nos demais casos.
  - `GET /status` → `{ success, data: { tokenState } }`
  - `GET /settings` → `{ success, data: MailgridReportSettings & { tokenState } }`
  - `PUT /settings` (body `MailgridReportSettings`): valida, salva, chama `applyMailgridReportSchedule` e audita `{action:'mailgrid_reports.update_schedule', target:'mailgrid_report_schedule', fields: changedFields}`. Erro de validação: `400 { error:'invalid_settings', field }`.
  - `POST /run` → `202`, com auditoria `mailgrid_reports.run_now`.
  - `POST /backfill` → `202 { data:{ blocks } }`, ou `409 { error:'backfill_running' }`, com auditoria `mailgrid_reports.backfill`.
  - `GET /runs` → as últimas 50 execuções.

- [ ] **Step 1: Escrever os testes que falham.** Casos:
  - status `auth_failed` após uma execução com falha;
  - PUT inválido responde 400 com `field: 'time'`;
  - PUT válido reagenda e audita sem valores;
  - backfill duplicado responde 409;
  - `403` para operator (em `app.authentication.test.ts`, um caso para `/api/admin/mailgrid-reports/status`).
- [ ] **Step 2: Rodar e conferir que falha.** Run: `cd backend && npx jest src/routes/mailgridReportAdminRoutes.test.ts src/app.authentication.test.ts`
- [ ] **Step 3: Implementar.** O actor vem de `accountLabel(request.auth!.account)`, como em `userAdminRoutes`.
- [ ] **Step 4: Rodar e conferir que passa**
- [ ] **Step 5: Commit** `feat: mailgrid reports admin API [Story 5.1]`

---

### Task 6: API de consulta `/api/reports` e CSV

**Files:**
- Create: `backend/src/routes/reportRoutes.ts`
- Create: `backend/src/services/reportQuery.ts`
- Modify: `backend/src/app.ts` (`app.use('/api/reports', reportRoutes)`, depois do guard de autenticação)
- Modify: `backend/package.json` (dependência `@fast-csv/format`, mesma versão major de `@fast-csv/parse`)
- Test: `backend/src/services/reportQuery.test.ts`, `backend/src/routes/reportRoutes.test.ts`

**Interfaces:**
- Consumes: `MailgridReportRepository.query/stream/count/listSenderHosts` (Task 1) e `parseSaoPauloDateTime` (Task 2).
- Produces:
  - `REPORT_PAGE_SIZE = 50`, `REPORT_CSV_MAX_ROWS = 100_000`
  - `parseReportQuery(query: Record<string, unknown>, now: Date): ReportQuery`. Recebe `from`/`to` como ISO 8601 com offset; sem eles, aplica os últimos 7 dias. Recebe `tipoStatus` como CSV, com valores permitidos `Aceita | Soft Bounce | Hard Bounce`. Os textos são trimados e limitados a 254 caracteres, e `page` é ≥ 1. Lança `ReportQueryError(field)` quando `from > to`, quando a data é inválida ou quando o `tipoStatus` é desconhecido.
  - `csvSafe(value: string | null): string`: prefixa `'` quando o valor começa com `= + - @ \t \r`.
  - `GET /api/reports` → `{ success, data: MailgridReportEntry[], pagination: { total, page, pageSize, pages } }`
  - `GET /api/reports/sender-hosts` → `{ success, data: string[] }`
  - `GET /api/reports/export.csv`: `count > 100000` responde `422 { error:'too_many_rows' }`. Caso contrário, faz stream com `Content-Disposition: attachment; filename="relatorio-mailgrid-AAAAMMDD.csv"`. As colunas são `data_hora (dd/mm/aaaa HH:MM:SS, -03:00), remetente, destinatario, assunto, resultado, status, servidor_origem, ip_origem, servidor_destino, ip_destino, tamanho, msgid, message_id`.

- [ ] **Step 1: Escrever os testes que falham**
  - `defaults to last 7 days`
  - `rejects from > to with field 'from'`
  - `rejects unknown tipoStatus`
  - `local 23:59 'to' includes 23:30 event stored as 02:30Z next day`: `parseReportQuery({to:'2026-11-11T23:59:59-03:00'})` gera `to >= 2026-11-12T02:30:00Z`.
  - `csvSafe('=HYPERLINK(...)') starts with "'"`
  - route `export.csv returns 422 above limit`
  - route `GET / returns pagination with pageSize 50`
- [ ] **Step 2: Rodar e conferir que falha.** Run: `cd backend && npx jest src/services/reportQuery.test.ts src/routes/reportRoutes.test.ts`
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Rodar e conferir que passa.** Rode também `cd backend && npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: mailgrid report query API and CSV export [Story 5.1]`

---

### Task 7: Frontend (aba admin, banner e página Relatórios)

**Before coding:** invocar a skill `ui-ux-pro-max` para orientar layout, tabela densa, filtros, drawer de detalhe e estados vazio/carregando/erro, mantendo os tokens Tailwind atuais (`primary-*`, `gray-*`) e o visual das páginas de Settings.

**Files:**
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/pages/settings/SettingsMailgridReportsPage.tsx`
- Modify: `frontend/src/pages/settings/SettingsLayout.tsx` (seção `{ to: '/settings/mailgrid-reports', label: 'Relatórios Mailgrid' }`)
- Create: `frontend/src/components/Layout/MailgridTokenBanner.tsx`
- Modify: `frontend/src/components/Layout/AppHeader.tsx` (link "Relatórios" para todos e `<MailgridTokenBanner />` para admin, abaixo do header)
- Create: `frontend/src/pages/ReportsPage.tsx`, `frontend/src/components/Reports/ReportFilters.tsx`, `frontend/src/components/Reports/ReportDetail.tsx`
- Modify: `frontend/src/App.tsx` (rota `/reports` protegida e `settings/mailgrid-reports` dentro do `AdminRoute`)
- Test: `frontend/e2e/auth/mailgrid-reports.spec.ts`

**Interfaces:**
- Consumes: os endpoints das Tasks 5 e 6.
- Produces (`api.ts`):
  - `getMailgridReportStatus()`
  - `getMailgridReportSettings()`
  - `updateMailgridReportSettings(s)`
  - `runMailgridReportNow()`
  - `startMailgridBackfill()`
  - `listMailgridReportRuns()`
  - `searchReports(filters, page)`
  - `getReportSenderHosts()`
  - `reportExportUrl(filters): string`, montado com `URLSearchParams`. O download usa `window.location` e cookie de sessão.

**Textos fixos:**
- **Banner:** "Token do relatório Mailgrid inválido ou não configurado", com o link "Ver configuração" para `/settings/mailgrid-reports`.
- **Confirmação da carga inicial:** "Isso vai buscar os últimos 90 dias na API Mailgrid em 13 blocos. Continuar?"
- **Estado do token:** "Configurado" / "Não configurado" / "Falha de autenticação na última execução".
- **Rótulos dos filtros:**
  - Período de / até
  - Destinatário
  - Remetente
  - Assunto
  - Resultado
  - Servidor de origem
  - Domínio de destino
  - msgid
- **Colunas da tabela:** Data/hora, Remetente, Destinatário, Assunto, Resultado, Servidor de origem.

- [ ] **Step 1: Escrever a spec Playwright que falha** (mocks `page.route` no padrão de `e2e/auth/settings.spec.ts`)
  - `admin sees banner when tokenState is auth_failed and link opens settings section`
  - `operator does not see banner nor Relatórios Mailgrid section`
  - `settings saves time 04:30 and windowHours 24 via PUT body`
  - `backfill asks confirmation and shows conflict message on 409`
  - `reports page sends tipoStatus and recipient filters and paginates`
  - `clicking a row opens detail with msgid and delivery_host`
  - `Exportar CSV link carries current filters`
- [ ] **Step 2: Rodar e conferir que falha.** Run: `cd frontend && npx playwright test --project=auth-chromium e2e/auth/mailgrid-reports.spec.ts`
- [ ] **Step 3: Implementar as telas**
  - O banner busca `/status` uma vez por montagem, apenas para admin.
  - Os filtros são aplicados ao clicar em "Filtrar", e a página volta para 1.
  - O detalhe abre em diálogo acessível: `role="dialog"`, `Esc` fecha e o foco é preso dentro dele.
  - O período usa `<input type="datetime-local">`, interpretado como horário de Brasília (sufixo `-03:00`).
- [ ] **Step 4: Rodar e conferir que passa.** Rode também `cd frontend && npm run lint && npm run build`.
- [ ] **Step 5: Commit** `feat: mailgrid reports UI [Story 5.1]`

---

### Task 8: Configuração de ambiente, deploy, runbook e gate final

**Files:**
- Modify: `.env.example` (`TOKEN_AUTH_MAILGRID=change-me-mailgrid-report-token`)
- Modify: `docker-compose.yml` (`TOKEN_AUTH_MAILGRID: ${TOKEN_AUTH_MAILGRID:-}` em backend e worker)
- Modify: `docker-compose.prod.yml` (`TOKEN_AUTH_MAILGRID_FILE: /run/secrets/mailgrid_report_token` e o secret `mailgrid_report_token` em `&backend_secrets` e no bloco `secrets:`)
- Modify: `backend/src/scripts/productionDeployGuards.test.ts`, se ele validar a lista de secrets
- Modify: `docs/production.md` (criar o secret, rodar a carga inicial pela UI ou por `npm run mailgrid:backfill`, reagendamento e o significado do banner)
- Modify: `docs/stories/5.1.feat-mailgrid-reports.story.md` (checkboxes, File List, Change Log; status `InProgress` → `InReview`)

- [ ] **Step 1:** aplicar as mudanças de ambiente e compose.
- [ ] **Step 2:** rodar todos os `quality_gate_tools` do frontmatter da story e a integração.

  Run: `cd backend && npx tsc --noEmit && npm run lint && npm test && npm run test:integration`, e depois `cd frontend && npm run lint && npm run build && npx playwright test --project=auth-chromium --project=chromium`
  Expected: tudo PASS.
- [ ] **Step 3:** verificar o AC 22 com uma massa de 60 mil linhas (`generate_series`) no Postgres de dev. O `EXPLAIN` da consulta padrão (período de 7 dias mais o filtro de destinatário) deve mostrar `Index Scan` ou `Bitmap Index Scan` em `event_at`, sem `Seq Scan` na tabela. Registrar o resultado nas Completion Notes.
- [ ] **Step 4:** smoke real em dev: `POST /api/admin/mailgrid-reports/run` com o token do `.env` gera uma execução `success` com `inserted > 0`. Depois, `GET /api/reports` devolve linhas.
- [ ] **Step 5: Commit** `docs: mailgrid reports runbook and env [Story 5.1]`
