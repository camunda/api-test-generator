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
        if multipart:
            for k, v in multipart.items():
                cmd += ["-F", f"{k}={v}"]
        else:
            # Empty multipart: still emit a multipart/form-data body (with a
            # closing boundary) so the server runs part-validation — matching
            # Playwright's `request.put(url, { multipart: {} })`, which yields
            # 400 "required part missing" rather than a bodyless 415.
            boundary = "----curlcompareEMPTY"
            cmd += ["-H", f"Content-Type: multipart/form-data; boundary={boundary}",
                    "--data-binary", f"--{boundary}--\r\n"]
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


# ======================================================================
# POSITIVE suite (lifecycle / feature / variant) — multi-step chain replay
# ----------------------------------------------------------------------
# Negative specs are one request per test; positive specs are ORDERED
# `test.step(...)` chains that thread server-minted ids forward via
# `extractInto(ctx, 'fooVar', json?.foo)`. To curl them faithfully we:
#   1. evaluate the spec's seed bindings through the suite's OWN
#      `seedBinding` (via tsx) so client-minted values match;
#   2. for each step: resolve the `url` template + `body` literal through
#      node with the live `ctx` in scope, curl it, compare status to the
#      step's `expect(...).toBe(N)`, and on a 2xx apply the step's
#      `extractInto` calls so the next step sees the real ids.
# A test PASSES (curl) when every step's status matches; the first
# mismatching step is recorded as the failure (the suite stops there too).
# Observe steps' membership body-assertion (toContain) is NOT re-checked —
# this oracle compares STATUS, the same axis as the negative report.
# ======================================================================
POS_TEST_RE = re.compile(r"\btest\(\s*(['\"])(?P<title>.*?)\1\s*,\s*async", re.S)
POS_STEP_RE = re.compile(r"test\.step\(\s*(['\"])(?P<name>.*?)\1\s*,\s*async", re.S)
SALT_RE = re.compile(r"initSpecSalt\(\s*['\"]([^'\"]+)['\"]\s*\)")
SEED_RE = re.compile(
    r"ctx\.\w+\s*=\s*ctx\.\w+\s*\?\?\s*seedBinding\(\s*['\"](?P<name>\w+)['\"]\s*"
    r"(?:,\s*(?P<opts>\{[^}]*\}))?\s*\)"
)
URL_RE = re.compile(r"const\s+url\s*=\s*(?P<expr>.+?);\s*\n", re.S)
REQ_RE = re.compile(r"request\.(?P<m>get|post|put|patch|delete)\(")
BODY_RE = re.compile(r"const\s+body\d*\s*=\s*(?P<expr>\{.*?\});\s*\n", re.S)
EXPECT_RE = re.compile(r"expect\(\s*resp\w*\.status\(\)\s*\)\.toBe\(\s*(\d{3})\s*\)")
EXTRACT_RE = re.compile(r"extractInto\(\s*ctx,\s*['\"](?P<var>\w+)['\"]\s*,\s*\w+\?\.(?P<field>\w+)")
MULTIPART_RE = re.compile(r"multipart:\s*multipart")

# Evaluate a JS expression (url template or body object literal) with the
# live `baseUrl` + `ctx` in scope. A string result (url) is emitted raw; an
# object (body) is JSON-stringified — exactly what curl needs for each.
EVAL_JS = r"""
const baseUrl = process.argv[1];
const ctx = JSON.parse(process.argv[2]);
const __v = (__EXPR__);
process.stdout.write(typeof __v === "string" ? __v : JSON.stringify(__v));
"""

# tsx harness: import the suite's real seeding module by file URL and resolve
# every seed binding under the spec's own salt, so values match the suite.
SEED_TS = r"""
const mod = await import(process.argv[2]);
mod.initSpecSalt(process.argv[3]);
const specs = JSON.parse(process.argv[4]);
const out = {};
for (const s of specs) out[s.name] = mod.seedBinding(s.name, s.opts);
process.stdout.write(JSON.stringify(out));
"""


def eval_js(expr, base, ctx):
    return node(EVAL_JS.replace("__EXPR__", expr), base, json.dumps(ctx))


def eval_seeds(seeding_path, salt, seeds):
    """Resolve seed bindings via the suite's own seedBinding (tsx)."""
    if not seeds:
        return {}
    url = Path(seeding_path).resolve().as_uri()
    specs = [{"name": n, "opts": ({"unique": True} if o and "unique" in o and "true" in o else {})}
             for n, o in seeds]
    tmp = Path(seeding_path).parent / ".curl_seed_eval.mts"
    try:
        tmp.write_text(SEED_TS, encoding="utf-8")
        out = subprocess.run(["npx", "tsx", str(tmp), url, salt, json.dumps(specs)],
                             capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return {}
        return json.loads(out.stdout)
    except Exception:
        return {}
    finally:
        try: tmp.unlink()
        except Exception: pass


def parse_positive_steps(test_body):
    """Yield ordered step dicts from a test() body."""
    starts = [(m.start(), m.group("name")) for m in POS_STEP_RE.finditer(test_body)]
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(test_body)
        blk = test_body[pos:end]
        um = URL_RE.search(blk)
        if not um:
            continue
        rm = REQ_RE.search(blk)
        em = EXPECT_RE.search(blk)
        bm = BODY_RE.search(blk)
        yield {
            "name": name,
            "url_expr": um.group("expr").strip(),
            "method": (rm.group("m").upper() if rm else "GET"),
            "expected": int(em.group(1)) if em else None,
            "body_expr": bm.group("expr") if bm else None,
            "multipart": bool(MULTIPART_RE.search(blk)),
            "extracts": EXTRACT_RE.findall(blk),  # list of (var, field)
        }


def replay_positive_test(title, test_body, salt, seeding_path, base, admin_header):
    seeds = SEED_RE.findall(test_body)  # list of (name, opts)
    ctx = eval_seeds(seeding_path, salt, seeds)
    headers = [admin_header] if admin_header else []
    steps = list(parse_positive_steps(test_body))
    last = None
    for st in steps:
        url = eval_js(st["url_expr"], base, ctx)
        if url is None:
            return {"title": title, "ok": False, "fail": st["name"], "expected": st["expected"],
                    "curl": None, "method": st["method"], "url": "<url-eval-failed>", "body": ""}
        body_json, multipart = None, None
        if st["multipart"]:
            # Reconstruct the multipart body the same way the emitted suite does:
            # the body literal is `{ fields: {...}, files: {...} }` where each
            # file value is an `@@FILE:<rel>` marker. Resolve fields to plain
            # form values and files to `@<abs fixture path>` so curl attaches the
            # real bytes (basename = part filename, matching e.g. the README's
            # template reference). Empty → falls through to run_curl's empty-
            # multipart boundary so the server still runs part-validation.
            multipart = {}
            mp = json.loads(eval_js(st["body_expr"], base, ctx)) if st["body_expr"] else {}
            fixtures_dir = Path(seeding_path).resolve().parent.parent / "fixtures"
            for k, v in (mp.get("fields") or {}).items():
                if v is not None:
                    multipart[k] = str(v)
            for k, v in (mp.get("files") or {}).items():
                if isinstance(v, str) and v.startswith("@@FILE:"):
                    multipart[k] = "@" + str((fixtures_dir / v[len("@@FILE:"):]).resolve())
                elif v is not None:
                    multipart[k] = str(v)
        elif st["body_expr"] is not None:
            body_json = eval_js(st["body_expr"], base, ctx)
        jhdr = headers + (["Content-Type: application/json"] if body_json is not None else [])
        code, rbody = run_curl(st["method"], url, jhdr, body_json, multipart)
        last = {"title": title, "expected": st["expected"], "curl": code, "method": st["method"],
                "url": url, "body": rbody, "fail": st["name"]}
        if code != st["expected"]:
            return {**last, "ok": False}
        # success → thread extracted ids forward for subsequent steps
        if rbody and 200 <= (code or 0) < 300:
            try:
                j = json.loads(rbody)
                for var, field in st["extracts"]:
                    if isinstance(j, dict) and j.get(field) is not None:
                        ctx[var] = j[field]
            except Exception:
                pass
    return {**(last or {"title": title, "expected": None, "curl": None, "method": "", "url": "",
                        "body": ""}), "ok": True, "fail": "all-pass"}


def main_positive(args):
    pw = load_pw(args.pw_json)
    specdir = Path(args.spec_dir)
    seeding = specdir / "support" / "seeding.ts"
    specs = sorted(p for p in specdir.rglob("*.spec.ts")
                   if not p.name.endswith("-validation-api-tests.spec.ts"))
    rows = []
    for spec in specs:
        src = spec.read_text(encoding="utf-8")
        sm = SALT_RE.search(src)
        salt = sm.group(1) if sm else spec.stem
        tm = [(m.start(), m.group("title")) for m in POS_TEST_RE.finditer(src)]
        for i, (pos, title) in enumerate(tm):
            end = tm[i + 1][0] if i + 1 < len(tm) else len(src)
            r = replay_positive_test(title, src[pos:end], salt, str(seeding),
                                     args.base_url, args.admin_header)
            pw_rec = pw.get(title, {})
            pw_status = ("pass" if pw_rec.get("ok") else f"FAIL({pw_rec.get('received')})") if pw_rec else "—"
            rows.append({
                "title": title, "expected": r["expected"], "pw": pw_status, "curl": r["curl"],
                "match": r["ok"], "method": r["method"], "url": r["url"],
                "kind": r["fail"], "body": r["body"],
            })

    total = len(rows)
    ok = sum(1 for r in rows if r["match"])
    label = args.label or "positive"
    print(f"\n### {label} — curl chain replay vs Playwright ###")
    print(f"\n{'TEST':<52} {'STEP':<22} {'EXP':>4} {'PW':>10} {'CURL':>5}  OK")
    print("-" * 100)
    for r in rows:
        print(f"{r['title'][:52]:<52} {r['kind'][:22]:<22} {str(r['expected']):>4} "
              f"{r['pw']:>10} {str(r['curl']):>5}  {'✓' if r['match'] else '✗'}")
    print("-" * 100)
    print(f"curl chain vs suite: {ok}/{total} pass, {total - ok} fail")

    if args.show_body:
        for r in rows:
            if not r["match"] and r["body"]:
                print(f"\n• {r['title']}  [fails at {r['kind']}]\n  {r['method']} {r['url']}\n"
                      f"  expected {r['expected']}, curl {r['curl']}\n  body: {r['body'].strip()[:args.max_body]}")

    if args.html:
        write_html(args.html, rows, {"label": label, "spec_dir": args.spec_dir,
                                     "base_url": args.base_url, "total": total, "ok": ok,
                                     "skipped": 0, "specs": [s.name for s in specs]})
        print(f"HTML report: {args.html}")
    if total == 0:
        print(f"✗ no positive tests parsed under {args.spec_dir}", file=sys.stderr)
        sys.exit(2)
    sys.exit(1 if (total - ok) else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["negative", "positive"], default="negative",
                    help="negative: one-request RV specs (default). positive: multi-step chains.")
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
    if args.mode == "positive":
        return main_positive(args)
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
