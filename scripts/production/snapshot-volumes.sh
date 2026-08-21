#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

require_command docker
require_command sha256sum
load_production_env
require_swarm_manager

for service_name in postgres redis backend worker frontend backup; do
  if docker service inspect "${STACK_NAME}_${service_name}" >/dev/null 2>&1; then
    echo "Offline snapshot refused: ${STACK_NAME}_${service_name} still exists." >&2
    exit 1
  fi
done

snapshot_root=${RECOVERY_SNAPSHOT_DIR:-$PROJECT_ROOT/deploy/recovery-snapshots}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot_dir="$snapshot_root/$stamp"
mkdir -p "$snapshot_dir"
chmod 700 "$snapshot_root" "$snapshot_dir"

for volume_name in bulkmail_postgres_data bulkmail_redis_data bulkmail_backups; do
  docker volume inspect "$volume_name" >/dev/null
  archive_name="${volume_name}-${stamp}.tar.gz"
  docker run --rm \
    --mount "type=volume,src=${volume_name},dst=/source,readonly" \
    --mount "type=bind,src=${snapshot_dir},dst=/snapshot" \
    alpine:3.22 \
    sh -ec "tar -C /source -czf /snapshot/${archive_name}.tmp .; tar -tzf /snapshot/${archive_name}.tmp >/dev/null; mv /snapshot/${archive_name}.tmp /snapshot/${archive_name}"
  sha256sum "$snapshot_dir/$archive_name" >> "$snapshot_dir/SHA256SUMS"
done

sha256sum -c "$snapshot_dir/SHA256SUMS"
echo "Verified offline volume snapshots created in: $snapshot_dir"
