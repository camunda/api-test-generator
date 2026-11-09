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
  '../../.github/scripts/hub-assign-fix-prs.sh',
);

// Stubs keep the orchestration test off git and the network: `gh` records each
// call it's asked to make — `pr edit` for PRs, `issue edit` / `issue comment`
// for the fresh-bug issue (and fails calls whose args match a pattern) — and the
// author resolver maps an operationId to a login from a table. So the test
// exercises the script's JSON filtering, suppress-PR exclusion, PR grouping,
// dedup, assignment, the team-review fallback and the issue assignment +
// @camunda/hub mention fallback — not the real resolver/gh.
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
  ghTokenHub?: string;
}

function runAssign(
  triage: unknown,
  opts: Opts = {},
): { log: string[]; stdout: string; unrouted: string } {
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

  const unroutedFile = join(dir, 'unrouted.txt');
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
        GH_TOKEN_HUB: opts.ghTokenHub ?? 'x',
        HUB_TOKEN: 'x',
        HUB_TEAM: 'camunda/hub',
        UNROUTED_FILE: unroutedFile,
      },
    });
  } catch (err) {
    stdout = String(err);
  }
  const log = readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean);
  const unrouted = existsSync(unroutedFile) ? readFileSync(unroutedFile, 'utf8') : '';
  return { log, stdout, unrouted };
}

const count = (log: string[], needle: string) => log.filter((l) => l.includes(needle)).length;

describe('hub-assign-fix-prs.sh', () => {
  it('requests review (no assignee) for a product-bug suppress PR', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: null,
            action: 'report-only',
            suppress_pr_url: 'PR_SUP',
            operationId: 'opX',
          },
        ],
        unmapped_operations: [],
      },
      { authors: { opX: 'alice' } },
    );
    expect(log).toContain('pr edit PR_SUP --add-reviewer alice');
    // a suppress PR is reviewed, never assigned — the owner sanity-checks it
    expect(count(log, 'PR_SUP --add-assignee')).toBe(0);
  });

  it('falls back to the team for a suppress PR whose author cannot be resolved', () => {
    const { log } = runAssign(
      {
        failures: [
          {
            subcategory: null,
            action: 'report-only',
            suppress_pr_url: 'PR_SUP2',
            operationId: 'opY',
          },
        ],
      },
      { authors: {} },
    );
    expect(log).toContain('pr edit PR_SUP2 --add-reviewer camunda/hub');
    expect(count(log, 'PR_SUP2 --add-assignee')).toBe(0);
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

  it('falls back to the team for a fix PR with no operationId (never dropped)', () => {
    const { log } = runAssign(
      { failures: [{ subcategory: 'test-generation', action: 'fix-pr', fix_pr_url: 'PR7' }] },
      { authors: {} },
    );
    expect(log).toContain('pr edit PR7 --add-reviewer camunda/hub');
    expect(count(log, 'PR7 --add-assignee')).toBe(0);
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

  it('does nothing when there are no fix/suppress PRs or fresh bug issues', () => {
    const { log, stdout } = runAssign({
      failures: [
        { subcategory: null, action: 'skip', category: 'infrastructure', operationId: 'q' },
      ],
      unmapped_operations: [],
    });
    expect(log).toHaveLength(0);
    expect(stdout).toContain('No fix/suppress PRs or fresh bug issues to attribute');
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

describe('hub-assign-fix-prs.sh: fresh bug issue', () => {
  it('assigns the endpoint author to a freshly filed Hub bug', () => {
    const { log } = runAssign(
      {
        failures: [{ action: 'file', issue_url: 'ISSUE1', operationId: 'getFile' }],
        unmapped_operations: [],
      },
      { authors: { getFile: 'alice' } },
    );
    expect(log).toContain('issue edit ISSUE1 --add-assignee alice');
    // author resolved and assigned, so no @camunda/hub mention fallback
    expect(count(log, 'issue comment ISSUE1')).toBe(0);
  });

  it('mentions @camunda/hub on the issue when no author resolves', () => {
    const { log } = runAssign(
      { failures: [{ action: 'file', issue_url: 'ISSUE2', operationId: 'getZ' }] },
      { authors: {} },
    );
    expect(log.some((l) => l.includes('issue comment ISSUE2') && l.includes('@camunda/hub'))).toBe(
      true,
    );
    // no author, so nothing is assigned
    expect(count(log, 'ISSUE2 --add-assignee')).toBe(0);
  });

  it('mentions @camunda/hub when the individual assignment fails', () => {
    const { log } = runAssign(
      { failures: [{ action: 'file', issue_url: 'ISSUE3', operationId: 'getFile' }] },
      { authors: { getFile: 'alice' }, failPatterns: ['issue edit ISSUE3 --add-assignee alice'] },
    );
    expect(log).toContain('issue edit ISSUE3 --add-assignee alice'); // attempted (and failed)
    expect(log.some((l) => l.includes('issue comment ISSUE3') && l.includes('@camunda/hub'))).toBe(
      true,
    );
  });

  it('skips issue assignment when GH_TOKEN_HUB is empty', () => {
    const { log, stdout } = runAssign(
      { failures: [{ action: 'file', issue_url: 'ISSUE4', operationId: 'getFile' }] },
      { authors: { getFile: 'alice' }, ghTokenHub: '' },
    );
    expect(count(log, 'ISSUE4')).toBe(0);
    expect(stdout).toContain('GH_TOKEN_HUB is empty');
  });

  it('does not touch an already-known recurrence (no file action)', () => {
    const { log } = runAssign(
      {
        failures: [
          { action: 'report-only', known_issue: true, issue_url: 'ISSUE5', operationId: 'getFile' },
        ],
      },
      { authors: { getFile: 'alice' } },
    );
    expect(count(log, 'ISSUE5')).toBe(0);
  });

  it('dedups multiple operations on one issue to a single assignee', () => {
    const { log } = runAssign(
      {
        failures: [
          { action: 'file', issue_url: 'ISSUE6', operationId: 'getA' },
          { action: 'file', issue_url: 'ISSUE6', operationId: 'getB' },
        ],
      },
      { authors: { getA: 'alice', getB: 'alice' } },
    );
    expect(count(log, 'issue edit ISSUE6 --add-assignee alice')).toBe(1);
  });

  it('keeps a filed bug with no operationId and mentions @camunda/hub (never dropped)', () => {
    const { log } = runAssign(
      { failures: [{ action: 'file', issue_url: 'ISSUE7' }] },
      { authors: { getFile: 'alice' } },
    );
    expect(log.some((l) => l.includes('issue comment ISSUE7') && l.includes('@camunda/hub'))).toBe(
      true,
    );
    expect(count(log, 'ISSUE7 --add-assignee')).toBe(0);
  });
});

describe('hub-assign-fix-prs.sh: unrouted fail-safe', () => {
  it('records a fix PR as unrouted when the @camunda/hub team fallback also fails', () => {
    // No author resolves → team-review fallback → that request also fails, so the
    // PR has no owner. It must be recorded so the digest can page hub-medic.
    const { unrouted } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PRX',
            operationId: 'op',
          },
        ],
      },
      { authors: {}, failPatterns: ['--add-reviewer camunda/hub'] },
    );
    expect(unrouted).toContain('PRX');
  });

  it('records a filed bug as unrouted when the @camunda/hub mention also fails', () => {
    const { unrouted } = runAssign(
      { failures: [{ action: 'file', issue_url: 'ISSUEX', operationId: 'op' }] },
      { authors: {}, failPatterns: ['issue comment ISSUEX'] },
    );
    expect(unrouted).toContain('ISSUEX');
  });

  it('records nothing when a finding is routed to an owner', () => {
    const { unrouted } = runAssign(
      {
        failures: [
          {
            subcategory: 'test-generation',
            action: 'fix-pr',
            fix_pr_url: 'PRY',
            operationId: 'getFile',
          },
        ],
      },
      { authors: { getFile: 'alice' } },
    );
    expect(unrouted.trim()).toBe('');
  });
});
