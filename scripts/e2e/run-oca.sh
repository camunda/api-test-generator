#!/usr/bin/env bash
# End-to-end driver for the camunda-oca generated suites:
#   1. generate   — positive (lifecycle) + request-validation (negatives)
#   2. run         — Playwright: positive suite + each request-validation profile
#   3. curl-compare — independent curl oracle over the request-validation profiles
#                     (compares expected vs Playwright vs curl STATUS; prints the
#                      curl response body on mismatch)
#
# OCA (Camunda 8 REST API) uses HTTP Basic auth by default (demo/demo) for the
# request-validation suite. The positive suite's vendored support module only
# attaches auth when BEARER_TOKEN is set (and only as a Bearer header — it does
# not do Basic), so the positive run is unauthenticated unless you export
# BEARER_TOKEN and your cluster accepts it.
#
# Prereqs: a Camunda 8 cluster reachable at CORE_URL (default http://localhost:8080).
#
# Env overrides (all optional):
#   CORE_URL=http://localhost:8080   CONFIG=camunda-oca
#   OCA_USER=demo  OCA_PASS=demo      (Basic auth; empty → unauthenticated)
#   BEARER_TOKEN=…                    (used by the positive suite if set)
#   RV_PROFILES="unsecured"           STEPS="generate run curl"  SKIP_POSITIVE=1
#   E2E_SOFT=1  (don't exit non-zero when the curl oracle finds mismatches)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

CONFIG="${CONFIG:-camunda-oca}"
CORE_URL="${CORE_URL:-http://localhost:8080}"
OCA_USER="${OCA_USER:-demo}"
OCA_PASS="${OCA_PASS:-demo}"
RV_PROFILES="${RV_PROFILES:-unsecured}"
STEPS="${STEPS:-generate run curl}"
RV_DIR="generated/${CONFIG}/request-validation"
OUT="test-results/e2e-${CONFIG}"; mkdir -p "$OUT"

step() { case " $STEPS " in *" $1 "*) return 0;; *) return 1;; esac; }

# Admin header for curl, mirroring the suite's authHeaders() precedence: Basic
# when both creds are set, else Bearer when BEARER_TOKEN is set, else none. This
# keeps curl-compare's requests identical to what Playwright sends (otherwise a
# BEARER_TOKEN-only run would have Playwright authenticate while curl doesn't →
# false mismatches). `tr -d '\n'`: base64 wraps at 76 cols on macOS/BSD.
b64() { printf '%s:%s' "$1" "$2" | base64 | tr -d '\n'; }
ADMIN_HEADER=""
if [ -n "$OCA_USER" ] && [ -n "$OCA_PASS" ]; then
  ADMIN_HEADER="Authorization: Basic $(b64 "$OCA_USER" "$OCA_PASS")"
elif [ -n "${BEARER_TOKEN:-}" ]; then
  ADMIN_HEADER="Authorization: Bearer ${BEARER_TOKEN}"
fi
# Deny-probe Basic header for rbac (403) scenarios. Defaults match the suite's
# env.ts denyProbeCredentials so curl-compare re-issues deny tests as the probe
# user; without it those tests would be re-issued unauthenticated (false 401s).
# `-` (not `:-`): default only when UNSET, so an explicit empty override stays
# empty → no header → curl_compare cleanly skips deny scenarios. Build the header
# only when both are non-empty (mirrors the admin Basic-auth handling above).
DENY_USER="${RBAC_DENY_PROBE_USER-rbac-deny-probe}"
DENY_PASS="${RBAC_DENY_PROBE_PASSWORD-rbac-deny-probe-pw}"
DENY_HEADER=""
if [ -n "$DENY_USER" ] && [ -n "$DENY_PASS" ]; then
  DENY_HEADER="Authorization: Basic $(b64 "$DENY_USER" "$DENY_PASS")"
fi

echo "▶ config=$CONFIG  api=$CORE_URL  steps='$STEPS'  rv-profiles='$RV_PROFILES'  auth=$([ -n "$ADMIN_HEADER" ] && echo yes || echo no)"

# ============================ 1. GENERATE ============================
if step generate; then
  echo "── generate ─────────────────────────────"
  if [ -z "${SKIP_POSITIVE:-}" ]; then
    CONFIG="$CONFIG" npm run extract-graph >/dev/null
    CONFIG="$CONFIG" npm run generate:scenarios >/dev/null
    CONFIG="$CONFIG" npm run codegen:playwright:all >/dev/null
    echo "  ✓ positive suite generated"
  fi
  CONFIG="$CONFIG" npm run generate:request-validation >/dev/null
  echo "  ✓ request-validation generated"
fi

# ====================== 2. RUN: positive =============================
if step run && [ -z "${SKIP_POSITIVE:-}" ]; then
  echo "── run: positive lifecycle suite ────────"
  API_BASE_URL="${CORE_URL}/v2" ${BEARER_TOKEN:+BEARER_TOKEN="$BEARER_TOKEN"} CONFIG="$CONFIG" \
    npx playwright test -c path-analyser/playwright.config.ts --reporter=list || true
fi

# request-validation Playwright run → JSON report per profile
run_rv() { # profile
  local p="$1" cfg="$RV_DIR/$1/playwright.config.ts"
  [ -f "$cfg" ] || { echo "  ⚠ profile '$p' not generated — skipping"; return; }
  # Set the Basic-auth env only when BOTH user and password are present — the
  # suite's authHeaders() ignores a partial credential (and warns), so exporting
  # just one would silently run unauthenticated. (`${arr[@]+…}` keeps this safe
  # under `set -u` with an empty array on bash 3.2.)
  local basic=()
  if [ -n "$OCA_USER" ] && [ -n "$OCA_PASS" ]; then
    basic=(CAMUNDA_BASIC_AUTH_USER="$OCA_USER" CAMUNDA_BASIC_AUTH_PASSWORD="$OCA_PASS")
  fi
  env CORE_APPLICATION_URL="$CORE_URL" RV_PROFILE="$p" CONFIG="$CONFIG" \
    ${basic[@]+"${basic[@]}"} \
    npx playwright test -c "$cfg" --reporter=json > "$OUT/pw-$p.json" 2>/dev/null || true
}

# ================== 2+3. RUN + CURL-COMPARE (per profile) ============
for p in $RV_PROFILES; do
  echo "── request-validation: $p ───────────────"
  if step run; then run_rv "$p"; fi
  if step curl; then
    # Tee the report to a file as well as the terminal. pipefail makes the
    # pipeline's status the oracle's (not tee's), so a mismatch still records
    # RV_FAIL; continue the loop, then fail at the end unless E2E_SOFT=1.
    python3 scripts/e2e/curl_compare.py \
      --spec-dir "$RV_DIR/$p" --base-url "$CORE_URL" --api-version v2 \
      --admin-header "$ADMIN_HEADER" --deny-header "$DENY_HEADER" \
      --pw-json "$OUT/pw-$p.json" --show-body --html "$OUT/curl-compare-$p.html" \
      2>&1 | tee "$OUT/curl-compare-$p.txt" || RV_FAIL=1
  fi
done
echo "▶ done. Playwright reports + curl-compare output under $OUT/"
if [ -n "${RV_FAIL:-}" ] && [ -z "${E2E_SOFT:-}" ]; then
  echo "✗ curl/expected mismatches detected (set E2E_SOFT=1 to treat as non-fatal)"; exit 1
fi
