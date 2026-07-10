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

# Preconditions for building/running the Hub app. Only `start` needs these;
# `stop` just kills the PID and tears down Docker, so it must not require them.
check_start_preconditions() {
  # The prebuilt path runs the published camunda/hub image via docker compose, so
  # it needs none of the source-build deps (make, the ../camunda-hub clone, a JDK).
  local prebuilt=false
  [ "${HUB_MODE:-source}" = "prebuilt" ] && prebuilt=true

  local required=(docker curl python3 lsof)
  [ "$prebuilt" = true ] || required+=(make)

  local missing=()
  for cmd in "${required[@]}"; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Error: required command(s) not found on PATH: ${missing[*]}"
    exit 1
  fi

  # Source build only: needs the camunda-hub repo checked out + a JDK.
  if [ "$prebuilt" = false ]; then
    if [ ! -d "$HUB_REPO" ]; then
      echo "Error: camunda-hub not found at $HUB_REPO"
      echo "Clone it as a sibling directory: git clone git@github.com:camunda/camunda-hub.git ../camunda-hub"
      exit 1
    fi
    if [ -z "${JAVA_HOME:-}" ]; then
      echo "Error: JAVA_HOME is not set. Set it to a JDK 21+ installation before running this script."
      exit 1
    fi
  fi
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
  # Wait for c8-client-deny — the LAST test client Identity provisions (web-modeler
  # and c8-client come before it). Waiting on web-modeler alone let the script race
  # ahead before c8-client-deny existed → "deny client not found" + a downstream
  # IndexError that crashed start-hub. Gating on c8-client-deny ensures all three
  # (web-modeler, c8-client, c8-client-deny) are present before we touch them.
  until curl -sf -H "Authorization: Bearer ${admin_token}" \
      "${realm_url}/clients?clientId=c8-client-deny" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "Error: camunda-platform realm / c8-client-deny not ready within 60 attempts."
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

  # 2b. Give the reduced-permission deny client (c8-client-deny) a web-modeler-api
  #     audience. Identity derives a token's audience from its granted public-api
  #     permissions; this client has none (so it is denied 403), which would also
  #     leave its token without aud=web-modeler-api and make the restapi reject it
  #     with 401. Adding the audience mapper explicitly lets the token authenticate
  #     and reach the authorization (403) gate — the whole point of the rbac probe.
  local deny_client_uuid
  deny_client_uuid=$(curl -sf -H "Authorization: Bearer ${admin_token}" \
    "${realm_url}/clients?clientId=c8-client-deny" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
  if [ -n "$deny_client_uuid" ]; then
    local deny_mapper_status
    deny_mapper_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      -H "Authorization: Bearer ${admin_token}" \
      -H "Content-Type: application/json" \
      "${realm_url}/clients/${deny_client_uuid}/protocol-mappers/models" \
      -d '{
        "name": "web-modeler-api audience (deny client)",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "consentRequired": false,
        "config": {
          "included.client.audience": "web-modeler-api",
          "id.token.claim": "false",
          "access.token.claim": "true",
          "introspection.token.claim": "true",
          "userinfo.token.claim": "false"
        }
      }')
    case "$deny_mapper_status" in
      201) echo "Keycloak: added web-modeler-api audience mapper to c8-client-deny" ;;
      409) echo "Keycloak: c8-client-deny already has web-modeler-api audience mapper (skipped)" ;;
      *)   echo "Keycloak: failed to add audience mapper to c8-client-deny (HTTP $deny_mapper_status)" >&2; return 1 ;;
    esac
    # The PUBLIC API (/api/v2) validates aud=web-modeler-public-api specifically.
    # The admin client gets it from its granted permissions; the deny client has
    # none, so without an explicit mapper its token lacks that audience and the
    # public API rejects it 401 (not the 403 the rbac probe expects). Identity may
    # add a realm-wide mapper eventually, but that is async — a fast CI run mints
    # the deny token before it lands. Add it explicitly so 403 is deterministic.
    local deny_pub_mapper_status
    deny_pub_mapper_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      -H "Authorization: Bearer ${admin_token}" \
      -H "Content-Type: application/json" \
      "${realm_url}/clients/${deny_client_uuid}/protocol-mappers/models" \
      -d '{
        "name": "web-modeler-public-api audience (deny client)",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "consentRequired": false,
        "config": {
          "included.client.audience": "web-modeler-public-api",
          "id.token.claim": "false",
          "access.token.claim": "true",
          "introspection.token.claim": "true",
          "userinfo.token.claim": "false"
        }
      }')
    case "$deny_pub_mapper_status" in
      201) echo "Keycloak: added web-modeler-public-api audience mapper to c8-client-deny" ;;
      409) echo "Keycloak: c8-client-deny already has web-modeler-public-api audience mapper (skipped)" ;;
      *)   echo "Keycloak: failed to add public-api audience mapper to c8-client-deny (HTTP $deny_pub_mapper_status)" >&2; return 1 ;;
    esac
  else
    echo "Warning: c8-client-deny not found — rbac (403) deny tests will not authenticate."
  fi

  # 2c. Assign Web Modeler / Web Modeler Admin / Identity roles to the demo user.
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
    # HUB_MODE=prebuilt: run the published camunda/hub image (compose `prebuilt`
    # profile) instead of building from source — fast, no JDK/source-build deps.
    # The container is managed by docker compose, so there's no make PID to track;
    # `stop` tears it down via `docker compose down`.
    if [ "${HUB_MODE:-source}" = "prebuilt" ]; then
      # Resolve the Hub image ref HERE (bash handles nested defaults reliably;
      # Compose interpolation does not, across versions) so docker-compose.hub.yml
      # only needs a single-level ${HUB_IMAGE:-…}. Precedence: explicit HUB_IMAGE
      # (full registry/repo/tag, e.g. the PR check's pr-<sha>) > HUB_IMAGE_TAG on
      # the public repo > SNAPSHOT.
      export HUB_IMAGE="${HUB_IMAGE:-camunda/hub:${HUB_IMAGE_TAG:-SNAPSHOT}}"
      echo "Hub image: ${HUB_IMAGE}"
      # Bring up only the hub + its deps (NOT websockets — it's a private image
      # the suite doesn't need; excluding it keeps the prebuilt path free of any
      # Camunda registry credentials since camunda/hub itself is public).
      # Retry to absorb transient Docker Hub pull errors ("Get …/manifests/…:
      # unknown"); `docker compose up -d` is idempotent, so a retry just resumes.
      compose_attempts=0
      until docker compose -f "$COMPOSE_FILE" --profile prebuilt up -d \
            modeler-db keycloak-db identity-db keycloak identity mailpit hub; do
        compose_attempts=$((compose_attempts + 1))
        if [ "$compose_attempts" -ge 3 ]; then
          echo "Error: docker compose up failed after ${compose_attempts} attempts." >&2
          exit 1
        fi
        echo "compose up failed (likely a transient registry pull error) — retry ${compose_attempts}/3 in 15s..."
        sleep 15
      done
      fix_keycloak
      echo "Hub app: prebuilt image camunda/hub:${HUB_IMAGE_TAG:-SNAPSHOT} (container 'hub')."
      echo "Run './docker/start-hub.sh stop' to stop."
      exit 0
    fi
    docker compose -f "$COMPOSE_FILE" up -d
    fix_keycloak
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
    echo "Hub app started (PID $MAKE_PID). Logs: $LOG_FILE"
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
  *)
    echo "Usage: ./docker/start-hub.sh [start|stop]"
    exit 1
    ;;
esac
