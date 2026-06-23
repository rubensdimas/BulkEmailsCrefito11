# BulkMail Pro

Sistema de envio de emails em massa via planilha XLSX com filas de processamento.

## Stack Técnica

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Database**: PostgreSQL
- **Cache/Queue**: Redis + Bull Queue
- **SMTP**: Nodemailer

## Funcionalidades

1. **Importação XLSX** - Upload de arquivos até 100MB/100k linhas
2. **Validação RFC 5322** - Regex para validação de emails
3. **Deduplicação** - Remove emails duplicados automaticamente
4. **Filas com Throttling** - Taxa configurável (10-500 emails/min)
5. **Retry Automático** - Máximo 3 tentativas em caso de falha
6. **Dashboard em Tempo Real** - Acompanhamento de status
7. **Configuração Dinâmica de SMTP** - Altere as credenciais de envio via interface web sem precisar reiniciar o sistema.

## Configuração de SMTP

O sistema suporta duas formas de configuração de SMTP:

1. **Variáveis de Ambiente**: Definidas no arquivo `.env` (fallback).
2. **Interface Web**: Acesse a página de "Configurações" para salvar as credenciais no banco de dados. As configurações no banco de dados têm prioridade sobre o `.env`.

### Teste de Conexão
Na página de configurações, você pode enviar um e-mail de teste para validar se as credenciais estão corretas antes de salvá-las.

## Quick Start

### Com Docker (Recomendado)

```bash
# Iniciar todos os serviços
# As migrações do banco de dados são executadas automaticamente no bootstrap do backend
docker-compose up -d

# Ver acompanhar logs das migrações
docker compose logs -f backend
```

## Produção com Docker Swarm

Este projeto possui um compose de produção para Docker Swarm em `docker-compose.prod.yml`.
Ele foi preparado para uma VPS com Traefik já ativo, rede externa `CrefitoNet` e domínio `bulkmail.crefito.gov.br`.

O acesso público deve acontecer pelo Traefik em `https://bulkmail.crefito.gov.br`. A stack não publica as portas `3000`, `5173`, `5432` ou `6379` no host; essas portas são usadas apenas dentro da rede Docker.

### 1. Verificar a VPS antes do deploy

Execute estes comandos diretamente na VPS antes de publicar a stack:

```bash
# Verificar portas em uso no host
ss -tulpn

# Verificar serviços Swarm existentes
docker service ls

# Verificar containers com portas publicadas
docker ps --format 'table {{.Names}}\t{{.Ports}}'

# Confirmar que a rede externa do Traefik existe
docker network ls | grep CrefitoNet
```

Também confira se nenhum serviço Traefik já usa o mesmo host:

```bash
docker service inspect $(docker service ls -q) \
  --format '{{.Spec.Name}} {{json .Spec.Labels}}' | grep 'bulkmail.crefito.gov.br'
```

Antes de continuar, confirme:

- `CrefitoNet` existe no Swarm.
- As portas `80` e `443` continuam sob responsabilidade do Traefik já instalado.
- Nenhum router Traefik já usa ``Host(`bulkmail.crefito.gov.br`)``.
- A stack do BulkMail não publica portas no host.

### 2. Configurar variáveis de ambiente

Crie ou atualize o `.env` na VPS com as credenciais reais de produção:

```bash
POSTGRES_USER=bulkmail
POSTGRES_PASSWORD=troque-esta-senha
POSTGRES_DB=bulkmail

REDIS_PASSWORD=troque-esta-senha

SMTP_HOST=smtp.exemplo.gov.br
SMTP_PORT=587
SMTP_USER=usuario-smtp
SMTP_PASS=senha-smtp
SMTP_SENDER=noreply@crefito.gov.br

WORKER_CONCURRENCY=3
THROTTLE_RATE=50
```

### 3. Buildar as imagens de produção

Execute os builds no diretório raiz do projeto:

```bash
docker build -t bulkmail-backend:prod ./backend
docker build --build-arg VITE_API_URL=/api -t bulkmail-frontend:prod ./frontend
```

O argumento `VITE_API_URL=/api` garante que o frontend chame a API pelo mesmo domínio público, usando o proxy Nginx interno para `backend:3000`.

### 4. Validar o compose de produção

Antes do deploy, valide a configuração:

```bash
docker compose -f docker-compose.prod.yml config
docker stack config -c docker-compose.prod.yml
```

Confirme que o arquivo não possui publicação de portas:

```bash
grep -nE 'ports:|3000:3000|5173:80|5432:5432|6379:6379' docker-compose.prod.yml
```

Esse comando não deve retornar resultados.

### 5. Fazer deploy manual no Swarm

Publique a stack:

```bash
docker stack deploy -c docker-compose.prod.yml bulkmail
```

Acompanhe os serviços:

```bash
docker stack services bulkmail
docker stack ps bulkmail
```

Verifique logs dos principais serviços:

```bash
docker service logs -f bulkmail_backend
docker service logs -f bulkmail_worker
docker service logs -f bulkmail_frontend
```

### 6. Validar a aplicação

Após o Traefik rotear o domínio, valide a API e a interface:

```bash
curl https://bulkmail.crefito.gov.br/api/health
```

Acesse `https://bulkmail.crefito.gov.br` no navegador e confirme que as chamadas da interface usam `/api`, não `localhost:3000`.

## Troubleshooting (Docker)

### Migrations não executaram ou Tabelas não criadas
Se ao subir os containers as tabelas não forem criadas automaticamente, você pode executar as migrações manualmente dentro do container do backend:

```bash
# Executar migrations manualmente
docker exec -it bulkmail-backend npm run migrate

# Verificar logs para erros específicos
docker logs bulkmail-backend
```

**Causas Comuns:**
- O banco Postgres demorou mais que o esperado para aceitar conexões (o backend tentou migrar antes da prontidão total).
- Erro de permissão no volume do Postgres.
- Credenciais no `.env` divergentes das configuradas no `docker-compose.yml`.

### Sem Docker

#### Backend

```bash
cd backend
npm install
cp ../.env.example .env
# Configure .env com suas credenciais SMTP e banco de dados

# Iniciar servidor
npm run dev

# Em outro terminal, iniciar worker
npm run worker
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |
| `POSTGRES_HOST` | Host PostgreSQL | `localhost` |
| `POSTGRES_PORT` | Porta PostgreSQL | `5432` |
| `POSTGRES_USER` | Usuário PostgreSQL | `bulkmail` |
| `POSTGRES_PASSWORD` | Senha PostgreSQL | `bulkmail123` |
| `POSTGRES_DB` | Nome do banco | `bulkmail` |
| `REDIS_URL` | URL Redis | `redis://localhost:6379` |
| `SMTP_HOST` | Host SMTP | `smtp.mailtrap.io` |
| `SMTP_PORT` | Porta SMTP | `2525` |
| `SMTP_USER` | Usuário SMTP | - |
| `SMTP_PASS` | Senha SMTP | - |
| `SMTP_SENDER` | Email remetente | `noreply@bulkmail.com` |
| `THROTTLE_RATE` | Taxa envio/min | `50` |

## API Endpoints

### Upload
```
POST /api/upload
Content-Type: multipart/form-data

Response:
{
  "success": true,
  "message": "File processed successfully",
  "data": {
    "fileName": "emails.xlsx",
    "totalRows": 100,
    "validEmails": 95,
    "invalidEmails": 5
  },
  "emails": {
    "valid": ["email@teste.com", ...],
    "invalid": [{ "email": "invalido", "error": "..." }]
  }
}
```

### Enviar Emails
```
POST /api/send
Content-Type: application/json
{
  "emails": ["teste@exemplo.com"],
  "subject": "Assunto",
  "html": "<p>Corpo HTML</p>"
}

Response:
{
  "success": true,
  "jobId": "uuid",
  "campaignId": "uuid",
  "totalEmails": 100,
  "validEmails": 95,
  "message": "Created 95 email jobs in queue"
}
```

### Status
```
GET /api/status/:jobId

Response:
{
  "success": true,
  "jobId": "uuid",
  "status": "processing",
  "total": 95,
  "completed": 50,
  "failed": 2,
  "processing": 10,
  "waiting": 33
}
```

## Estrutura do Projeto

```
bulkmail-pro/
├── backend/
│   ├── src/
│   │   ├── controllers/   # Controladores de rota
│   │   ├── services/      # Lógica de negócio
│   │   ├── repositories/  # Acesso a dados
│   │   ├── models/        # Modelos de banco
│   │   ├── queue/         # Processamento Bull Queue
│   │   ├── middlewares/   # Middlewares Express
│   │   ├── routes/        # Definição de rotas
│   │   └── config/        # Configurações
│   └── migrations/        # Migrações Knex
├── frontend/
│   ├── src/
│   │   ├── components/    # Componentes React
│   │   ├── pages/         # Páginas
│   │   ├── hooks/         # Custom hooks
│   │   ├── services/      # API calls
│   │   └── types/         # TypeScript types
│   └── public/
├── docker-compose.yml
└── .env
```

## Desenvolvimento

```bash
# Rodar testes
cd backend && npm test

# Build
cd backend && npm run build
cd frontend && npm run build

# Lint
cd backend && npm run lint
```

## Limpeza de Arquivos Temporários

O sistema inclui um serviço de cleanup que remove arquivos de upload antigos automaticamente:

```typescript
import { cleanupOldFiles, getDirectoryStats } from './services/fileCleanup';

// Verificar estatísticas
const stats = getDirectoryStats('./uploads');
console.log(`Arquivos: ${stats.totalFiles}, Tamanho: ${stats.totalSize} bytes`);

// Executar limpeza (arquivos com mais de 24h)
const result = cleanupOldFiles({ maxAgeMs: 24 * 60 * 60 * 1000 });
console.log(`Removidos: ${result.deleted}, Espaço: ${result.freedBytes} bytes`);
```

## Critérios de Aceite

- [x] Upload aceita .xlsx até 100MB
- [x] Regex valida emails (RFC 5322)
- [x] Throttling configurável
- [x] Retry automático (max 3x)
- [x] Status tracking com contadores

## Licença

MIT
