# Runbook de produção

Este documento contém operações administrativas e potencialmente destrutivas. Execute os comandos somente no manager Swarm que hospeda os volumes locais do BulkMail.

## Recuperação com stack removida e volumes preservados

Quando a stack tiver sido removida pelo Portainer, não execute o deploy normal. O
deploy normal é bloqueado nesse cenário para impedir que o worker consuma
automaticamente os jobs preservados no Redis.

Confirme primeiro que os três volumes externos existem:

```bash
docker volume inspect bulkmail_postgres_data
docker volume inspect bulkmail_redis_data
docker volume inspect bulkmail_backups
```

Inicie a recuperação em modo de manutenção:

```bash
./scripts/production/deploy.sh --maintenance-recovery
```

Esse comando cria e valida snapshots offline dos três volumes em
`deploy/recovery-snapshots/<timestamp>/`, sobe PostgreSQL e Redis e mantém
backend, worker, frontend e backup com zero réplicas. Mova uma cópia dos
snapshots para armazenamento externo antes de continuar.

Valide os logs dos serviços de dados e crie os backups lógicos:

```bash
docker service logs --tail 200 bulkmail_postgres
docker service logs --tail 200 bulkmail_redis
docker service scale bulkmail_backup=1
./scripts/production/backup.sh
./scripts/production/backup-redis.sh
```

Suba apenas o backend. O frontend e principalmente o worker devem permanecer em
zero:

```bash
docker service scale bulkmail_backend=1
docker service scale bulkmail_frontend=0 bulkmail_worker=0
```

Localize o container do backend e execute primeiro o relatório sem alterações:

```bash
backend_container=$(docker ps --filter name=bulkmail_backend -q | head -1)
docker exec "$backend_container" npm run reconcile:email-jobs -- --dry-run
```

O comando termina com código `2` se encontrar jobs ativos, payloads divergentes,
destinatários ausentes ou estados de entrega incertos. Nesses casos, não execute
`--apply` e não suba o worker. Confirme os estados incertos nos registros do
Mailgrid pelo destinatário, horário e message ID.

Para limitar a análise a uma campanha, acrescente `--campaign=ID`. O filtro vale
tanto para jobs do Redis quanto para campanhas existentes somente no PostgreSQL.

Quando o dry-run estiver sem bloqueios:

```bash
docker exec "$backend_container" npm run reconcile:email-jobs -- --apply
docker exec "$backend_container" npm run reconcile:email-jobs -- --dry-run
```

Se o único bloqueio de uma campanha for a existência de logs `pending` sem jobs
no Redis, confirme externamente que esses destinatários não foram enviados. O
reenfileiramento exige o ID duas vezes e continua bloqueado se houver jobs ativos
ou logs `processing`:

```bash
campaign_id="ID_DA_CAMPANHA_CONFIRMADA"
docker exec "$backend_container" npm run reconcile:email-jobs -- \
  --enqueue-missing \
  "--campaign=$campaign_id" "--confirm-provider-unsent=$campaign_id"
```

Repita o dry-run depois dessa operação. Nunca use essa opção para um estado que
não tenha sido conferido no Mailgrid.

Jobs que terminaram como `failed` também não são reenviados automaticamente. Se
o Mailgrid confirmar que não houve entrega, reative somente os jobs falhos da
campanha com:

```bash
docker exec "$backend_container" npm run reconcile:email-jobs -- \
  --retry-failed \
  "--campaign=$campaign_id" "--confirm-provider-unsent=$campaign_id"
```

As duas operações manuais executam um novo dry-run internamente e recusam
payload divergente, hash inválido, job ativo ou estado incerto.

Depois da reconciliação, suba o frontend, valide login, readiness e dashboard e
só então libere o worker:

```bash
docker service scale bulkmail_frontend=1
curl --fail https://bulkmail.crefito.gov.br/api/health/ready
docker service scale bulkmail_worker=1
```

Monitore os primeiros envios com throttling reduzido. Não restaure volumes para
fazer rollback de imagem; os dados reconciliados são compatíveis com a versão
anterior.

## Estado da stack

```bash
docker stack services bulkmail
docker stack ps bulkmail --no-trunc
docker service logs --tail 200 bulkmail_postgres
docker service logs --tail 200 bulkmail_backend
docker service logs --tail 200 bulkmail_worker
docker service logs --tail 200 bulkmail_backup
```

## Falha durante deploy

Se `bulkmail_backend` falhar em `migrate:prod`, consulte primeiro o caminho das migrations e a imagem usada pelo serviço:

```bash
docker service logs --tail 200 bulkmail_backend
docker service inspect bulkmail_backend --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

Depois de atualizar o código na VPS, execute somente o fluxo normal abaixo. Ele recria as imagens, executa backup e aguarda o readiness; não remova a stack, os volumes ou os secrets para corrigir uma falha de aplicação.

```bash
./scripts/production/deploy.sh
```

Antes de publicar, o deploy valida o `knexfile` e todas as migrations dentro da imagem final. O log registra o release e o ID da imagem do backend; use essas informações para confirmar que a VPS publicou o artefato recém-construído.

A imagem de produção carrega somente migrations `*.js` e remove declarações `*.d.ts`; portanto, o erro `Invalid migration ... .d.ts` bloqueia o build localmente em vez de interromper o serviço no Swarm.

O Nginx do frontend usa a resolução DNS dinâmica da rede Docker. Assim, uma indisponibilidade temporária do backend durante migrations não encerra o container do frontend.

## Exceção temporária da auditoria npm

O frontend está fixado em `react-router-dom@7.18.2`. A auditoria npm atual associa essa versão a um alerta de CSRF no modo RSC/Server Actions. O BulkMail é uma SPA Vite client-side e não usa RSC, loaders/actions de servidor ou React Server Components; portanto, o caminho afetado não está habilitado nesta aplicação.

Não faça downgrade automático do React Router para eliminar o alerta: versões anteriores reintroduzem avisos de redirect já corrigidos. Reavalie e atualize para uma versão sem alertas quando ela estiver disponível. Esta exceção deixa de ser válida imediatamente se o projeto adotar SSR, RSC ou Server Actions.

## Configurações no banco (Mailgrid e login pela intranet)

Desde a Story 4.2, Mailgrid e OIDC são configurados em **Configurações** (somente
administradores) e ficam na tabela `configurations`, com segredos criptografados por
`CONFIG_ENCRYPTION_KEY`. Continuam no ambiente: Postgres, Redis, `APP_ORIGIN`,
`CONFIG_ENCRYPTION_KEY`, `OIDC_SESSION_ENCRYPTION_KEY`, `TRUST_PROXY_HOPS` e
`LOCAL_LOGIN_ENABLED`.

No primeiro start da nova versão, se o banco não tiver a configuração, o backend copia
uma única vez os valores atuais de `MAILGRID_*` e `OIDC_*` (incluindo os Docker secrets).
O backend não emite log de sucesso da importação. Confirme que o start não falhou (a
falha aparece como `Database configuration initialization failed`) e valide o resultado
na tela:

```bash
docker service logs --since 10m bulkmail_backend | grep 'Database configuration initialization failed'
```

A saída deve ser vazia.

Depois, entre como administrador e confira **Configurações → E-mail** e
**Configurações → Login intranet** (use **Testar**). A partir daí, alterações feitas no
`.env` ou nos secrets do Mailgrid/OIDC não têm efeito.

### Antes do deploy

- Garanta ao menos um administrador local (`npm run user:admin -- create`) antes de
  depender da tela de Configurações.
- Faça e guarde um backup do banco (veja "Backup sob demanda"). A migration que renomeia
  `local_users` é destrutiva e seu rollback não é automático; a recuperação é pelo backup.
- Não faça rolling deploy com versões antiga e nova ao mesmo tempo após o rename de
  `local_users`. Registre uma janela de manutenção: pare o backend e os workers antigos,
  execute a migration e só então inicie a nova versão.

### Perfis

- Usuários da intranet entram como **Operador** no primeiro acesso; promova-os em
  **Configurações → Usuários**.
- Sessões abertas antes do deploy continuam válidas enquanto a configuração importada
  permanecer compatível; sua identidade é vinculada ao issuer original e os usuários
  aparecem como Operador. Mudanças incompatíveis na configuração OIDC (por exemplo, de
  issuer) exigem novo login e não transferem o perfil entre issuers.

### Falha ao ler secret file

Se a importação ou o carregamento falhar por causa de um secret file ausente ou ilegível,
a importação é atômica: nada é gravado e o start falha com
`Database configuration initialization failed`. Corrija o secret (sem imprimir seu valor),
reinicie o serviço e confira novamente o start e as telas de Configurações. A importação
só preenche seções ausentes e nunca sobrescreve valores já existentes no banco.

### Retirada das variáveis antigas (follow-up)

Depois de validar a importação em produção, uma story seguinte remove de
`docker-compose.prod.yml`, `deploy/production.env`, `scripts/production/bootstrap.sh` e
`scripts/production/deploy.sh` as variáveis `MAILGRID_*`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_BACKCHANNEL_ORIGIN` e os secrets `bulkmail_mailgrid_password`,
`bulkmail_mailgrid_webhook_token` e `bulkmail_oidc_client_secret`. Não remova
`bulkmail_config_encryption_key` nem `bulkmail_oidc_session_encryption_key`.

## Usuários locais (login por senha)

Administradores também criam usuários, definem senhas, alteram perfis e desativam
contas em **Configurações → Usuários**. Os comandos abaixo continuam disponíveis como
acesso de emergência e sempre criam administradores.

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

O bloqueio de tentativas usa o IP do cliente. A cadeia de produção é
Traefik → Nginx → backend, e cada salto acrescenta um IP ao `X-Forwarded-For`;
por isso o valor esperado é `TRUST_PROXY_HOPS=2` (Traefik + Nginx), que já é o
padrão de `deploy/production.env.example` e do `docker-compose.prod.yml`. Com
apenas 1 salto, o backend enxergaria sempre o IP do Traefik e o bloqueio por IP
viraria um bloqueio global.

Depois do primeiro deploy, faça uma tentativa com senha errada a partir de uma
máquina conhecida e confirme que o campo `ip` do log `[LocalAuth]` é o IP real
do cliente.

Pré-condição: o Traefik **não** pode confiar em `X-Forwarded-For` enviado pelo
cliente (sem `forwardedHeaders.insecure` e sem `trustedIPs` amplos no
entrypoint). Caso contrário, qualquer cliente poderia forjar o próprio IP e
contornar o bloqueio.

Se o IP registrado continuar sendo interno do Docker (por exemplo `10.0.x.x`) e
igual para todos, o Traefik está recebendo o tráfego pela rede ingress do Swarm,
que oculta o IP de origem; publique as portas do Traefik em `mode: host` antes
de confiar no bloqueio por IP.

## Backup sob demanda

```bash
./scripts/production/backup.sh
./scripts/production/backup-redis.sh
docker run --rm -v bulkmail_backups:/backups alpine:3.22 ls -lh /backups
```

Os dumps usam formato custom do PostgreSQL e são validados com `pg_restore --list` antes de receber o nome definitivo.

## Restaurar um backup

A restauração gera um backup adicional, interrompe backend/worker, restaura o dump e religa os consumidores:

```bash
./scripts/production/restore.sh bulkmail-AAAAmmddTHHMMSSZ.dump --confirm-restore
```

Confirme o readiness e os dados após a restauração:

```bash
curl --fail https://bulkmail.crefito.gov.br/api/health/ready
docker service logs --tail 100 bulkmail_backend
```

## Rollback de aplicação

O stack usa rollback automático para falhas durante o rollout. Para solicitar rollback manual da configuração mais recente:

```bash
docker service update --rollback bulkmail_backend
docker service update --rollback bulkmail_worker
docker service update --rollback bulkmail_frontend
```

Rollback de imagem não reverte schema. Migrations devem ser compatíveis com a versão anterior usando o padrão expand/contract.

## Rotacionar secrets

Docker Secrets são imutáveis. Faça backup, remova temporariamente a stack, substitua os arquivos locais e recrie os secrets pelo bootstrap:

```bash
./scripts/production/backup.sh
docker stack rm bulkmail

# Aguarde os serviços desaparecerem e substitua somente o secret desejado.
docker secret rm bulkmail_mailgrid_password
printf '%s' 'NOVA_SENHA' > deploy/secrets/mailgrid_password
chmod 600 deploy/secrets/mailgrid_password

./scripts/production/bootstrap.sh
```

Para o segredo do cliente OIDC, use o nome `bulkmail_oidc_client_secret` e o
arquivo local `deploy/secrets/oidc_client_secret`. A chave
`bulkmail_oidc_session_encryption_key` é gerada pelo bootstrap e deve ser
rotacionada junto com as sessões, invalidando os logins existentes.

Para PostgreSQL e Redis, alterar apenas o Docker Secret não muda automaticamente a credencial persistida no serviço. Essas rotações exigem atualização coordenada da senha no banco/Redis e devem ser executadas em janela de manutenção.

## Reset total para ambiente novo

O comando abaixo apaga permanentemente banco, filas, backups e secrets do BulkMail. Traefik e `CrefitoNet` são preservados.

```bash
./scripts/production/reset.sh --confirm-destroy-bulkmail-data
```

Depois recrie `deploy/production.env`, `deploy/secrets/mailgrid_password` e execute:

```bash
./scripts/production/bootstrap.sh
```

## Recursos que nunca devem ser removidos por este projeto

- stack e containers do Traefik;
- rede `CrefitoNet`;
- portas públicas `80` e `443`;
- certificados e storage ACME do Traefik;
- outros volumes ou secrets que não começam com `bulkmail_`.
