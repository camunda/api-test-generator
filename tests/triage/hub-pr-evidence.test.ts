import { describe, expect, it } from 'vitest';
import {
  buildEvidence,
  cleanError,
  deterministicVerdict,
  fingerprint,
} from '../../scripts/triage/hub-pr-evidence.ts';

function spec(title: string, ok: boolean, statuses: string[], error?: string) {
  return {
    title,
    file: 'positive.spec.ts',
    ok,
    tests: [
      {
        projectName: 'positive',
        results: statuses.map((status, i) => ({
          status,
          ...(error && i === statuses.length - 1 ? { error: { message: error } } : {}),
        })),
      },
    ],
  };
}

// Playwright nests file suite -> describe suite -> specs.
function report(...specs: ReturnType<typeof spec>[]) {
  return { suites: [{ suites: [{ specs }] }] };
}

describe('buildEvidence', () => {
  it('finds specs at depth, not only one level down', () => {
    const ev = buildEvidence([report(spec('a', false, ['failed']), spec('b', true, ['passed']))]);
    expect(ev.total).toBe(2);
    expect(ev.failing.map((s) => s.title)).toEqual(['a']);
  });

  it('reports a failed -> passed spec as flaky, not failing', () => {
    const ev = buildEvidence([report(spec('a', true, ['failed', 'passed']))]);
    expect(ev.failing).toHaveLength(0);
    expect(ev.flaky.map((s) => s.title)).toEqual(['a']);
  });

  it('treats a spec that timed out on every attempt as deterministic', () => {
    const ev = buildEvidence([report(spec('a', false, ['timedOut', 'timedOut']))]);
    expect(ev.failing[0]?.deterministic).toBe(true);
  });

  it('does not call a mixed spec deterministic', () => {
    const ev = buildEvidence([report(spec('a', false, ['failed', 'passed', 'failed']))]);
    expect(ev.failing[0]?.deterministic).toBe(false);
  });

  it('marks no reports as absent evidence', () => {
    expect(buildEvidence([]).reportsPresent).toBe(false);
  });
});

describe('cleanError', () => {
  it('strips ANSI colour codes and truncates', () => {
    const esc = String.fromCharCode(27);
    expect(cleanError(`expect(${esc}[31mx${esc}[39m)`)).toBe('expect(x)');
    expect(cleanError('y'.repeat(700))).toHaveLength(600);
  });
});

describe('deterministicVerdict', () => {
  const flakyOnly = buildEvidence([report(spec('a', true, ['failed', 'passed']))]);

  it('decides flaky when only retried specs went red', () => {
    expect(deterministicVerdict(flakyOnly, '')?.category).toBe('flaky');
  });

  it('leaves a genuine failure to the agent', () => {
    const ev = buildEvidence([
      report(spec('a', false, ['failed']), spec('b', true, ['failed', 'passed'])),
    ]);
    expect(deterministicVerdict(ev, '')).toBeNull();
  });

  it('leaves a run with unmapped operations to the agent', () => {
    expect(deterministicVerdict(flakyOnly, 'newOp')).toBeNull();
  });

  it('never decides without reports', () => {
    expect(deterministicVerdict(buildEvidence([]), '')).toBeNull();
  });
});

describe('fingerprint', () => {
  const failing = buildEvidence([
    report(spec('a', false, ['failed']), spec('b', false, ['failed'])),
  ]);
  const reordered = buildEvidence([
    report(spec('b', false, ['failed']), spec('a', false, ['failed'])),
  ]);

  it('is stable across ordering', () => {
    expect(fingerprint('7', failing, '')).toBe(fingerprint('7', reordered, ''));
  });

  it('differs per PR and per failing set', () => {
    expect(fingerprint('7', failing, '')).not.toBe(fingerprint('8', failing, ''));
    const one = buildEvidence([report(spec('a', false, ['failed']))]);
    expect(fingerprint('7', failing, '')).not.toBe(fingerprint('7', one, ''));
  });

  it('includes unmapped operations', () => {
    expect(fingerprint('7', failing, 'op')).not.toBe(fingerprint('7', failing, ''));
  });
});
