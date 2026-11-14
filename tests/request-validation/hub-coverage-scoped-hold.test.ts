import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A scoped exclusion that removes the one kind asserting a status code (for example `purgeFile`'s
 * `not-found-fake-id`, excluded because purge answers 204 for a missing key) parks that status code
 * in the weekly report, the same as a whole-operation exclusion. Otherwise the endpoint issue stays
 * open forever for a gap the config already explains.
 */
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/e2e/hub_response_coverage.py',
);

function held(
  opId: string,
  bucket: string,
  cfg: { suppressed?: string[]; excluded?: string[]; heldKinds?: Record<string, string[]> },
): boolean {
  const code = [
    'import sys, json, importlib.util',
    `spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(script)})`,
    'h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)',
    'd = json.load(sys.stdin)',
    "hk = {k: set(v) for k, v in d['heldKinds'].items()}",
    "print(json.dumps(h.cell_held(d['op'], d['b'], set(d['suppressed']), set(d['excluded']), hk)))",
  ].join('\n');
  const out = execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify({
      op: opId,
      b: bucket,
      suppressed: cfg.suppressed ?? [],
      excluded: cfg.excluded ?? [],
      heldKinds: cfg.heldKinds ?? {},
    }),
    encoding: 'utf8',
  });
  return JSON.parse(out) === true;
}

describe('hub coverage report: scoped exclusions park their status code', () => {
  it('parks 404 when not-found-fake-id is held for the operation', () => {
    expect(held('purgeFile', '404', { heldKinds: { purgeFile: ['not-found-fake-id'] } })).toBe(
      true,
    );
  });

  it('parks 401 only when both auth-absent and auth-invalid are held', () => {
    const both = { heldKinds: { op: ['auth-absent', 'auth-invalid'] } };
    expect(held('op', '401', both)).toBe(true);
  });

  it('does not park 401 when only one of its two kinds is held', () => {
    expect(held('op', '401', { heldKinds: { op: ['auth-absent'] } })).toBe(false);
    expect(held('op', '401', { heldKinds: { op: ['auth-invalid'] } })).toBe(false);
  });

  it('parks 403 when auth-deny is held for the operation', () => {
    expect(held('addMember', '403', { heldKinds: { addMember: ['auth-deny'] } })).toBe(true);
  });

  it('does not park 400 for a single held body kind', () => {
    expect(
      held('createWorkspace', '400', { heldKinds: { createWorkspace: ['malformed-json-body'] } }),
    ).toBe(false);
  });

  it('does not park a status code whose kind is held on another operation', () => {
    expect(held('deleteFile', '404', { heldKinds: { purgeFile: ['not-found-fake-id'] } })).toBe(
      false,
    );
  });

  it('keeps the whole-operation and suppression rules', () => {
    expect(held('op', '404', { excluded: ['op'] })).toBe(true);
    expect(held('op', '2xx', { suppressed: ['op'] })).toBe(true);
    expect(held('op', '2xx', { excluded: ['op'] })).toBe(false);
  });
});
