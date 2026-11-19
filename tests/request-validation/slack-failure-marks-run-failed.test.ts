import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ACTION = './.github/actions/fail-if-slack-failed';
const WORKFLOWS = [
  'nightly-camunda-hub',
  'triage-camunda-hub-nightly',
  'spec-bump-check',
  'hub-known-issue-reenable-check',
  'hub-response-coverage',
  'hub-generator-gap-digest',
  'hub-nightly-post-check',
];

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  continueOnError: boolean;
  outcomes?: string;
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function toStep(raw: unknown): Step[] {
  if (!isRecord(raw)) return [];
  return [
    {
      id: str(raw.id),
      name: str(raw.name),
      uses: str(raw.uses),
      if: str(raw.if),
      run: str(raw.run),
      continueOnError: raw['continue-on-error'] === true,
      outcomes: isRecord(raw.with) ? str(raw.with.outcomes) : undefined,
    },
  ];
}

function stepsOf(file: string): Step[][] {
  const wf: unknown = parse(readFileSync(join(root, '.github/workflows', `${file}.yml`), 'utf8'));
  if (!isRecord(wf) || !isRecord(wf.jobs)) return [];
  return Object.values(wf.jobs).flatMap((j) =>
    isRecord(j) && Array.isArray(j.steps) ? [j.steps.flatMap(toStep)] : [],
  );
}

describe('the fail-if-slack-failed action', () => {
  const action: unknown = parse(
    readFileSync(join(root, '.github/actions/fail-if-slack-failed/action.yml'), 'utf8'),
  );
  const first =
    isRecord(action) && isRecord(action.runs) && Array.isArray(action.runs.steps)
      ? action.runs.steps[0]
      : undefined;
  const script = isRecord(first) ? (str(first.run) ?? '') : '';
  const run = (outcomes: string) =>
    spawnSync('bash', ['-c', script], {
      env: { ...process.env, OUTCOMES: outcomes },
      encoding: 'utf8',
    });

  it('only uses expressions GitHub can evaluate where it loads the action (a stray one makes it fail to load)', () => {
    const text = readFileSync(
      join(root, '.github/actions/fail-if-slack-failed/action.yml'),
      'utf8',
    );
    const expressions = text.match(/\$\{\{[^}]*\}\}/g) ?? [];
    // Only the run step's env may use one, and only the inputs context exists inside an action.
    for (const e of expressions) expect(e).toMatch(/^\$\{\{\s*inputs\.[a-z-]+\s*\}\}$/);
    const doc: unknown = parse(text);
    const descriptions = [
      isRecord(doc) ? str(doc.description) : undefined,
      isRecord(doc) && isRecord(doc.inputs)
        ? Object.values(doc.inputs).map((i) => (isRecord(i) ? str(i.description) : undefined))
        : [],
    ].flat();
    for (const d of descriptions) expect(d ?? '').not.toContain('${{');
  });

  it('points the error at the checklist that says what to check', () => {
    const r = run('failure');
    expect(r.stdout).toContain('docs/hub-nightly-cookbook.md');
  });

  it('fails the run when any Slack step failed, and says why', () => {
    const r = run('success failure skipped');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error title=Slack alert not posted::');
  });

  it('passes when every Slack step succeeded or was skipped', () => {
    expect(run('success skipped success').status).toBe(0);
    expect(run('').status).toBe(0);
  });

  it('does not match a word that merely contains "failure"', () => {
    expect(run('no-failure-here').status).toBe(0);
  });
});

// A job that only wraps secrets for an agent job (vault-wrapped-secrets/wrap) posts nothing to Slack, so it has no Slack check.
const isSecretsBroker = (steps: Step[]) =>
  steps.some((st) => st.uses?.includes('vault-wrapped-secrets/wrap@'));
// The Slack token comes from the slack-token action, or, in a job that must not log in to Vault itself, from an
// unwrap step (id "slack") that redeems the token wrapped by the job's secrets broker.
const isSlackTokenStep = (st: Step) =>
  st.uses === './.github/actions/slack-token' ||
  (st.id === 'slack' && st.uses?.includes('vault-wrapped-secrets/unwrap@') === true);
const emptyTokenChecks = (id: string | undefined) => [
  `steps.${id}.outputs.SLACK_BOT_TOKEN == ''`,
  `fromJSON(steps.${id}.outputs.secrets || '{}').SLACK_BOT_TOKEN == ''`,
];

describe.each(WORKFLOWS)('%s', (file) => {
  const jobs = stepsOf(file).filter((steps) => !isSecretsBroker(steps));

  it('ends with the Slack check, which always runs', () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const steps of jobs) {
      const last = steps[steps.length - 1];
      expect(last?.uses).toBe(ACTION);
      expect(last?.if).toBe('always()');
    }
  });

  it('also fails when a token step succeeded but produced an empty token', () => {
    for (const steps of jobs) {
      const outcomes = steps[steps.length - 1]?.outcomes ?? '';
      const tokenSteps = steps.filter(isSlackTokenStep);
      expect(tokenSteps.length).toBeGreaterThan(0);
      for (const st of tokenSteps) {
        expect(
          emptyTokenChecks(st.id).some((check) => outcomes.includes(check)),
          `token step "${st.name}" is not checked for an empty token`,
        ).toBe(true);
      }
    }
  });

  it('passes the outcome of every Slack step that is allowed to fail silently', () => {
    for (const steps of jobs) {
      const outcomes = steps[steps.length - 1]?.outcomes ?? '';
      const silent = steps.filter((s) => s.continueOnError && /slack/i.test(s.name ?? ''));
      expect(silent.length).toBeGreaterThan(0);
      for (const s of silent) {
        expect(
          s.id,
          `Slack step "${s.name}" needs an id so its outcome can be checked`,
        ).toBeTruthy();
        expect(outcomes, `"${s.name}" is missing from the Slack check`).toContain(
          `steps.${s.id}.outcome`,
        );
      }
    }
  });
});

describe('workflows whose manual run is a dry run that posts nothing', () => {
  it.each([
    'hub-generator-gap-digest',
    'hub-nightly-post-check',
    'hub-response-coverage',
  ])('%s fetches no Slack token in a dry run, so a Vault problem cannot fail it', (file) => {
    for (const steps of stepsOf(file)) {
      const token = steps.find((st) => st.uses === './.github/actions/slack-token');
      expect(token?.if, 'the token step needs an if that skips a dry run').toMatch(/dry_run/);
    }
  });
});

describe('the verdict comment on a failing camunda-hub PR', () => {
  const wf: unknown = parse(readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8'));
  const report =
    isRecord(wf) && isRecord(wf.jobs) && isRecord(wf.jobs.report) ? wf.jobs.report : {};
  const steps: Step[] =
    isRecord(report) && Array.isArray(report.steps) ? report.steps.flatMap(toStep) : [];
  const comment = steps.find((s) => /comment the suite verdict/i.test(s.name ?? ''));

  it('links the PR-check cookbook', () => {
    const text = readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8');
    expect(text).toContain('[PR-check cookbook](');
    expect(text).toContain('docs/hub-pr-check-cookbook.md');
  });

  it('@-tags the PR author so the comment, not Slack, notifies them', () => {
    const text = readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8');
    // The author login is plumbed into the comment step and emitted directly (not via clean(),
    // which strips '@'); it is charset-validated in the validate job, so the mention is safe.
    // (Regex, not a string literal, so the GitHub-Actions `${{ }}` does not trip noTemplateCurlyInString.)
    expect(text).toMatch(/PR_AUTHOR:\s*\$\{\{\s*needs\.validate\.outputs\.pr_author\s*\}\}/);
    expect(text).toMatch(/@\$\{PR_AUTHOR\}/);
  });

  it('fires for every failing non-draft PR, not just a caused-by-PR failure', () => {
    expect(comment, 'a verdict comment step must exist').toBeTruthy();
    const gate = (comment?.if ?? '').replace(/\s+/g, ' ');
    expect(gate).toContain("needs.run.result == 'failure'");
    expect(gate).toContain("needs.validate.outputs.is_draft != 'true'");
    // The broadened model (2026-10-28 handover): the comment is no longer gated on a specific
    // category or on caused_by_pr — every failing PR gets one, tagging the author.
    expect(gate).not.toContain('caused_by_pr');
    expect(gate).not.toContain('category ==');
  });

  it('posts a fresh comment on every failing push (never a silent edit that can be missed)', () => {
    // A silent edit sends no GitHub notification, so a repeat or changed verdict could be missed. The
    // step removes the prior verdict comment and POSTs a fresh one each failing push, so every push
    // notifies the author — it must DELETE then POST, and must not PATCH (edit) the failure comment.
    const run = typeof comment?.run === 'string' ? comment.run : '';
    expect(run, 'a verdict comment step must exist').not.toBe('');
    expect(run).toContain('-X DELETE');
    expect(run).toContain('-X POST');
    expect(run).not.toContain('-X PATCH');
    const text = readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8');
    expect(text).toContain('re-posted on each failing push');
  });

  it('removes/resolves legacy-marker comments too, scoped to this check own comments', () => {
    // main posts the legacy :generator-gap / :regression markers, so open PRs can carry one. Both the
    // delete-on-failure and resolve-on-green lookups must match the shared prefix so those migrate —
    // but scoped to a Bot author whose body STARTS WITH the marker, so a reviewer comment that quotes
    // the marker is never matched (and so never deleted).
    const text = readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8');
    expect(text).toContain("marker_prefix='<!-- api-test-generator:hub-pr-check:'");
    const scopedLookups =
      text.match(
        /select\(\(\.user\.type == \\"Bot\\"\) and \(\.body \| startswith\(\\"\$\{marker_prefix\}\\"\)\)\)/g,
      ) ?? [];
    expect(scopedLookups.length).toBeGreaterThanOrEqual(2);
    // Guard against a regression to the unscoped substring match that could delete review discussion.
    // (Regex, not a string literal, so the ${...} does not trip noTemplateCurlyInString.)
    expect(text).not.toMatch(/select\(\.body \| contains\(\\"\$\{marker_prefix\}\\"\)\)/);
  });

  it('excludes a presuite (setup-step) failure — that stays Slack-only, pinging automation', () => {
    // presuite = suites did not run AND Hub did not fail to start. It is shared-pipeline, the
    // automation team's responsibility, so it gets no PR comment (handled in Slack instead).
    const gate = (comment?.if ?? '').replace(/\s+/g, ' ');
    expect(gate).toContain(
      "!(needs.run.outputs.suites_ran != 'true' && needs.run.outputs.hub_start_failed != 'true')",
    );
  });
});

describe('hub-pr-check: a failing PR is comment-only, including bot/Renovate PRs', () => {
  // 2026-10-28 handover decision (Jan + Wolfgang): a PR-check failure is the PR author's to look at on
  // their own PR, so the sticky verdict comment @-tags the author and the Slack chain is suppressed. A
  // bot PR (renovate[bot], no author to @-tag) is comment-only too — "for Renovate PRs you have the
  // dependency maintainer who would look into that anyway" — so an empty pr_author must NOT page a medic.
  // Slack fires in exactly two cases: a presuite failure (setup step before the suites ran, which is
  // automation's and gets no comment → test-automation-medic), OR the verdict comment did not deliver
  // (the author was not reached on the PR at all → hub-medic fallback). A bot PR whose comment posts
  // fine reaches neither, so it never pings.
  const NO_AUTHOR = "needs.validate.outputs.pr_author == ''";
  const PRESUITE =
    "needs.run.outputs.suites_ran != 'true' && needs.run.outputs.hub_start_failed != 'true'";
  // Fallback: if the verdict comment was not delivered (skipped for a missing status token, or its
  // POST failed under continue-on-error), the author was not reached on the PR, so Slack must still fire.
  const COMMENT_FAILED = "steps.verdict-comment.outcome != 'success'";
  const wf: unknown = parse(readFileSync(join(root, '.github/workflows/hub-pr-check.yml'), 'utf8'));
  const report =
    isRecord(wf) && isRecord(wf.jobs) && isRecord(wf.jobs.report) ? wf.jobs.report : {};
  const steps: Step[] =
    isRecord(report) && Array.isArray(report.steps) ? report.steps.flatMap(toStep) : [];
  const slackSteps = steps.filter((s) => /slack/i.test(s.name ?? ''));

  it('has the report job with its Slack steps', () => {
    expect(slackSteps.length).toBeGreaterThanOrEqual(4);
  });

  it('gives the verdict comment step an id so Slack can see whether it delivered', () => {
    const comment = steps.find((s) => /comment the suite verdict/i.test(s.name ?? ''));
    expect(comment?.id).toBe('verdict-comment');
  });

  it('fires every Slack step for a presuite failure or an undelivered comment — never for a bot PR alone', () => {
    for (const s of slackSteps) {
      const gate = (s.if ?? '').replace(/\s+/g, ' ');
      expect(gate, `Slack step "${s.name}" must fire for a presuite failure`).toContain(PRESUITE);
      expect(
        gate,
        `Slack step "${s.name}" must fall back when the verdict comment did not deliver`,
      ).toContain(COMMENT_FAILED);
      // The fix: a bot/Renovate PR whose comment posts is comment-only, so an empty pr_author must not
      // be a Slack trigger on its own (it would page hub-medic for exactly the noise the handover cut).
      expect(
        gate,
        `Slack step "${s.name}" must NOT page for a bot PR whose comment posted (comment-only)`,
      ).not.toContain(NO_AUTHOR);
    }
  });
});
