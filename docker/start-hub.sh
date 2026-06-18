#!/usr/bin/env bash
# Start, stop, or check the status of camunda-hub (Web Modeler) in Self-Managed mode.
# Expects camunda-hub to be cloned as a sibling directory: ../camunda-hub
#
# Usage:
#   ./docker/start-hub.sh [start|stop|status]
#
# Environment variables (all optional):
#   HUB_UI_PORT      Frontend port (default: 8088)
#   KEYCLOAK_PORT    Keycloak port (default: 18080)
#   JAVA_HOME        Must point to a JDK 21+ installation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HUB_REPO="$REPO_ROOT/../camunda-hub"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.hub.yml"
PID_FILE="$REPO_ROOT/test-results/.hub.pid"
LOG_FILE="$REPO_ROOT/test-results/.hub.log"

# Preconditions for building/running the Hub app. Only `start` needs these;
# `stop` just kills the PID and tears down Docker, so it must not require them.
check_start_preconditions() {
  local missing=()
  for cmd in docker curl python3 lsof make npm; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Error: required command(s) not found on PATH: ${missing[*]}"
    exit 1
  fi
  if [ ! -d "$HUB_REPO" ]; then
    echo "Error: camunda-hub not found at $HUB_REPO"
    echo "Clone it as a sibling directory: git clone git@github.com:camunda/camunda-hub.git ../camunda-hub"
    exit 1
  fi
  if [ -z "${JAVA_HOME:-}" ]; then
    echo "Error: JAVA_HOME is not set. Set it to a JDK 21+ installation before running this script."
    exit 1
  fi
}

# Sync frontend node_modules to the lockfile before starting the dev server.
# This prevents stale installs (e.g. a package updated in package-lock.json but
# not yet reflected in node_modules) from causing webpack compile failures.
sync_frontend_deps() {
  echo "Syncing frontend dependencies (npm ci)..."
  # Capture output so a genuine `npm ci` failure aborts (declare then assign —
  # `local log=$(...)` would mask the command's exit status behind `local`'s).
  # The previous `… | grep … || true` pipeline swallowed failures and still
  # printed success, risking a start with broken frontend deps.
  local log
  if ! log="$(npm ci --workspace=apps/hub --prefix "$HUB_REPO/frontend" 2>&1)"; then
    echo "$log" | grep -v "^npm warn\|^npm notice" || true
    echo "Error: 'npm ci' failed for the Hub frontend (see output above)." >&2
    return 1
  fi
  echo "$log" | grep -v "^npm warn\|^npm notice" || true
  echo "Frontend dependencies up to date."
}

# Poll until the Hub UI responds successfully. `curl -sf` treats any 2xx/3xx as
# success and only fails on HTTP >= 400 (or connection errors), so this waits for
# the login page to be served (a redirect counts as ready).
wait_for_ready() {
  local hub_ui_port="${HUB_UI_PORT:-8088}"
  local url="http://localhost:${hub_ui_port}/login"
  local attempts=0
  echo "Waiting for Hub UI at ${url}..."
  until curl -sf -o /dev/null "$url"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 90 ]; then
      echo "Error: Hub UI did not become ready within 90 attempts (≈3 min). Check $LOG_FILE for details."
      return 1
    fi
    sleep 2
  done
  echo "Hub UI is ready at http://localhost:${hub_ui_port}"
}

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

  # 2a. Idempotently add web-modeler-api audience mapper to c8-client (M2M test client).
  #     The API test suite authenticates as c8-client; its JWT must carry aud=web-modeler-api
  #     so the restapi's resource-server security accepts it for /v2/* endpoints.
  local c8_client_uuid
  c8_client_uuid=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/clients?clientId=c8-client" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
  if [ -n "$c8_client_uuid" ]; then
    local already_has_mapper
    already_has_mapper=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
      "${realm_url}/clients/${c8_client_uuid}/protocol-mappers/models" \
      | python3 -c "
import sys,json
for m in json.load(sys.stdin):
    if m.get('config',{}).get('included.client.audience') == 'web-modeler-api':
        print('yes'); break
") || true
    if [ "${already_has_mapper:-}" != "yes" ]; then
      curl -sf -X POST \
        -H "Authorization: Bearer ${admin_token}" \
        -H "Content-Type: application/json" \
        "${realm_url}/clients/${c8_client_uuid}/protocol-mappers/models" \
        -d '{
          "name": "web-modeler-api Audience Mapper",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": {
            "included.client.audience": "web-modeler-api",
            "access.token.claim": "true",
            "id.token.claim": "false"
          }
        }' > /dev/null
      echo "Keycloak: added web-modeler-api audience mapper to c8-client"
    else
      echo "Keycloak: c8-client already has web-modeler-api audience mapper (skipped)"
    fi
  fi

  # 2b. Assign Web Modeler / Web Modeler Admin / Identity roles to the demo user.
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
    check_start_preconditions
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
    # The stack is up now; if frontend-dep sync or Keycloak setup fails, tear it
    # back down so a failed start doesn't leave a half-started environment
    # (ports bound, containers running) behind.
    if ! sync_frontend_deps || ! fix_keycloak; then
      echo "Error: Hub setup failed — tearing down infrastructure." >&2
      docker compose -f "$COMPOSE_FILE" down || true
      exit 1
    fi
    echo "Starting Hub app (restapi + frontend)..."
    cd "$HUB_REPO"
    # Launch make in its OWN process group (job-control mode) so the recorded PID
    # is also the process-group ID. stop can then signal the whole subtree via
    # `kill -- -PID` without any risk of hitting the caller's shell/terminal.
    set -m
    make local-self-managed > "$LOG_FILE" 2>&1 &
    MAKE_PID=$!
    set +m
    echo "$MAKE_PID" > "$PID_FILE"
    # Detect an immediate failure (bad config, missing deps): make backgrounded with
    # set -e won't surface it, so check the process is still alive after a moment.
    sleep 2
    if ! kill -0 "$MAKE_PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Error: Hub app exited immediately. Check $LOG_FILE for details."
      exit 1
    fi
    echo "Hub app starting (PID $MAKE_PID). Logs: $LOG_FILE"
    # If the UI never comes up, don't leave the app process + docker stack running
    # with a stale PID file — reuse the stop path to tear everything down.
    if ! wait_for_ready; then
      echo "Error: Hub UI did not become ready — tearing down. Check $LOG_FILE." >&2
      "$0" stop || true
      exit 1
    fi
    echo "Run './docker/start-hub.sh stop' to stop."
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      MAKE_PID=$(cat "$PID_FILE")
      if kill -0 "$MAKE_PID" 2>/dev/null; then
        if ps -p "$MAKE_PID" -o args= 2>/dev/null | grep -qE "local[-:]self-managed"; then
          echo "Stopping Hub app (PID $MAKE_PID)..."
          # start launches make as its own process-group leader (set -m), so the
          # recorded PID is also the PGID. `kill -- -PID` reaps the whole subtree
          # (make + npm/webpack/spring-boot) and can never hit the caller's shell.
          # Only fall back to a single-PID kill if this group is somehow gone.
          if [ "$(ps -p "$MAKE_PID" -o pgid= 2>/dev/null | tr -d ' ')" = "$MAKE_PID" ]; then
            kill -- "-$MAKE_PID" 2>/dev/null || true
          else
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
  status)
    hub_ui_port="${HUB_UI_PORT:-8088}"
    echo "=== Hub status ==="
    if [ -f "$PID_FILE" ]; then
      MAKE_PID=$(cat "$PID_FILE")
      if kill -0 "$MAKE_PID" 2>/dev/null; then
        echo "App process : running (PID $MAKE_PID)"
      else
        echo "App process : stopped (stale PID file — run start)"
      fi
    else
      echo "App process : no PID file (not started via this script)"
    fi
    if curl -sf -o /dev/null "http://localhost:${hub_ui_port}/login" 2>/dev/null; then
      echo "Hub UI      : http://localhost:${hub_ui_port}  ✓ responding"
    else
      echo "Hub UI      : http://localhost:${hub_ui_port}  ✗ not responding"
    fi
    if curl -sf -o /dev/null "http://localhost:${KEYCLOAK_PORT:-18080}/auth/" 2>/dev/null; then
      echo "Keycloak    : http://localhost:${KEYCLOAK_PORT:-18080}  ✓ responding"
    else
      echo "Keycloak    : http://localhost:${KEYCLOAK_PORT:-18080}  ✗ not responding"
    fi
    echo "Logs        : $LOG_FILE"
    ;;
  *)
    echo "Usage: ./docker/start-hub.sh [start|stop|status]"
    exit 1
    ;;
esac
