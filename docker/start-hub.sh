#!/bin/bash
# Start or stop camunda-hub (Web Modeler) in Self-Managed mode.
# Expects camunda-hub to be cloned as a sibling directory: ../camunda-hub
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HUB_REPO="$(cd "$REPO_ROOT/../camunda-hub" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.hub.yml"
export JAVA_HOME="/Users/$(whoami)/.asdf/installs/java/openjdk-25.0.1"

case "${1:-start}" in
  start)
    echo "Starting Hub infrastructure..."
    docker compose -f "$COMPOSE_FILE" up -d
    echo "Starting Hub app (restapi + frontend)..."
    cd "$HUB_REPO"
    make local-self-managed
    ;;
  stop)
    echo "Stopping Hub app..."
    pkill -f "local:self-managed\|local:client\|local:legacy" 2>/dev/null || true
    echo "Stopping Hub infrastructure..."
    docker compose -f "$COMPOSE_FILE" down
    ;;
  *)
    echo "Usage: ./docker/start-hub.sh [start|stop]"
    exit 1
    ;;
esac
