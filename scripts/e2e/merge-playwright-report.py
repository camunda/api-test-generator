#!/usr/bin/env python3
"""Merge a second Playwright reporter output into a base one, in place.
Handles both the JSON reporter (.json) and the JUnit reporter (.xml).  Used
by run-hub.sh to fold deleteCatalogAsset's isolated run (its own disposable
catalog-asset fixture, see #598) back into the shared pw-positive.{json,junit.xml}
so downstream tooling that expects exactly one positive-suite report sees it
as part of the same suite — including the nightly's TestRail JUnit publish
step, which reads the JUnit file directly.

If the base report is missing (the main pass crashed before writing any
output — already a failure the caller has recorded), this reports that
clearly and exits non-zero without a raw traceback, so callers can decide
whether to treat it as fatal rather than aborting the whole script on an
unhandled exception.

Usage: merge-playwright-report.py <base> <delta>
"""
import json
import sys
import xml.etree.ElementTree as ET


def merge_json(base_path: str, delta_path: str) -> None:
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


def merge_junit(base_path: str, delta_path: str) -> None:
    base_tree = ET.parse(base_path)
    base_root = base_tree.getroot()
    delta_root = ET.parse(delta_path).getroot()

    for testsuite in delta_root.findall("testsuite"):
        base_root.append(testsuite)

    for attr in ("tests", "failures", "skipped", "errors"):
        base_val = int(base_root.get(attr, "0") or "0")
        delta_val = int(delta_root.get(attr, "0") or "0")
        base_root.set(attr, str(base_val + delta_val))
    base_time = float(base_root.get("time", "0") or "0")
    delta_time = float(delta_root.get("time", "0") or "0")
    base_root.set("time", str(base_time + delta_time))

    base_tree.write(base_path, encoding="unicode", xml_declaration=False)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: merge-playwright-report.py <base> <delta>", file=sys.stderr)
        return 1
    base_path, delta_path = sys.argv[1], sys.argv[2]

    try:
        if base_path.endswith(".json"):
            merge_json(base_path, delta_path)
        elif base_path.endswith(".xml"):
            merge_junit(base_path, delta_path)
        else:
            print(f"error: unrecognized report extension for {base_path!r} (expected .json or .xml)", file=sys.stderr)
            return 1
    except FileNotFoundError as e:
        print(f"error: could not merge {delta_path!r} into {base_path!r} — {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
