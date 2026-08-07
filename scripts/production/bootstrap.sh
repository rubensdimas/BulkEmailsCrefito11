#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

require_command docker
require_command openssl
load_production_env
require_swarm_manager

docker network inspect CrefitoNet >/dev/null 2>&1 || {
  echo "The existing Traefik network CrefitoNet was not found." >&2
  exit 1
}

if ! docker network inspect bulkmail_internal >/dev/null 2>&1; then
  docker network create --driver overlay --attachable --opt encrypted bulkmail_internal >/dev/null
fi

for volume_name in bulkmail_postgres_data bulkmail_redis_data bulkmail_backups; do
  docker volume inspect "$volume_name" >/dev/null 2>&1 || docker volume create "$volume_name" >/dev/null
done

data_node=$(docker info --format '{{.Name}}')
docker node update --label-add bulkmail.data=true "$data_node" >/dev/null

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
umask 077

[ -s "$SECRETS_DIR/postgres_password" ] || openssl rand -base64 36 > "$SECRETS_DIR/postgres_password"
[ -s "$SECRETS_DIR/redis_password" ] || openssl rand -base64 36 > "$SECRETS_DIR/redis_password"
[ -s "$SECRETS_DIR/mailgrid_webhook_token" ] || openssl rand -hex 32 > "$SECRETS_DIR/mailgrid_webhook_token"
[ -s "$SECRETS_DIR/config_encryption_key" ] || openssl rand -hex 32 > "$SECRETS_DIR/config_encryption_key"
require_file "$SECRETS_DIR/mailgrid_password"

create_secret() {
  secret_name="$1"
  secret_file="$2"
  if ! docker secret inspect "$secret_name" >/dev/null 2>&1; then
    docker secret create "$secret_name" "$secret_file" >/dev/null
  fi
}

create_secret bulkmail_postgres_password "$SECRETS_DIR/postgres_password"
create_secret bulkmail_redis_password "$SECRETS_DIR/redis_password"
create_secret bulkmail_mailgrid_password "$SECRETS_DIR/mailgrid_password"
create_secret bulkmail_mailgrid_webhook_token "$SECRETS_DIR/mailgrid_webhook_token"
create_secret bulkmail_config_encryption_key "$SECRETS_DIR/config_encryption_key"

exec "$SCRIPT_DIR/deploy.sh" --skip-backup
