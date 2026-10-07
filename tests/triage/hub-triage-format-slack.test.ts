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

function threadLine(relatedCommit: unknown): string {
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
        },
      ],
    }),
  );
  return execFileSync('bash', [script, file, 'thread'], { encoding: 'utf8' });
}

describe('triage Slack thread: related_commit links', () => {
  it('links a leading sha to the camunda-hub commit and #N to the camunda-hub PR', () => {
    const text = threadLine('8fa152b500 feat(catalog): add endpoint (#28600)');
    expect(text).toContain(`:fast_forward: <${HUB}/commit/8fa152b500|8fa152b500>`);
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
    expect(text).toContain(`:fast_forward: <${url}>`);
    expect(text).not.toContain('commit/');
  });

  it('leaves plain text with no sha or #N unchanged', () => {
    const text = threadLine('explained by a recent change');
    expect(text).toContain(':fast_forward: explained by a recent change');
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

  it('prints no related-commit marker when the value is empty or not a string', () => {
    expect(threadLine('')).not.toContain(':fast_forward:');
    expect(threadLine(null)).not.toContain(':fast_forward:');
    expect(threadLine(42)).not.toContain(':fast_forward:');
  });
});
