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
];

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
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

describe.each(WORKFLOWS)('%s', (file) => {
  const jobs = stepsOf(file);

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
      const tokenSteps = steps.filter((st) => st.uses === './.github/actions/slack-token');
      expect(tokenSteps.length).toBeGreaterThan(0);
      for (const st of tokenSteps) {
        expect(outcomes, `token step "${st.name}" is not checked for an empty token`).toContain(
          `steps.${st.id}.outputs.SLACK_BOT_TOKEN == ''`,
        );
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
    'hub-response-coverage',
  ])('%s fetches no Slack token in a dry run, so a Vault problem cannot fail it', (file) => {
    for (const steps of stepsOf(file)) {
      const token = steps.find((st) => st.uses === './.github/actions/slack-token');
      expect(token?.if, 'the token step needs an if that skips a dry run').toMatch(/dry_run/);
    }
  });
});
