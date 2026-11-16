import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

interface Target {
  id: string;
  sdkMap?: unknown;
}

function isTarget(value: unknown): value is Target {
  if (typeof value !== 'object' || value === null) return false;
  return 'id' in value && typeof value.id === 'string';
}

function runListTargets(): unknown {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve('materializer/src/index.ts'), 'list-targets'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe('list-targets', () => {
  test('lists every registered SDK emitter and its map', () => {
    const parsed = runListTargets();
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;

    const targets = parsed.filter(isTarget);
    expect(targets.map((target) => target.id).sort()).toEqual([
      'csharp-sdk',
      'js-sdk',
      'playwright',
      'python-sdk',
    ]);
    expect(targets.find((target) => target.id === 'js-sdk')?.sdkMap).toBeDefined();
    expect(targets.find((target) => target.id === 'python-sdk')?.sdkMap).toBeDefined();
  });
});
