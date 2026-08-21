#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

require_command docker
load_production_env
require_swarm_manager
require_file "$SECRETS_DIR/redis_password"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="redis-${stamp}.rdb"

docker run --rm \
  --network bulkmail_internal \
  --mount type=volume,src=bulkmail_backups,dst=/backups \
  --mount type=bind,src="$SECRETS_DIR/redis_password",dst=/run/secrets/redis_password,readonly \
  -e BACKUP_NAME="$backup_name" \
  redis:8.4.2-alpine \
  sh -ec 'redis-cli -h redis -a "$(cat /run/secrets/redis_password)" --rdb "/backups/${BACKUP_NAME}.tmp" >/dev/null;
    redis-check-rdb "/backups/${BACKUP_NAME}.tmp" >/dev/null;
    mv "/backups/${BACKUP_NAME}.tmp" "/backups/${BACKUP_NAME}"'

echo "Verified Redis backup created: $backup_name"
