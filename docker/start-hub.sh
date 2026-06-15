#!/usr/bin/env bash
# Start or stop camunda-hub (Web Modeler) in Self-Managed mode.
# Expects camunda-hub to be cloned as a sibling directory: ../camunda-hub
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HUB_REPO="$REPO_ROOT/../camunda-hub"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.hub.yml"
PID_FILE="$REPO_ROOT/test-results/.hub.pid"
LOG_FILE="$REPO_ROOT/test-results/.hub.log"

if [ ! -d "$HUB_REPO" ]; then
  echo "Error: camunda-hub not found at $HUB_REPO"
  echo "Clone it as a sibling directory: git clone git@github.com:camunda/camunda-hub.git ../camunda-hub"
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ]; then
  echo "Error: JAVA_HOME is not set. Set it to a JDK 21+ installation before running this script."
  exit 1
fi

fix_keycloak() {
  local keycloak_port="${KEYCLOAK_PORT:-18080}"
  local keycloak_url="http://localhost:${keycloak_port}"
  local token_url="${keycloak_url}/auth/realms/master/protocol/openid-connect/token"

  # docker compose up -d already waits for Keycloak to be healthy (Identity depends_on it),
  # but the management health port (9000) is not published to the host. Poll the admin token
  # endpoint on the published port instead — it becomes available once Keycloak is ready.
  # Then wait for Identity to finish initialising the camunda-platform realm and web-modeler client.
  echo "Waiting for Keycloak admin API..."
  local admin_token attempts=0
  until admin_token=$(curl -sf -X POST "$token_url" \
      -d "client_id=admin-cli&username=admin&password=admin&grant_type=password" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) \
      && [ -n "$admin_token" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Error: Keycloak admin API did not become available within 30 attempts."
      return 1
    fi
    sleep 2
  done

  echo "Waiting for Identity to initialise the camunda-platform realm..."
  local realm_url="${keycloak_url}/auth/admin/realms/camunda-platform"
  attempts=0
  until curl -sf -H "Authorization: Bearer ${admin_token}" \
      "${realm_url}/clients?clientId=web-modeler" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "Error: camunda-platform realm / web-modeler client not ready within 60 attempts."
      return 1
    fi
    # Admin token expires after 60 s — refresh it periodically
    if [ $((attempts % 25)) -eq 0 ]; then
      admin_token=$(curl -sf -X POST "$token_url" \
        -d "client_id=admin-cli&username=admin&password=admin&grant_type=password" \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) || true
    fi
    sleep 2
  done

  # 1. Fix web-modeler audience mapper: Identity seeds included.client.audience=web-modeler
  #    but the restapi validates aud=web-modeler-api. Patch the mapper to point to web-modeler-api.
  local wm_client_uuid mapper_id
  wm_client_uuid=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/clients?clientId=web-modeler" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
  mapper_id=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/clients/${wm_client_uuid}/protocol-mappers/models" \
    | python3 -c "
import sys,json
for m in json.load(sys.stdin):
    if m.get('protocolMapper') == 'oidc-audience-mapper':
        print(m['id']); break
")
  curl -sf -X PUT \
    -H "Authorization: Bearer ${admin_token}" \
    -H "Content-Type: application/json" \
    "${realm_url}/clients/${wm_client_uuid}/protocol-mappers/models/${mapper_id}" \
    -d "{
      \"id\": \"${mapper_id}\",
      \"name\": \"web-modeler Audience Mapper\",
      \"protocol\": \"openid-connect\",
      \"protocolMapper\": \"oidc-audience-mapper\",
      \"consentRequired\": false,
      \"config\": {
        \"included.client.audience\": \"web-modeler-api\",
        \"id.token.claim\": \"false\",
        \"access.token.claim\": \"true\",
        \"introspection.token.claim\": \"true\",
        \"userinfo.token.claim\": \"false\"
      }
    }" > /dev/null
  echo "Keycloak: fixed web-modeler audience mapper → web-modeler-api"

  # 2. Assign Web Modeler / Web Modeler Admin / Identity roles to the demo user.
  #    Identity creates the roles but does not assign them to seeded users.
  local demo_user_id
  demo_user_id=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/users?username=demo" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
  local roles_json
  roles_json=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/roles" \
    | python3 -c "
import sys,json
needed = {'Identity','Web Modeler','Web Modeler Admin'}
result = [{'id':r['id'],'name':r['name']} for r in json.load(sys.stdin) if r['name'] in needed]
import json as j; print(j.dumps(result))
")
  curl -sf -X POST \
    -H "Authorization: Bearer ${admin_token}" \
    -H "Content-Type: application/json" \
    "${realm_url}/users/${demo_user_id}/role-mappings/realm" \
    -d "${roles_json}" > /dev/null
  echo "Keycloak: assigned Web Modeler / Web Modeler Admin / Identity roles to demo user"
}

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ]; then
      EXISTING_PID=$(cat "$PID_FILE")
      if kill -0 "$EXISTING_PID" 2>/dev/null; then
        echo "Error: Hub app is already running (PID $EXISTING_PID). Run './docker/start-hub.sh stop' first."
        exit 1
      else
        echo "Warning: Stale PID file found (PID $EXISTING_PID is not running). Removing."
        rm -f "$PID_FILE"
      fi
    fi
    mkdir -p "$(dirname "$PID_FILE")"
    # Clear any orphaned processes on the Hub ports left by a previous unclean stop.
    hub_ui_port="${HUB_UI_PORT:-8088}"
    stale_pids=$(lsof -ti ":${hub_ui_port}" 2>/dev/null || true)
    if [ -n "$stale_pids" ]; then
      echo "Warning: Clearing orphaned processes on port ${hub_ui_port}: $stale_pids"
      echo "$stale_pids" | xargs kill 2>/dev/null || true
    fi
    echo "Starting Hub infrastructure..."
    docker compose -f "$COMPOSE_FILE" up -d
    fix_keycloak
    echo "Starting Hub app (restapi + frontend)..."
    cd "$HUB_REPO"
    make local-self-managed > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Hub app started (PID $(cat "$PID_FILE")). Logs: $LOG_FILE"
    echo "Run './docker/start-hub.sh stop' to stop."
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      MAKE_PID=$(cat "$PID_FILE")
      if kill -0 "$MAKE_PID" 2>/dev/null; then
        if ps -p "$MAKE_PID" -o args= 2>/dev/null | grep -qE "local[-:]self-managed"; then
          echo "Stopping Hub app (PID $MAKE_PID)..."
          # Kill the full process tree: make spawns npm/webpack/spring-boot as grandchildren
          # that pkill -P misses. Kill by process group so the whole subtree is reaped.
          MAKE_PGID=$(ps -p "$MAKE_PID" -o pgid= 2>/dev/null | tr -d ' ')
          if [ -n "$MAKE_PGID" ] && [ "$MAKE_PGID" != "$$" ]; then
            kill -- "-$MAKE_PGID" 2>/dev/null || true
          else
            pkill -P "$MAKE_PID" 2>/dev/null || true
            kill "$MAKE_PID" 2>/dev/null || true
          fi
        else
          echo "Warning: PID $MAKE_PID does not look like a Hub process (PID may have been recycled). Skipping kill."
        fi
      else
        echo "PID file found but process $MAKE_PID is not running (stale PID file)."
      fi
      rm -f "$PID_FILE"
    else
      echo "No PID file at $PID_FILE — Hub app may not be running."
    fi
    echo "Stopping Hub infrastructure..."
    docker compose -f "$COMPOSE_FILE" down
    ;;
  *)
    echo "Usage: ./docker/start-hub.sh [start|stop]"
    exit 1
    ;;
esac
