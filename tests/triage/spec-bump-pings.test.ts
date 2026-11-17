import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(dir, '../../.github/workflows/spec-bump-check.yml'), 'utf8');
const openPr = readFileSync(join(dir, '../../.github/scripts/spec-bump-open-pr.sh'), 'utf8');

describe('spec-bump-check Slack pings', () => {
  const line = workflow.split('\n').find((l) => l.includes('Spec-bump check failed for')) ?? '';

  it('pings test-automation-medic when a step of the Hub check itself failed', () => {
    // A broken scheduled run is CI machinery (test-automation owns it), not a Hub
    // finding — never hub-medic.
    expect(line).toContain(
      "matrix.private && ' · :rotating_light: <!subteam^S09UF0EV0HG|test-automation-medic>'",
    );
  });

  it('does not page anyone for the camunda-oca leg', () => {
    expect(line).toContain("|| '')");
  });

  it('keeps the mention on one line: an expression string does not interpret "\\n"', () => {
    expect(line).not.toContain('\\n');
  });

  it('pages hub-medic only when the auto-bump is BLOCKED (broken drift), never on a clean bump', () => {
    // A CLEAN drift pings nobody: its bump PR already requests @camunda/hub review
    // (the reviewer carries the signal). A BLOCKED drift only files a tracking
    // issue with no reviewer, so without a page it sits unseen — the camunda-hub
    // Credential-removal drift did exactly that. The Hub team owns the camunda-hub
    // config (docs/how-it-works.md "Who owns what"), so the page is hub-medic. A
    // broken scheduled *run* still pages test-automation-medic (the leg-failure line).
    expect(workflow.split('S014VK4482H').length - 1).toBe(1);
    expect(workflow.split('S09UF0EV0HG').length - 1).toBe(1);

    // The hub-medic page is set ONLY under the deterministic broken-drift
    // condition — computed from the routing inputs, not the racy open-issue
    // lookup (GitHub search indexing lags and can miss a just-filed issue, which
    // is why the real Credential alert fell through to the "Canonical heads-up"
    // branch rather than "Blocked — see tracking issue").
    const payloadStep = workflow.slice(workflow.indexOf('Build hub drift Slack payload'));
    expect(payloadStep).toContain('mention=":rotating_light: <!subteam^S014VK4482H|hub-medic>"');
    for (const guard of [
      'GEN_OUTCOME',
      'INV_OUTCOME',
      'HAS_UNMAPPED',
      'HAS_NEWLY_REQUIRED',
      'APP_TOKEN_EMPTY',
    ]) {
      expect(payloadStep).toContain(guard);
    }
  });
});

describe('spec-bump-check hub bump PR reviewer', () => {
  it('requests @camunda/hub review on the bump PR', () => {
    expect(openPr).toContain('--add-reviewer camunda/hub');
  });

  it('requests it only on the hub (private) leg', () => {
    // request_hub_review returns early unless IS_PRIVATE=true (oca routes elsewhere).
    expect(openPr).toMatch(/IS_PRIVATE[^\n]*\|\|\s*return 0/);
  });

  it('requests the review only once — a marker label guards the daily re-run', () => {
    // The existing-PR path runs daily; without a guard it would re-request (and
    // re-notify) an already-reviewed bump PR. The marker is checked before
    // requesting and set only after a successful request.
    expect(openPr).toContain('HUB_REVIEW_MARKER="hub-review-requested"');
    expect(openPr).toMatch(/grep -qx "\$HUB_REVIEW_MARKER"/);
  });
});
