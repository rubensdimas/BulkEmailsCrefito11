# Runbook de produção

Este documento contém operações administrativas e potencialmente destrutivas. Execute os comandos somente no manager Swarm que hospeda os volumes locais do BulkMail.

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

## Backup sob demanda

```bash
./scripts/production/backup.sh
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
