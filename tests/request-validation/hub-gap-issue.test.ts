import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/e2e/hub_response_coverage.py',
);

type Row = {
  operationId: string;
  area?: string;
  method?: string;
  path?: string;
  requestChecks: 'ok' | 'gap' | 'hold' | 'na';
  cells: Record<string, string>;
  requestMissing: string[];
};

const ok = (id: string): Row => ({
  operationId: id,
  method: 'GET',
  path: `/${id}`,
  requestChecks: 'ok',
  cells: { '2xx': 'ok', '404': 'ok' },
  requestMissing: [],
});

/** Runs the weekly report's issue_body() on made-up rows; '' means "close the issue". */
function issueBody(rows: Row[], requestCheckGaps: Record<string, string[]> = {}): string {
  const summary = {
    fullyAsserted: 1,
    operations: rows.length,
    requestNoTests: [],
    requestCheckGaps,
  };
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'd = json.load(sys.stdin)',
    "sys.stdout.write(h.issue_body(d['s'], d['r'], types.SimpleNamespace(run_url='http://run')))",
  ].join('\n');
  return execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify({ s: summary, r: rows }),
    encoding: 'utf8',
  });
}

describe('weekly coverage gap issue body', () => {
  it('is empty when nothing is missing, so the workflow closes the issue', () => {
    expect(issueBody([ok('a'), ok('b')])).toBe('');
  });

  it('does not count tracked or held cells as gaps', () => {
    const held: Row = { ...ok('a'), requestChecks: 'hold', cells: { '2xx': 'ok', '403': 'hold' } };
    expect(issueBody([held])).toBe('');
  });

  it('is an index, not a second table: counts, the marker for the endpoint links, no endpoint rows', () => {
    const body = issueBody([{ ...ok('a'), cells: { '2xx': 'ok', '404': 'gap' } }, ok('b')]);
    expect(body).toContain('**1** still have something missing');
    expect(body).toContain('<!-- ENDPOINT_INDEX -->');
    expect(body).not.toContain('| `a`');
    expect(body).not.toContain('Missing responses');
    expect(body).not.toMatch(/^\|/m);
    expect(body).toContain('Bad-request tests: every kind that applies is covered.');
    expect(body).toContain('open gradually');
    expect(body).toContain('Full table: http://run');
  });

  it('says which bad-request kinds are missing most often when there are gaps', () => {
    const row: Row = { ...ok('a'), requestChecks: 'gap', requestMissing: ['param-missing'] };
    const body = issueBody([row], { a: ['param-missing'] });
    expect(body).toContain('Bad-request tests: Most often missing');
    expect(body).toContain('<!-- ENDPOINT_INDEX -->');
  });
});

/** Runs endpoint_issues() on made-up rows and returns [title, body, operationId, area] tuples. */
function endpointIssues(rows: Row[]): [string, string, string, string][] {
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'rows = json.load(sys.stdin)',
    "json.dump(h.endpoint_issues(rows, types.SimpleNamespace(run_url='http://run')), sys.stdout)",
  ].join('\n');
  return JSON.parse(
    execFileSync('python3', ['-B', '-c', code], { input: JSON.stringify(rows), encoding: 'utf8' }),
  );
}

describe('per-endpoint coverage gap issues', () => {
  const gap = (id: string, area: string): Row => ({
    ...ok(id),
    area,
    cells: { '2xx': 'ok', '404': 'gap' },
  });

  it('opens nothing when no endpoint has a gap', () => {
    expect(endpointIssues([{ ...ok('a'), area: 'Files' }])).toEqual([]);
  });

  it('makes one issue per uncovered endpoint, sorted by area then operationId', () => {
    const issues = endpointIssues([
      gap('f2', 'Files'),
      gap('f1', 'Files'),
      { ...ok('c1'), area: 'Comments' },
      gap('m1', 'Milestones'),
    ]);
    expect(issues.map(([title]) => title)).toEqual([
      '[hub-response-coverage] f1: missing response or bad-request test',
      '[hub-response-coverage] f2: missing response or bad-request test',
      '[hub-response-coverage] m1: missing response or bad-request test',
    ]);
    // operationId + area ride along for the workflow (assignment and area-grouped index).
    expect(issues.map(([, , op, area]) => [op, area])).toEqual([
      ['f1', 'Files'],
      ['f2', 'Files'],
      ['m1', 'Milestones'],
    ]);
  });

  it('lists only the dimension actually missing, omitting a covered one (no "—" placeholder)', () => {
    const kinds: Row = {
      ...ok('k'),
      area: 'Files',
      requestChecks: 'gap',
      requestMissing: ['param-missing'],
    };
    const byOp = Object.fromEntries(
      endpointIssues([gap('r', 'Files'), kinds]).map(([, body, op]) => [op, body]),
    );
    // `r` has only a response-code gap: the bad-request line is omitted, not shown as "—".
    expect(byOp.r).toContain('`r` (`GET /r`) in the **Files** area');
    expect(byOp.r).toContain('- Response status codes: 404');
    expect(byOp.r).not.toContain('Bad-request kinds:');
    // `k` has only a bad-request gap: the response-code line is omitted.
    expect(byOp.k).not.toContain('Response status codes:');
    expect(byOp.k).toContain('- Bad-request kinds: param-missing');
    // Never the cryptic dash placeholder.
    expect(byOp.r).not.toContain('—');
    expect(byOp.k).not.toContain('—');
  });

  it('ends every endpoint issue with a link to the guide on fixing a gap', () => {
    const [[, body]] = endpointIssues([gap('f1', 'Files')]);
    expect(body).toContain(
      'How to fix a gap: [guide](https://github.com/camunda/api-test-generator/blob/main/docs/hub-response-coverage-report.md#closing-a-gap)',
    );
  });

  it('files an endpoint without an area under Other', () => {
    const [[title, , op, area]] = endpointIssues([{ ...ok('x'), cells: { '2xx': 'gap' } }]);
    expect(title).toBe('[hub-response-coverage] x: missing response or bad-request test');
    expect([op, area]).toEqual(['x', 'Other']);
  });
});

// ---- issue lifecycle, run against a stub `gh` ------------------------------------------------

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../.github/scripts');
const SUMMARY = '[hub-response-coverage] Endpoints missing response or bad-request tests';
const areaTitle = (a: string) =>
  `[hub-response-coverage] ${a}: missing response or bad-request tests`;

type Existing = { number: number; title: string; state: 'OPEN' | 'CLOSED' };

/** Runs one of the issue scripts with a stub gh that records every call; returns calls + outputs. */
function runIssueScript(
  script: string,
  files: Record<string, string>,
  existing: Existing[],
  env: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'gap-issue-'));
  const report = join(dir, 'report');
  mkdirSync(join(report, 'endpoints'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(report, name), body.replaceAll('$REPORT', report));
  }
  writeFileSync(join(dir, 'existing.json'), JSON.stringify(existing));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // `issue list` honours --jq like the real gh; `issue create` returns a URL.
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
# GH_FAIL: '|'-separated substrings; a gh call whose args contain one exits 1 (lets a test
# simulate a rejected assignment or a failed comment). Empty/unset => every call succeeds.
if [ -n "$GH_FAIL" ]; then
  _args="$*"  # capture before IFS change: IFS='|' would re-join $* with '|'
  _oifs=$IFS; IFS='|'
  for pat in $GH_FAIL; do case "$_args" in *"$pat"*) IFS=$_oifs; exit 1 ;; esac; done
  IFS=$_oifs
fi
if [ "$1 $2" = "issue list" ]; then
  expr=""; prev=""
  for a in "$@"; do [ "$prev" = "--jq" ] && expr="$a"; prev="$a"; done
  if [ -n "$expr" ]; then jq -r "$expr" "$GH_EXISTING"; else cat "$GH_EXISTING"; fi
elif [ "$1 $2" = "issue create" ]; then
  echo "https://example.test/issues/$((100 + $(grep -c 'issue create' "$GH_LOG")))"
fi
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  // spawnSync (not execFileSync) so stderr is captured on success too — the lookup-cap warning is emitted
  // on a run that still exits 0. On a non-zero exit, throw an error carrying stderr so stderrOf(err) works.
  const res = spawnSync('bash', [join(scriptsDir, script)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: join(dir, 'log'),
      GH_EXISTING: join(dir, 'existing.json'),
      REPORT_DIR: report,
      ISSUE_TITLE: SUMMARY,
      REPO_URL: 'https://example.test',
      RUN_URL: 'https://example.test/run',
      ...env,
    },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw Object.assign(new Error(`hub-coverage script exited ${res.status}`), {
      stderr: res.stderr,
    });
  }
  const read = (f: string) =>
    existsSync(join(report, f)) ? readFileSync(join(report, f), 'utf8') : '';
  return {
    calls: readFileSync(join(dir, 'log'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('gh issue list')),
    issueUrl: read('issue-url.txt').trim(),
    endpointIndex: read('endpoint-index.md').trim().split('\n').filter(Boolean),
    endpointIssues: ((raw) => (raw ? JSON.parse(raw) : undefined))(read('endpoint-issues.json')),
    rendered: read('issue.rendered.md'),
    stderr: res.stderr,
  };
}

const endpointTitle = (op: string) =>
  `[hub-response-coverage] ${op}: missing response or bad-request test`;

const endpoint = (op: string, areaName = 'Files') => ({
  title: endpointTitle(op),
  file: `$REPORT/endpoints/${op}.md`,
  operationId: op,
  area: areaName,
});
const endpointFiles = (...ops: string[]) => ({
  'endpoints.json': JSON.stringify(ops.map((o) => endpoint(o))),
  ...Object.fromEntries(ops.map((o) => [`endpoints/${o}.md`, `body ${o}`])),
});

// A resolver stub (echoes a login) + a dir that looks like a git checkout, so the endpoint script's
// assignment path resolves an author; omit `hubDir` in a test to force the @camunda/hub fallback.
function authorStub(login: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gap-author-'));
  mkdirSync(join(dir, 'hub', '.git'), { recursive: true });
  const resolver = join(dir, 'resolver.sh');
  writeFileSync(resolver, `#!/usr/bin/env bash\necho '${login}'\n`);
  chmodSync(resolver, 0o755);
  return { AUTHOR_RESOLVER: resolver, HUB_DIR: join(dir, 'hub'), HUB_TOKEN: 'x' };
}
// A HUB_DIR with no .git, so the resolver is never consulted and assignment falls back to the team.
const NO_HUB = { HUB_DIR: join(tmpdir(), 'gap-no-hub-does-not-exist') };

/** stderr of a child-process error thrown by execFileSync, narrowed without an `as` cast. */
const stderrOf = (e: unknown): string =>
  e && typeof e === 'object' && 'stderr' in e ? String(e.stderr) : '';

describe('summary issue lifecycle (stub gh)', () => {
  it('opens the issue with the three labels when none exists', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, []);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('issue create');
    expect(r.calls[0]).toContain('--label missing-coverage --label auto-generated --label hub');
    expect(r.issueUrl).toBe('https://example.test/issues/101');
  });

  it('rewrites the open issue in place instead of opening a second one', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, [
      { number: 7, title: SUMMARY, state: 'OPEN' },
    ]);
    expect(r.calls.map((c) => c.split(' ').slice(0, 4).join(' '))).toEqual([
      'gh issue edit 7',
      'gh issue comment 7',
    ]);
    expect(r.issueUrl).toBe('https://example.test/issues/7');
  });

  it('reopens a closed issue when a gap returns', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': 'gaps' }, [
      { number: 7, title: SUMMARY, state: 'CLOSED' },
    ]);
    expect(r.calls[0]).toBe('gh issue reopen 7');
    expect(r.calls.some((c) => c.includes('issue create'))).toBe(false);
  });

  it('closes the open issue when nothing is missing, and still records its link', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': '' }, [
      { number: 7, title: SUMMARY, state: 'OPEN' },
    ]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('issue close 7');
    expect(r.issueUrl).toBe('https://example.test/issues/7');
  });

  it('does nothing when nothing is missing and no issue is open', () => {
    const r = runIssueScript('hub-coverage-summary-issue.sh', { 'issue.md': '' }, [
      { number: 7, title: SUMMARY, state: 'CLOSED' },
    ]);
    expect(r.calls).toEqual([]);
    expect(r.issueUrl).toBe('');
  });
});

describe('per-endpoint issue lifecycle (stub gh)', () => {
  it('creates, updates and reopens by exact title', () => {
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      endpointFiles('newOp', 'openOp', 'shutOp'),
      [
        { number: 5, title: endpointTitle('openOp'), state: 'OPEN' },
        { number: 6, title: endpointTitle('shutOp'), state: 'CLOSED' },
      ],
      NO_HUB,
    );
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(1);
    expect(r.calls).toContain('gh issue reopen 6');
    expect(r.calls.some((c) => c.startsWith('gh issue edit 5 '))).toBe(true);
  });

  it('writes endpoint-issues.json mapping each endpoint with an issue to its number', () => {
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      endpointFiles('newOp', 'openOp', 'shutOp'),
      [
        { number: 5, title: endpointTitle('openOp'), state: 'OPEN' },
        { number: 6, title: endpointTitle('shutOp'), state: 'CLOSED' },
      ],
      NO_HUB,
    );
    expect(r.endpointIssues).toEqual({ newOp: 101, openOp: 5, shutOp: 6 });
  });

  it('assigns a newly created issue to the resolved endpoint author', () => {
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('newOp'), [], {
      ...authorStub('alice'),
    });
    expect(r.calls).toContain('gh issue edit 101 --add-assignee alice');
  });

  it('mentions @camunda/hub on a new issue when no endpoint author resolves', () => {
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('newOp'), [], NO_HUB);
    const mention = r.calls.find((c) => c.startsWith('gh issue comment 101 '));
    expect(mention).toContain('@camunda/hub');
    expect(r.calls.some((c) => c.includes('--add-assignee'))).toBe(false);
  });

  it('skips the blame on a shallow checkout and mentions the team (blame would mis-attribute)', () => {
    // A shallow clone (clone-hub-sibling fetches --depth 1) carries .git/shallow; git blame there
    // attributes every line to the fetched tip, so the script must NOT blame — it falls back to the team
    // rather than assign the wrong owner. The workflow deepens the checkout first; this guards the case
    // where that unshallow fetch failed.
    const stub = authorStub('alice');
    writeFileSync(join(stub.HUB_DIR, '.git', 'shallow'), 'deadbeef\n');
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('newOp'), [], stub);
    expect(r.calls.some((c) => c.includes('--add-assignee'))).toBe(false);
    const mention = r.calls.find((c) => c.startsWith('gh issue comment 101 '));
    expect(mention).toContain('@camunda/hub');
  });

  it('falls back to the team mention when a resolved author cannot be assigned in this repo', () => {
    // The common real case: the endpoint author resolves, but is not an assignable collaborator on this
    // repo, so `gh issue edit --add-assignee` is rejected — the script must fall through to the @camunda/hub mention.
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('newOp'), [], {
      ...authorStub('alice'),
      GH_FAIL: '--add-assignee',
    });
    expect(r.calls).toContain('gh issue edit 101 --add-assignee alice'); // attempted
    const mention = r.calls.find((c) => c.startsWith('gh issue comment 101 '));
    expect(mention).toContain('@camunda/hub'); // fell back to the team
  });

  it('keeps processing later endpoints when an owner mention fails', () => {
    // A failed @camunda/hub mention on one endpoint must not abort the run — the next endpoint still gets its issue.
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('opA', 'opB'), [], {
      ...NO_HUB,
      GH_FAIL: 'issue comment',
    });
    expect(r.calls.filter((c) => c.startsWith('gh issue create')).length).toBe(2);
  });

  it('omits an endpoint from endpoint-issues.json when its issue opens on a later run (cap reached)', () => {
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('a', 'b', 'c'), [], {
      MAX_NEW_ENDPOINT_ISSUES: '2',
      ...NO_HUB,
    });
    // a and b get issues this run; c is capped, so it has no entry (and thus no PR link until it does).
    expect(r.endpointIssues).toEqual({ a: 101, b: 102 });
  });

  it('opens at most MAX_NEW_ENDPOINT_ISSUES new issues and lists the rest unlinked', () => {
    const r = runIssueScript('hub-coverage-endpoint-issues.sh', endpointFiles('a', 'b', 'c'), [], {
      MAX_NEW_ENDPOINT_ISSUES: '2',
      ...NO_HUB,
    });
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(2);
    // a and b get linked index lines; the capped c is still listed, unlinked, in the index.
    expect(r.endpointIndex).toEqual([
      '- [ ] #101 `a` — Files',
      '- [ ] #102 `b` — Files',
      '- `c` — Files (its issue opens on a later run)',
    ]);
  });

  it('closes a clean endpoint issue and migrates the old per-area issues, never the summary', () => {
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      endpointFiles('keptOp'),
      [
        { number: 5, title: endpointTitle('keptOp'), state: 'OPEN' },
        { number: 6, title: endpointTitle('fixedOp'), state: 'OPEN' },
        { number: 7, title: SUMMARY, state: 'OPEN' },
        { number: 8, title: endpointTitle('closedOp'), state: 'CLOSED' },
        { number: 9, title: areaTitle('Files'), state: 'OPEN' },
      ],
      NO_HUB,
    );
    const closed = r.calls
      .filter((c) => c.includes('issue close'))
      .map((c) => c.split(' ')[3])
      .sort();
    // fixedOp (6) is a clean per-endpoint issue; the old per-area issue (9) is migrated; the summary (7),
    // the still-open keptOp (5) and the already-closed one (8) are left alone.
    expect(closed).toEqual(['6', '9']);
  });

  it('aborts (closing nothing) when endpoints.json is missing — a broken report is not "no gaps"', () => {
    // No endpoints.json in the report dir: an upstream crash, not a genuine empty result. Without the
    // guard the read yields zero endpoints and the cleanup loop closes every open issue as resolved; the
    // script must abort instead. (A real no-gaps run is a valid `[]`, exercised elsewhere.)
    let err: unknown;
    try {
      runIssueScript(
        'hub-coverage-endpoint-issues.sh',
        {},
        [{ number: 6, title: endpointTitle('fixedOp'), state: 'OPEN' }],
        NO_HUB,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(stderrOf(err)).toContain('endpoints.json');
  });

  it('aborts (closing nothing) when endpoints.json is malformed', () => {
    let err: unknown;
    try {
      runIssueScript(
        'hub-coverage-endpoint-issues.sh',
        { 'endpoints.json': '{not json' },
        [{ number: 6, title: endpointTitle('fixedOp'), state: 'OPEN' }],
        NO_HUB,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(stderrOf(err)).toContain('endpoints.json');
  });

  it('never closes a manual follow-up whose title only contains the prefix mid-string', () => {
    // `issue list --search "in:title [hub-response-coverage]"` is a substring match, so a human
    // follow-up like "Investigate [hub-response-coverage] fixedOp: ... test" comes back in $existing. It
    // ends with the suffix the close/migrate loops key on but is not ours — the startswith($prefix) guard
    // must spare both decoys while the real clean endpoint (6) and per-area (9) issues still close.
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      endpointFiles('keptOp'),
      [
        { number: 5, title: endpointTitle('keptOp'), state: 'OPEN' },
        { number: 6, title: endpointTitle('fixedOp'), state: 'OPEN' },
        { number: 9, title: areaTitle('Files'), state: 'OPEN' },
        { number: 20, title: `Investigate ${endpointTitle('fixedOp')}`, state: 'OPEN' },
        { number: 21, title: `Investigate ${areaTitle('Files')}`, state: 'OPEN' },
      ],
      NO_HUB,
    );
    const closed = r.calls
      .filter((c) => c.includes('issue close'))
      .map((c) => c.split(' ')[3])
      .sort();
    expect(closed).toEqual(['6', '9']);
  });

  it('warns when the coverage-issue lookup hits its result cap (truncation could miss issues)', () => {
    // Force the cap low so the lookup is provably truncated. A truncated lookup can miss an existing issue
    // (duplicate) and skip its cleanup, so the run must surface a loud warning rather than degrade silently.
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      endpointFiles('keptOp'),
      [
        { number: 5, title: endpointTitle('keptOp'), state: 'OPEN' },
        { number: 6, title: endpointTitle('otherOp'), state: 'CLOSED' },
      ],
      { ...NO_HUB, COVERAGE_ISSUE_LOOKUP_LIMIT: '1' },
    );
    expect(r.stderr).toContain('hit the 1-result cap');
  });
});

describe('the tracking issue is an index of the per-endpoint issues', () => {
  it('writes one line per endpoint: a link to its issue, or the endpoint when its issue is not open yet', () => {
    const files = {
      'endpoints.json': JSON.stringify([endpoint('newOp'), endpoint('openOp'), endpoint('lateOp')]),
      'endpoints/newOp.md': 'b',
      'endpoints/openOp.md': 'b',
      'endpoints/lateOp.md': 'b',
    };
    const r = runIssueScript(
      'hub-coverage-endpoint-issues.sh',
      files,
      [{ number: 5, title: endpointTitle('openOp'), state: 'OPEN' }],
      { MAX_NEW_ENDPOINT_ISSUES: '1', ...NO_HUB },
    );
    expect(r.endpointIndex).toEqual([
      '- [ ] #101 `newOp` — Files',
      '- [ ] #5 `openOp` — Files',
      '- `lateOp` — Files (its issue opens on a later run)',
    ]);
  });

  it('puts that index where the marker is, leaving the rest of the issue as it was', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      {
        'issue.md': 'top\n<!-- ENDPOINT_INDEX -->\nbottom\n',
        'endpoint-index.md': '- [ ] #5 `a & b` — Files\n- `c` — Files\n',
      },
      [],
    );
    expect(r.rendered).toBe('top\n- [ ] #5 `a & b` — Files\n- `c` — Files\nbottom\n');
    expect(r.calls[0]).toContain('issue.rendered.md');
  });

  it('drops the marker line when there is no index, instead of leaving it in the issue', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      { 'issue.md': 'top\n<!-- ENDPOINT_INDEX -->\nbottom\n' },
      [],
    );
    expect(r.rendered).toBe('top\nbottom\n');
  });

  it('rewrites an existing issue from the rendered body, never the marker version', () => {
    const r = runIssueScript(
      'hub-coverage-summary-issue.sh',
      { 'issue.md': '<!-- ENDPOINT_INDEX -->\n', 'endpoint-index.md': '- line\n' },
      [{ number: 7, title: SUMMARY, state: 'OPEN' }],
    );
    const edit = r.calls.find((c) => c.startsWith('gh issue edit 7'));
    expect(edit).toContain('issue.rendered.md');
    expect(edit).not.toContain('issue.md ');
  });
});

/**
 * Runs slack() on a made-up summary; `prev` is the previous report's summary or null. `mention` is the
 * subteam handle the workflow passes via --regression-mention (empty string = none, the default).
 */
function slackText(
  summary: Record<string, unknown>,
  prev: Record<string, unknown> | null,
  mention = '',
): string {
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'd = json.load(sys.stdin)',
    "args = types.SimpleNamespace(spec_ref='abcdef1234', run_url='http://run', tracking_url='http://track', regression_mention=d['m'])",
    "sys.stdout.write(h.slack(d['s'], d['p'], args))",
  ].join('\n');
  return execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify({ s: summary, p: prev, m: mention }),
    encoding: 'utf8',
  });
}

const baseSummary = (over: Record<string, unknown> = {}) => ({
  specHash: 'sha256:abcdef0',
  operations: 10,
  operationIds: ['a', 'b'],
  negativeTests: 50,
  fullyAsserted: 8,
  opsMissingResponseTest: 2,
  codes: {
    '2xx': [10, 10],
    '400': [4, 5],
    '401': [10, 10],
    '403': [8, 10],
    '404': [3, 4],
    '409': [1, 3],
  },
  optionalFields: [6, 9],
  requestChecks: [5, 10],
  requestCheckGaps: {},
  requestNoTests: [],
  shapeUnvalidated: ['a', 'b', 'c'],
  lifecycle: {
    create: [4, 6],
    createMissing: ['ProjectSnapshot', 'Version'],
    restore: [4, 5],
    restoreMissing: ['Version'],
    edge: [1, 2],
    edgeMissing: ['addTag'],
    known: ['Version'],
  },
  zeroTestOperations: [],
  trackedOperations: [],
  codeGaps: { '2xx': 0, '400': 1, '401': 0, '403': 2, '404': 1, '409': 2 },
  areaResponseGaps: { File: 2, Project: 1 },
  ...over,
});

describe('weekly Slack message', () => {
  // Note: the weekly report pings hub-medic ONLY on a week-over-week regression — that behaviour
  // is covered by the 'weekly Slack message pings only on a regression' describe block below.
  it('leads with the documented main question — endpoints tested for every status code', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('*8 of 10 endpoints are tested for every status code they can return*');
    // The two-angle intro frames the headline and the invalid-request line.
    expect(text).toContain('Two angles:');
  });

  it('notes that a documented 500 is not counted, so the headline is not over-claimed', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('a documented 500 is not checked');
    expect(text).toContain('2xx/400/401/403/404/409');
  });

  it('shows the bad-request-kind axis on its own line, flagged as possibly understated', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain(
      'Invalid-request coverage: 5 of 10 endpoints are tested with every kind of bad request that applies',
    );
    // The caveat now names the direction: the covered count may be understated; the missing count is the bound.
    expect(text).toContain('may be understated');
    expect(text).toContain('upper bound');
  });

  it('lists status codes not tested yet, omitting codes with no gap', () => {
    const text = slackText(baseSummary(), null);
    // baseSummary codeGaps: 400:1, 403:2, 404:1, 409:2 ; 2xx and 401 are 0, so omitted
    expect(text).toContain('Status codes not tested yet: 400 (1) · 403 (2) · 404 (1) · 409 (2)');
    const clean = slackText(
      baseSummary({ codeGaps: { '2xx': 0, '400': 0, '401': 0, '403': 0, '404': 0, '409': 0 } }),
      null,
    );
    expect(clean).toContain('Status codes not tested yet: none');
  });

  it('lists where the response gaps are, by area, most first', () => {
    const text = slackText(
      baseSummary({ areaResponseGaps: { File: 2, Project: 1, Catalog: 2 } }),
      null,
    );
    // sorted by count desc then name: Catalog 2, File 2, Project 1
    expect(text).toContain('Where those gaps are (by area): Catalog 2 · File 2 · Project 1');
  });

  it('rolls up the out-of-scope dimensions on one line so they stay visible', () => {
    const text = slackText(baseSummary(), null);
    // lifecycle missing 2+1+1=4 ; optional fields 9-6=3 ; response-shape 3
    expect(text).toContain('Other test gaps: 4 lifecycle · 3 optional fields · 3 response-shape');
  });

  it('shows the change in brackets on the headline and on the kind line', () => {
    const text = slackText(
      baseSummary({ fullyAsserted: 8, requestChecks: [5, 10] }),
      baseSummary({ fullyAsserted: 7, requestChecks: [7, 10] }),
    );
    expect(text).toContain('they can return* (+1).');
    expect(text).toContain('every kind of bad request that applies (-2)');
  });

  it('shows no change figures at all for the first report', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('they can return*. _Counts');
    expect(text).not.toMatch(/\([+-]\d+\)/);
  });

  it('links the tracking issues next to an endpoint with no test at all', () => {
    const text = slackText(
      baseSummary({
        zeroTestOperations: ['a', 'b', 'c'],
        trackedOperations: ['a', 'b'],
        trackedUrls: {
          a: [
            'https://github.com/camunda/camunda-hub/issues/25907',
            'https://github.com/camunda/camunda-hub/issues/26448',
          ],
        },
      }),
      null,
    );
    expect(text).toContain(
      'No test at all: `a` (known, tracked: <https://github.com/camunda/camunda-hub/issues/25907|camunda-hub#25907>, <https://github.com/camunda/camunda-hub/issues/26448|camunda-hub#26448>)',
    );
    // tracked but no URL on record, and not tracked at all
    expect(text).toContain('`b` (known, tracked), `c`');
    expect(text).not.toContain('`c` (');
  });

  it('ends with the full-table, tracking-issue and guide links', () => {
    const text = slackText(baseSummary(), null);
    expect(text).toContain('<http://run|Full table>');
    expect(text).toContain('<http://track|Tracking issue>');
    expect(text).toContain('|📖 Guide>');
  });
});

describe('weekly Slack message pings only on a regression', () => {
  const HANDLE = '<!subteam^S014VK4482H|hub-medic>';
  // A regression ping is the :rotating_light: line; it must carry the handle, and a quiet week must not,
  // so assert both halves together on every case.
  const pinged = (
    summary: Record<string, unknown>,
    prev: Record<string, unknown> | null,
    mention = HANDLE,
  ): boolean => {
    const text = slackText(summary, prev, mention);
    const alerted = text.includes(':rotating_light:');
    expect(text.includes(mention) && mention !== '').toBe(alerted);
    return alerted;
  };

  it('pings when fewer endpoints are fully tested than last week', () => {
    expect(pinged(baseSummary({ fullyAsserted: 7 }), baseSummary())).toBe(true);
  });

  it('pings when fewer endpoints have every bad-request kind than last week', () => {
    expect(pinged(baseSummary({ requestChecks: [4, 10] }), baseSummary())).toBe(true);
  });

  it('pings when more endpoints have no test at all than last week', () => {
    expect(pinged(baseSummary({ zeroTestOperations: ['a'] }), baseSummary())).toBe(true);
  });

  it('pings on a brand-new endpoint shipped untested, even at an unchanged no-test count', () => {
    // Equal-count swap: an old untested op gained a test while a new op shipped with none.
    const cur = baseSummary({ operationIds: ['b', 'c'], zeroTestOperations: ['c'] });
    const prev = baseSummary({ operationIds: ['a', 'b'], zeroTestOperations: ['a'] });
    expect(pinged(cur, prev)).toBe(true);
  });

  it('stays quiet on a flat week', () => {
    expect(pinged(baseSummary(), baseSummary())).toBe(false);
  });

  it('stays quiet on an improving week', () => {
    expect(pinged(baseSummary({ fullyAsserted: 9 }), baseSummary())).toBe(false);
  });

  it('stays quiet when there is no previous report to compare against', () => {
    expect(pinged(baseSummary({ fullyAsserted: 7 }), null)).toBe(false);
  });

  it('never pings when the workflow passes no handle, even on a clear regression', () => {
    expect(pinged(baseSummary({ fullyAsserted: 7 }), baseSummary(), '')).toBe(false);
  });
});

describe('lifecycle resources found in the spec', () => {
  const resources = (ops: Record<string, { method: string; path: string }>) => {
    const code = [
      'import sys, json, importlib.util',
      `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
      'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
      'sys.stdout.write(json.dumps(h.lifecycle_resources(json.load(sys.stdin))))',
    ].join('\n');
    return JSON.parse(
      execFileSync('python3', ['-B', '-c', code], { input: JSON.stringify(ops), encoding: 'utf8' }),
    );
  };

  it('needs create, read-by-key and delete, and marks a restore only when a delete is soft', () => {
    const found = resources({
      createFile: { method: 'POST', path: '/files' },
      getFile: { method: 'GET', path: '/files/{fileKey}' },
      deleteFile: { method: 'DELETE', path: '/files/{fileKey}' },
      restoreFile: { method: 'POST', path: '/files/{fileKey}/restoration' },
      searchRecentlyDeletedFiles: { method: 'POST', path: '/files/recently-deleted/search' },
      // a restoration endpoint with no recently-deleted search restores a state, not a deleted entity
      createVersion: { method: 'POST', path: '/versions' },
      getVersion: { method: 'GET', path: '/versions/{versionKey}' },
      deleteVersion: { method: 'DELETE', path: '/versions/{versionKey}' },
      restoreVersion: { method: 'POST', path: '/versions/{versionKey}/restoration' },
      // a resource scoped by a parent key is still a resource
      createDocument: { method: 'POST', path: '/projects/{projectKey}/documents' },
      getDocument: { method: 'GET', path: '/projects/{projectKey}/documents/{documentKey}' },
      deleteDocument: { method: 'DELETE', path: '/projects/{projectKey}/documents/{documentKey}' },
      createTag: { method: 'POST', path: '/tags' },
      getTag: { method: 'GET', path: '/tags/{tagKey}' },
      deleteTag: { method: 'DELETE', path: '/tags/{tagKey}' },
      // no read by key: not a resource
      createClusterRegistration: { method: 'POST', path: '/clusters' },
      removeClusterRegistration: { method: 'DELETE', path: '/clusters/{clusterId}' },
      // a search is not a create
      searchThings: { method: 'POST', path: '/things/search' },
    });
    expect(found).toEqual({
      File: { create: 'createFile', restores: true },
      Version: { create: 'createVersion', restores: false },
      Document: { create: 'createDocument', restores: false },
      Tag: { create: 'createTag', restores: false },
    });
  });

  it('counts a resource only when its own lifecycle test file was generated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
    try {
      for (const f of ['EntityLifecycle/File', 'EntityLifecycle/Tag', 'RestoreLifecycle/File']) {
        mkdirSync(join(dir, 'templates', f.split('/')[0]), { recursive: true });
        writeFileSync(join(dir, 'templates', `${f}.lifecycle.spec.ts`), '');
      }
      const code = [
        'import sys, json, importlib.util',
        `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
        'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
        "res = {'File': {'create': 'createFile', 'restores': True}, 'Tag': {'create': 'createTag', 'restores': False},",
        "       'Doc': {'create': 'createDoc', 'restores': True}}",
        `sys.stdout.write(json.dumps(h.scan_lifecycle(${JSON.stringify(dir)}, res)))`,
      ].join('\n');
      const out = JSON.parse(execFileSync('python3', ['-B', '-c', code], { encoding: 'utf8' }));
      // created, restorable, restored
      expect(out).toEqual([['File', 'Tag'], ['Doc', 'File'], ['File']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const py = (body: string, input: unknown): unknown =>
    JSON.parse(
      execFileSync(
        'python3',
        [
          '-B',
          '-c',
          [
            'import sys, json, importlib.util',
            `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
            'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
            'd = json.load(sys.stdin)',
            body,
          ].join('\n'),
        ],
        { input: JSON.stringify(input), encoding: 'utf8' },
      ),
    );

  it('finds add-and-remove pairs on nested paths only', () => {
    const pairs = py('sys.stdout.write(json.dumps(h.edge_pairs(d)))', {
      addMember: { method: 'POST', path: '/workspaces/{workspaceKey}/members' },
      removeMember: { method: 'DELETE', path: '/workspaces/{workspaceKey}/members/{email}' },
      // a nested POST with nothing to remove
      restoreFile: { method: 'POST', path: '/files/{fileKey}/restoration' },
      // a nested item that can be read by key is a resource, not a link
      createDocument: { method: 'POST', path: '/projects/{projectKey}/documents' },
      getDocument: { method: 'GET', path: '/projects/{projectKey}/documents/{documentKey}' },
      deleteDocument: { method: 'DELETE', path: '/projects/{projectKey}/documents/{documentKey}' },
      // a top-level create/delete pair is a resource, not a link
      createFile: { method: 'POST', path: '/files' },
      deleteFile: { method: 'DELETE', path: '/files/{fileKey}' },
    });
    expect(pairs).toEqual({ addMember: 'removeMember' });
  });

  it('counts a link only when an ontology edge names both operations and its file was generated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edges-'));
    try {
      mkdirSync(join(dir, 'templates', 'EdgeLifecycle'), { recursive: true });
      writeFileSync(join(dir, 'templates', 'EdgeLifecycle', 'Member.lifecycle.spec.ts'), '');
      writeFileSync(join(dir, 'templates', 'EdgeLifecycle', 'WrongPair.lifecycle.spec.ts'), '');
      const out = py(`sys.stdout.write(json.dumps(h.scan_edges(d['dir'], d['pairs'], d['cfg'])))`, {
        dir,
        pairs: {
          addMember: 'removeMember',
          addTag: 'removeTag',
          addRole: 'removeRole',
          addGroup: 'removeGroup',
        },
        cfg: {
          edges: [
            { name: 'Member', establishedBy: 'addMember', revokedBy: 'removeMember' },
            // names the add operation but not the matching remove: does not count
            { name: 'WrongPair', establishedBy: 'addRole', revokedBy: 'removeOther' },
            // named in the ontology but no file was generated
            { name: 'Tag', establishedBy: 'addTag', revokedBy: 'removeTag' },
          ],
        },
      });
      expect(out).toEqual(['addMember']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
