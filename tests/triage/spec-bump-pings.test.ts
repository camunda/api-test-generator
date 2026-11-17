import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildDriftMessage, isBlocked } from '../../scripts/triage/spec-bump-drift-slack.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(dir, '../../.github/workflows/spec-bump-check.yml'), 'utf8');
const openPr = readFileSync(join(dir, '../../.github/scripts/spec-bump-open-pr.sh'), 'utf8');

const HUB_MEDIC = '<!subteam^S014VK4482H|hub-medic>';
const countMentions = (text: string) => text.split(HUB_MEDIC).length - 1;

// A drift message with real op churn. The routing signals default to the CLEAN
// case (a bump PR opened, so no page); each test overrides only what it exercises.
const CLEAN = {
  PINNED: 'effe8f8',
  LATEST: '73ec1c9',
  N_ADDED: '0',
  N_REMOVED: '9',
  ADDED_CSV: '',
  REMOVED_CSV: 'createCredential, deleteCredential',
  UNMAPPED_LIST: '',
  LINK: '➡️ Adopt via <https://x/pr|bump PR #5>',
  RUN_URL: 'https://x/run',
  COOKBOOK_URL: 'https://x/cb',
  GEN_OUTCOME: 'success',
  INV_OUTCOME: 'success',
  HAS_UNMAPPED: 'false',
  HAS_NEWLY_REQUIRED: 'false',
  APP_TOKEN_EMPTY: 'false',
};

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

  it('wires the extracted drift builder with the routing signals, and inlines no hub-medic id', () => {
    // The drift message is built by the committed, unit-tested builder (below),
    // not an inline node -e — so the hub-medic subteam id lives there, not in the
    // workflow. The workflow only feeds it the routing signals.
    expect(workflow).toContain('node scripts/triage/spec-bump-drift-slack.ts');
    for (const signal of [
      'GEN_OUTCOME:',
      'INV_OUTCOME:',
      'HAS_UNMAPPED:',
      'HAS_NEWLY_REQUIRED:',
      'APP_TOKEN_EMPTY:',
    ]) {
      expect(workflow).toContain(signal);
    }
    // ta-medic still pages once (the leg-failure line); hub-medic is not inlined.
    expect(workflow.split('S09UF0EV0HG').length - 1).toBe(1);
    expect(workflow).not.toContain('S014VK4482H');
  });
});

describe('spec-bump drift message — hub-medic pages only a BLOCKED drift', () => {
  it('a clean drift pages nobody (bump PR opened → its @camunda/hub reviewer carries it)', () => {
    expect(isBlocked(CLEAN)).toBe(false);
    expect(countMentions(buildDriftMessage(CLEAN))).toBe(0);
  });

  // Each blocking input alone must page — and exactly once. This is the guard the
  // old string-presence test lacked: an unconditional mention would make the clean
  // case above fail, and dropping any branch here would make that input fail.
  const blockingInputs: Array<[string, Record<string, string>]> = [
    ['generate failed', { GEN_OUTCOME: 'failure' }],
    ['invariants failed', { INV_OUTCOME: 'failure' }],
    ['an uncovered operation', { HAS_UNMAPPED: 'true' }],
    ['a newly-required unfixtured field', { HAS_NEWLY_REQUIRED: 'true' }],
    ['no App token', { APP_TOKEN_EMPTY: 'true' }],
  ];
  for (const [label, override] of blockingInputs) {
    it(`pages hub-medic exactly once when blocked by ${label}`, () => {
      const env = { ...CLEAN, ...override };
      expect(isBlocked(env)).toBe(true);
      expect(countMentions(buildDriftMessage(env))).toBe(1);
    });
  }

  it('pages a blocked drift even when the issue lookup found nothing (Canonical heads-up link)', () => {
    // The real Credential drift fell through to this branch because GitHub search
    // had not indexed the just-filed tracking issue. The page must not depend on
    // the link resolving — only on the deterministic routing signal.
    const env = {
      ...CLEAN,
      HAS_UNMAPPED: 'true',
      LINK: 'ℹ️ Canonical heads-up: the `Spec-bump check: camunda-hub drifted from the pin` issue/PR.',
    };
    expect(countMentions(buildDriftMessage(env))).toBe(1);
  });

  it('a clean drift never pages, whatever the link says', () => {
    const withIssueLink = { ...CLEAN, LINK: '📋 Blocked — see <https://x/i|tracking issue #9>' };
    expect(countMentions(buildDriftMessage(withIssueLink))).toBe(0);
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
