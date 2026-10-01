#!/usr/bin/env python3
"""Render the camunda-hub response-coverage report as a single self-contained HTML page.

Reads summary.json and rows.json written by hub_response_coverage.py and writes
page.html. All text is derived from those numbers, so a gap that gets closed drops
off the page by itself. It is plain HTML, so it opens anywhere and can be published as a
Claude page by hand.

  hub_coverage_page.py --report DIR [--out FILE]
"""
import argparse
import html
import json
import os

ISSUES = 'https://github.com/camunda/api-test-generator/issues/'
EPIC = 618
BUCKETS = (
    ('2xx', 'Success path'), ('400', 'Validation'), ('401', 'Authentication'),
    ('404', 'Resource not found'), ('403', 'Forbidden'), ('409', 'Conflict'),
)
GLYPH = {'ok': '●', 'gap': '×', 'hold': '◇', 'na': 'n/a'}
LABEL = {'ok': 'tested', 'gap': 'in the spec, but no test', 'hold': 'known and tracked elsewhere', 'na': 'n/a, the spec does not list it for this endpoint'}
CSS = """
:root {
  --ground:#F4F7F8; --panel:#FFFFFF; --ink:#12232B; --muted:#566872; --rule:#D6DFE3; --wash:#EAF0F2;
  --ok:#0B7A75; --gap:#B83A2B; --hold:#8A5E00; --gap-wash:#FBEDEA; --focus:#1F5FBF;
  --sans:"Avenir Next","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:#0E181D; --panel:#14232A; --ink:#E3ECEF; --muted:#8FA3AC; --rule:#26383F; --wash:#1A2D35;
    --ok:#46C2B8; --gap:#F0806F; --hold:#E0B04A; --gap-wash:#2A1D1C; --focus:#7AA8F0;
  }
}
:root[data-theme="dark"] {
  --ground:#0E181D; --panel:#14232A; --ink:#E3ECEF; --muted:#8FA3AC; --rule:#26383F; --wash:#1A2D35;
  --ok:#46C2B8; --gap:#F0806F; --hold:#E0B04A; --gap-wash:#2A1D1C; --focus:#7AA8F0;
}
* { box-sizing:border-box; }
body { margin:0; background:var(--ground); color:var(--ink); font:16px/1.55 var(--sans); }
code { font-family:var(--mono); font-size:.88em; }
main { max-width:1180px; margin:0 auto; padding:56px 28px 80px; display:flex; flex-direction:column; gap:64px; }
h1 { margin:0; font-size:clamp(2rem,4.4vw,3.1rem); line-height:1.04; letter-spacing:-.03em; font-weight:720; text-wrap:balance; max-width:20ch; }
h2 { margin:0 0 20px; font-size:.78rem; letter-spacing:.14em; text-transform:uppercase; font-weight:650; color:var(--muted); }
h3 { margin:0; font-size:1.02rem; letter-spacing:-.005em; }
.lede { margin:20px 0 0; max-width:62ch; font-size:1.12rem; color:var(--ink); }
.lede b { font-weight:650; }
.meta { margin:14px 0 0; color:var(--muted); font:.8rem var(--mono); display:flex; flex-wrap:wrap; gap:6px 18px; }

.bars { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; background:var(--panel); border:1px solid var(--rule); }
.bar { display:grid; grid-template-columns:56px minmax(180px,1.2fr) minmax(120px,2fr) 84px; align-items:center; gap:18px; padding:14px 20px; }
.bar + .bar { border-top:1px solid var(--rule); }
.bcode { font:650 1.05rem var(--mono); }
.blabel { display:flex; flex-direction:column; font-weight:600; }
.blabel small { font-weight:400; color:var(--muted); font-size:.82rem; line-height:1.35; }
.track { height:10px; background:var(--wash); position:relative; }
.track i { position:absolute; inset:0 auto 0 0; display:block; background:var(--ok); }
.bar.mid .track i { background:var(--hold); }
.bar.low .track i { background:var(--gap); }
.bnum { text-align:right; font:.9rem var(--mono); font-variant-numeric:tabular-nums; color:var(--muted); }
.bnum b { color:var(--ink); font-size:1.05rem; }
@media (max-width:720px) { .bar { grid-template-columns:44px 1fr 70px; } .track { grid-column:1 / -1; order:5; } }

.findings { display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:18px; }
.finding { background:var(--panel); border:1px solid var(--rule); padding:20px 22px; display:flex; flex-direction:column; gap:10px; }
.finding header { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
.finding p { margin:0; color:var(--ink); font-size:.94rem; max-width:62ch; }
.finding code { background:var(--wash); padding:1px 5px; }
.tag { font:.7rem var(--mono); letter-spacing:.05em; text-transform:uppercase; color:var(--muted); white-space:nowrap; border:1px solid var(--rule); padding:2px 7px; }

.tools { display:flex; flex-wrap:wrap; gap:14px 28px; align-items:center; justify-content:space-between; margin-bottom:14px; }
.legend { display:flex; flex-wrap:wrap; gap:6px 20px; font-size:.84rem; color:var(--muted); }
.legend span { display:inline-flex; gap:7px; align-items:center; }
.k { font:700 .95rem var(--mono); }
.k.ok { color:var(--ok); } .k.gap { color:var(--gap); } .k.hold { color:var(--hold); } .k.na { color:var(--muted); }
.toggle { display:inline-flex; gap:9px; align-items:center; font-size:.9rem; cursor:pointer; }
.toggle input { width:17px; height:17px; accent-color:var(--ok); }
.toggle input:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
.scroll { overflow-x:auto; background:var(--panel); border:1px solid var(--rule); }
table { width:100%; border-collapse:collapse; min-width:860px; }
thead th { position:sticky; top:0; background:var(--panel); z-index:2; font:650 .72rem var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); padding:12px 8px; text-align:center; border-bottom:1px solid var(--ink); }
thead th:first-child { text-align:left; padding-left:20px; }
tbody th[scope=row] { text-align:left; font-weight:400; padding:9px 12px 9px 20px; }
.opc { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px; }
tr { border-top:1px solid var(--rule); }
.grp td { background:var(--wash); padding:9px 20px; font-size:.82rem; border-top:1px solid var(--rule); }
.gname { font:650 .88rem var(--mono); margin-right:14px; }
.gcount { color:var(--muted); }
.m { font:700 .64rem var(--mono); letter-spacing:.04em; color:var(--muted); width:44px; }
.op { font-weight:600; font-size:.88rem; }
.path { font:.74rem var(--mono); color:var(--muted); flex-basis:100%; padding-left:54px; }
.note { flex-basis:100%; padding-left:54px; font-size:.76rem; color:var(--hold); }
td.c { text-align:center; width:64px; font:700 1rem var(--mono); }
td.c.ok { color:var(--ok); } td.c.gap { color:var(--gap); background:var(--gap-wash); } td.c.hold { color:var(--hold); } td.c.na { color:var(--rule); font-weight:400; }
td.frac span { font:700 .8rem var(--mono); font-variant-numeric:tabular-nums; }
table.only-gaps tr[data-gap="0"] { display:none; }
.method h2 { margin-bottom:12px; }
.method ul { margin:0; padding-left:1.1em; display:flex; flex-direction:column; gap:7px; color:var(--muted); font-size:.9rem; max-width:80ch; }
"""


def esc(x):
    return html.escape(str(x))


def issue(*nums):
    return ', '.join(f'<a href="{ISSUES}{n}" rel="noopener">#{n}</a>' for n in nums)


def names(ops, limit=6):
    shown = ', '.join(f'<code>{esc(o)}</code>' for o in ops[:limit])
    return shown + (f' and {len(ops) - limit} more' if len(ops) > limit else '')


def cell(kind, tip):
    return f'<td class="c {kind}" title="{esc(tip)}"><span aria-label="{LABEL[kind]}">{GLYPH[kind]}</span></td>'


def bar_note(b, s):
    miss, held = s['missing'][b], set(s['heldCells'][b])
    tracked = [o for o in miss if o in held]
    open_ = [o for o in miss if o not in held]
    if not miss:
        return 'Every response the spec lists is tested.'
    if b in ('404', '403', '409'):
        return f'{len(miss)} of {s["codes"][b][1]} endpoints that list a {b} have no test for it.'
    parts = []
    if open_:
        parts.append('Untested: ' + names(open_, 3) + '.')
    if tracked:
        parts.append('Suppressed or excluded: ' + names(tracked, 3) + '.')
    return ' '.join(parts)


def bar(b, label, got, doc, note):
    pct = round(100 * got / doc) if doc else 100
    sev = 'ok' if doc and got / doc >= 0.95 else ('mid' if doc and got / doc >= 0.5 else 'low')
    return (f'<li class="bar {sev}"><span class="bcode">{b}</span><span class="blabel">{label}<small>{note}</small></span>'
            f'<span class="track" role="img" aria-label="{got} of {doc} endpoints"><i style="width:{pct}%"></i></span>'
            f'<span class="bnum"><b>{got}</b> / {doc}</span></li>')


def findings(s):
    m, out = s['missing'], []
    if m['404']:
        out.append(('Not found (404)', issue(619),
                    f'Of the {s["codes"]["404"][1]} "not found" responses the spec lists, {len(m["404"])} have no test. Test generation '
                    f'only covers "not found" for GET requests. Untested: {names(m["404"])}.'))
    if m['409']:
        out.append(('Conflict (409)', issue(620, 621),
                    f'{len(m["409"])} of {s["codes"]["409"][1]} endpoints that list a 409 (conflict) response have no test for it: {names(m["409"])}.'))
    if m['403']:
        out.append(('Forbidden (403) on writes', issue(622),
                    f'A 403 is tested for {s["codes"]["403"][0]} of {s["codes"]["403"][1]} endpoints that list one. '
                    f'Hub checks 400, then 404, then 403, so a forbidden write test needs a real resource and a valid body.'))
    open400 = [o for o in m['400'] if o not in set(s['heldCells']['400'])]
    if open400:
        out.append(('Bad request (400) with no test', issue(627),
                    f'{names(open400)} list a 400 response that no test triggers.'))
    o_sent, o_total = s['optionalFields']
    if o_sent < o_total:
        fields = [f'{op}.{f}' for op, fs in sorted(s['optionalMissing'].items()) for f in fs]
        out.append(('Optional request fields', issue(623, 624, 625),
                    f'Success-path tests send {o_sent} of {o_total} optional body fields. Never sent: {names(fields, 8)}.'))
    if s['shapeUnvalidated']:
        out.append(('Success response not checked', issue(626),
                    f'{len(s["shapeUnvalidated"])} endpoints check the success status but never check the response body against '
                    f'its schema: {names(s["shapeUnvalidated"])}.'))
    if s['zeroTestOperations']:
        out.append(('Endpoints with no test at all', issue(EPIC),
                    f'{names([o + (" (known, tracked)" if o in set(s["trackedOperations"]) else "") for o in s["zeroTestOperations"]])}.'))
    return ''.join(f'<article class="finding"><header><h3>{esc(t)}</h3><span class="tag">{ref}</span></header><p>{txt}</p></article>'
                   for t, ref, txt in out)


def render(s, rows):
    groups = {}
    for r in rows:
        groups.setdefault(r['path'].strip('/').split('/')[0], []).append(r)
    body = []
    for g, rs in groups.items():
        bad = sum(not r['fullyTestedExcept403'] for r in rs)
        trs = []
        for r in rs:
            c = r['cells']
            tds = [cell(c.get('2xx', 'na'), 'Success path'), cell(r['shape'], 'Success body schema-validated')]
            if r['optionalTotal']:
                kind = 'ok' if r['optionalSent'] == r['optionalTotal'] else 'gap'
                tds.append(f'<td class="c {kind} frac" title="Optional request-body fields a success-path test sends"><span>{r["optionalSent"]}/{r["optionalTotal"]}</span></td>')
            else:
                tds.append('<td class="c na"><span aria-label="not applicable">n/a</span></td>')
            for b in ('400', '401', '403', '404', '409'):
                k = c.get(b, 'na')
                tds.append(cell(k, f'{b}: {LABEL[k]}') if k != 'na' else '<td class="c na"><span aria-label="not listed in the spec">n/a</span></td>')
            note = f'<span class="note">excluded: {esc(", ".join(r["notes"]))}</span>' if r['notes'] else ''
            trs.append(f'<tr data-gap="{int(r["codeGap"])}"><th scope="row"><div class="opc"><span class="m">{esc(r["method"])}</span>'
                       f'<code class="op">{esc(r["operationId"])}</code><span class="path">{esc(r["path"])}</span>{note}</div></th>' + ''.join(tds) + '</tr>')
        body.append(f'<tbody><tr class="grp"><td colspan="9"><span class="gname">/{esc(g)}</span>'
                    f'<span class="gcount">{len(rs) - bad} of {len(rs)} fully tested apart from 403</span></td></tr>' + ''.join(trs) + '</tbody>')
    c = s['codes']
    bars = ''.join(bar(b, label, c[b][0], c[b][1], bar_note(b, s)) for b, label in BUCKETS)
    ref = (s.get('specRef') or '')[:7] or s['specHash'].replace('sha256:', '')[:7]
    verdict = 'Every response the spec lists is tested for every endpoint.' if s['fullyAsserted'] == s['operations'] else 'Not full.'
    fnd = findings(s)
    findings_html = f'<section aria-labelledby="gaps"><h2 id="gaps">Where the gaps are</h2><div class="findings">{fnd}</div></section>' if fnd else ''
    return f"""<title>Hub Endpoint Coverage</title>
<style>{CSS}</style>
<main>
  <header>
    <h1>Hub endpoint coverage</h1>
    <p class="lede"><b>{verdict}</b> {c['2xx'][0]} of {c['2xx'][1]} endpoints have a success test, but only {s['fullyAsserted']} of {s['operations']} have a test for every response the spec lists. {s['opsMissingResponseTest']} endpoints are missing a test for a success, 400, 401, 404 or 409 response, and {len(s['missing']['403'])} have an untested 403.</p>
    <p class="meta"><span>camunda-hub@{esc(ref)}</span><span>{s['operations']} endpoints</span><span>{s['negativeTests']} negative tests</span><span>secured + rbac profiles</span><span>tracked in <a href="{ISSUES}{EPIC}" rel="noopener">#{EPIC}</a></span></p>
  </header>
  <section aria-labelledby="codes"><h2 id="codes">Responses tested, out of those the spec lists</h2><ol class="bars">{bars}</ol></section>
  {findings_html}
  <section aria-labelledby="matrix">
    <h2 id="matrix">Every endpoint</h2>
    <div class="tools">
      <div class="legend"><span><i class="k ok">●</i> tested</span><span><i class="k gap">×</i> in the spec, but no test</span><span><i class="k hold">◇</i> known and tracked elsewhere</span><span><i class="k na">n/a</i> the spec does not list it for this endpoint</span></div>
      <label class="toggle"><input type="checkbox" id="onlygaps"> Only endpoints missing a response test (ignoring 403)</label>
    </div>
    <div class="scroll"><table id="mx"><thead><tr><th>Operation</th><th title="Success-path test">Success</th><th title="A test checks the success response against its schema">Response checked</th><th title="Optional request fields a success test sends">Optional fields</th><th title="Bad request">400</th><th title="Not authenticated">401</th><th title="Forbidden">403</th><th title="Not found">404</th><th title="Conflict">409</th></tr></thead>{''.join(body)}</table></div>
  </section>
  <section class="method" aria-labelledby="how">
    <h2 id="how">How this was measured</h2>
    <ul>
      <li>Static analysis of the generated suites, bundled from camunda-hub@{esc(ref)}. It reads the tests that exist; it is not a run result.</li>
      <li>"The spec lists" means a response code in the OpenAPI spec for that endpoint. 500 is left out because it cannot be provoked on purpose.</li>
      <li>A response counts as tested if any success, lifecycle or negative test expects it. Optional fields are counted at the top level of the request body only.</li>
    </ul>
  </section>
</main>
<script>
document.getElementById('onlygaps').addEventListener('change', function (e) {{
  document.getElementById('mx').classList.toggle('only-gaps', e.target.checked);
}});
</script>
"""


def as_document(fragment):
    """Wrap the fragment (title, style, body, script) in a complete document."""
    i = fragment.index('<main>')
    head, body = fragment[:i], fragment[i:]
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + head + '</head>\n<body>\n' + body + '</body>\n</html>\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--report', required=True)
    ap.add_argument('--out')
    ap.add_argument('--fragment', action='store_true',
                    help='emit the wrapper-free form (no doctype/html/head/body), for publishing as a Claude page')
    a = ap.parse_args()
    s = json.load(open(os.path.join(a.report, 'summary.json')))
    rows = json.load(open(os.path.join(a.report, 'rows.json')))
    out = a.out or os.path.join(a.report, 'page.html')
    page = render(s, rows)
    open(out, 'w', encoding='utf-8').write(page if a.fragment else as_document(page))
    print(f'wrote {out}')


if __name__ == '__main__':
    main()
