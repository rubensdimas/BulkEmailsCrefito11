#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

skip_backup=false
maintenance_recovery=false
initial_bootstrap=false
bootstrap_guard=
for argument in "$@"; do
  case "$argument" in
    --skip-backup) skip_backup=true ;;
    --maintenance-recovery) maintenance_recovery=true ;;
    --initial-bootstrap) initial_bootstrap=true ;;
    --bootstrap-guard=*) bootstrap_guard=${argument#--bootstrap-guard=} ;;
    *) echo "Unknown argument: $argument" >&2; exit 1 ;;
  esac
done

require_command docker
require_command curl
require_command git
load_production_env
require_swarm_manager

stack_exists=false
docker service inspect "${STACK_NAME}_postgres" >/dev/null 2>&1 && stack_exists=true
preserved_volume_count=0
for volume_name in bulkmail_postgres_data bulkmail_redis_data bulkmail_backups; do
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    preserved_volume_count=$((preserved_volume_count + 1))
  fi
done

if [ "$maintenance_recovery" = true ] && [ "$initial_bootstrap" = true ]; then
  echo "Maintenance recovery and initial bootstrap are mutually exclusive." >&2
  exit 1
fi

if [ "$stack_exists" = false ] && [ "$maintenance_recovery" = false ]; then
  if [ "$initial_bootstrap" = false ]; then
    echo "The stack is absent. Refusing to start application services against preserved volumes." >&2
    echo "Use --maintenance-recovery to snapshot the volumes and deploy with application replicas at zero." >&2
    exit 1
  fi

  [ -n "$bootstrap_guard" ] \
    && [ -f "$bootstrap_guard" ] \
    && [ -n "${BULKMAIL_BOOTSTRAP_TOKEN:-}" ] \
    && [ "${BULKMAIL_BOOTSTRAP_CALLER_PID:-}" = "$PPID" ] \
    && [ "$(sed -n '1p' "$bootstrap_guard")" = "${STACK_NAME}:${BULKMAIL_BOOTSTRAP_TOKEN}:${BULKMAIL_BOOTSTRAP_CALLER_PID}" ] || {
      echo "Initial bootstrap is only accepted through bootstrap.sh with its one-time guard." >&2
      exit 1
    }
fi

if [ "$maintenance_recovery" = true ]; then
  [ "$stack_exists" = false ] || {
    echo "Maintenance recovery requires the existing stack services to be absent." >&2
    exit 1
  }
  [ "$preserved_volume_count" -eq 3 ] || {
    echo "Maintenance recovery requires all three preserved volumes." >&2
    exit 1
  }
  "$SCRIPT_DIR/snapshot-volumes.sh"
  BACKEND_REPLICAS=0
  WORKER_REPLICAS=0
  FRONTEND_REPLICAS=0
  BACKUP_REPLICAS=0
  export BACKEND_REPLICAS WORKER_REPLICAS FRONTEND_REPLICAS BACKUP_REPLICAS
fi

if [ "$initial_bootstrap" = true ] && [ "$stack_exists" = true ]; then
  echo "Initial bootstrap cannot run while the stack exists." >&2
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

for secret_name in bulkmail_postgres_password bulkmail_redis_password bulkmail_mailgrid_password bulkmail_mailgrid_webhook_token bulkmail_config_encryption_key bulkmail_oidc_client_secret bulkmail_oidc_session_encryption_key; do
  docker secret inspect "$secret_name" >/dev/null 2>&1 || {
    echo "Required Docker secret not found: $secret_name" >&2
    exit 1
  }
done

release_id=${DEPLOY_VERSION:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}

if [ "${SKIP_BUILD:-false}" != "true" ]; then
  BACKEND_IMAGE="bulkmail-backend:$release_id"
  FRONTEND_IMAGE="bulkmail-frontend:$release_id"
  docker build --pull --label "org.opencontainers.image.revision=$release_id" -f "$PROJECT_ROOT/backend/Dockerfile" -t "$BACKEND_IMAGE" "$PROJECT_ROOT"
  docker build --pull --label "org.opencontainers.image.revision=$release_id" --build-arg VITE_API_URL=/api --build-arg VITE_AUTH_ENABLED=true -f "$PROJECT_ROOT/frontend/Dockerfile" -t "$FRONTEND_IMAGE" "$PROJECT_ROOT/frontend"
else
  : "${BACKEND_IMAGE:?BACKEND_IMAGE is required when SKIP_BUILD=true}"
  : "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required when SKIP_BUILD=true}"
  docker pull "$BACKEND_IMAGE"
  docker pull "$FRONTEND_IMAGE"
fi
export BACKEND_IMAGE FRONTEND_IMAGE

echo "Verifying backend production artifacts: $BACKEND_IMAGE"
docker run --rm --entrypoint npm "$BACKEND_IMAGE" run verify:production-artifacts
backend_image_id=$(docker image inspect --format '{{.Id}}' "$BACKEND_IMAGE")
echo "Deploying release $release_id with backend image $BACKEND_IMAGE ($backend_image_id)"

docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" config --quiet
docker stack config -c "$PROJECT_ROOT/docker-compose.prod.yml" >/dev/null

if [ "$skip_backup" = false ] && [ "$stack_exists" = true ]; then
  "$SCRIPT_DIR/backup.sh"
  "$SCRIPT_DIR/backup-redis.sh"
fi

docker stack deploy --with-registry-auth -c "$PROJECT_ROOT/docker-compose.prod.yml" "$STACK_NAME"

attempt=0
while [ "$attempt" -lt 60 ]; do
  pending=$(docker stack services "$STACK_NAME" --format '{{.Replicas}}' | awk -F/ '$1 != $2 {count++} END {print count+0}')
  [ "$pending" -eq 0 ] && break
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$attempt" -ge 60 ]; then
  echo "Deployment did not become healthy. Inspecting service state:" >&2
  docker stack services "$STACK_NAME" >&2
  exit 1
fi

if [ "$maintenance_recovery" = true ]; then
  echo "Maintenance recovery stack created with backend, worker, frontend and backup replicas at zero."
  echo "Validate PostgreSQL and Redis before scaling backend to one. Keep the worker at zero until reconciliation passes."
  exit 0
fi

if ! curl --fail --silent --show-error "${APP_ORIGIN%/}/api/health/ready" >/dev/null; then
  echo "Deployment did not become healthy. Inspecting service state:" >&2
  docker stack services "$STACK_NAME" >&2
  exit 1
fi

echo "Deployment $release_id completed successfully."
