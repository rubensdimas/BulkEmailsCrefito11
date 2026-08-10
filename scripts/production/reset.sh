#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

[ "${1:-}" = "--confirm-destroy-bulkmail-data" ] || {
  echo "This permanently removes the BulkMail stack, database, queue, backups and secrets." >&2
  echo "Run: $0 --confirm-destroy-bulkmail-data" >&2
  exit 1
}

require_command docker
require_swarm_manager

docker stack rm "$STACK_NAME" >/dev/null 2>&1 || true
attempt=0
while docker service ls --format '{{.Name}}' | grep -q "^${STACK_NAME}_" && [ "$attempt" -lt 30 ]; do
  attempt=$((attempt + 1))
  sleep 2
done

for secret_name in bulkmail_postgres_password bulkmail_redis_password bulkmail_mailgrid_password bulkmail_mailgrid_webhook_token bulkmail_config_encryption_key bulkmail_oidc_client_secret bulkmail_oidc_session_encryption_key; do
  docker secret rm "$secret_name" >/dev/null 2>&1 || true
done
for volume_name in bulkmail_postgres_data bulkmail_redis_data bulkmail_backups; do
  docker volume rm "$volume_name" >/dev/null 2>&1 || true
done
docker network rm bulkmail_internal >/dev/null 2>&1 || true

echo "BulkMail production data was permanently removed. Traefik and CrefitoNet were preserved."
