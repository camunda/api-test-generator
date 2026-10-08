import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const wf: unknown = load(readFileSync(join(root, 'hub-coverage-fix.yml'), 'utf8'));
const doc = isRec(wf) ? wf : {};
// js-yaml reads the key `on` as the string "on" (YAML 1.2), so this works with either spelling.
const triggers = isRec(doc.on) ? doc.on : isRec(doc.true) ? doc.true : {};
const jobs = isRec(doc.jobs) ? doc.jobs : {};
const fix = isRec(jobs.fix) ? jobs.fix : {};
const env = isRec(doc.env) ? doc.env : {};

describe('the coverage-fix trigger after the weekly report', () => {
  it('starts after the weekly report workflow, and still by hand', () => {
    const run = isRec(triggers.workflow_run) ? triggers.workflow_run : {};
    expect(run.workflows).toEqual(['Hub response coverage']);
    expect(run.types).toEqual(['completed']);
    expect('workflow_dispatch' in triggers).toBe(true);
    const weekly: unknown = load(readFileSync(join(root, 'hub-response-coverage.yml'), 'utf8'));
    expect(isRec(weekly) ? weekly.name : '').toBe('Hub response coverage');
  });

  it('only goes ahead on the switch, a successful scheduled run on main', () => {
    const cond = String(fix.if).replace(/\s+/g, ' ');
    expect(cond).toContain("github.event_name != 'workflow_run'");
    expect(cond).toContain("vars.COVERAGE_FIX_AUTO == 'true'");
    expect(cond).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(cond).toContain("github.event.workflow_run.event == 'schedule'");
    expect(cond).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it('is a real run after the report and a dry run by default by hand', () => {
    const dry = String(env.DRY_RUN);
    expect(dry).toContain("github.event_name == 'workflow_run' && 'false'");
    expect(dry).toContain("github.event.inputs.dry_run || 'true'");
  });

  it('reads the report run that started it', () => {
    const steps = Array.isArray(fix.steps) ? fix.steps.filter(isRec) : [];
    const resolve = steps.find((s) => s.name === 'Resolve the coverage report run');
    const e = isRec(resolve) && isRec(resolve.env) ? resolve.env : {};
    expect(String(e.INPUT_RUN_ID)).toContain('github.event.workflow_run.id');
    expect(String(e.INPUT_RUN_ID)).toContain('github.event.inputs.coverage_run_id');
  });

  it('does not run its verify job when the fix job was skipped', () => {
    const verify = isRec(jobs.verify) ? jobs.verify : {};
    expect(verify.needs).toBe('fix');
    // a skipped fix job has no baseline output, which this condition requires
    expect(String(verify.if)).toContain("needs.fix.outputs.baseline != ''");
  });
});
