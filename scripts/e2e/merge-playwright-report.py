#!/usr/bin/env python3
"""Merge a second Playwright JSON reporter output's suites/stats/errors into
a base one, in place. Used by run-hub.sh to fold deleteCatalogAsset's
isolated run (its own disposable catalog-asset fixture, see #598) back into
the shared pw-positive.json so downstream nightly/PR-check triage tooling —
which expects exactly one positive-suite report — sees it as part of the
same suite.

Usage: merge-playwright-json.py <base.json> <delta.json>
"""
import json
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: merge-playwright-json.py <base.json> <delta.json>", file=sys.stderr)
        return 1
    base_path, delta_path = sys.argv[1], sys.argv[2]
    with open(base_path) as f:
        base = json.load(f)
    with open(delta_path) as f:
        delta = json.load(f)

    base["suites"] = base.get("suites", []) + delta.get("suites", [])
    base["errors"] = base.get("errors", []) + delta.get("errors", [])

    base_stats = base.setdefault(
        "stats", {"startTime": "", "duration": 0, "expected": 0, "skipped": 0, "unexpected": 0, "flaky": 0}
    )
    delta_stats = delta.get("stats", {})
    for key in ("duration", "expected", "skipped", "unexpected", "flaky"):
        base_stats[key] = base_stats.get(key, 0) + delta_stats.get(key, 0)

    with open(base_path, "w") as f:
        json.dump(base, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
