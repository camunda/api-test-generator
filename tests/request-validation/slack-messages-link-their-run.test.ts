import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// Every top-level Slack message a workflow posts links the run that posted it, so a reader can
// open the logs from the message. These are the messages that had none.
describe('Slack messages link their workflow run', () => {
  it('the spec-bump drift alert', () => {
    const wf = read('.github/workflows/spec-bump-check.yml');
    expect(wf).toContain(
      `RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}`,
    );
    expect(wf).toContain(`<\${e.RUN_URL}|📊 View run>`);
  });

  it('the gap digest and the missing-post alert read the run URL from the Actions environment', () => {
    for (const file of [
      'scripts/triage/hub-gap-digest.ts',
      'scripts/triage/hub-nightly-post-check.ts',
    ]) {
      const src = read(file);
      expect(src).toContain("env('GITHUB_RUN_ID')");
      expect(src).toContain('runUrl: runUrl()');
    }
  });
});
