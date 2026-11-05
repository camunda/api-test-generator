import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-assign-fix-prs.sh',
);

// Stubs keep the orchestration test off git and the network: `gh` records each
// `pr edit` it's asked to make (and fails calls whose args match a pattern), and
// the author resolver maps an operationId to a login from a table. So the test
// exercises the script's JSON filtering, suppress-PR exclusion, PR grouping,
// dedup, assignment and the team-review fallback — not the real resolver/gh.
const GH_BODY = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ -s "$GH_FAIL" ]; then
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    case "$*" in *"$pat"*) exit 1 ;; esac
  done < "$GH_FAIL"
fi
exit 0
`;
const RESOLVER_BODY = `#!/usr/bin/env bash
awk -v op="$1" '$1==op{print $2; exit}' "$RESOLVER_MAP"
`;

interface Opts {
  authors?: Record<string, string>;
  failPatterns?: string[];
  hubGit?: boolean;
}

function runAssign(triage: unknown, opts: Opts = {}): { log: string[]; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'assign-'));
  const triageFile = join(dir, 'triage.json');
  writeFileSync(triageFile, JSON.stringify(triage));
  const ghLog = join(dir, 'gh.log');
  writeFileSync(ghLog, '');
  const ghFail = join(dir, 'gh.fail');
  writeFileSync(ghFail, `${(opts.failPatterns ?? []).join('\n')}\n`);
  const resolverMap = join(dir, 'resolver.map');
  writeFileSync(
    resolverMap,
    `${Object.entries(opts.authors ?? {})
      .map(([o, l]) => `${o} ${l}`)
      .join('\n')}\n`,
  );

  const gh = join(dir, 'gh');
  writeFileSync(gh, GH_BODY);
  chmodSync(gh, 0o755);
  const resolver = join(dir, 'resolver.sh');
  writeFileSync(resolver, RESOLVER_BODY);
  chmodSync(resolver, 0o755);

  const hub = join(dir, 'hub');
  mkdirSync(hub);
  if (opts.hubGit !== false) mkdirSync(join(hub, '.git'));

  let stdout = '';
  try {
    stdout = execFileSync('bash', [script, triageFile, hub], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GH: gh,
        AUTHOR_RESOLVER: resolver,
        GH_LOG: ghLog,
        GH_FAIL: ghFail,
        RESOLVER_MAP: resolverMap,
        GH_TOKEN_GENERATOR: 'x',
        HUB_TOKEN: 'x',
        HUB_TEAM: 'camunda/hub',
      },
    });
  } catch (err) {
    stdout = String(err);
  }
  const log = readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean);
  return { log, stdout };
}

const count = (log: string[], needle: string) => log.filter((l) => l.includes(needle)).length;

describe('hub-assign-fix-prs.sh', () => {
  it('excludes a product-bug suppress PR (never touches it)', () => {
    const { log, stdout } = runAssign({
      failures: [
        { subcategory: null, action: 'report-only', suppress_pr_url: 'PR_SUP', operationId: 'opX' },
      ],
      unmapped_operations: [],
    });
    expect(count(log, 'PR_SUP')).toBe(0);
    expect(log).toHaveLength(0);
    expect(stdout).toContain('No test-generation/unmapped-op fix PRs');
  });

  it('assigns and requests review for a test-generation fix PR', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR1',
            operationId: 'getFile',
          },
        ],
      },
      { authors: { getFile: 'alice' } },
    );
    expect(log).toContain('pr edit PR1 --add-assignee alice');
    expect(log).toContain('pr edit PR1 --add-reviewer alice');
    // reviewer resolved, so no team fallback
    expect(count(log, '--add-reviewer camunda/hub')).toBe(0);
  });

  it('assigns and requests review for an unmapped-operation fix PR', () => {
    const { log } = runAssign(
      {
        unmapped_operations: [{ action: 'fix-pr', fix_pr_url: 'PR2', operationId: 'getFolder' }],
      },
      { authors: { getFolder: 'bob' } },
    );
    expect(log).toContain('pr edit PR2 --add-assignee bob');
    expect(log).toContain('pr edit PR2 --add-reviewer bob');
  });

  it('dedups multiple operations on one PR to a single assignee', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR3',
            operationId: 'getA',
          },
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR3',
            operationId: 'getB',
          },
        ],
      },
      { authors: { getA: 'alice', getB: 'alice' } },
    );
    expect(count(log, 'pr edit PR3 --add-assignee alice')).toBe(1);
    expect(count(log, 'pr edit PR3 --add-reviewer alice')).toBe(1);
  });

  it('requests two distinct authors when a PR spans two operations', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR3',
            operationId: 'getA',
          },
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR3',
            operationId: 'getB',
          },
        ],
      },
      { authors: { getA: 'alice', getB: 'bob' } },
    );
    expect(log).toContain('pr edit PR3 --add-reviewer alice');
    expect(log).toContain('pr edit PR3 --add-reviewer bob');
  });

  it('falls back to the team when no author resolves', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR4',
            operationId: 'getZ',
          },
        ],
      },
      { authors: {} },
    );
    expect(log).toContain('pr edit PR4 --add-reviewer camunda/hub');
    expect(count(log, 'PR4 --add-assignee')).toBe(0);
  });

  it('falls back to the team when every author review request fails', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR5',
            operationId: 'getFile',
          },
        ],
      },
      { authors: { getFile: 'alice' }, failPatterns: ['--add-reviewer alice'] },
    );
    expect(log).toContain('pr edit PR5 --add-assignee alice');
    expect(log).toContain('pr edit PR5 --add-reviewer alice'); // attempted (and failed)
    expect(log).toContain('pr edit PR5 --add-reviewer camunda/hub'); // backstop
  });

  it('does nothing for a non-JSON triage result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assign-bad-'));
    const triageFile = join(dir, 'triage.json');
    writeFileSync(triageFile, 'not json {');
    const hub = join(dir, 'hub');
    mkdirSync(join(hub, '.git'), { recursive: true });
    const out = execFileSync('bash', [script, triageFile, hub], { encoding: 'utf8' });
    expect(out).toContain('not JSON');
  });

  it('does nothing when there are no fix PRs', () => {
    const { log, stdout } = runAssign({
      failures: [
        { subcategory: null, action: 'skip', category: 'infrastructure', operationId: 'q' },
      ],
      unmapped_operations: [],
    });
    expect(log).toHaveLength(0);
    expect(stdout).toContain('No test-generation/unmapped-op fix PRs');
  });

  it('skips when the camunda-hub checkout is missing', () => {
    const { log, stdout } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PR6',
            operationId: 'getFile',
          },
        ],
      },
      { authors: { getFile: 'alice' }, hubGit: false },
    );
    expect(log).toHaveLength(0);
    expect(stdout).toContain('camunda-hub checkout not found');
  });
});
