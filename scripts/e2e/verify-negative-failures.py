#!/usr/bin/env python3
"""
Live curl-replay verification for the camunda-hub nightly triage agent (#482).

For every FAILING negative-suite test in the downloaded Playwright JSON
report (pw-secured.json / pw-rbac.json), reconstructs the exact request the
generated test built and replays it via curl against a freshly-started,
separate live Hub — so the triage agent can tell a genuine, still-
reproducing product-bug candidate apart from flakiness or a since-fixed
regression, before filing a real issue on camunda-hub.

Evidence comes entirely from the request.json/response.json testInfo
attachments (request-validation/templates/support/http.ts) EMBEDDED INLINE
(base64) in the JSON reporter's own output — confirmed against this repo's
own request-validation/templates/scripts/summarize-failures.mjs, which reads
attachments the exact same way. This script deliberately does NOT read
generated *.spec.ts source (unlike curl_compare.py, its closest sibling) —
the triage workspace never has it (a gitignored build artifact, absent
there) — and does NOT rely on any Playwright trace: both suite configs set
`trace: 'off'`, so there is none to read.

Auth headers are reconstructed from a closed, verified mapping keyed on
scenarioKind + JSON-body presence — traced directly from
request-validation/src/emit/qaEmitter.ts's own header-builder selection
(lines ~329-346), so it can't drift from what the generator actually emits.
scenarioKind is a closed vocabulary the generator alone defines (see
SCENARIO_KINDS in request-validation/src/model/types.ts), so this mapping
only needs updating if that emitter logic itself changes.

This tool only re-verifies a STATUS-code contradiction. A failure whose
`response.json` shows a body-SHAPE violation (assertResponseStatus's
ProblemDetail check) at the SAME status code as expected cannot be
confirmed/refuted by re-checking the numeric status alone — those are
flagged explicitly (confirmed: null) rather than silently misreporting a
resolved-looking false negative.

Usage:
  verify-negative-failures.py --reports-dir <dir> --base-url <url> \
    --kc-url <keycloak-token-endpoint> --out <curl-verification.json>
"""
import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

# Same-directory import — curl_compare.py is a plain script, not a package,
# but Python resolves this fine since both files live in scripts/e2e/. Reuses
# its run_curl() (the actual curl invocation + status/body extraction) rather
# than re-implementing it a second time.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curl_compare import run_curl  # noqa: E402


def mint(kc_url: str, client_id: str, client_secret: str) -> str:
    """Mints a Keycloak access token. Mirrors scripts/e2e/run-hub.sh's own
    mint() bash function exactly (same client-credentials grant, same
    --data-urlencode fields) — kept as a small, clearly-labeled port rather
    than a cross-language import, since bash and Python can't share a
    function directly."""
    try:
        proc = subprocess.run(
            [
                "curl", "-s", "-X", "POST", kc_url,
                "--data-urlencode", f"client_id={client_id}",
                "--data-urlencode", f"client_secret={client_secret}",
                "--data-urlencode", "grant_type=client_credentials",
            ],
            capture_output=True, text=True, timeout=30,
        )
        return json.loads(proc.stdout).get("access_token", "")
    except Exception:
        return ""


def walk_suites(suites, out, file_hint=None):
    """Ported from summarize-failures.mjs's walkSuites() — same shape, same
    "final attempt only" rule (a flaky test that eventually passed under
    retries would otherwise leave a stale failed entry)."""
    for suite in suites:
        file = suite.get("file", file_hint)
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                results = test.get("results") or []
                if not results:
                    continue
                result = results[-1]
                if result.get("status") in ("passed", "skipped"):
                    continue
                ctx = extract_context(result)
                if ctx is not None:
                    ctx["title"] = spec.get("title")
                    ctx["file"] = file
                    out.append(ctx)
        if suite.get("suites"):
            walk_suites(suite["suites"], out, file)


def extract_context(result):
    """Ported from summarize-failures.mjs's extractContext() — same
    base64-decode + JSON-parse of the request.json/response.json
    attachments. Returns None (skip) when there's no request.json (nothing
    to replay — e.g. a failure with only a scraped error message)."""
    req = None
    resp = None
    for att in result.get("attachments") or []:
        if att.get("contentType") != "application/json" or not att.get("body"):
            continue
        try:
            parsed = json.loads(base64.b64decode(att["body"]).decode("utf-8"))
        except Exception:
            continue
        if att.get("name") == "request.json":
            req = parsed
        elif att.get("name") == "response.json":
            resp = parsed
    if req is None:
        return None
    return {"request": req, "response": resp}


def rebase_url(original_url: str, base_url: str) -> str:
    """Replace original_url's scheme+host with base_url's scheme+host,
    keeping the captured path+query unchanged. buildUrl()'s own path
    structure (/v2/...) is identical between the original nightly run and
    this replay — same generator, same spec — but the ORIGINAL Hub is
    already stopped by the time this runs, and this replay's freshly-
    started Hub isn't guaranteed to land on the same host/port. Re-basing
    only the host, never the path, is what lets --base-url actually matter
    instead of silently trusting whatever host the original run happened to
    use."""
    new = urlsplit(base_url)
    orig = urlsplit(original_url)
    return urlunsplit((new.scheme, new.netloc, orig.path, orig.query, orig.fragment))


AUTH_INVALID_HEADER = "Authorization: Bearer invalid-token"


def build_headers(scenario_kind, has_json_body, admin_header, deny_header):
    """Mirrors request-validation/src/emit/qaEmitter.ts's own header-builder
    selection (lines ~329-346) — kept in sync deliberately, not re-derived
    independently, since scenarioKind is a closed, fixed vocabulary only the
    generator defines. Returns None when the scenario needs a credential
    this run doesn't have (auth-deny with no deny token available) — the
    caller treats that as "cannot verify", not "no headers"."""
    if scenario_kind == "auth-invalid":
        return [AUTH_INVALID_HEADER]
    if scenario_kind == "auth-deny":
        return [deny_header] if deny_header else None
    if scenario_kind == "auth-absent":
        return []
    # Every other kind: admin auth, +Content-Type when there's a JSON body.
    # jsonHeaders()/authHeaders() both use the SAME admin token — the only
    # difference is Content-Type, and a multipart request sets its own
    # Content-Type via curl -F (handled by run_curl, not here).
    headers = [admin_header] if admin_header else []
    if has_json_body:
        headers = ["Content-Type: application/json"] + headers
    return headers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports-dir", required=True,
                     help="Directory containing pw-secured.json / pw-rbac.json")
    ap.add_argument("--base-url", required=True,
                     help="Hub core API base (buildUrl adds /v2), e.g. http://localhost:8088/api")
    ap.add_argument("--kc-url", required=True, help="Keycloak token endpoint")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    failures = []
    for name in ("pw-secured.json", "pw-rbac.json"):
        p = Path(args.reports_dir) / name
        if not p.exists():
            continue
        try:
            report = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"::warning::Could not parse {p}: {e}", file=sys.stderr)
            continue
        walk_suites(report.get("suites", []), failures)

    if not failures:
        print("No failing negative-suite tests with request.json evidence — nothing to verify.")
        Path(args.out).write_text("{}\n")
        return

    admin_tok = mint(args.kc_url, "c8-client", "c8-secret")
    if not admin_tok:
        print("::error::Could not mint admin token — is the fresh Hub/Keycloak actually up?",
              file=sys.stderr)
        Path(args.out).write_text("{}\n")
        sys.exit(1)
    admin_header = f"Authorization: Bearer {admin_tok}"
    deny_tok = mint(args.kc_url, "c8-client-deny", "c8-deny-secret")
    deny_header = f"Authorization: Bearer {deny_tok}" if deny_tok else None
    if not deny_tok:
        print("⚠ no c8-client-deny token — auth-deny candidates will be left unverified",
              file=sys.stderr)

    results = {}
    for f in failures:
        req = f["request"]
        resp = f.get("response") or {}
        op = req.get("operationId", "?")
        kind = req.get("scenarioKind", "?")
        key = f"{op}::{kind}::{f.get('title', '?')}"
        method = req.get("method")
        captured_url = req.get("url")
        expected = req.get("expectedStatus")
        if not (method and captured_url and expected is not None):
            continue
        # Re-host onto THIS run's fresh Hub — the nightly's own Hub (where
        # captured_url's host/port came from) is already stopped, and this
        # replay's Hub isn't guaranteed to share it.
        url = rebase_url(captured_url, args.base_url)

        # This tool only re-verifies a STATUS-code contradiction. A body-
        # SHAPE-only failure (status already matched expected; the
        # ProblemDetail shape check is what failed) can't be confirmed or
        # refuted by re-checking the status alone — flag explicitly rather
        # than silently reporting a misleading confirmed:false.
        original_status = resp.get("status")
        was_status_mismatch = original_status is not None and original_status != expected
        if not was_status_mismatch and resp.get("shapeErrors"):
            results[key] = {
                "confirmed": None,
                "error": "original failure was a response-shape violation at the expected "
                         "status, not a status mismatch — this tool only re-verifies status "
                         "codes, not response body shape",
            }
            continue

        has_json_body = req.get("body") is not None and req.get("multipart") is None
        headers = build_headers(kind, has_json_body, admin_header, deny_header)
        if headers is None:
            results[key] = {
                "confirmed": None,
                "error": "no deny token available — could not verify this auth-deny scenario",
            }
            continue

        body_json = json.dumps(req["body"]) if req.get("body") is not None else None
        multipart = req.get("multipart")
        code, curl_body = run_curl(method, url, headers, body_json, multipart)
        if code is None:
            results[key] = {"confirmed": None, "error": f"curl could not reach the server: {curl_body}"}
            continue

        results[key] = {
            # True = curl STILL contradicts the spec the same way the
            # original failure did — a genuinely reproducing candidate.
            # False = curl now gets the expected status — likely flaky or a
            # since-fixed regression; don't file.
            "confirmed": code != expected,
            "curlStatus": code,
            "expectedStatus": expected,
            "curlBody": (curl_body or "")[:2000],
        }

    Path(args.out).write_text(json.dumps(results, indent=2) + "\n")
    n_confirmed = sum(1 for r in results.values() if r.get("confirmed") is True)
    n_unconfirmed = sum(1 for r in results.values() if r.get("confirmed") is False)
    n_unverifiable = sum(1 for r in results.values() if r.get("confirmed") is None)
    print(
        f"Verified {len(results)} failing test(s): {n_confirmed} still reproduce, "
        f"{n_unconfirmed} no longer reproduce, {n_unverifiable} could not be verified — "
        f"wrote {args.out}"
    )


if __name__ == "__main__":
    main()
