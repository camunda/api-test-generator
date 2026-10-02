import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  requestChecks: 'ok' | 'gap' | 'hold' | 'na';
  cells: Record<string, string>;
  requestMissing: string[];
};

const ok = (id: string): Row => ({
  operationId: id,
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

  it('lists a response-only gap and does not claim bad-request tests are missing', () => {
    const body = issueBody([{ ...ok('a'), cells: { '2xx': 'ok', '404': 'gap' } }, ok('b')]);
    expect(body).toContain('| `a` | 404 | — |');
    expect(body).not.toContain('`b`');
    expect(body).toContain('Bad-request tests: every kind that applies is covered.');
    expect(body).not.toContain('Nothing is missing');
    expect(body).toContain('opened gradually');
    expect(body).not.toContain('also has its own issue');
  });

  it('lists a bad-request-only gap', () => {
    const row: Row = { ...ok('a'), requestChecks: 'gap', requestMissing: ['param-missing'] };
    const body = issueBody([row], { a: ['param-missing'] });
    expect(body).toContain('| `a` | — | param-missing |');
    expect(body).toContain('Bad-request tests: Most often missing');
  });

  it('caps the table at 100 endpoints and says how many were left out', () => {
    const rows = Array.from({ length: 103 }, (_, i) => ({
      ...ok(`op${i}`),
      cells: { '2xx': 'gap' },
    }));
    const body = issueBody(rows);
    expect(body.match(/^\| `op/gm)).toHaveLength(100);
    expect(body).toContain('…and 3 more');
  });
});

/** Runs area_issues() on made-up rows and returns [title, body] pairs. */
function areaIssues(rows: Row[]): [string, string][] {
  const code = [
    'import sys, json, types, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'rows = json.load(sys.stdin)',
    "json.dump(h.area_issues(rows, types.SimpleNamespace(run_url='http://run')), sys.stdout)",
  ].join('\n');
  return JSON.parse(
    execFileSync('python3', ['-B', '-c', code], { input: JSON.stringify(rows), encoding: 'utf8' }),
  );
}

describe('per-area coverage gap issues', () => {
  const gap = (id: string, area: string): Row => ({
    ...ok(id),
    area,
    cells: { '2xx': 'ok', '404': 'gap' },
  });

  it('opens nothing when no area has a gap', () => {
    expect(areaIssues([{ ...ok('a'), area: 'Files' }])).toEqual([]);
  });

  it('makes one issue per area, only for areas with a gap, sorted by area', () => {
    const issues = areaIssues([
      gap('f1', 'Files'),
      gap('f2', 'Files'),
      { ...ok('c1'), area: 'Comments' },
      gap('m1', 'Milestones'),
    ]);
    expect(issues.map(([title]) => title)).toEqual([
      '[hub-response-coverage] Files: missing response or bad-request tests',
      '[hub-response-coverage] Milestones: missing response or bad-request tests',
    ]);
    expect(issues[0][1]).toContain('**2** endpoints in the **Files** area');
    expect(issues[0][1]).toContain('`f1`');
    expect(issues[0][1]).not.toContain('`m1`');
    expect(issues[1][1]).toContain('**1** endpoint in the **Milestones** area');
  });

  it('files an endpoint without an area under Other', () => {
    const [[title]] = areaIssues([{ ...ok('x'), cells: { '2xx': 'gap' } }]);
    expect(title).toBe('[hub-response-coverage] Other: missing response or bad-request tests');
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
  mkdirSync(join(report, 'areas'), { recursive: true });
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
  execFileSync('bash', [join(scriptsDir, script)], {
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
  const read = (f: string) =>
    existsSync(join(report, f)) ? readFileSync(join(report, f), 'utf8') : '';
  return {
    calls: readFileSync(join(dir, 'log'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('gh issue list')),
    issueUrl: read('issue-url.txt').trim(),
    areaLinks: read('area-links.txt').trim().split('\n').filter(Boolean),
  };
}

const area = (name: string, gaps = 1) => ({
  title: areaTitle(name),
  file: `$REPORT/areas/${name}.md`,
  area: name,
  gaps,
});
const areaFiles = (...names: string[]) => ({
  'areas.json': JSON.stringify(names.map((n) => area(n))),
  ...Object.fromEntries(names.map((n) => [`areas/${n}.md`, `body ${n}`])),
});

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

describe('per-area issue lifecycle (stub gh)', () => {
  it('creates, updates and reopens by exact title, and links each one', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('New', 'Open', 'Shut'), [
      { number: 5, title: areaTitle('Open'), state: 'OPEN' },
      { number: 6, title: areaTitle('Shut'), state: 'CLOSED' },
    ]);
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(1);
    expect(r.calls).toContain('gh issue reopen 6');
    expect(r.calls.some((c) => c.startsWith('gh issue edit 5 '))).toBe(true);
    expect(r.areaLinks).toEqual([
      '<https://example.test/issues/101|New (1)>',
      '<https://example.test/issues/5|Open (1)>',
      '<https://example.test/issues/6|Shut (1)>',
    ]);
  });

  it('opens at most MAX_NEW_AREA_ISSUES new issues and lists the rest unlinked', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('A', 'B', 'C'), [], {
      MAX_NEW_AREA_ISSUES: '2',
    });
    expect(r.calls.filter((c) => c.includes('issue create'))).toHaveLength(2);
    expect(r.areaLinks).toEqual([
      '<https://example.test/issues/101|A (1)>',
      '<https://example.test/issues/102|B (1)>',
      'C (1)',
    ]);
  });

  it('closes an open area issue whose area is clean, but never the summary issue', () => {
    const r = runIssueScript('hub-coverage-area-issues.sh', areaFiles('Kept'), [
      { number: 5, title: areaTitle('Kept'), state: 'OPEN' },
      { number: 6, title: areaTitle('Fixed'), state: 'OPEN' },
      { number: 7, title: SUMMARY, state: 'OPEN' },
      { number: 8, title: areaTitle('AlreadyClosed'), state: 'CLOSED' },
    ]);
    const closes = r.calls.filter((c) => c.includes('issue close'));
    expect(closes).toHaveLength(1);
    expect(closes[0]).toContain('issue close 6');
  });
});
