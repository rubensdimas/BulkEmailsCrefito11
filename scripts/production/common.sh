#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PRODUCTION_ENV=${PRODUCTION_ENV:-$PROJECT_ROOT/deploy/production.env}
SECRETS_DIR=${SECRETS_DIR:-$PROJECT_ROOT/deploy/secrets}
STACK_NAME=${STACK_NAME:-bulkmail}

load_production_env() {
  if [ ! -f "$PRODUCTION_ENV" ]; then
    echo "Missing production configuration: $PRODUCTION_ENV" >&2
    echo "Copy deploy/production.env.example and review every value." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$PRODUCTION_ENV"
  set +a
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_file() {
  [ -s "$1" ] || {
    echo "Required secret file is missing or empty: $1" >&2
    exit 1
  }
}

require_swarm_manager() {
  [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = "active" ] || {
    echo "Docker Swarm is not active on this host." >&2
    exit 1
  }
  [ "$(docker info --format '{{.Swarm.ControlAvailable}}')" = "true" ] || {
    echo "Run this command on a Swarm manager." >&2
    exit 1
  }
}
