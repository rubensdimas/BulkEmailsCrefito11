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

## Quick Start

### Com Docker (Recomendado)

```bash
# Iniciar todos os serviços
docker-compose up -d

# Acessar
# - Frontend: http://localhost:5173
# - Backend: http://localhost:3000
# - Health: http://localhost:3000/api/health
```

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
