#!/usr/bin/env python3
"""Render the camunda-hub response-coverage report as a single self-contained HTML page.

Reads summary.json and rows.json written by hub_response_coverage.py and writes
page.html. All text is derived from those numbers, so a gap that gets closed drops
off the page by itself. It is plain HTML, so it opens anywhere and can be published as a
Claude page by hand.

  hub_coverage_page.py --report DIR [--out FILE]
"""
import argparse
import csv
import html
import json
import os

BUCKETS = (
    ('2xx', 'Success path'), ('400', 'Validation'), ('401', 'Authentication'),
    ('404', 'Resource not found'), ('403', 'Forbidden'), ('409', 'Conflict'),
)
GLYPH = {'ok': '●', 'gap': '×', 'hold': '◇', 'na': 'n/a'}
LABEL = {'ok': 'tested', 'gap': 'in the spec, but no test', 'hold': 'known and tracked elsewhere', 'na': 'n/a, the spec does not list it for this endpoint'}
CSS = """
:root {
  --ground:#F4F7F8; --panel:#FFFFFF; --ink:#12232B; --muted:#566872; --rule:#D6DFE3; --wash:#EAF0F2;
  --ok:#0B7A75; --gap:#B83A2B; --hold:#8A5E00; --gap-wash:#FBEDEA; --hold-wash:#FBF3DF; --focus:#1F5FBF;
  --sans:"Avenir Next","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:#0E181D; --panel:#14232A; --ink:#E3ECEF; --muted:#8FA3AC; --rule:#26383F; --wash:#1A2D35;
    --ok:#46C2B8; --gap:#F0806F; --hold:#E0B04A; --gap-wash:#2A1D1C; --hold-wash:#2A2512; --focus:#7AA8F0;
  }
}
:root[data-theme="dark"] {
  --ground:#0E181D; --panel:#14232A; --ink:#E3ECEF; --muted:#8FA3AC; --rule:#26383F; --wash:#1A2D35;
  --ok:#46C2B8; --gap:#F0806F; --hold:#E0B04A; --gap-wash:#2A1D1C; --hold-wash:#2A2512; --focus:#7AA8F0;
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

.findings { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px; }
.finding { background:var(--panel); border:1px solid var(--rule); border-radius:3px; padding:20px 22px; display:flex; flex-direction:column; gap:10px; }
.finding p { margin:0; color:var(--ink); font-size:.94rem; max-width:62ch; }
.finding code { background:var(--wash); padding:1px 5px; }
.finding .age { color:var(--muted); font-size:.85em; white-space:nowrap; }
.finding.alert { border:1px solid var(--gap); border-left:5px solid var(--gap); background:var(--gap-wash); }
.finding.alert h3 { color:var(--gap); }
.finding.alert h3::before { content:"\\26A0  "; }
.finding.warn { border:1px solid var(--hold); border-left:5px solid var(--hold); background:var(--hold-wash); }
.finding.warn h3 { color:var(--hold); }
.finding.warn h3::before { content:"\\25C7  "; }
.h2link { margin-left:12px; font:400 .72rem var(--mono); text-transform:none; letter-spacing:0; }
.h2link a { color:var(--focus); }

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
tbody th[scope=row] { text-align:left; font-weight:400; padding:13px 12px 13px 20px; }
tbody tr:hover th[scope=row], tbody tr:hover td.c:not(.gap) { background:var(--wash); }
.opc { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px; }
tr { border-top:1px solid var(--rule); }
.grp td { background:var(--wash); padding:11px 20px; border-top:2px solid var(--ink); }
.gname { font:700 .92rem var(--mono); color:var(--ink); margin-right:14px; }
.gcount { color:var(--muted); font-size:.82rem; }
.m { font:700 .64rem var(--mono); letter-spacing:.04em; color:var(--muted); width:44px; }
.op { font-weight:600; font-size:.9rem; }
.path { font:.74rem var(--mono); color:var(--muted); flex-basis:100%; padding-left:54px; }
.note { flex-basis:100%; padding-left:54px; font-size:.76rem; color:var(--hold); }
td.c { text-align:center; width:64px; font:700 1.1rem var(--mono); padding:13px 8px; }
td.c.ok { color:var(--ok); } td.c.gap { color:var(--gap); background:var(--gap-wash); } td.c.hold { color:var(--hold); } td.c.na { color:var(--rule); font-weight:400; }
td.frac span { font:700 .8rem var(--mono); font-variant-numeric:tabular-nums; }
table.only-gaps tr[data-gap="0"] { display:none; }
details.matrix > summary { cursor:pointer; list-style:none; display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 14px; padding-bottom:12px; border-bottom:1px solid var(--ink); }
details.matrix > summary::-webkit-details-marker { display:none; }
details.matrix > summary::before { content:"\\25B8"; color:var(--muted); font-size:.72rem; margin-right:4px; }
details.matrix[open] > summary::before { content:"\\25BE"; }
details.matrix > summary .sumh { font:650 .78rem var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
details.matrix > summary:hover .h2link a, details.matrix > summary .h2link { color:var(--focus); }
details.matrix > .tools { margin-top:22px; }
.method h2 { margin-bottom:12px; }
.method ul { margin:0; padding-left:1.1em; display:flex; flex-direction:column; gap:7px; color:var(--muted); font-size:.9rem; max-width:80ch; }

.t-headline { margin:0 0 18px; font-size:1.15rem; color:var(--ink); }
.t-headline b { font-weight:700; }
.t-headline .up { color:var(--ok); font-weight:650; }
.t-headline .down { color:var(--gap); font-weight:650; }
.t-headline .flat { color:var(--muted); font-weight:650; }
.activity { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; background:var(--panel); border:1px solid var(--rule); border-radius:3px; }
.activity li { padding:16px 20px; font-size:1.02rem; border-left:5px solid var(--rule); }
.activity li + li { border-top:1px solid var(--rule); }
.activity li b { font-size:1.15rem; }
.activity code { background:var(--wash); padding:1px 5px; }
.activity .a-new { border-left-color:var(--focus); }
.activity .a-closed { border-left-color:var(--ok); }
.activity .a-stalled { border-left-color:var(--gap); }
.activity .a-stalled b { color:var(--gap); }
"""


def esc(x):
    return html.escape(str(x))


def tracking_ref(s):
    """Link to the live rolling tracking issue the weekly report maintains — open while any gap
    exists, closed when none do. main() reads its URL from the report dir's issue-url.txt (written
    by the workflow's summary-issue step, the same file the Slack link uses) into
    summary['trackingUrl']. Empty on a local or dry run, where there is no issue to point at. Never
    a hardcoded number: the old per-category epic issues were a one-time backlog that has since been
    closed, so linking them pointed every gap card at a dead ticket."""
    url = s.get('trackingUrl')
    if not url:
        return ''
    num = url.rstrip('/').rsplit('/', 1)[-1]
    label = f'#{num}' if num.isdigit() else 'tracking issue'
    return f'<a href="{esc(url)}" rel="noopener">{label}</a>'


def names(ops, limit=6):
    shown = ', '.join(f'<code>{esc(o)}</code>' for o in ops[:limit])
    return shown + (f' and {len(ops) - limit} more' if len(ops) > limit else '')


def age_text(days):
    """'open 6 weeks' / 'open 3 days' / 'new this week' from a day count, or '' when the age is unknown.
    The manager question is how long a gap has sat unaddressed, so weeks are the unit once it is a week
    old. `days` is how long the endpoint's tracking issue has been open (0 for one opened this run)."""
    if days is None:
        return ''
    days = int(days)
    if days >= 14:
        return f'open {days // 7} weeks'
    if days >= 7:
        return 'open 1 week'
    if days > 0:
        return f'open {days} day' + ('s' if days != 1 else '')
    return 'new this week'


def names_aged(ops, ages, limit=6):
    """Like names(), but annotates each endpoint with how long its gap has been open (from `ages`, an
    operationId -> days-open map), so a stale gap is obvious next to a fresh one."""
    def one(o):
        lab = age_text(ages.get(o))
        return f'<code>{esc(o)}</code>' + (f' <span class="age">({lab})</span>' if lab else '')
    shown = ', '.join(one(o) for o in ops[:limit])
    return shown + (f' and {len(ops) - limit} more' if len(ops) > limit else '')


def cell(kind, tip):
    return f'<td class="c {kind}" title="{esc(tip)}"><span aria-label="{LABEL[kind]}">{GLYPH[kind]}</span></td>'


def bar_note(b, s):
    """One line under each status-code bar, naming the endpoints that are missing it (not just a count),
    so the bar is actionable at a glance. Tracked/suppressed endpoints are named separately."""
    miss, held = s['missing'][b], set(s['heldCells'][b])
    tracked = [o for o in miss if o in held]
    open_ = [o for o in miss if o not in held]
    if not miss:
        return 'Every endpoint that can return this is tested.'
    parts = []
    if open_:
        parts.append('Untested: ' + names(open_))
    if tracked:
        parts.append('Suppressed or excluded: ' + names(tracked))
    return ' · '.join(parts)


def bar(b, label, got, doc, note):
    pct = round(100 * got / doc) if doc else 100
    sev = 'ok' if doc and got / doc >= 0.95 else ('mid' if doc and got / doc >= 0.5 else 'low')
    return (f'<li class="bar {sev}"><span class="bcode">{b}</span><span class="blabel">{label}<small>{note}</small></span>'
            f'<span class="track" role="img" aria-label="{got} of {doc} endpoints"><i style="width:{pct}%"></i></span>'
            f'<span class="bnum"><b>{got}</b> / {doc}</span></li>')


def findings(s, ages=None):
    ages = ages or {}
    m, out = s['missing'], []
    if m['404']:
        out.append(('Not found (404)',
                    f'Of the {s["codes"]["404"][1]} "not found" responses the spec lists, {len(m["404"])} have no test. Test generation '
                    f'only covers "not found" for GET requests. Untested: {names(m["404"])}.'))
    if m['409']:
        out.append(('Conflict (409)',
                    f'{len(m["409"])} of {s["codes"]["409"][1]} endpoints that list a 409 (conflict) response have no test for it: {names(m["409"])}.'))
    if m['403']:
        out.append(('Forbidden (403) on writes',
                    f'A 403 is tested for {s["codes"]["403"][0]} of {s["codes"]["403"][1]} endpoints that list one. '
                    f'Hub checks 400, then 404, then 403, so a forbidden write test needs a real resource and a valid body.'))
    open400 = [o for o in m['400'] if o not in set(s['heldCells']['400'])]
    if open400:
        out.append(('Bad request (400) with no test',
                    f'{names(open400)} list a 400 response that no test triggers.'))
    o_sent, o_total = s['optionalFields']
    if o_sent < o_total:
        fields = [f'{op}.{f}' for op, fs in sorted(s['optionalMissing'].items()) for f in fs]
        out.append(('Optional request fields',
                    f'Success-path tests send {o_sent} of {o_total} optional body fields. Never sent: {names(fields, 8)}.'))
    if s['shapeUnvalidated']:
        out.append(('Success response not checked',
                    f'{len(s["shapeUnvalidated"])} endpoints check the success status but never check the response body against '
                    f'its schema: {names(s["shapeUnvalidated"])}.'))
    # The single live tracking issue is linked once on the section heading (see render), not on every
    # card — one link, not the same number repeated down the page. The "no test at all" card is the most
    # serious gap, so it carries an alert style instead of blending in with the rest.
    cards = ''.join(f'<article class="finding"><h3>{esc(t)}</h3><p>{txt}</p></article>'
                    for t, txt in out)
    # No test at all, split by severity: an untracked gap is unexplained (red); a known/tracked gap is
    # expected and parked (amber). Colour carries the distinction so the serious one is obvious.
    if s['zeroTestOperations']:
        tracked = set(s['trackedOperations'])
        untracked = [o for o in s['zeroTestOperations'] if o not in tracked]
        known = [o for o in s['zeroTestOperations'] if o in tracked]
        if untracked:
            cards += ('<article class="finding alert"><h3>No test at all, and no tracking issue</h3>'
                      f'<p>Nothing tests these endpoints and nothing tracks the gap: {names_aged(untracked, ages)}.</p></article>')
        if known:
            cards += ('<article class="finding warn"><h3>No test at all, tracked elsewhere</h3>'
                      f'<p>No test yet, but the gap is known and tracked: {names_aged(known, ages)}.</p></article>')
    return cards


STALLED_WEEKS = 4  # a gap open this many weeks or longer is "stalled" — nobody is acting on it


def trend_pct(history):
    """The % of endpoints tested for every status code, per report, skipping a row that never recorded
    the columns (an older header). Used for the one-line trajectory."""
    out = []
    for r in history:
        fa, ops = r.get('fullyAsserted'), r.get('operations')
        if fa not in (None, '') and ops not in (None, '') and int(ops):
            out.append(100 * int(fa) / int(ops))
    return out


def trend_section(history, progress=None, ages=None):
    """The weekly movement, as three plain lines a manager can read at a glance rather than a chart:
    new gaps reported this week, gaps closed this week, and gaps that have stalled (open for weeks). Plus
    a one-line trajectory of the headline % once there are two reports. `progress` is the workflow's
    gaps-progress.json (newThisWeek, closedThisWeek); `ages` is endpoint-ages.json (operationId -> days
    open), from which stalled gaps are derived. '' when there is nothing to show (a first local run)."""
    progress = progress or {}
    ages = ages or {}
    pct = trend_pct(history)
    headline = ''
    if len(pct) >= 2:
        d = round(pct[-1] - pct[0])
        move = (f'<span class="up">&#9650; up {d} pts</span>' if d > 0 else
                f'<span class="down">&#9660; down {abs(d)} pts</span>' if d < 0 else
                '<span class="flat">level</span>')
        headline = (f'<p class="t-headline"><b>{pct[-1]:.0f}%</b> of endpoints are tested for every status '
                    f'code — {move} over the last {len(pct)} reports.</p>')

    items = []
    if progress:
        new = progress.get('newThisWeek') or []
        closed = progress.get('closedThisWeek') or 0
        items.append(('new', f'<b>{len(new)}</b> new coverage gap' + ('' if len(new) == 1 else 's')
                      + ' reported this week' + (f': {names(new)}' if new else '')))
        items.append(('closed', f'<b>{int(closed)}</b> coverage gap' + ('' if closed == 1 else 's')
                      + ' closed this week'))
    if ages:
        stalled = sorted(o for o, dys in ages.items() if int(dys) >= STALLED_WEEKS * 7)
        items.append(('stalled', f'<b>{len(stalled)}</b> stalled — open {STALLED_WEEKS}+ weeks'
                      + (f': {names(stalled)}' if stalled else '')))
    if not headline and not items:
        return ''
    lis = ''.join(f'<li class="a-{cls}">{txt}</li>' for cls, txt in items)
    activity = f'<ul class="activity">{lis}</ul>' if items else ''
    return ('<section aria-labelledby="trend"><h2 id="trend">This week\'s movement</h2>'
            f'{headline}{activity}</section>')


def render(s, rows, history=(), ages=None, progress=None):
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
    verdict = 'Every response the spec lists is tested for every endpoint (2xx/400/401/403/404/409; a documented 500 is not checked).' if s['fullyAsserted'] == s['operations'] else 'Not full.'
    fnd = findings(s, ages)
    t_ref = tracking_ref(s)
    # One tracking-issue link for the whole section, on the heading — not the same number on every card.
    gap_link = f'<span class="h2link">tracked in {t_ref}</span>' if t_ref else ''
    findings_html = (f'<section aria-labelledby="gaps"><h2 id="gaps">Where the gaps are{gap_link}</h2>'
                     f'<div class="findings">{fnd}</div></section>') if fnd else ''
    return f"""<title>Hub Endpoint Coverage</title>
<style>{CSS}</style>
<main>
  <header>
    <h1>Hub endpoint coverage</h1>
    <p class="lede"><b>{verdict}</b> {c['2xx'][0]} of {c['2xx'][1]} endpoints have a success test, but only {s['fullyAsserted']} of {s['operations']} have a test for every response the spec lists (2xx/400/401/403/404/409; a documented 500 is not checked). {s['opsMissingResponseTest']} endpoints are missing a test for a success, 400, 401, 404 or 409 response, and {len(s['missing']['403'])} have an untested 403.</p>
    <p class="meta"><span>camunda-hub@{esc(ref)}</span><span>{s['operations']} endpoints</span><span>{s['negativeTests']} negative tests</span><span>secured + rbac profiles</span></p>
  </header>
  {trend_section(history, progress, ages)}
  <section aria-labelledby="codes"><h2 id="codes">Responses tested, out of those the spec lists</h2><ol class="bars">{bars}</ol></section>
  {findings_html}
  <section aria-labelledby="matrix">
    <details class="matrix">
      <summary><span class="sumh">Every endpoint</span><span class="h2link">show all {s['operations']} endpoints and their per-code status</span></summary>
      <div class="tools">
        <div class="legend"><span><i class="k ok">●</i> tested</span><span><i class="k gap">×</i> in the spec, but no test</span><span><i class="k hold">◇</i> known and tracked elsewhere</span><span><i class="k na">n/a</i> the spec does not list it for this endpoint</span></div>
        <label class="toggle"><input type="checkbox" id="onlygaps"> Only endpoints missing a response test (ignoring 403)</label>
      </div>
      <div class="scroll"><table id="mx"><thead><tr><th>Operation</th><th title="Success-path test">Success</th><th title="A test checks the success response against its schema">Response checked</th><th title="Optional request fields a success test sends">Optional fields</th><th title="Bad request">400</th><th title="Not authenticated">401</th><th title="Forbidden">403</th><th title="Not found">404</th><th title="Conflict">409</th></tr></thead>{''.join(body)}</table></div>
    </details>
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
    hist_path = os.path.join(a.report, 'history.csv')
    history = []
    if os.path.exists(hist_path):
        with open(hist_path, newline='') as f:
            history = list(csv.DictReader(f))
    # The live rolling tracking issue, written by the workflow's summary-issue step into the same
    # report dir and used for the Slack link too, so the page and Slack point at the same issue.
    # Absent on a local or dry run (no issue), where the gap cards carry no issue tag.
    url_path = os.path.join(a.report, 'issue-url.txt')
    if os.path.exists(url_path):
        with open(url_path) as f:
            s['trackingUrl'] = f.read().strip()
    # How long each endpoint's gap has been open (operationId -> days), written by the workflow's
    # endpoint-issues step from each tracking issue's creation date. Absent on a local or dry run.
    ages = {}
    ages_path = os.path.join(a.report, 'endpoint-ages.json')
    if os.path.exists(ages_path):
        with open(ages_path) as f:
            ages = json.load(f)
    # This week's movement (new/closed gap counts), written by the workflow's endpoint-issues step.
    progress = {}
    prog_path = os.path.join(a.report, 'gaps-progress.json')
    if os.path.exists(prog_path):
        with open(prog_path) as f:
            progress = json.load(f)
    out = a.out or os.path.join(a.report, 'page.html')
    page = render(s, rows, history, ages, progress)
    open(out, 'w', encoding='utf-8').write(page if a.fragment else as_document(page))
    print(f'wrote {out}')


if __name__ == '__main__':
    main()
