/**
 * Unit tests for the edges ABox loader (#201 review feedback).
 *
 * Documented loader contract has four observable behaviours:
 *   1. Missing ABox file → returns `null` (configs aren't required to ship one).
 *   2. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   3. Schema-invalid content → throws with a "failed TBox validation" diagnostic
 *      (and lists the failing instance paths).
 *   4. Duplicate edge `name` values → throws (Draft-07 cannot express uniqueness
 *      at the array level, so the loader enforces it programmatically).
 *
 * The L3 invariants in `configs/<name>/regression-invariants.test.ts`
 * only exercise the happy path against the real ABox shipped by the
 * config; these tests pin each error/no-op branch so a regression in
 * any branch (e.g. swallowing parse errors, dropping the duplicate
 * check) is caught directly.
 *
 * Each branch is tested via a temporary `configs/<name>/ontology/edges.json`
 * under a synthesized repo-root directory; CONFIG is set so the active
 * config resolves to the temp tree.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEdgesAbox } from '../../../path-analyser/src/ontology/loader.ts';

let workdir: string;
const CONFIG_NAME = 'unit-test-config';
const ORIGINAL_CONFIG = process.env.CONFIG;

function configsJson(): string {
  return JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } });
}

function writeAbox(contents: string): void {
  const dir = join(workdir, 'configs', CONFIG_NAME, 'ontology');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'edges.json'), contents);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'edges-abox-loader-'));
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, 'configs.json'), configsJson());
  process.env.CONFIG = CONFIG_NAME;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  if (ORIGINAL_CONFIG === undefined) {
    delete process.env.CONFIG;
  } else {
    process.env.CONFIG = ORIGINAL_CONFIG;
  }
});

describe('loadEdgesAbox: documented branches (#201 review)', () => {
  it('returns null when the ABox file does not exist (configs are not required to ship one)', () => {
    expect(loadEdgesAbox(workdir)).toBeNull();
  });

  it('throws a parse-error when the ABox file is not valid JSON', () => {
    writeAbox('{ this is not json');
    expect(() => loadEdgesAbox(workdir)).toThrow(/Failed to parse edges ABox/);
  });

  it('throws a TBox-validation error when the ABox is structurally wrong', () => {
    // Missing required top-level `version` and `edges`.
    writeAbox(JSON.stringify({ '@context': {} }));
    expect(() => loadEdgesAbox(workdir)).toThrow(/failed TBox validation/);
  });

  it('lists the failing instance path in the validation diagnostic', () => {
    // `edges` is required; emitting the error path is the property we depend on.
    writeAbox(JSON.stringify({ version: 1 }));
    expect(() => loadEdgesAbox(workdir)).toThrow(/edges/);
  });

  it('throws a duplicate-name error when two edges share the same `name`', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        edges: [
          {
            '@type': 'Edge',
            name: 'DupedEdge',
            endpoints: { from: 'A', to: 'B' },
            identifiedBy: ['AId', 'BId'],
            establishedBy: 'opOne',
            observableVia: 'opTwo',
            description: 'first',
          },
          {
            '@type': 'Edge',
            name: 'DupedEdge',
            endpoints: { from: 'A', to: 'C' },
            identifiedBy: ['AId', 'CId'],
            establishedBy: 'opThree',
            observableVia: 'opFour',
            description: 'second',
          },
        ],
      }),
    );
    expect(() => loadEdgesAbox(workdir)).toThrow(/duplicate edge name\(s\): DupedEdge/);
  });

  it('returns the parsed ABox for a minimal valid file (happy-path sanity)', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        edges: [
          {
            '@type': 'Edge',
            name: 'OnlyEdge',
            endpoints: { from: 'A', to: 'B' },
            identifiedBy: ['AId', 'BId'],
            establishedBy: 'opOne',
            observableVia: 'opTwo',
            description: 'only',
          },
        ],
      }),
    );
    const abox = loadEdgesAbox(workdir);
    expect(abox?.edges).toHaveLength(1);
    expect(abox?.edges[0]?.name).toBe('OnlyEdge');
  });
});
