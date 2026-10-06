import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

  it('prints nothing when there is nothing to report', () => {
    expect(format([]).trim()).toBe('');
  });
});
