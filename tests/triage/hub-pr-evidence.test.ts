import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEvidence,
  cleanError,
  collectEvidence,
  fingerprint,
  isObserved,
  junitFailures,
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

  it('treats a sequence with no passed attempt as deterministic even if not all failed', () => {
    const ev = buildEvidence([report(spec('a', false, ['failed', 'skipped']))]);
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

  it('salts a fingerprint with no observed failures so each push stays distinct', () => {
    const none = buildEvidence([]);
    expect(fingerprint('7', none, '', 'sha1')).not.toBe(fingerprint('7', none, '', 'sha2'));
    expect(fingerprint('7', none, '', 'sha1')).toBe(fingerprint('7', none, '', 'sha1'));
  });

  it('does not salt when a failing set was observed', () => {
    expect(fingerprint('7', failing, '', 'sha1')).toBe(fingerprint('7', failing, '', 'sha2'));
  });
});

describe('isObserved', () => {
  it('is true when a spec failed', () => {
    expect(isObserved(buildEvidence([report(spec('a', false, ['failed']))]), '')).toBe(true);
  });

  it('is true when operations have no test', () => {
    expect(isObserved(buildEvidence([]), 'newOp')).toBe(true);
  });

  it('is false when nothing says what failed', () => {
    expect(isObserved(buildEvidence([]), '')).toBe(false);
    expect(isObserved(buildEvidence([report(spec('a', true, ['passed']))]), '  ')).toBe(false);
  });
});

describe('junitFailures', () => {
  it('reports testcases that carry a failure or error element', () => {
    const xml =
      '<testsuite><testcase classname="a.spec.ts" name="ok"/>' +
      '<testcase classname="b.spec.ts" name="bad"><failure message="x"/></testcase>' +
      '<testcase classname="c.spec.ts" name="boom"><error/></testcase></testsuite>';
    expect(junitFailures(xml).map((f) => `${f.file}::${f.title}`)).toEqual([
      'b.spec.ts::bad',
      'c.spec.ts::boom',
    ]);
  });

  it('finds nothing in an all-passing report', () => {
    expect(junitFailures('<testsuite><testcase classname="a" name="ok"/></testsuite>')).toEqual([]);
  });
});

describe('collectEvidence', () => {
  it('applies the JUnit fallback per profile, not only when no JSON failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    writeFileSync(
      join(dir, 'pw-positive.json'),
      JSON.stringify(report(spec('a', false, ['failed']))),
    );
    writeFileSync(join(dir, 'pw-rbac.json'), '{corrupt');
    writeFileSync(
      join(dir, 'pw-rbac.junit.xml'),
      '<testsuite><testcase classname="b.spec.ts" name="B"><failure/></testcase></testsuite>',
    );
    const titles = collectEvidence(dir).failing.map((f) => f.title);
    expect(titles).toContain('a');
    expect(titles).toContain('B');
  });
});
