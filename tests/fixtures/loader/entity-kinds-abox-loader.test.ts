/**
 * Unit tests for the entity-kinds ABox loader (Lift 4 / #210).
 *
 * Mirrors the structure of `edges-abox-loader.test.ts` (Lift 3 / #208).
 * Documented loader contract has the same four observable branches:
 *   1. Missing ABox file → returns `null` (configs aren't required to ship one).
 *   2. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   3. Schema-invalid content → throws with a "failed TBox validation" diagnostic.
 *   4. Duplicate kind `name` values → throws (Draft-07 cannot express uniqueness).
 *
 * The L3 invariants in `configs/<name>/regression-invariants.test.ts`
 * only exercise the happy path against the real ABox shipped by the
 * config; these tests pin each error/no-op branch so a regression in
 * any branch is caught directly.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadEntityKindsAbox,
  loadExternalEntityIdentifiers,
} from '../../../path-analyser/src/ontology/loader.ts';

let workdir: string;
const CONFIG_NAME = 'unit-test-config';
const ORIGINAL_CONFIG = process.env.CONFIG;

function configsJson(): string {
  return JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } });
}

function writeAbox(contents: string): void {
  const dir = join(workdir, 'configs', CONFIG_NAME, 'ontology');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entity-kinds.json'), contents);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'entity-kinds-abox-loader-'));
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

describe('loadEntityKindsAbox: documented branches', () => {
  it('returns null when the ABox file does not exist (configs are not required to ship one)', () => {
    expect(loadEntityKindsAbox(workdir)).toBeNull();
  });

  it('returns null when configs.json itself is missing (test-isolation fallback)', () => {
    rmSync(join(workdir, 'configs.json'));
    expect(loadEntityKindsAbox(workdir)).toBeNull();
  });

  it('throws with a "Failed to parse" diagnostic on invalid JSON', () => {
    writeAbox('{ this is not json');
    expect(() => loadEntityKindsAbox(workdir)).toThrow(/Failed to parse entity-kinds ABox/);
  });

  it('throws with a "failed TBox validation" diagnostic on schema-invalid content', () => {
    writeAbox(JSON.stringify({ version: 1, kinds: [{ name: 'lower-case-bad', shape: 'entity' }] }));
    expect(() => loadEntityKindsAbox(workdir)).toThrow(/failed TBox validation/);
  });

  it('throws on duplicate kind names (Draft-07 uniqueness backstop)', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            establishedBy: 'createRole',
            observableVia: 'getRole',
            revokedBy: 'deleteRole',
            description: 'first',
          },
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            establishedBy: 'createRole',
            observableVia: 'getRole',
            revokedBy: 'deleteRole',
            description: 'second',
          },
        ],
      }),
    );
    expect(() => loadEntityKindsAbox(workdir)).toThrow(/duplicate kind name\(s\): Role/);
  });

  it('returns the parsed ABox on the happy path', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            establishedBy: 'createRole',
            observableVia: 'getRole',
            revokedBy: 'deleteRole',
            description: 'A role.',
          },
        ],
      }),
    );
    const abox = loadEntityKindsAbox(workdir);
    expect(abox).not.toBeNull();
    expect(abox?.kinds).toHaveLength(1);
    expect(abox?.kinds[0]?.name).toBe('Role');
  });

  it('accepts an optional restorableVia on a shape: "entity" kind (#426)', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'File',
            shape: 'entity',
            identifiers: ['FileKey'],
            establishedBy: 'createFile',
            observableVia: 'getFile',
            revokedBy: 'deleteFile',
            restorableVia: 'restoreFile',
            description: 'A file with a soft-delete/restore transition.',
          },
        ],
      }),
    );
    const abox = loadEntityKindsAbox(workdir);
    expect(abox?.kinds[0]?.restorableVia).toBe('restoreFile');
  });

  it('rejects restorableVia on a non-entity shape (#426 — restore is entity-only)', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'Member',
            shape: 'external-entity',
            identifiers: ['MemberEmail'],
            restorableVia: 'restoreMember',
            description: 'External entity may not declare restorableVia.',
          },
        ],
      }),
    );
    expect(() => loadEntityKindsAbox(workdir)).toThrow(/failed TBox validation/);
  });
});

describe('loadExternalEntityIdentifiers: ABox-derived externalBoundary set', () => {
  it('returns null when no ABox is shipped (caller falls back to spec-emitted kindRegistry)', () => {
    expect(loadExternalEntityIdentifiers(workdir)).toBeNull();
  });

  it('returns the union of identifiers across `external-entity` kinds', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            establishedBy: 'createRole',
            observableVia: 'getRole',
            revokedBy: 'deleteRole',
            description: 'in-API entity',
          },
          {
            name: 'Client',
            shape: 'external-entity',
            identifiers: ['ClientId'],
            description: 'minted outside the API',
          },
          {
            name: 'ExternalApp',
            shape: 'external-entity',
            identifiers: ['AppId', 'TenantSlug'],
            description: 'second external kind to verify union semantics',
          },
        ],
      }),
    );
    const set = loadExternalEntityIdentifiers(workdir);
    expect(set).not.toBeNull();
    // RoleId is in-API and must NOT appear; only external-entity identifiers do.
    expect(set).toEqual(new Set(['ClientId', 'AppId', 'TenantSlug']));
  });

  it('returns an empty set when no `external-entity` kinds are present (consumer treats empty as no-op)', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            establishedBy: 'createRole',
            observableVia: 'getRole',
            revokedBy: 'deleteRole',
            description: 'in-API only',
          },
        ],
      }),
    );
    const set = loadExternalEntityIdentifiers(workdir);
    expect(set).not.toBeNull();
    expect(set?.size).toBe(0);
  });

  it("propagates the loader's validation failure (does not silently swallow malformed ABox)", () => {
    writeAbox('{ this is not json');
    expect(() => loadExternalEntityIdentifiers(workdir)).toThrow(
      /Failed to parse entity-kinds ABox/,
    );
  });
});
