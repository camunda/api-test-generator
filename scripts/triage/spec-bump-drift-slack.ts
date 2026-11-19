// Builds the camunda-hub spec-bump drift Slack message. As a CLI it writes
// `text_json=<JSON.stringify(text)>` to $GITHUB_OUTPUT for the Notify step in
// .github/workflows/spec-bump-check.yml; as a module it exports the pure
// builder so the clean-vs-blocked paging decision is unit-testable
// (tests/triage/spec-bump-pings.test.ts), which an inline `node -e` was not.
//
// The hub-medic page is gated on the DETERMINISTIC routing signals — the exact
// negation of the workflow's "Open/update the auto-bump PR" condition — never
// the issue-link lookup: GitHub search indexing lags, so a just-filed tracking
// issue can be missing from the link (the Credential-removal drift rendered the
// "Canonical heads-up" branch for exactly that reason, yet was still blocked).

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// hub-medic Slack subteam. The Hub team owns the camunda-hub config
// (docs/how-it-works.md "Who owns what"), so a BLOCKED drift — which files a
// tracking issue with no bump PR, hence no @camunda/hub reviewer to carry it —
// pages them. A broken scheduled *run* pages test-automation-medic elsewhere.
const HUB_MEDIC = ':rotating_light: <!subteam^S014VK4482H|hub-medic>';

type Env = Record<string, string | undefined>;

// The auto-bump is BLOCKED (routed to the tracking issue, not a bump PR) when
// any routing signal fails. This is the exact boolean negation of the
// "Open/update the auto-bump PR" step's condition in spec-bump-check.yml, so
// the page fires iff no bump PR (and therefore no reviewer) was created.
export function isBlocked(e: Env): boolean {
  return (
    e.GEN_OUTCOME !== 'success' ||
    e.INV_OUTCOME !== 'success' ||
    e.HAS_UNMAPPED === 'true' ||
    e.HAS_NEWLY_REQUIRED === 'true' ||
    e.APP_TOKEN_EMPTY === 'true'
  );
}

export function buildDriftMessage(e: Env): string {
  // UNMAPPED_LIST is already ", "-joined (a single line), so it is used directly,
  // not through the workflow's newline-oriented csv() helper.
  const unmappedLine = e.UNMAPPED_LIST
    ? `\n🚫 *missing coverage* (blocks auto-adopt): ${e.UNMAPPED_LIST}`
    : '';
  // Claim "op-surface drift" only on real operationId churn and "coverage
  // regression" only on a real unmapped hit; otherwise an honest field-only
  // headline rather than a mislabeled one.
  const hasChurn = e.N_ADDED !== '0' || e.N_REMOVED !== '0';
  const hasUnmapped = !!e.UNMAPPED_LIST;
  const headline = hasChurn
    ? `:alert2: *camunda-hub upstream op-surface drift* vs the pin (\`${e.PINNED}\` → latest \`${e.LATEST}\`):\n` +
      `🆕 added (${e.N_ADDED}): ${e.ADDED_CSV ?? ''}\n` +
      `🗑️ removed (${e.N_REMOVED}): ${e.REMOVED_CSV ?? ''}`
    : hasUnmapped
      ? `:alert2: *camunda-hub coverage regression* vs latest \`${e.LATEST}\` (no operationId churn):`
      : `:alert2: *camunda-hub spec pin is behind* latest \`${e.LATEST}\` (no operationId churn, no coverage regression):`;
  // Page the Hub team on a blocked drift; no ping on a clean bump (its PR
  // already requests @camunda/hub review).
  const mention = isBlocked(e) ? `\n${HUB_MEDIC}` : '';
  return (
    headline +
    unmappedLine +
    `\n${e.LINK}\n<${e.RUN_URL}|📊 View run> · <${e.COOKBOOK_URL}|📖 What this alert means>` +
    mention
  );
}

// CLI: JSON-encode the message for the workflow's Notify step. JSON.stringify
// guarantees valid escaping for any upstream operationId (quotes, backslashes,
// control chars), so an odd id cannot break the payload.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = buildDriftMessage(process.env);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `text_json=${JSON.stringify(text)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(text)}\n`);
  }
}
