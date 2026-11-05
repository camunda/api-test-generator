import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/triage/hub-triage-format-slack.sh',
);

const HUB = 'https://github.com/camunda/camunda-hub';

function threadLine(relatedCommit: unknown, extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'triage-format-'));
  const file = join(dir, 'hub-triage.json');
  writeFileSync(
    file,
    JSON.stringify({
      failures: [
        {
          suite: 'negative',
          operationId: 'searchCatalogAssetProjectUsages',
          category: 'product',
          subcategory: 'test-generation',
          expected: '400',
          actual: '404',
          action: 'report-only',
          related_commit: relatedCommit,
          ...extra,
        },
      ],
    }),
  );
  return execFileSync('bash', [script, file, 'thread'], { encoding: 'utf8' });
}

describe('triage Slack thread: related_commit links', () => {
  it('links a leading sha to the camunda-hub commit and #N to the camunda-hub PR', () => {
    const text = threadLine('8fa152b500 feat(catalog): add endpoint (#28600)');
    expect(text).toContain(`:link: <${HUB}/commit/8fa152b500|8fa152b500>`);
    expect(text).toContain(`(<${HUB}/pull/28600|#28600>)`);
  });

  it('shortens a full 40-character sha to 10 characters in the link text', () => {
    const sha = '8fa152b5000000000000000000000000000000ab';
    const text = threadLine(`${sha} (#1)`);
    expect(text).toContain(`<${HUB}/commit/${sha}|8fa152b500>`);
  });

  it('leaves an existing URL as a single link, without re-linking it', () => {
    const url = `${HUB}/pull/28600`;
    const text = threadLine(url);
    expect(text).toContain(`:link: <${url}>`);
    expect(text).not.toContain('commit/');
  });

  it('leaves plain text with no sha or #N unchanged', () => {
    const text = threadLine('explained by a recent change');
    expect(text).toContain(':link: explained by a recent change');
    expect(text).not.toContain('github.com');
  });

  it('does not link a sha that is not at the start, a short hex word, or a longer word', () => {
    expect(threadLine('see 8fa152b500')).not.toContain('/commit/');
    expect(threadLine('abc123 fixed it')).not.toContain('/commit/');
    expect(threadLine('8fa152b500zz fixed it')).not.toContain('/commit/');
  });

  it('links every #N in the text', () => {
    const text = threadLine('8fa152b500 (#1, #22)');
    expect(text).toContain(`<${HUB}/pull/1|#1>`);
    expect(text).toContain(`<${HUB}/pull/22|#22>`);
  });

  it('uses the wait-and-see icon only for a product finding held back for the commit', () => {
    const held = threadLine('8fa152b500 (#1)', { subcategory: null, action: 'skip' });
    expect(held).toContain(':hourglass_flowing_sand:');
    expect(held).not.toContain(':link:');
    const fixed = threadLine('8fa152b500 (#1)', { action: 'fix-pr', fix_pr_url: `${HUB}/pull/2` });
    expect(fixed).toContain(':link:');
    expect(fixed).not.toContain(':hourglass_flowing_sand:');
  });

  it('keeps the link icon when skip means an open fix PR already covers a test-generation finding', () => {
    const deduped = threadLine('8fa152b500 (#1)', {
      action: 'skip',
      fix_pr_url: 'https://github.com/camunda/api-test-generator/pull/9',
    });
    expect(deduped).toContain(':link:');
    expect(deduped).not.toContain(':hourglass_flowing_sand:');
    const noUrl = threadLine('8fa152b500 (#1)', { action: 'skip' });
    expect(noUrl).toContain(':link:');
    expect(noUrl).not.toContain(':hourglass_flowing_sand:');
  });

  it('keeps the link icon for a skipped non-product finding', () => {
    for (const category of ['infrastructure', 'flakiness']) {
      const text = threadLine('8fa152b500 (#1)', { category, subcategory: null, action: 'skip' });
      expect(text).toContain(':link:');
      expect(text).not.toContain(':hourglass_flowing_sand:');
    }
  });

  it('ignores a malformed fix_pr_url when deciding why a product finding was skipped', () => {
    for (const fix_pr_url of [42, {}, true, '']) {
      const text = threadLine('8fa152b500 (#1)', {
        subcategory: null,
        action: 'skip',
        fix_pr_url,
      });
      expect(text).toContain(':hourglass_flowing_sand:');
      expect(text).not.toContain(':link:');
    }
  });

  it('does not link a number followed by letters as a PR', () => {
    const text = threadLine('8fa152b500 (#123abc)');
    expect(text).not.toContain('/pull/');
    expect(text).toContain('#123abc');
  });

  it('prints no related-commit marker when the value is empty or not a string', () => {
    for (const value of ['', null, 42]) {
      for (const action of ['report-only', 'skip']) {
        const text = threadLine(value, { subcategory: null, action });
        expect(text).not.toContain(':link:');
        expect(text).not.toContain(':hourglass_flowing_sand:');
      }
    }
  });
});

describe('triage Slack summary: recent-change counter', () => {
  function summary(counts: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'triage-summary-'));
    const file = join(dir, 'hub-triage.json');
    writeFileSync(
      file,
      JSON.stringify({
        suites: {
          positive: { passed: 5, failed: 0, report: 'present' },
          negative: { passed: 3, failed: 2, report: 'present' },
        },
        failures: [
          { suite: 'negative', operationId: 'a', category: 'product', action: 'skip' },
          { suite: 'negative', operationId: 'b', category: 'product', action: 'skip' },
        ],
        unmapped_operations: [],
        counts,
      }),
    );
    return execFileSync('bash', [script, file, 'summary'], { encoding: 'utf8' });
  }

  it('shows the wait-and-see icon, the label and the count', () => {
    const text = summary({ product: 2, skipped_recent_change: 2 });
    expect(text).toContain(':hourglass_flowing_sand: no Hub bug filed (recent change): 2');
  });

  it('does not use the word skipped for it, so it is not mistaken for a suppress PR', () => {
    const text = summary({ product: 2, skipped_recent_change: 2 });
    expect(text).not.toContain('skipped (recent change)');
    expect(text).not.toContain(':fast_forward:');
  });

  it('omits the counter when nothing was held back for a recent change', () => {
    const text = summary({ product: 2, skipped_recent_change: 0 });
    expect(text).not.toContain('no Hub bug filed');
  });
});

describe('triage Slack thread: who is pinged', () => {
  const HUB_MEDIC = '<!subteam^S014VK4482H|hub-medic>';
  const issue = `${HUB}/issues/1`;
  const pr = 'https://github.com/camunda/api-test-generator/pull/1';
  const pings = (text: string) => text.split(HUB_MEDIC).length - 1;

  it('pings hub-medic once when a new Hub issue was filed', () => {
    const text = threadLine('', { action: 'file', issue_url: issue });
    expect(pings(text)).toBe(1);
  });

  it('pings hub-medic once for a fresh fix PR', () => {
    expect(pings(threadLine('', { action: 'fix-pr', fix_pr_url: pr }))).toBe(1);
  });

  it('a suppress PR pings nobody — the endpoint owner reviews it instead', () => {
    const text = threadLine('', { action: 'report-only', known_issue: true, suppress_pr_url: pr });
    expect(pings(text)).toBe(0);
    expect(text).not.toContain(':rotating_light:');
    // the suppress PR is still shown on the line, just not pinged
    expect(text).toContain(pr);
  });

  it('a freshly-filed bug that also has a suppress PR pings hub-medic exactly once', () => {
    // the file trigger pings; the suppress PR adds no second mention
    expect(pings(threadLine('', { action: 'file', issue_url: issue, suppress_pr_url: pr }))).toBe(
      1,
    );
  });

  it('pings hub-medic when the agent could not classify the failure', () => {
    const text = threadLine('', { category: 'infrastructure', confidence: 'low' });
    expect(pings(text)).toBe(1);
  });

  it('does not ping for an already-known recurrence with no PR', () => {
    const text = threadLine('', { action: 'report-only', known_issue: true });
    expect(pings(text)).toBe(0);
  });

  it('never mentions test-automation-medic', () => {
    for (const extra of [
      { action: 'file', issue_url: issue },
      { action: 'fix-pr', fix_pr_url: pr },
      { action: 'report-only', suppress_pr_url: pr },
      { category: 'infrastructure', confidence: 'low' },
    ]) {
      const text = threadLine('', extra);
      expect(text).not.toContain('S09UF0EV0HG');
      expect(text).not.toContain('test-automation-medic');
    }
  });
});

describe('triage Slack thread: unmapped operations', () => {
  const HUB_MEDIC = '<!subteam^S014VK4482H|hub-medic>';
  const pr = 'https://github.com/camunda/api-test-generator/pull/1';
  const pings = (text: string) => text.split(HUB_MEDIC).length - 1;

  function unmappedLine(u: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'triage-unmapped-'));
    const file = join(dir, 'hub-triage.json');
    writeFileSync(
      file,
      JSON.stringify({ failures: [], unmapped_operations: [{ operationId: 'getThing', ...u }] }),
    );
    return execFileSync('bash', [script, file, 'thread'], { encoding: 'utf8' });
  }

  it('renders the unmapped bullet and the operationId', () => {
    const text = unmappedLine({ action: 'report-only' });
    expect(text).toContain('unmapped — `getThing` — no generated test');
  });

  it('pings hub-medic once when a fresh fix PR was opened for the gap', () => {
    const text = unmappedLine({ action: 'fix-pr', fix_pr_url: pr });
    expect(pings(text)).toBe(1);
    expect(text).toContain(`:hammer_and_wrench: <${pr}>`);
  });

  it('does not ping when an existing PR already covers the gap (skip)', () => {
    const text = unmappedLine({ action: 'skip', fix_pr_url: pr });
    expect(pings(text)).toBe(0);
    expect(text).toContain(`:recycle: <${pr}>`);
  });

  it('does not ping for a report-only gap with no fix PR, and never pages test-automation-medic', () => {
    for (const u of [
      { action: 'report-only' },
      { action: 'fix-pr', fix_pr_url: '' },
      { action: 'fix-pr', fix_pr_url: pr },
    ]) {
      const text = unmappedLine(u);
      expect(text).not.toContain('test-automation-medic');
    }
    expect(pings(unmappedLine({ action: 'report-only' }))).toBe(0);
    expect(pings(unmappedLine({ action: 'fix-pr', fix_pr_url: '' }))).toBe(0);
  });
});
