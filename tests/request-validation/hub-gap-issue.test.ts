import { execFileSync } from 'node:child_process';
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
