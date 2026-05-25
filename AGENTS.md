# BulkMail Pro — Agentes

## Stack Técnica

- **Frontend**: React 18 + TypeScript + Redux Toolkit/Zustand + React Query + Tailwind CSS
- **Backend**: Node.js + Express/Fastify + NestJS (opcional)
- **Queue**: Bull Queue (Redis) ou RabbitMQ
- **Database**: PostgreSQL
- **Cache/Session**: Redis
- **SMTP**: Nodemailer (servidor próprio ou Amazon SES/SendGrid)
- **Container**: Docker + docker-compose (dev) / K8s (prod)

## Estrutura de Diretórios

```
bulkmail-pro/
├── frontend/           # SPA React
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── store/
│   │   └── styles/
├── backend/          # API Node.js
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── repositories/
│   │   ├── middlewares/
│   │   ├── config/
│   │   └── workers/
│   └── migrations/
└── docker-compose.yml
```

## Funcionalidades Core

1. **Importação XLSX**: até 100MB/100k linhas, validação RFC 5322, mapeamento de colunas, dedupe
2. **Templates**: editor visual, variáveis `{{campo}}`, versionamento
3. **Filas**: throttling (10-500/min), retry automático (max 3x), pausa/cancelamento
4. **Dashboard**: métricas em tempo real (websocket/polling), gráficos, exportação PDF/CSV
5. **Tracking**: pixel 1x1 (aberturas), links redirecionados (cliques)

## Requisitos Não-Funcionais

- Processamento: ≥100 emails/min por worker
- APIs: ≤200ms leitura, ≤500ms escrita
- Import 10k linhas: <30s
- uptime: 99,5%
- Testes: 70% coverage backend

## Risks Críticos

- **Bloqueio SMTP**: implementar SPF/DKIM/DMARC, warm-up gradual, throttling adaptativo
- **Performance**: paginação/streaming para grandes volumes, caching agressivo
- **Idempotência**: garantir que emails não sejam enviados 2x

## Desenvolvimento (Roadmap)

1. **Fase 1** (sem 1-6): Infraestrutura + importação + templates
2. **Fase 2** (sem 7-10): Filas + SMTP + retry
3. **Fase 3** (sem 11-14): React SPA + dashboard
4. **Fase 4** (sem 15-18): Tracking + relatórios
5. **Fase 5** (sem 19-20): Testes + stabilize + deploy

## Comandos Esperados

```bash
# Desenvolvimento
docker-compose up

# Frontend
cd frontend && npm run dev

# Backend
cd backend && npm run dev

# Worker
cd backend && npm run worker
```

---

<!-- AIOX-MANAGED SECTIONS -->
<!-- These sections are managed by AIOX. Edit content between markers carefully. -->
<!-- Your custom content above will be preserved during updates. -->

<!-- AIOX-MANAGED-START: core -->
## Core Rules

1. Siga a Constitution em `.aiox-core/constitution.md`
2. Priorize `CLI First -> Observability Second -> UI Third`
3. Trabalhe por stories em `docs/stories/`
4. Nao invente requisitos fora dos artefatos existentes
<!-- AIOX-MANAGED-END: core -->

<!-- AIOX-MANAGED-START: quality -->
## Quality Gates

- Rode `npm run lint`
- Rode `npm run typecheck`
- Rode `npm test`
- Atualize checklist e file list da story antes de concluir
<!-- AIOX-MANAGED-END: quality -->

<!-- AIOX-MANAGED-START: codebase -->
## Project Map

- Core framework: `.aiox-core/`
- CLI entrypoints: `bin/`
- Shared packages: `packages/`
- Tests: `tests/`
- Docs: `docs/`
<!-- AIOX-MANAGED-END: codebase -->

<!-- AIOX-MANAGED-START: commands -->
## Common Commands

- `npm run sync:ide`
- `npm run sync:ide:check`
- `npm run sync:skills:codex`
- `npm run sync:skills:codex:global` (opcional; neste repo o padrao e local-first)
- `npm run validate:structure`
- `npm run validate:agents`
<!-- AIOX-MANAGED-END: commands -->

<!-- AIOX-MANAGED-START: shortcuts -->
## Agent Shortcuts

Preferencia de ativacao no Codex CLI:
1. Use `/skills` e selecione `aiox-<agent-id>` vindo de `.codex/skills` (ex.: `aiox-architect`)
2. Se preferir, use os atalhos abaixo (`@architect`, `/architect`, etc.)

Interprete os atalhos abaixo carregando o arquivo correspondente em `.aiox-core/development/agents/` (fallback: `.codex/agents/`), renderize o greeting via `generate-greeting.js` e assuma a persona ate `*exit`:

- `@architect`, `/architect`, `/architect.md` -> `.aiox-core/development/agents/architect.md`
- `@dev`, `/dev`, `/dev.md` -> `.aiox-core/development/agents/dev.md`
- `@qa`, `/qa`, `/qa.md` -> `.aiox-core/development/agents/qa.md`
- `@pm`, `/pm`, `/pm.md` -> `.aiox-core/development/agents/pm.md`
- `@po`, `/po`, `/po.md` -> `.aiox-core/development/agents/po.md`
- `@sm`, `/sm`, `/sm.md` -> `.aiox-core/development/agents/sm.md`
- `@analyst`, `/analyst`, `/analyst.md` -> `.aiox-core/development/agents/analyst.md`
- `@devops`, `/devops`, `/devops.md` -> `.aiox-core/development/agents/devops.md`
- `@data-engineer`, `/data-engineer`, `/data-engineer.md` -> `.aiox-core/development/agents/data-engineer.md`
- `@ux-design-expert`, `/ux-design-expert`, `/ux-design-expert.md` -> `.aiox-core/development/agents/ux-design-expert.md`
- `@squad-creator`, `/squad-creator`, `/squad-creator.md` -> `.aiox-core/development/agents/squad-creator.md`
- `@aiox-master`, `/aiox-master`, `/aiox-master.md` -> `.aiox-core/development/agents/aiox-master.md`
<!-- AIOX-MANAGED-END: shortcuts -->
