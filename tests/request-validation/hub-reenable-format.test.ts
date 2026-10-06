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
