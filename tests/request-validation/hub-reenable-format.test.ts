import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-reenable-format-slack.sh',
);

function format(items: unknown[], env: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'reenable-'));
  const file = join(dir, 'summary.json');
  writeFileSync(file, JSON.stringify(items));
  return execFileSync('bash', [script, file], {
    encoding: 'utf8',
    env: { ...process.env, RUN_URL: '', ...env },
  });
}

const suiteWide = (reason?: string) => ({
  type: 'suite_wide_closed',
  url: 'https://github.com/camunda/camunda-hub/issues/25926',
  summary: 'Wrong-type tests on resource-key body fields are skipped',
  ...(reason === undefined ? {} : { reason }),
});

describe('re-enable check Slack message', () => {
  it('tells the reader what to change when a suite-wide issue was fixed', () => {
    const text = format([suiteWide('COMPLETED')]);
    expect(text).toContain('is closed as *fixed*');
    expect(text).toContain('To re-enable: remove its entry from `knownIssues`');
    expect(text).toContain('configs/camunda-hub/request-validation.json');
    expect(text).not.toContain('needs manual follow-up');
  });

  it('keeps the skip when the issue was closed as not planned', () => {
    const text = format([suiteWide('NOT_PLANNED')]);
    expect(text).toContain('closed as *not planned*');
    expect(text).toContain('the skip stays');
    expect(text).not.toContain('To re-enable');
  });

  it('still gives the steps when the close reason is unknown (an older summary)', () => {
    const text = format([suiteWide()]);
    expect(text).toContain('is closed.');
    expect(text).toContain('To re-enable: remove its entry');
  });

  it('adds a link to the run only when one is given', () => {
    expect(format([suiteWide('COMPLETED')], { RUN_URL: 'https://x/run' })).toContain(
      '<https://x/run|Open the workflow run>',
    );
    expect(format([suiteWide('COMPLETED')])).not.toContain('Open the workflow run');
  });

  it('adds a link to the cookbook only when one is given', () => {
    const withBoth = format([suiteWide('COMPLETED')], {
      RUN_URL: 'https://x/run',
      COOKBOOK_URL: 'https://x/book',
    });
    expect(withBoth).toContain(
      '<https://x/run|Open the workflow run> · <https://x/book|📖 Cookbook>',
    );
    expect(format([suiteWide('COMPLETED')], { COOKBOOK_URL: 'https://x/book' })).toContain(
      '<https://x/book|📖 Cookbook>',
    );
    expect(format([suiteWide('COMPLETED')])).not.toContain('Cookbook');
  });

  it('prints nothing when there is nothing to report', () => {
    expect(format([]).trim()).toBe('');
  });
});

describe('re-enable check Slack message: naming the fix author', () => {
  const opened = (fixer?: string) => ({
    type: 'opened',
    url: 'https://github.com/camunda/camunda-hub/issues/30001',
    title: 'getFolder returns the wrong shape',
    operations: 'getFolder',
    pr_url: 'https://github.com/camunda/api-test-generator/pull/999',
    ...(fixer === undefined ? {} : { fixer }),
  });
  const broke = (fixer?: string) => ({
    type: 'aborted_broke_checks',
    url: 'https://github.com/camunda/camunda-hub/issues/30002',
    title: 'updateFile optimistic lock',
    operations: 'updateFile',
    ...(fixer === undefined ? {} : { fixer }),
  });

  it('names the fix author as the PR assignee when one was resolved', () => {
    const text = format([opened('octocat')]);
    expect(text).toContain('assigned <https://github.com/octocat|@octocat> (landed the fix)');
  });

  it('omits the assignee note when no fix author was resolved', () => {
    const text = format([opened('')]);
    expect(text).toContain('draft PR');
    expect(text).not.toContain('assigned');
    // An older summary with no `fixer` field at all behaves the same.
    expect(format([opened()])).not.toContain('assigned');
  });

  it('cc-s the fix author on a partial-fix (needs-manual-investigation) alert', () => {
    const text = format([broke('octocat')]);
    expect(text).toContain('needs manual investigation');
    expect(text).toContain('Likely a partial fix — cc <https://github.com/octocat|@octocat>');
  });

  it('still reports the broken re-enable when no fix author was resolved', () => {
    const text = format([broke('')]);
    expect(text).toContain('needs manual investigation');
    expect(text).not.toContain('cc <https://github.com');
    expect(format([broke()])).not.toContain('cc <https://github.com');
  });

  it('prefers a real Slack @-mention over the GitHub link when fixerMention is set', () => {
    // fixerMention is the <@id> the slack-github-map resolver adds in the workflow.
    const openedText = format([{ ...opened('octocat'), fixerMention: '<@U123>' }]);
    expect(openedText).toContain('assigned <@U123> (landed the fix)');
    expect(openedText).not.toContain('https://github.com/octocat');

    const brokeText = format([{ ...broke('octocat'), fixerMention: '<@U123>' }]);
    expect(brokeText).toContain('Likely a partial fix — cc <@U123> (closed the blocker).');
  });

  it('falls back to the GitHub link when fixerMention is empty (unresolved)', () => {
    const text = format([{ ...opened('octocat'), fixerMention: '' }]);
    expect(text).toContain('assigned <https://github.com/octocat|@octocat>');
  });
});

describe('re-enable check: suite-wide issues closed as not planned', () => {
  /** Runs hub-reenable-check.sh in a scratch repo whose gh stub answers every issue with the given state. */
  function runCheck(knownIssues: unknown[], ghAnswer: string) {
    const dir = mkdtempSync(join(tmpdir(), 'reenable-check-'));
    cpSync(join(repoRoot, '.github'), join(dir, '.github'), { recursive: true });
    mkdirSync(join(dir, 'configs/camunda-hub'), { recursive: true });
    writeFileSync(join(dir, 'configs/camunda-hub/positive-suppress.json'), '{"suppress":[]}');
    writeFileSync(
      join(dir, 'configs/camunda-hub/request-validation.json'),
      JSON.stringify({ excludeOperations: [], knownIssues }),
    );
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'bin/gh'),
      `#!/usr/bin/env bash\nif [ "$1 $2" = "issue view" ]; then echo "${ghAnswer}"; fi\n`,
    );
    chmodSync(join(dir, 'bin/gh'), 0o755);
    const summary = join(dir, 'summary.json');
    execFileSync('bash', [join(dir, '.github/scripts/hub-reenable-check.sh')], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        GH_TOKEN_HUB: 'x',
        SUMMARY_FILE: summary,
      },
      stdio: 'ignore',
    });
    const items: { url: string; reason?: string }[] = JSON.parse(readFileSync(summary, 'utf8'));
    const message = execFileSync('bash', [script, summary], {
      encoding: 'utf8',
      env: { ...process.env, RUN_URL: '' },
    });
    return {
      issues: items.map((i) => i.url.split('/').pop()),
      reasons: items.map((i) => i.reason),
      message,
    };
  }
  const ki = (n: number, extra: object = {}) => ({
    summary: `issue ${n}`,
    url: `https://github.com/camunda/camunda-hub/issues/${n}`,
    ...extra,
  });

  it('reports a not-planned closure until it is acknowledged on the entry', () => {
    expect(
      runCheck([ki(11, { acknowledgedNotPlanned: true }), ki(12)], 'CLOSED NOT_PLANNED').issues,
    ).toEqual(['12']);
  });

  it('still reports an acknowledged entry once the issue was actually fixed', () => {
    expect(runCheck([ki(11, { acknowledgedNotPlanned: true })], 'CLOSED COMPLETED').issues).toEqual(
      ['11'],
    );
  });

  it('hands the close reason to the formatter, so each outcome gets its own instructions', () => {
    const declined = runCheck([ki(12)], 'CLOSED NOT_PLANNED');
    expect(declined.reasons).toEqual(['NOT_PLANNED']);
    expect(declined.message).toContain('closed as *not planned*');
    expect(declined.message).toContain('acknowledgedNotPlanned');
    const fixed = runCheck([ki(12)], 'CLOSED COMPLETED');
    expect(fixed.reasons).toEqual(['COMPLETED']);
    expect(fixed.message).toContain('closed as *fixed*');
    expect(fixed.message).toContain('To re-enable');
  });
});

describe('re-enable check: op-scoped fix-author resolution and assignment (end-to-end script)', () => {
  type SummaryItem = { type: string; fixer?: string; pr_url?: string; operations?: string };

  /**
   * Drives hub-reenable-check.sh against one op-scoped, CLOSED blocker in a scratch git repo.
   * `gh`, `git`, `npm` and `npx` are stubbed on PATH so nothing leaves the sandbox:
   *   - `gh issue view` → CLOSED; `gh api .../issues/N` → the closed_by/assignee pair (or a failure);
   *   - `npm` (generate) always succeeds; `npx` (the local guard) succeeds iff `guardPasses`,
   *     so guardPasses=false drives the `aborted_broke_checks` path and true drives `opened`;
   *   - `git push`/`remote` are no-ops; `gh pr create` returns a URL; `gh pr edit --add-assignee`
   *     succeeds unless `assignFails`.
   */
  function runOpScoped(opts: {
    closedBy?: string;
    assignee?: string;
    apiFails?: boolean;
    guardPasses: boolean;
    assignFails?: boolean;
  }): SummaryItem[] {
    const dir = mkdtempSync(join(tmpdir(), 'reenable-op-'));
    cpSync(join(repoRoot, '.github'), join(dir, '.github'), { recursive: true });
    mkdirSync(join(dir, 'configs/camunda-hub'), { recursive: true });
    writeFileSync(join(dir, 'configs/camunda-hub/positive-suppress.json'), '{"suppress":[]}\n');
    writeFileSync(
      join(dir, 'configs/camunda-hub/request-validation.json'),
      `${JSON.stringify(
        {
          excludeOperations: [
            {
              operationId: 'foo',
              scenarioKinds: ['missing-required'],
              knownIssue: {
                summary: 's',
                url: 'https://github.com/camunda/camunda-hub/issues/123',
              },
            },
          ],
          knownIssues: [],
        },
        null,
        2,
      )}\n`,
    );

    // A real git repo so the script's checkout/add/commit work; the git stub no-ops push/remote.
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, env: gitEnv, stdio: 'ignore' });

    mkdirSync(join(dir, 'bin'));
    const apiLine = opts.apiFails
      ? 'exit 1'
      : `printf '%s\\t%s' '${opts.closedBy ?? ''}' '${opts.assignee ?? ''}'`;
    const editLine = opts.assignFails ? 'echo "no access" >&2; exit 1' : 'exit 0';
    writeFileSync(
      join(dir, 'bin/gh'),
      [
        '#!/usr/bin/env bash',
        'case "$1" in',
        `  issue) echo '{"state":"CLOSED","title":"T"}' ;;`,
        `  api) ${apiLine} ;;`,
        '  pr)',
        '    case "$2" in',
        '      create) echo "https://github.com/camunda/api-test-generator/pull/4242" ;;',
        `      edit) ${editLine} ;;`,
        '      *) : ;;',
        '    esac ;;',
        '  *) : ;;',
        'esac',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'bin/git'),
      '#!/usr/bin/env bash\ncase "$1" in\n  push|remote) exit 0 ;;\n  *) exec /usr/bin/git "$@" ;;\nesac\n',
    );
    writeFileSync(join(dir, 'bin/npm'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(dir, 'bin/npx'), `#!/usr/bin/env bash\nexit ${opts.guardPasses ? 0 : 1}\n`);
    for (const b of ['gh', 'git', 'npm', 'npx']) chmodSync(join(dir, `bin/${b}`), 0o755);

    const summaryFile = join(dir, 'summary.json');
    execFileSync('bash', [join(dir, '.github/scripts/hub-reenable-check.sh')], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        GH_TOKEN_HUB: 'x',
        GH_TOKEN_GENERATOR: 'x',
        SUMMARY_FILE: summaryFile,
      },
      stdio: 'ignore',
    });
    return JSON.parse(readFileSync(summaryFile, 'utf8'));
  }

  it('resolves the fix author from closed_by when it is a real user', () => {
    const item = runOpScoped({ closedBy: 'alice', assignee: 'bob', guardPasses: false }).find(
      (i) => i.type === 'aborted_broke_checks',
    );
    expect(item?.fixer).toBe('alice');
  });

  it('falls back to the first assignee when closed_by is a bot', () => {
    const item = runOpScoped({ closedBy: 'ci[bot]', assignee: 'bob', guardPasses: false }).find(
      (i) => i.type === 'aborted_broke_checks',
    );
    expect(item?.fixer).toBe('bob');
  });

  it('tags no one when the closer is a bot and there is no assignee', () => {
    const item = runOpScoped({ closedBy: 'ci[bot]', assignee: '', guardPasses: false }).find(
      (i) => i.type === 'aborted_broke_checks',
    );
    expect(item?.fixer).toBe('');
  });

  it('tags no one when the author lookup fails', () => {
    const item = runOpScoped({ apiFails: true, guardPasses: false }).find(
      (i) => i.type === 'aborted_broke_checks',
    );
    expect(item?.fixer).toBe('');
  });

  it('rejects a non-login candidate so arbitrary API text never becomes the fixer', () => {
    // Defensive: even if gh/jq returned something that is not a GitHub login (e.g. an error
    // phrase), the charset guard drops it rather than letting it reach the summary / Slack link.
    const item = runOpScoped({ closedBy: 'Not Found', assignee: '', guardPasses: false }).find(
      (i) => i.type === 'aborted_broke_checks',
    );
    expect(item?.fixer).toBe('');
  });

  it('assigns the fix author on the opened unskip PR', () => {
    const item = runOpScoped({ closedBy: 'alice', guardPasses: true, assignFails: false }).find(
      (i) => i.type === 'opened',
    );
    expect(item?.pr_url).toContain('/pull/');
    expect(item?.fixer).toBe('alice');
  });

  it('clears fixer when the assignment fails, so Slack cannot claim it stuck', () => {
    const item = runOpScoped({ closedBy: 'alice', guardPasses: true, assignFails: true }).find(
      (i) => i.type === 'opened',
    );
    expect(item?.pr_url).toContain('/pull/'); // the PR still opened
    expect(item?.fixer).toBe(''); // but no assignee is claimed in the summary
  });
});
