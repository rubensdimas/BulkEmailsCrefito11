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