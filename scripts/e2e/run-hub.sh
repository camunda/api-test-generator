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
# NOTE: on the current codebase the deny token is consumed ONLY by curl-compare
# (passed as --deny-header). The request-validation `rbac` Playwright suite's
# denyProbeHeaders() is Basic-auth only and does not read a Bearer token yet
# (that support is in the unmerged 403/auth-deny work), so the rbac Playwright
# run is skipped here when no deny token is available.
#
# Prereqs: Hub running (./docker/start-hub.sh) on HUB_UI_PORT, Keycloak on KEYCLOAK_PORT.
#
# Env overrides (all optional):
#   HUB_UI_PORT=8088  KEYCLOAK_PORT=18080  CONFIG=camunda-hub
#   RV_PROFILES="secured rbac"   STEPS="generate run curl"
#   SKIP_POSITIVE=1   (skip the positive suite)
#   E2E_SOFT=1        (don't exit non-zero when the curl oracle finds mismatches)
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
  BEARER_TOKEN="$ADMIN_TOK" API_BASE_URL="$POS_URL" CONFIG="$CONFIG" \
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
  BEARER_TOKEN="$ADMIN_TOK" RBAC_DENY_PROBE_BEARER_TOKEN="$DENY_TOK" \
    CORE_APPLICATION_URL="$CORE_URL" RV_PROFILE="$p" CONFIG="$CONFIG" \
    PLAYWRIGHT_JSON_OUTPUT_FILE="$abs_out/pw-$p.json" \
    PLAYWRIGHT_HTML_OUTPUT_DIR="$abs_out/pw-$p" \
    npx playwright test -c "$cfg" 2>/dev/null || true
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
    # Tee the report to a file as well as the terminal. pipefail makes the
    # pipeline's status the oracle's (not tee's), so a mismatch still records
    # RV_FAIL; continue the loop, then fail at the end unless E2E_SOFT=1.
    python3 scripts/e2e/curl_compare.py \
      --spec-dir "$RV_DIR/$p" --base-url "$CORE_URL" --api-version v2 \
      --admin-header "Authorization: Bearer $ADMIN_TOK" \
      --deny-header "$DENY_HEADER" \
      --pw-json "$OUT/pw-$p.json" --show-body --html "$OUT/curl-compare-$p.html" \
      2>&1 | tee "$OUT/curl-compare-$p.txt" || RV_FAIL=1
  fi
done
echo "▶ done. Playwright reports + curl-compare output under $OUT/"
if [ -n "${RV_FAIL:-}" ] && [ -z "${E2E_SOFT:-}" ]; then
  echo "✗ curl/expected mismatches detected (set E2E_SOFT=1 to treat as non-fatal)"; exit 1
fi
