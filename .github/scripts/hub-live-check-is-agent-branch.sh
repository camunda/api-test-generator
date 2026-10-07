#!/usr/bin/env bash
# Exit 0 when the PR branch given as $1 belongs to one of our AI agents, so the automatic live-Hub check must be
# skipped for it; exit 1 for any other branch.
#
# Why: the live check checks out a same-repo PR's own code and runs it with Hub access (Vault) the moment the PR
# opens, before anyone has read the diff. A PR an agent opened contains text the agent wrote after reading
# untrusted input (issues, reports, spec descriptions), and config values it wrote end up in generated test code.
# So for these branches a person reads the diff first and then runs hub-ondemand-test.yml on the branch.
#
# Agent branches: fix/coverage-* (coverage-fix agent) and fix/nightly-triage-* (nightly triage agent). An empty or
# missing branch name fails closed (treated as an agent branch).
set -euo pipefail

ref="${1:-}"
case "$ref" in
  '' | fix/coverage-* | fix/nightly-triage-*) exit 0 ;;
  *) exit 1 ;;
esac
