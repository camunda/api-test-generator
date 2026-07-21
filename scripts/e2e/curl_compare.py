#!/usr/bin/env python3
"""
Independent curl oracle for the generated request-validation suite.

For each generated negative test it re-issues the SAME request with curl
(method, URL, headers, body reconstructed from the emitted .spec.ts) and
compares per test:

    expected   — the status the generator asserts (assertResponseStatus arg)
    playwright — the result Playwright observed (from its JSON report, optional)
    curl       — the status curl observes now

Mismatches are flagged; with --show-body the curl response body is printed for
any test whose curl status != expected. Exits non-zero on any mismatch.

It does NOT import the suite's own code — a true cross-check oracle. To stay
faithful to the suite it does, however, reconstruct the URL by running the
EXACT `buildUrl()` implementation from the support module in node (so path
params, the 3-arg `buildUrl(path, params, query)` form, and `encodeURIComponent`
query encoding all match), and normalises JS object/array literals via node too.
"""
import argparse
import html
import json
import re
import subprocess
import sys
from pathlib import Path

TEST_RE = re.compile(r"test\(\s*(['\"])(?P<title>.*?)\1\s*,", re.S)

# Exact copy of request-validation support/http.ts buildUrl (API_VERSION = 'v2').
BUILD_URL_JS = r"""
const base = process.argv[1];
const API_VERSION = process.argv[2];
function buildUrl(pathTemplate, params, query) {
  let url = `${base}/${API_VERSION}${pathTemplate}`.replace(/\{(\w+)}/g, (_, k) => {
    const v = params && params[k];
    return v == null ? "__MISSING_PARAM__" : String(v);
  });
  if (query) {
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }
  return url;
}
process.stdout.write(buildUrl(__ARGS__));
"""


def node(script: str, *args: str):
    # For `node -e`, the first positional is process.argv[1] (no script-name slot
    # to skip), so pass args straight through — BUILD_URL_JS reads argv[1]/argv[2].
    try:
        out = subprocess.run(["node", "-e", script, *args],
                             capture_output=True, text=True, timeout=15)
        return (out.stdout if out.returncode == 0 else None)
    except Exception:
        return None


def node_json(js_literal: str):
    """JS object/array literal -> parsed Python value (via node)."""
    out = node(f"process.stdout.write(JSON.stringify(({js_literal})))")
    if out is None:
        return None
    try:
        return json.loads(out)
    except Exception:
        return None


def extract_balanced(src: str, start: int, open_ch: str, close_ch: str) -> str:
    """Return the substring between the delimiter at `start` and its match,
    respecting ' and " string literals. `start` is the index of `open_ch`."""
    depth, i, n = 0, start, len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return src[start + 1:i]
        i += 1
    return ""


def split_tests(src: str):
    starts = [(m.start(), m.group("title")) for m in TEST_RE.finditer(src)]
    for i, (pos, title) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
        yield title, src[pos:end]


def parse_block(block: str, base: str, api_version: str):
    # --- URL: run the suite's real buildUrl with the emitted args ---
    bidx = block.find("buildUrl(")
    if bidx == -1:
        return None
    args = extract_balanced(block, block.index("(", bidx), "(", ")").strip()
    url = node(BUILD_URL_JS.replace("__ARGS__", args), base, api_version)
    if url is None:
        return None
    # --- method ---
    mm = re.search(r"request\.(get|post|put|patch|delete)\(", block)
    method = mm.group(1).upper() if mm else "GET"
    # --- headers helper / literal ---
    hm = re.search(r"headers:\s*([^\n]+?),?\n", block)
    headers_kind = hm.group(1).strip() if hm else "{}"
    # --- multipart vs json body ---
    multipart = None
    body_json = None
    if "multipart: formData" in block:
        fm = re.search(r"multipartFields[^=]*=\s*", block)
        if fm:
            obj = extract_balanced(block, block.index("{", fm.end()), "{", "}")
            multipart = node_json("{" + obj + "}")
    else:
        # Capture the whole literal up to the statement terminator (`;` before the
        # next `const`). Anchoring on `;` — not "next { or [" — keeps PRIMITIVE
        # bodies intact (e.g. body-top-type-mismatch emits `requestBody = 123` /
        # `"notNumber"`); scanning for the next brace would otherwise grab the
        # later `request.x(url, { … })` object. A JS object/array literal has no
        # top-level `;`, so the first `;\n` is the statement end.
        bm = re.search(r"const requestBody[^=]*=\s*(.+?);\s*\n", block, re.S)
        if bm:
            body_json = node(f"process.stdout.write(JSON.stringify(({bm.group(1)})))")
    # --- expected status + metadata (quote-agnostic) ---
    am = re.search(r"assertResponseStatus\(\s*testInfo,\s*res,\s*(\d{3})", block)
    expected = int(am.group(1)) if am else None
    op = re.search(r"operationId:\s*['\"]([^'\"]+)['\"]", block)
    kind = re.search(r"scenarioKind:\s*['\"]([^'\"]+)['\"]", block)
    return {
        "url": url, "method": method, "headers_kind": headers_kind,
        "multipart": multipart, "body_json": body_json, "expected": expected,
        "operationId": op.group(1) if op else "", "kind": kind.group(1) if kind else "",
    }


def curl_headers(kind, admin_header, deny_header):
    k = kind.strip()
    if k.startswith("jsonHeaders"):
        return (["Content-Type: application/json"] + ([admin_header] if admin_header else []))
    if k.startswith("authHeaders"):
        return [admin_header] if admin_header else []
    if k.startswith("denyProbeHeaders"):
        return [deny_header] if deny_header else []
    if "Bearer invalid-token" in k:
        return ["Authorization: Bearer invalid-token"]
    return []  # {} → no auth


def run_curl(method, url, headers, body_json, multipart):
    # -sS: quiet progress but still emit connection/TLS/DNS errors on stderr.
    cmd = ["curl", "-sS", "-o", "-", "-w", "\n__HTTP__%{http_code}", "-X", method, url]
    for h in headers:
        cmd += ["-H", h]
    if multipart is not None:
        for k, v in multipart.items():
            cmd += ["-F", f"{k}={v}"]
    elif body_json is not None:
        cmd += ["--data-binary", body_json]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except Exception as e:
        return None, f"<curl error: {e}>"
    out, err = proc.stdout, (proc.stderr or "").strip()
    marker = out.rfind("__HTTP__")
    if marker == -1:
        return None, err or out
    code = int(out[marker + len("__HTTP__"):].strip() or 0)
    body = out[:marker]
    if code == 0:  # 000 → curl never reached the server; surface the stderr reason
        return None, err or body
    return code, (f"{body}\n{err}".strip() if err else body)


def load_pw(pw_json):
    res = {}
    if not pw_json:
        return res
    try:
        with open(pw_json, encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return res
    def walk(suites):
        for s in suites:
            for sp in s.get("specs", []):
                rec = None
                for t in sp.get("tests", []):
                    for r in t.get("results", []):
                        for e in (r.get("errors") or []):
                            mm = re.search(r"Received:.*?(\d{3})", e.get("message", ""))
                            if mm:
                                rec = int(mm.group(1))
                res[sp["title"]] = {"ok": sp.get("ok"), "received": rec}
            walk(s.get("suites", []))
    walk(d.get("suites", []))
    return res


def write_html(path, rows, meta, max_body=1000):
    """Self-contained, color-coded HTML report (no external deps)."""
    def esc(s):
        return html.escape(str(s))

    spec_list = "".join(f"<li><code>{esc(s)}</code></li>" for s in meta.get("specs", []))
    out = [
        "<!doctype html><html lang=en><head><meta charset=utf-8>",
        f"<title>curl-compare — {esc(meta['spec_dir'])}</title>",
        "<style>",
        "body{font:13px/1.45 -apple-system,system-ui,sans-serif;margin:1.5rem;color:#222}",
        "h1{font-size:1.1rem;margin:0 0 .2rem}.meta{color:#555;margin:.2rem 0 .8rem}",
        ".pill{display:inline-block;padding:.12rem .55rem;border-radius:1rem;font-weight:600;margin-right:.4rem}",
        ".pass{background:#e8f5e9;color:#1b5e20}.fail{background:#fdecea;color:#b71c1c}",
        "table{border-collapse:collapse;width:100%;margin-top:.6rem}",
        "th,td{border:1px solid #e3e3e3;padding:.35rem .55rem;text-align:left;vertical-align:top}",
        "th{position:sticky;top:0;background:#fafafa}",
        "tr.ok{background:#f4fbf5}tr.bad{background:#fdeeed}",
        ".n{text-align:right;font-variant-numeric:tabular-nums}",
        "code{font-family:ui-monospace,monospace}",
        "details>summary{cursor:pointer;color:#555;font-family:ui-monospace,monospace}",
        "pre{margin:.3rem 0 0;white-space:pre-wrap;word-break:break-word;color:#444}",
        "label{user-select:none;cursor:pointer}",
        "ul.specs{margin:.2rem 0 .6rem;padding-left:1.4rem;color:#555}",
        "#onlybad:checked~table tr.ok{display:none}",
        "</style></head><body>",
        "<h1>curl-compare report</h1>",
        f"<div class=meta>spec-dir <code>{esc(meta['spec_dir'])}</code> &middot; "
        f"base <code>{esc(meta['base_url'])}</code></div>",
        (f"<ul class=specs>{spec_list}</ul>" if spec_list else ""),
        f"<p><span class='pill pass'>{meta['ok']}/{meta['total']} match</span>"
        f"<span class='pill fail'>{meta['total'] - meta['ok']} mismatch</span>"
        + (f"<span class=meta>{meta['skipped']} skipped</span>" if meta['skipped'] else "")
        + "</p>",
        "<input type=checkbox id=onlybad><label for=onlybad>&nbsp;show only mismatches</label>",
        "<table><thead><tr><th>Test<th>Kind<th>Method"
        "<th class=n>Exp<th>Playwright<th class=n>curl<th>OK</tr></thead><tbody>",
    ]
    for r in rows:
        cls = "ok" if r["match"] else "bad"
        cell = esc(r["title"])
        if not r["match"]:
            body = esc((r["body"] or "").strip()[:max_body])
            cell += (f"<details><summary>{esc(r['method'])} {esc(r['url'])}</summary>"
                     f"<pre>{body}</pre></details>")
        out.append(
            f"<tr class={cls}><td>{cell}</td><td>{esc(r['kind'])}</td>"
            f"<td>{esc(r['method'])}</td><td class=n>{r['expected']}</td>"
            f"<td>{esc(r['pw'])}</td><td class=n>{esc(r['curl'])}</td>"
            f"<td>{'✓' if r['match'] else '✗'}</td></tr>"
        )
    out.append("</tbody></table></body></html>")
    Path(path).write_text("".join(out), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec-dir", required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--api-version", default="v2")
    ap.add_argument("--admin-header", default="")
    ap.add_argument("--deny-header", default="")
    ap.add_argument("--pw-json", default="")
    ap.add_argument("--show-body", action="store_true")
    ap.add_argument("--max-body", type=int, default=400)
    ap.add_argument("--html", default="", help="also write a self-contained HTML report here")
    ap.add_argument("--label", default="", help="human label for the run (config/profile/suite)")
    args = ap.parse_args()
    label = args.label or args.spec_dir

    pw = load_pw(args.pw_json)
    specs = sorted(Path(args.spec_dir).glob("*-validation-api-tests.spec.ts"))
    rows, skipped = [], 0
    for spec in specs:
        src = spec.read_text(encoding="utf-8")  # emitted suite is UTF-8; don't rely on locale
        for title, block in split_tests(src):
            d = parse_block(block, args.base_url, args.api_version)
            if not d or d["expected"] is None:
                skipped += 1
                continue
            # Deny (auth-deny / 403) scenarios need the probe principal's header.
            # Without --deny-header we'd re-issue them unauthenticated and get a
            # bogus 401-vs-403 "mismatch", so skip them explicitly instead.
            if d["headers_kind"].strip().startswith("denyProbeHeaders") and not args.deny_header:
                skipped += 1
                continue
            headers = curl_headers(d["headers_kind"], args.admin_header, args.deny_header)
            code, body = run_curl(d["method"], d["url"], headers, d["body_json"], d["multipart"])
            pw_rec = pw.get(title, {})
            pw_status = ("pass" if pw_rec.get("ok") else f"FAIL({pw_rec.get('received')})") if pw_rec else "—"
            rows.append({
                "title": title, "expected": d["expected"], "pw": pw_status,
                "curl": code, "match": code == d["expected"],
                "method": d["method"], "url": d["url"], "kind": d["kind"], "body": body,
            })

    total = len(rows)
    ok = sum(1 for r in rows if r["match"])
    print(f"\n### {label} — curl vs expected ###")
    print(f"\n{'TEST':<58} {'EXP':>4} {'PW':>10} {'CURL':>5}  OK")
    print("-" * 88)
    for r in rows:
        print(f"{r['title'][:58]:<58} {r['expected']:>4} {r['pw']:>10} {str(r['curl']):>5}  {'✓' if r['match'] else '✗'}")
    print("-" * 88)
    print(f"curl vs expected: {ok}/{total} match, {total - ok} mismatch" +
          (f"  ({skipped} unparsed/skipped)" if skipped else ""))

    mism = [r for r in rows if not r["match"]]
    if args.show_body and mism:
        print("\n=== MISMATCH DETAIL (curl status != expected) ===")
        for r in mism:
            print(f"\n• {r['title']}\n  {r['method']} {r['url']}\n  expected {r['expected']}, curl {r['curl']}")
            if r["body"]:
                print("  body:", r["body"].strip()[: args.max_body])

    if args.html:
        write_html(args.html, rows, {"label": label, "spec_dir": args.spec_dir,
                                     "base_url": args.base_url, "total": total,
                                     "ok": ok, "skipped": skipped,
                                     "specs": [s.name for s in specs]})
        print(f"HTML report: {args.html}")

    # 0 comparable tests means a broken parser / wrong --spec-dir / everything
    # skipped — that's an error, not a silent pass.
    if total == 0:
        print(f"✗ no comparable tests (parsed 0; {skipped} skipped) — check --spec-dir/auth", file=sys.stderr)
        sys.exit(2)
    sys.exit(1 if (total - ok) else 0)


if __name__ == "__main__":
    main()
