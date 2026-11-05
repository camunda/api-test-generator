#!/usr/bin/env bash
# Resolve the GitHub login of the person who last touched an operation's
# definition in the camunda-hub OpenAPI spec — so a nightly generator-fix PR
# can be assigned to "the person who added the endpoint" (handover call,
# 2026-10-28: a generator gap "belongs end-to-end" to whoever added the op).
#
#   GH_TOKEN=<camunda-hub Contents:Read token> \
#     hub-endpoint-author.sh <operationId> <camunda-hub-checkout-dir>
#
# Prints one GitHub login on stdout, or NOTHING when it cannot resolve a human
# owner: operationId not found in the spec, no git history for the line, the
# commit email isn't linked to a GitHub account, or the author is a bot/app.
# It never exits non-zero for "not found" — the caller treats empty output as
# "fall back to @camunda/hub" (the CODEOWNERS default), so attribution is a
# best-effort improvement that can never make the run worse.
#
# Scope note: the caller must only invoke this for a test-generation / unmapped-
# operation fix (a newly added or changed endpoint), where blaming the op's
# spec line cleanly identifies who added it. It must NOT be used for a product-
# bug suppress PR: a real regression is often not in the endpoint's own spec, so
# blame would mis-attribute — those keep @camunda/hub review.
set -uo pipefail

op="${1:-}"
hub="${2:-}"
if [ -z "$op" ] || [ -z "$hub" ]; then
  echo "usage: hub-endpoint-author.sh <operationId> <camunda-hub-checkout-dir>" >&2
  exit 2
fi

# operationId is interpolated into a grep pattern below; only accept the
# characters a real operationId uses so nothing in it can be interpreted.
case "$op" in
  *[!A-Za-z0-9_]* | '') exit 0 ;;
esac

[ -d "$hub/.git" ] || exit 0
spec_dir="restapi/public-api/src/main/resources/openapi/v2"
[ -d "$hub/$spec_dir" ] || exit 0

# Find the spec file + line that declares this operationId. An operationId is
# unique across the spec, so the first exact "operationId: <op>" line wins.
match=$(cd "$hub" && grep -rnE "^[[:space:]]*operationId:[[:space:]]+${op}[[:space:]]*$" \
  "$spec_dir" 2>/dev/null | head -1)
[ -n "$match" ] || exit 0
file="${match%%:*}"
rest="${match#*:}"
line="${rest%%:*}"
case "$line" in '' | *[!0-9]*) exit 0 ;; esac

# The commit that last touched that exact line = the commit that added/changed
# the operation. --porcelain's first field of the first line is the SHA.
sha=$(cd "$hub" && git blame -L "${line},${line}" --porcelain -- "$file" 2>/dev/null \
  | head -1 | awk '{print $1}')
case "$sha" in '' | *[!0-9a-f]*) exit 0 ;; esac

# Map the commit -> GitHub login (the author, not the committer). Needs a token
# with Contents:Read on camunda-hub; `.author` is null when the commit email is
# not linked to any GitHub account, in which case we fall through to empty.
login=$(gh api "repos/camunda/camunda-hub/commits/${sha}" \
  --jq '.author.login // ""' 2>/dev/null || true)

# A bot/app actor or an empty login can't own a review — fall back to the team.
case "$login" in
  '' | *'[bot]' | app/*) exit 0 ;;
  *[!A-Za-z0-9-]*) exit 0 ;;
esac
printf '%s\n' "$login"
