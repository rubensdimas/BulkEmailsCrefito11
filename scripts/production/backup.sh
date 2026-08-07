#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

require_command docker
load_production_env
require_swarm_manager
require_file "$SECRETS_DIR/postgres_password"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="${POSTGRES_DB}-${stamp}.dump"

docker run --rm \
  --network bulkmail_internal \
  --mount type=volume,src=bulkmail_backups,dst=/backups \
  --mount type=bind,src="$SECRETS_DIR/postgres_password",dst=/run/secrets/postgres_password,readonly \
  -e PGHOST=postgres \
  -e PGUSER="$POSTGRES_USER" \
  -e PGDATABASE="$POSTGRES_DB" \
  -e BACKUP_NAME="$backup_name" \
  -e BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}" \
  postgres:18.4-alpine \
  sh -ec 'export PGPASSWORD="$(cat /run/secrets/postgres_password)";
    pg_dump --format=custom --file="/backups/${BACKUP_NAME}.tmp";
    pg_restore --list "/backups/${BACKUP_NAME}.tmp" >/dev/null;
    mv "/backups/${BACKUP_NAME}.tmp" "/backups/${BACKUP_NAME}";
    find /backups -type f -name "*.dump" -mtime +"${BACKUP_RETENTION_DAYS}" -delete'

echo "Verified backup created: $backup_name"
