#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

skip_backup=false
[ "${1:-}" = "--skip-backup" ] && skip_backup=true

require_command docker
require_command curl
require_command git
load_production_env
require_swarm_manager

if [ "${ALLOW_UNAUTHENTICATED_ADMIN:-false}" != "true" ]; then
  echo "Refusing public deploy without explicit ALLOW_UNAUTHENTICATED_ADMIN=true." >&2
  exit 1
fi

for resource_name in CrefitoNet bulkmail_internal; do
  docker network inspect "$resource_name" >/dev/null 2>&1 || {
    echo "Required network not found: $resource_name" >&2
    exit 1
  }
done

for volume_name in bulkmail_postgres_data bulkmail_redis_data bulkmail_backups; do
  docker volume inspect "$volume_name" >/dev/null 2>&1 || {
    echo "Required volume not found: $volume_name" >&2
    exit 1
  }
done

for secret_name in bulkmail_postgres_password bulkmail_redis_password bulkmail_mailgrid_password bulkmail_mailgrid_webhook_token bulkmail_config_encryption_key; do
  docker secret inspect "$secret_name" >/dev/null 2>&1 || {
    echo "Required Docker secret not found: $secret_name" >&2
    exit 1
  }
done

release_id=${DEPLOY_VERSION:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}

if [ "${SKIP_BUILD:-false}" != "true" ]; then
  BACKEND_IMAGE="bulkmail-backend:$release_id"
  FRONTEND_IMAGE="bulkmail-frontend:$release_id"
  docker build --pull -f "$PROJECT_ROOT/backend/Dockerfile" -t "$BACKEND_IMAGE" "$PROJECT_ROOT"
  docker build --pull --build-arg VITE_API_URL=/api -f "$PROJECT_ROOT/frontend/Dockerfile" -t "$FRONTEND_IMAGE" "$PROJECT_ROOT/frontend"
else
  : "${BACKEND_IMAGE:?BACKEND_IMAGE is required when SKIP_BUILD=true}"
  : "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required when SKIP_BUILD=true}"
  docker pull "$BACKEND_IMAGE"
  docker pull "$FRONTEND_IMAGE"
fi
export BACKEND_IMAGE FRONTEND_IMAGE

docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" config --quiet
docker stack config -c "$PROJECT_ROOT/docker-compose.prod.yml" >/dev/null

if [ "$skip_backup" = false ] && docker service inspect "${STACK_NAME}_postgres" >/dev/null 2>&1; then
  "$SCRIPT_DIR/backup.sh"
fi

docker stack deploy --with-registry-auth -c "$PROJECT_ROOT/docker-compose.prod.yml" "$STACK_NAME"

attempt=0
while [ "$attempt" -lt 60 ]; do
  pending=$(docker stack services "$STACK_NAME" --format '{{.Replicas}}' | awk -F/ '$1 != $2 {count++} END {print count+0}')
  [ "$pending" -eq 0 ] && break
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$attempt" -ge 60 ] || ! curl --fail --silent --show-error "${APP_ORIGIN%/}/api/health/ready" >/dev/null; then
  echo "Deployment did not become healthy. Inspecting service state:" >&2
  docker stack services "$STACK_NAME" >&2
  exit 1
fi

echo "Deployment $release_id completed successfully."
