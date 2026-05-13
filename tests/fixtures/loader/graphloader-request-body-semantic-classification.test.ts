/**
 * Loader fixtures for #162 PR 5 — unclassified-semantic load-time
 * diagnostic.
 *
 * Every semantic referenced by an operation's `requestBodySemanticTypes`
 * must fit exactly one of the five classifications defined in
 * `bindSemanticInput.ts`:
 *
 *   - `modelDerived`             (domain-semantics: kind: 'modelDerived')
 *   - `clientMintedAttribute`    (domain-semantics: kind: 'attribute' + clientMinted)
 *   - `serverEmergent`           (domain-semantics: kind: 'serverEmergent')
 *   - `producerBound`            (graph.producersByType[T])
 *   - `clientMintedIdentifier`   (graph.establishersByType[T])
 *   - `externalBoundary`         (graph.externalEntityIdentifiers)
 *
 * If a semantic falls through all of those, `classifySemantic` returns
 * `'unclassified'` and the planner has no rule for what value to bind.
 * Pre-PR 5 this surfaced as a placeholder string in the emitted suite
 * with no record of the gap; PR 5 turns it into a fail-fast at graph
 * load so a future spec change that introduces a new semantic without
 * an accompanying classification is caught immediately.
 *
 * The fixtures here exercise the validator in isolation against
 * synthetic graphs — the real bundled-spec sweep is covered by the
 * pipeline regen step (any unclassified semantic in the live graph
 * fails `npm run testsuite:generate`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

interface Layout {
  graph: Record<string, unknown>;
  domain: Record<string, unknown>;
}

let workdir: string;
let baseDir: string;
let graphDir: string;
let configDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-pr5-'));
  baseDir = join(workdir, 'path-analyser');
  graphDir = join(workdir, 'generated', 'camunda-oca', 'graph');
  configDir = join(workdir, 'configs', 'camunda-oca');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(workdir, 'configs.json'),
    JSON.stringify({ default: 'camunda-oca', configs: { 'camunda-oca': {} } }),
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeLayout(layout: Layout): void {
  writeFileSync(join(graphDir, 'operation-dependency-graph.json'), JSON.stringify(layout.graph));
  writeFileSync(join(configDir, 'domain-semantics.json'), JSON.stringify(layout.domain));
}

describe('graphLoader: requestBodySemantics classification fail-fast (#162 PR 5)', () => {
  it('throws when a single requestBodySemanticTypes entry references an unclassified semantic', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchFoos',
            method: 'POST',
            path: '/foos/search',
            requestBodySemanticTypes: [
              { semanticType: 'FooKey', fieldPath: 'filter.fooKey', required: false },
            ],
          },
        ],
      },
      // No semanticTypes declaration for FooKey, no producer, no establisher,
      // no external-entity identifier — the classifier returns 'unclassified'.
      domain: {},
    });

    await expect(loadGraph(baseDir)).rejects.toThrow(/requestBodySemanticUnclassified/);
    await expect(loadGraph(baseDir)).rejects.toThrow(/FooKey/);
    await expect(loadGraph(baseDir)).rejects.toThrow(/searchFoos/);
  });

  it('reports every offending (operationId, semantic) pair — class-scoped, not just the first', async () => {
    // Two ops, two distinct unclassified semantics. The diagnostic must
    // list both so a future spec change introducing N new semantics
    // surfaces all of them in one load failure rather than turning into
    // a peel-the-onion of N separate failures.
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchAlphas',
            method: 'POST',
            path: '/alphas/search',
            requestBodySemanticTypes: [
              { semanticType: 'AlphaKey', fieldPath: 'filter.alphaKey', required: false },
            ],
          },
          {
            operationId: 'searchBetas',
            method: 'POST',
            path: '/betas/search',
            requestBodySemanticTypes: [
              { semanticType: 'BetaKey', fieldPath: 'filter.betaKey', required: false },
            ],
          },
        ],
      },
      domain: {},
    });

    let captured: unknown;
    try {
      await loadGraph(baseDir);
    } catch (err) {
      captured = err;
    }
    expect(captured, 'expected loadGraph to throw').toBeInstanceOf(Error);
    const message = captured instanceof Error ? captured.message : String(captured);
    expect(message).toMatch(/AlphaKey/);
    expect(message).toMatch(/searchAlphas/);
    expect(message).toMatch(/BetaKey/);
    expect(message).toMatch(/searchBetas/);
  });

  it('passes when every requestBodySemantics entry resolves to a known classification', async () => {
    // One op declares a producerBound semantic (Tier 2a) and one
    // serverEmergent semantic (Tier 1c — the new class PR 5 adds for
    // server-minted lifecycle keys like IncidentKey/AuditLogKey that no
    // client API call directly creates).
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createWidget',
            method: 'POST',
            path: '/widgets',
            producesSemanticTypes: ['WidgetKey'],
            // Mirror the response-shape that drives providerMap=true so
            // the producer is authoritative (Tier 2a).
            responseSemanticTypes: [
              { semanticType: 'WidgetKey', fieldPath: 'widgetKey', provider: true },
            ],
          },
          {
            operationId: 'searchWidgetIncidents',
            method: 'POST',
            path: '/widgets/incidents/search',
            requestBodySemanticTypes: [
              { semanticType: 'WidgetKey', fieldPath: 'filter.widgetKey', required: false },
              {
                semanticType: 'WidgetIncidentKey',
                fieldPath: 'filter.incidentKey',
                required: false,
              },
            ],
          },
        ],
      },
      domain: {
        semanticTypes: {
          WidgetIncidentKey: { kind: 'serverEmergent' },
        },
      },
    });

    const g = await loadGraph(baseDir);
    // Sanity: the load actually succeeded and produced the expected
    // operations, otherwise this test is vacuously green.
    expect(Object.keys(g.operations)).toEqual(
      expect.arrayContaining(['createWidget', 'searchWidgetIncidents']),
    );
  });
});
