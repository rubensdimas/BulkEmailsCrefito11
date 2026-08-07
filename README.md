# BulkMail Pro

Aplicação para importação de destinatários por planilha, criação de campanhas e envio de emails pela Mailgrid, com processamento assíncrono e acompanhamento de status.

## Arquitetura

- React 18 + TypeScript no frontend.
- Node.js 24 LTS + Express + TypeScript no backend.
- PostgreSQL 18 para dados e configurações.
- Redis + Bull para filas.
- Nginx no frontend e Traefik existente na borda.
- Docker Compose no desenvolvimento e Docker Swarm em produção.

Em produção, somente o frontend participa da rede externa `CrefitoNet`. Backend, worker, PostgreSQL, Redis e backup usam a rede privada `bulkmail_internal`. PostgreSQL, Redis e backups ficam em volumes externos e sobrevivem à substituição dos containers e à remoção da stack.

## Desenvolvimento local

Requisitos: Docker Engine com Compose v2.

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f backend worker
```

A interface fica em `http://localhost:5173` e a API em `http://localhost:3000/api`.

Para parar sem apagar dados:

```bash
docker compose down
```

Para atualizar o ambiente local:

```bash
docker compose up -d --build
```

As dependências locais são fornecidas pela imagem Docker a partir do
`package-lock.json`. Não execute `npm install` dentro dos containers. Após
alterar dependências, basta repetir o comando acima; os volumes do PostgreSQL
e Redis permanecem preservados.

`docker compose down -v` apaga os dados locais e não deve ser usado em produção.

## Configuração

O arquivo `.env.example` contém somente valores para desenvolvimento. Produção separa:

- `deploy/production.env`: domínio, banco, remetente, limites e referências das imagens;
- `deploy/secrets/`: valores sensíveis locais usados uma vez para criar Docker Secrets.

Nenhuma senha possui fallback em produção. O backend lê secrets pelos campos `*_FILE`, e senha Mailgrid/token webhook persistidos pela interface são criptografados com AES-256-GCM.

## Primeiro deploy em produção

Requisitos da VPS:

- Docker Swarm ativo;
- execução em um manager;
- Traefik atual operando na rede `CrefitoNet`;
- domínio `bulkmail.crefito.gov.br` apontado para a VPS;
- `docker`, `curl`, `openssl` e Git instalados.

Prepare a configuração:

```bash
cp deploy/production.env.example deploy/production.env
mkdir -p deploy/secrets
chmod 700 deploy/secrets
printf '%s' 'SENHA_REAL_MAILGRID' > deploy/secrets/mailgrid_password
chmod 600 deploy/secrets/mailgrid_password
```

Revise `deploy/production.env`. A opção `ALLOW_UNAUTHENTICATED_ADMIN=true` é obrigatória no estado atual e registra conscientemente que o painel ainda não possui login.

Execute o bootstrap uma única vez:

```bash
./scripts/production/bootstrap.sh
```

O bootstrap:

1. valida Swarm, manager, Traefik e `CrefitoNet`;
2. cria a rede privada e os volumes externos;
3. fixa os serviços de dados no nó atual;
4. gera passwords/tokens fortes quando ausentes;
5. cria Docker Secrets;
6. constrói imagens versionadas e publica a stack;
7. aguarda `https://bulkmail.crefito.gov.br/api/health/ready` responder com sucesso.

As labels Traefik permanecem iguais às existentes: router `bulkmail`, entrypoint `websecure`, resolver `letsencryptresolver` e porta interna `80`.

## Publicar uma atualização

Depois de atualizar o código na VPS:

```bash
./scripts/production/deploy.sh
```

O comando cria imagens com tag imutável, valida o stack, gera um backup antes da atualização, executa migrations, acompanha healthchecks e encerra com erro se o rollout não estabilizar. O Swarm mantém a versão anterior durante o início da nova versão e aplica rollback quando o novo serviço falha.

O frontend resolve o backend dinamicamente pela rede interna do Docker. Portanto, ele continua disponível durante o intervalo curto em que o backend executa migrations ou é recriado no rollout.

Para acompanhar:

```bash
docker stack services bulkmail
docker stack ps bulkmail --no-trunc
docker service logs -f bulkmail_backend
docker service logs -f bulkmail_worker
```

Não é necessário executar build, migration, `docker service update --force` ou `docker stack deploy` manualmente.

## Persistência e backups

Os volumes de produção têm nomes fixos:

| Volume | Conteúdo |
| --- | --- |
| `bulkmail_postgres_data` | Banco PostgreSQL |
| `bulkmail_redis_data` | Filas Redis/AOF |
| `bulkmail_backups` | Dumps PostgreSQL verificados |

O serviço `bulkmail_backup` cria um dump ao iniciar e depois diariamente, mantendo sete dias. Um backup sob demanda pode ser criado com:

```bash
./scripts/production/backup.sh
```

Atualizações e `docker stack rm bulkmail` não removem volumes externos. Nunca inclua `docker volume rm` no fluxo normal de atualização.

Restauração, reset total e rotação de secrets estão no [runbook de produção](docs/production.md).

## Segurança

O ambiente de produção aplica:

- TLS pelo Traefik existente;
- banco e Redis sem portas públicas e fora da `CrefitoNet`;
- Docker Secrets para credenciais;
- containers de aplicação executados como usuário sem privilégios;
- healthchecks, limites de recursos e rollback;
- headers HTTP, CSP, CORS restrito e rate limiting;
- validação de assinatura de planilha e uploads temporários em memória;
- remoção automática das planilhas após processamento;
- erros internos ocultos em produção.

> **Risco conhecido:** o painel ainda não possui autenticação. Quem acessar o domínio poderá tentar enviar campanhas e alterar configurações. Rate limiting não substitui autenticação. Antes de disponibilizar o domínio para acesso público irrestrito, implemente SSO, VPN, allowlist ou login da aplicação.

O webhook Mailgrid continua protegido por `Authorization: Bearer <TOKEN>`:

```text
POST https://bulkmail.crefito.gov.br/api/webhooks/mailgrid
```

## Healthchecks

| Endpoint | Uso |
| --- | --- |
| `GET /api/health/live` | Processo HTTP ativo |
| `GET /api/health/ready` | PostgreSQL e Redis disponíveis |
| `GET /api/health` | Alias compatível do readiness |

## Qualidade

```bash
cd backend
npm ci
npm run lint
npm run build
npm test

cd ../frontend
npm ci
npm run lint
npm run build
```

## Futuro GitHub Actions

Nenhum workflow é criado nesta entrega. O fluxo já aceita imagens publicadas por CI:

```bash
SKIP_BUILD=true
BACKEND_IMAGE=ghcr.io/owner/repository/backend@sha256:...
FRONTEND_IMAGE=ghcr.io/owner/repository/frontend@sha256:...
```

O futuro workflow deverá testar, publicar as duas imagens no GHCR e executar o mesmo `scripts/production/deploy.sh`. A persistência, migrations, backup, healthcheck e rollback continuarão sob responsabilidade do script da VPS.

## Licença

MIT
