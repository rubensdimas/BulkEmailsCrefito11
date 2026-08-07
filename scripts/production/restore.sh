#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

backup_name=${1:-}
confirmation=${2:-}
[ -n "$backup_name" ] && [ "$confirmation" = "--confirm-restore" ] || {
  echo "Usage: $0 BACKUP_FILE.dump --confirm-restore" >&2
  exit 1
}
case "$backup_name" in */*|*..*) echo "Backup must be a filename inside bulkmail_backups." >&2; exit 1;; esac

require_command docker
load_production_env
require_swarm_manager
require_file "$SECRETS_DIR/postgres_password"

"$SCRIPT_DIR/backup.sh"
docker service scale "${STACK_NAME}_backend=0" "${STACK_NAME}_worker=0" >/dev/null

restore_result=0
docker run --rm \
  --network bulkmail_internal \
  --mount type=volume,src=bulkmail_backups,dst=/backups \
  --mount type=bind,src="$SECRETS_DIR/postgres_password",dst=/run/secrets/postgres_password,readonly \
  -e PGHOST=postgres -e PGUSER="$POSTGRES_USER" -e PGDATABASE="$POSTGRES_DB" \
  -e BACKUP_NAME="$backup_name" \
  postgres:18.4-alpine \
  sh -ec 'test -f "/backups/${BACKUP_NAME}";
    export PGPASSWORD="$(cat /run/secrets/postgres_password)";
    pg_restore --clean --if-exists --no-owner --dbname="${PGDATABASE}" "/backups/${BACKUP_NAME}"' || restore_result=$?

docker service scale "${STACK_NAME}_backend=1" "${STACK_NAME}_worker=1" >/dev/null
[ "$restore_result" -eq 0 ] || exit "$restore_result"
echo "Restore completed from $backup_name"
