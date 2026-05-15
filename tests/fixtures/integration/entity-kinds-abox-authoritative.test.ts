/**
 * Integration fixture for Lift 4 (#210): the entity-kinds ABox is the
 * authoritative source for `graph.externalEntityIdentifiers` at
 * runtime. Mirrors `edges-abox-authoritative.test.ts` (Lift 3 / #208).
 *
 * Four observable behaviours guarded here:
 *
 *   1. **ABox authoritative — promotes**: the spec-emitted
 *      `kindRegistry` does NOT mark a type as `external-entity`; the
 *      ABox does. After loadGraph, `graph.externalEntityIdentifiers`
 *      includes the type.
 *
 *   2. **ABox authoritative — demotes**: the spec `kindRegistry` marks
 *      a type as `external-entity` but the ABox does not. After
 *      loadGraph, `graph.externalEntityIdentifiers` does NOT include
 *      the type, and a drift warning is emitted.
 *
 *   3. **Strict mode**: with `STRICT_ENTITY_KINDS_ABOX=1`, drift
 *      becomes a hard error.
 *
 *   4. **Legacy fallback**: with no ABox shipped, the loader falls
 *      back to the spec-emitted `kindRegistry` payload (preserving
 *      the pre-Lift-4 behaviour for unmigrated configs).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

const CONFIG_NAME = 'lift4-entity-kinds-test';

let workdir: string;
let baseDir: string;
const ORIGINAL = {
  CONFIG: process.env.CONFIG,
  OPERATION_GRAPH_PATH: process.env.OPERATION_GRAPH_PATH,
  OPENAPI_SPEC_PATH: process.env.OPENAPI_SPEC_PATH,
  STRICT_ENTITY_KINDS_ABOX: process.env.STRICT_ENTITY_KINDS_ABOX,
};

function writeWorkspace(opts: {
  entityKindsAbox: object | null;
  kindRegistry?: object;
  graphOps: Record<string, unknown>;
}): void {
  const repoRoot = workdir;
  baseDir = join(repoRoot, 'path-analyser');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(
    join(repoRoot, 'configs.json'),
    JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } }),
  );
  if (opts.entityKindsAbox !== null) {
    const aboxDir = join(repoRoot, 'configs', CONFIG_NAME, 'ontology');
    mkdirSync(aboxDir, { recursive: true });
    writeFileSync(join(aboxDir, 'entity-kinds.json'), JSON.stringify(opts.entityKindsAbox));
  }
  const graphPath = join(baseDir, 'operation-dependency-graph.json');
  const graphRoot: Record<string, unknown> = { operations: opts.graphOps };
  if (opts.kindRegistry) graphRoot.kindRegistry = opts.kindRegistry;
  writeFileSync(graphPath, JSON.stringify(graphRoot));
  process.env.OPERATION_GRAPH_PATH = graphPath;
  process.env.CONFIG = CONFIG_NAME;
  process.env.OPENAPI_SPEC_PATH = join(baseDir, 'no-such-spec.yaml');
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lift4-entity-kinds-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Lift 4 (#210): entity-kinds ABox is authoritative for externalEntityIdentifiers', () => {
  it('sources externalEntityIdentifiers from the ABox even when spec kindRegistry classifies the type differently (promote)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      entityKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'Client',
            shape: 'external-entity',
            identifiers: ['ClientId'],
            description: 'fixture-external',
          },
        ],
      },
      // Spec says Client is a plain entity (no `external-entity` shape).
      // The ABox classification must win.
      kindRegistry: {
        kinds: [{ name: 'Client', shape: 'entity', identifiers: ['ClientId'] }],
      },
      graphOps: {
        consumeClient: {
          operationId: 'consumeClient',
          method: 'GET',
          path: '/clients/{clientId}',
          requires: { required: ['ClientId'], optional: [] },
          produces: [],
        },
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.externalEntityIdentifiers).toBeDefined();
    expect(graph.externalEntityIdentifiers?.has('ClientId')).toBe(true);
    warn.mockRestore();
  });

  it('demotes a spec external-entity classification when the ABox does not mark it as external (drift warning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      entityKindsAbox: {
        version: 1,
        // Some unrelated entry — the schema requires at least one kind.
        // Crucially, NoLongerExternalKind is NOT classified as
        // external-entity here.
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            description: 'in-API-only',
          },
        ],
      },
      kindRegistry: {
        kinds: [
          {
            name: 'NoLongerExternalKind',
            shape: 'external-entity',
            identifiers: ['LegacyExternalId'],
          },
        ],
      },
      graphOps: {
        consumeRole: {
          operationId: 'consumeRole',
          method: 'GET',
          path: '/roles/{roleId}',
          requires: { required: ['RoleId'], optional: [] },
          produces: [],
        },
      },
    });
    const graph = await loadGraph(baseDir);
    // ABox has zero external-entity kinds → externalEntityIdentifiers
    // is undefined (the loader treats an empty set as "no externals").
    expect(graph.externalEntityIdentifiers).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(/entity-kinds ABox drift detected/);
    expect(allWarnings).toMatch(/spec-vs-abox/);
    expect(allWarnings).toMatch(/NoLongerExternalKind/);
    warn.mockRestore();
  });

  it('hard-errors on drift when STRICT_ENTITY_KINDS_ABOX=1', async () => {
    process.env.STRICT_ENTITY_KINDS_ABOX = '1';
    writeWorkspace({
      entityKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'Role',
            shape: 'entity',
            identifiers: ['RoleId'],
            description: 'in-API',
          },
        ],
      },
      kindRegistry: {
        kinds: [{ name: 'Mystery', shape: 'entity', identifiers: ['MysteryId'] }],
      },
      graphOps: {
        consumeRole: {
          operationId: 'consumeRole',
          method: 'GET',
          path: '/roles/{roleId}',
          requires: { required: ['RoleId'], optional: [] },
          produces: [],
        },
      },
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/entity-kinds ABox drift detected/);
  });

  it('falls back to legacy spec-emitted kindRegistry when no ABox is present', async () => {
    writeWorkspace({
      entityKindsAbox: null,
      kindRegistry: {
        kinds: [
          { name: 'LegacyClient', shape: 'external-entity', identifiers: ['LegacyClientId'] },
        ],
      },
      graphOps: {
        consumeLegacy: {
          operationId: 'consumeLegacy',
          method: 'GET',
          path: '/legacy/{id}',
          requires: { required: ['LegacyClientId'], optional: [] },
          produces: [],
        },
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.externalEntityIdentifiers?.has('LegacyClientId')).toBe(true);
  });

  it('warns when the ABox lists a kind whose identifier types are not referenced by any operation (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      entityKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'DeadKind',
            shape: 'entity',
            identifiers: ['NeverUsedId'],
            description: 'no op references NeverUsedId',
          },
          {
            name: 'LiveKind',
            shape: 'entity',
            identifiers: ['UsedId'],
            description: 'an op consumes UsedId',
          },
        ],
      },
      // No spec kindRegistry — only the durable abox-vs-graph drift
      // applies in this fixture.
      graphOps: {
        useLive: {
          operationId: 'useLive',
          method: 'GET',
          path: '/live/{id}',
          requires: { required: ['UsedId'], optional: [] },
          produces: [],
        },
      },
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(/abox-vs-graph/);
    expect(allWarnings).toMatch(/DeadKind/);
    // LiveKind must NOT be flagged.
    expect(allWarnings).not.toMatch(/LiveKind/);
    warn.mockRestore();
  });
});
