#!/usr/bin/env bash
# End-to-end driver for the camunda-hub generated suites:
#   1. generate   — positive (lifecycle) + request-validation (negatives)
#   2. run         — Playwright: positive suite + each request-validation profile
#   3. curl-compare — independent curl oracle over the request-validation profiles
#                     (compares expected vs Playwright vs curl STATUS; prints the
#                      curl response body on mismatch)
#
# Hub is Bearer-authenticated, so this mints tokens from Keycloak:
#   - admin: c8-client       → BEARER_TOKEN (admin auth for 400/401 + positive)
#   - deny:  c8-client-deny   → the reduced-permission 403 probe.
#
# The deny token is consumed both by curl-compare (--deny-header) and by the
# request-validation `rbac` Playwright suite: denyProbeHeaders() emits a Bearer
# header when RBAC_DENY_PROBE_BEARER_TOKEN is set (Hub's all-secured deny mode),
# else falls back to the Basic-auth zero-grant probe user (the OCA model). Hub
# provisions no such Basic user, so the rbac Playwright run is skipped here when
# no deny token is available.
#
# Prereqs: Hub running (./docker/start-hub.sh) on HUB_UI_PORT, Keycloak on KEYCLOAK_PORT.
#
# Env overrides (all optional):
#   HUB_UI_PORT=8088  KEYCLOAK_PORT=18080  CONFIG=camunda-hub
#   RV_PROFILES="secured rbac"   STEPS="generate run curl"
#   SKIP_POSITIVE=1   (skip the positive suite)
#   E2E_SOFT=1        (don't exit non-zero when Playwright tests fail — monitoring-only)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

CONFIG="${CONFIG:-camunda-hub}"
HUB_UI_PORT="${HUB_UI_PORT:-8088}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
RV_PROFILES="${RV_PROFILES:-secured rbac}"
STEPS="${STEPS:-generate run curl}"
# TODO: remove once camunda/camunda-hub#25146 is merged
SKIP_POSITIVE="${SKIP_POSITIVE:-1}"
KC="http://localhost:${KEYCLOAK_PORT}/auth/realms/camunda-platform/protocol/openid-connect/token"
CORE_URL="http://localhost:${HUB_UI_PORT}/api"        # request-validation base (buildUrl adds /v2)
POS_URL="http://localhost:${HUB_UI_PORT}/api/v2"       # positive suite base
RV_DIR="generated/${CONFIG}/request-validation"
OUT="test-results/e2e-${CONFIG}"; mkdir -p "$OUT"

step() { case " $STEPS " in *" $1 "*) return 0;; *) return 1;; esac; }
mint() { # client_id client_secret
  # --data-urlencode each field so a client_id/secret with reserved chars
  # (& = +) can't corrupt the form body.
  curl -s -X POST "$KC" \
    --data-urlencode "client_id=$1" \
    --data-urlencode "client_secret=$2" \
    --data-urlencode "grant_type=client_credentials" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token',''))"; }

echo "▶ config=$CONFIG  hub=$POS_URL  steps='$STEPS'  rv-profiles='$RV_PROFILES'"

# --- tokens ---
# `|| true`: under set -euo pipefail a mint failure (Keycloak down / non-JSON
# response) would abort the assignment before the friendly check below runs.
ADMIN_TOK="$(mint c8-client c8-secret || true)"
[ -n "$ADMIN_TOK" ] || { echo "✗ could not mint c8-client token — is Hub/Keycloak up?"; exit 1; }
DENY_TOK="$(mint c8-client-deny c8-deny-secret || true)"
# Empty header (not `Bearer `) when the token is missing, so the oracle skips
# deny scenarios instead of re-issuing them with an invalid Authorization header.
DENY_HEADER=""; [ -n "$DENY_TOK" ] && DENY_HEADER="Authorization: Bearer $DENY_TOK"
[ -n "$DENY_TOK" ] || echo "⚠ no c8-client-deny token (rbac/403 deny scenarios will be skipped by the oracle)"

# ===== resource fixtures (#352) =====================================
# Create REAL resources so a malformed-field negative test rides on an otherwise
# valid envelope (the path key / referenced project|folder exists) and reaches
# body validation (400) instead of being short-circuited by a resource lookup
# (404) or access check (403) on a filler placeholder ('x' or '1'). The generator
# emits `process.env.RV_FIXTURE_* || '<filler>'` for these (`||` so an unset OR
# empty env var falls back; see configs/.../request-validation.json
# resourceFixtures + pathResourceFixtures). v2 createFile/createFolder/updateFile/
# updateFolder resolve the projectKey as a ProcessApplication, so the folder/file
# fixtures AND the body `projectKey` all use RV_FIXTURE_V2_PROJECT_KEY (a valid
# body 403s against a V1 projects-table id).
# Always exits 0 (prints '' on non-JSON / missing field) so a bad response can't
# abort make_fixtures under `set -euo pipefail` before the empty-key warnings run.
_jget() { python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except Exception: pass
" 2>/dev/null || true; }
make_fixtures() {
  local h=(-H "Authorization: Bearer $ADMIN_TOK" -H "Content-Type: application/json")
  # content must be valid BPMN XML — createFile rejects a non-parseable body (400).
  local bpmn='<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="Process_1" isExecutable="false"/></bpmn:definitions>'
  export RV_FIXTURE_WORKSPACE_KEY; RV_FIXTURE_WORKSPACE_KEY="$(curl -s -X POST "$POS_URL/workspaces" "${h[@]}" -d '{"name":"rv-fixture-ws"}' | _jget workspaceKey)"
  export RV_FIXTURE_V2_PROJECT_KEY; RV_FIXTURE_V2_PROJECT_KEY="$(curl -s -X POST "$POS_URL/projects" "${h[@]}" -d "$(printf '{"name":"rv-fixture-proj-v2","workspaceKey":"%s"}' "$RV_FIXTURE_WORKSPACE_KEY")" | _jget projectKey)"
  export RV_FIXTURE_FOLDER_KEY;    RV_FIXTURE_FOLDER_KEY="$(curl -s -X POST "$POS_URL/folders" "${h[@]}" -d "$(printf '{"name":"rv-fixture-folder","projectKey":"%s"}' "$RV_FIXTURE_V2_PROJECT_KEY")" | _jget folderKey)"
  local file_body; file_body="$(BPMN="$bpmn" PK="$RV_FIXTURE_V2_PROJECT_KEY" python3 -c 'import json,os; print(json.dumps({"name":"rv-fixture-file","projectKey":os.environ["PK"],"content":os.environ["BPMN"],"type":"BPMN"}))')"
  export RV_FIXTURE_FILE_KEY;      RV_FIXTURE_FILE_KEY="$(curl -s -X POST "$POS_URL/files" "${h[@]}" -d "$file_body" | _jget fileKey)"
  # VERSION_KEY is blocked on camunda/camunda-hub#25801: a file created via the
  # v2 API now lives inside a ProcessApplication (V2) project, and createVersion
  # rejects that ("Cannot create a version for file ... located inside a process
  # application", 400). There is no project that is both v2-file-creatable AND
  # versionable, so this stays empty until #25801 — restore/updateVersion path
  # tests will 404 (tracked, same block as the dropped positive Version suite).
  export RV_FIXTURE_VERSION_KEY;   RV_FIXTURE_VERSION_KEY="$(curl -s -X POST "$POS_URL/versions" "${h[@]}" -d "$(printf '{"fileKey":"%s","name":"rv-fixture-version"}' "$RV_FIXTURE_FILE_KEY")" | _jget versionKey)"
  echo "  fixtures: ws=$RV_FIXTURE_WORKSPACE_KEY v2proj=$RV_FIXTURE_V2_PROJECT_KEY folder=$RV_FIXTURE_FOLDER_KEY file=$RV_FIXTURE_FILE_KEY version=$RV_FIXTURE_VERSION_KEY"
  # Surface any failed create: an empty key means the tests fall back to the 'x'
  # filler for that resource (via `|| 'x'`) and will 404/403 as if unfixtured.
  local k var
  for k in WORKSPACE_KEY V2_PROJECT_KEY FOLDER_KEY FILE_KEY VERSION_KEY; do
    var="RV_FIXTURE_${k}"
    [ -n "${!var-}" ] || echo "  ⚠ RV_FIXTURE_${k} is empty — its create call failed; affected tests will see 404/403"
  done
}
if step run; then
  echo "── resource fixtures (#352) ──────────────"
  make_fixtures || echo "  ⚠ fixture creation failed — affected tests may see 404/403 instead of 400"
fi

# ============================ 1. GENERATE ============================
if step generate; then
  echo "── generate ─────────────────────────────"
  # Positive tests are skipped for Hub until camunda/camunda-hub#25146 is merged.
  if [ -z "${SKIP_POSITIVE:-}" ]; then
    CONFIG="$CONFIG" npm run extract-graph >/dev/null
    CONFIG="$CONFIG" npm run generate:scenarios >/dev/null
    CONFIG="$CONFIG" npm run codegen:playwright:all >/dev/null
    echo "  ✓ positive suite generated"
  fi
  CONFIG="$CONFIG" npm run generate:request-validation >/dev/null
  # find (not a glob+ls) so an empty/missing dir can't trip pipefail on this
  # purely-informational count.
  profile_count="$( { find "$RV_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true; } | wc -l | tr -d ' ')"
  echo "  ✓ request-validation generated (${profile_count} profiles)"
fi

# ====================== 2. RUN (Playwright) ==========================
unset CAMUNDA_BASIC_AUTH_USER CAMUNDA_BASIC_AUTH_PASSWORD 2>/dev/null || true
# Positive tests are skipped for Hub until camunda/camunda-hub#25146 is merged.
if step run && [ -z "${SKIP_POSITIVE:-}" ]; then
  echo "── run: positive lifecycle suite ────────"
  # POS_FIXTURE_MEMBER_EMAIL: the member email for addMember/removeMember is
  # client-minted and must be an EXISTING Hub user, so the emitted suite reads
  # `process.env.POS_FIXTURE_MEMBER_EMAIL || <seed>` (configs/camunda-hub/codegen/
  # playwright/config.json → clientMintedFixtures). Default to the seeded
  # `camunda@example.com` user Identity provisions; override for other setups.
  POS_FIXTURE_MEMBER_EMAIL="${POS_FIXTURE_MEMBER_EMAIL:-camunda@example.com}"
  # POS_FIXTURE_CATALOG_ASSET_KEY: deleteCatalogAsset targets a client-minted
  # assetKey (an element-template id) that must reference a REAL ingested asset,
  # else 404. Ingest the shipped fixture — a multipart upload with named parts
  # `readme` + `template` (ingestCatalogAssets is an orphan op with no producer
  # chain, so the suite can't self-create it) — and point the fixture var at the
  # template's own id. A failed ingest is non-fatal (the if/else below only
  # warns, so `set -e` doesn't abort the run); the test would then 404 and
  # report itself.
  CATALOG_FIX_DIR="configs/${CONFIG}/fixtures/catalog"
  POS_FIXTURE_CATALOG_ASSET_KEY="${POS_FIXTURE_CATALOG_ASSET_KEY:-$(python3 -c "import json;print(json.load(open('$CATALOG_FIX_DIR/test-catalog-asset.json'))['id'])" 2>/dev/null || true)}"
  if [ -n "$POS_FIXTURE_CATALOG_ASSET_KEY" ]; then
    if curl -sf -X PUT "$POS_URL/catalog/assets/ingestion" -H "Authorization: Bearer $ADMIN_TOK" \
      -F "readme=@${CATALOG_FIX_DIR}/readme.md;type=text/markdown" \
      -F "template=@${CATALOG_FIX_DIR}/test-catalog-asset.json;type=application/json" >/dev/null 2>&1; then
      echo "  ✓ catalog asset ingested ($POS_FIXTURE_CATALOG_ASSET_KEY)"
    else
      echo "  ⚠ catalog asset ingest failed — deleteCatalogAsset may 404"
    fi
  fi
  # POS_FIXTURE_FILE_CONTENT: createFile validates that `content` is parseable
  # for its `type` (bpmn) — the seeded placeholder is rejected 400
  # (SAXException: Content is not allowed in prolog). Provide a minimal valid
  # BPMN document; the emitted suite reads `process.env.POS_FIXTURE_FILE_CONTENT
  # || <seed>` for contentVar (configs/.../config.json → clientMintedFixtures).
  if [ -z "${POS_FIXTURE_FILE_CONTENT:-}" ]; then
    POS_FIXTURE_FILE_CONTENT='<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="Process_1" isExecutable="false"/></bpmn:definitions>'
  fi
  BEARER_TOKEN="$ADMIN_TOK" API_BASE_URL="$POS_URL" CONFIG="$CONFIG" \
    POS_FIXTURE_MEMBER_EMAIL="$POS_FIXTURE_MEMBER_EMAIL" \
    POS_FIXTURE_CATALOG_ASSET_KEY="$POS_FIXTURE_CATALOG_ASSET_KEY" \
    POS_FIXTURE_FILE_CONTENT="$POS_FIXTURE_FILE_CONTENT" \
    PLAYWRIGHT_HTML_REPORT="$OUT/pw-positive" \
    npx playwright test -c path-analyser/playwright.config.ts || true
  if [ -f "$OUT/pw-positive/index.html" ]; then
    echo "  ✓ positive suite report: $OUT/pw-positive/index.html"
  else
    echo "  ⚠ positive suite report not generated (Playwright run may have failed)"
  fi
fi

# Playwright JSON (consumed by curl-compare) + HTML report per profile.
# The generated playwright.config.ts already declares both `json` and `html`
# reporters; we redirect their outputs via env vars instead of `--reporter=json`
# (which would override the config's list and suppress the HTML report).
# Paths must be ABSOLUTE: Playwright resolves these reporter env vars relative to
# the config dir (the generated profile dir), not cwd, so a relative path would
# land the reports under generated/<config>/... instead of $OUT.
run_rv() { # profile
  local p="$1" cfg="$RV_DIR/$1/playwright.config.ts"
  [ -f "$cfg" ] || { echo "  ⚠ profile '$p' not generated — skipping"; return; }
  local abs_out; abs_out="$(cd "$OUT" && pwd)"
  # Playwright is the GATE: a non-zero exit (any spec assertion failed) sets
  # PW_FAIL, which fails the run at the end. (curl-compare below is diagnostic
  # only — it never affects pass/fail.)
  # Capture stderr to a per-profile log (kept in the uploaded artifact) rather
  # than discarding it — per-test failures go to stdout via the `list` reporter,
  # but a crash before reporting (config/runtime error) only surfaces on stderr.
  local pw_err="$abs_out/pw-$p.stderr.log"
  if BEARER_TOKEN="$ADMIN_TOK" RBAC_DENY_PROBE_BEARER_TOKEN="$DENY_TOK" \
    CORE_APPLICATION_URL="$CORE_URL" RV_PROFILE="$p" CONFIG="$CONFIG" \
    PLAYWRIGHT_JSON_OUTPUT_FILE="$abs_out/pw-$p.json" \
    PLAYWRIGHT_HTML_OUTPUT_DIR="$abs_out/pw-$p" \
    PLAYWRIGHT_JUNIT_OUTPUT_FILE="$abs_out/pw-$p.junit.xml" \
    npx playwright test -c "$cfg" 2>"$pw_err"; then
    echo "  ✓ Playwright passed: $p"
  else
    PW_FAIL=1
    echo "  ✗ Playwright reported test failures in profile '$p'"
    if [ -s "$pw_err" ]; then
      echo "  ── playwright stderr (tail) ──────────────"
      tail -n 30 "$pw_err" | sed 's/^/    /'
    fi
  fi
  if [ -f "$OUT/pw-$p/index.html" ]; then
    echo "  ✓ Playwright report: $OUT/pw-$p/index.html (json: $OUT/pw-$p.json)"
  else
    echo "  ⚠ Playwright HTML report not generated for '$p' (run may have failed)"
  fi
}

# ================== 2+3. RUN + CURL-COMPARE (per profile) ============
for p in $RV_PROFILES; do
  echo "── request-validation: $p ───────────────"
  if step run; then
    # Without a deny token the rbac Playwright suite has nothing to authenticate
    # with — skip it. curl-compare still covers rbac deny scenarios when
    # DENY_HEADER is set (else it skips them too).
    if [ "$p" = "rbac" ] && [ -z "$DENY_TOK" ]; then
      echo "  ⏭  skipping rbac Playwright run (no c8-client-deny token)"
    else
      run_rv "$p"
    fi
  fi
  if step curl; then
    # DIAGNOSTIC ONLY — the independent curl oracle (an "is the generator
    # faithful?" cross-check + response-body dump on mismatch). It never gates
    # the run: `|| true` so a mismatch is reported but does not change pass/fail.
    # Tee to a file as well as the terminal.
    python3 scripts/e2e/curl_compare.py \
      --spec-dir "$RV_DIR/$p" --base-url "$CORE_URL" --api-version v2 \
      --admin-header "Authorization: Bearer $ADMIN_TOK" \
      --deny-header "$DENY_HEADER" \
      --pw-json "$OUT/pw-$p.json" --show-body --html "$OUT/curl-compare-$p.html" \
      2>&1 | tee "$OUT/curl-compare-$p.txt" || true
  fi
done
echo "▶ done. Playwright reports + curl-compare output under $OUT/"
# Gate on Playwright (the test suite), not curl-compare. E2E_SOFT=1 keeps the
# run green even on Playwright failures (monitoring-only mode).
if [ -n "${PW_FAIL:-}" ] && [ -z "${E2E_SOFT:-}" ]; then
  echo "✗ Playwright test failures detected (set E2E_SOFT=1 to treat as non-fatal)"; exit 1
fi
