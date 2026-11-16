import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readRequired(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `response-coverage input not found at ${path} (run the pipeline for this config first)`,
    );
  }
  return readFileSync(path, 'utf8');
}

/**
 * Shared Layer-3 guard: run scripts/e2e/hub_response_coverage.py for `configName` and assert its
 * numbers stay at or above the floors in `floorsPath`. Both configs' `response coverage does not
 * regress` invariants call this, so the floor-checking logic lives in exactly one place.
 *
 * Floors are one-way minimums (asserted responses per status, request-check / optional-field /
 * lifecycle counts, per-kind and per-aliased-type endpoint counts) plus two **ceilings**
 * (`maxOperationsWithNoRequestTest`, `maxShapeUnvalidated`) that ratchet their gaps down to zero.
 * Called inside an `it`, so `expect` is in context.
 */
export function assertResponseCoverageFloors(
  configName: string,
  floorsPath: string,
  repoRoot: string,
): void {
  const floors: unknown = JSON.parse(readRequired(floorsPath));
  const out = mkdtempSync(join(tmpdir(), 'response-coverage-'));
  try {
    // The same script and data as the report, so the floors and the report cannot drift apart.
    const run = spawnSync(
      'python3',
      [
        join(repoRoot, 'scripts/e2e/hub_response_coverage.py'),
        '--config',
        configName,
        '--out',
        out,
      ],
      { encoding: 'utf8', env: { ...process.env } },
    );
    expect(run.status, `coverage audit failed to run: ${run.stderr}`).toBe(0);
    const summary: unknown = JSON.parse(readRequired(join(out, 'summary.json')));
    expect(isRecord(summary) && isRecord(floors), 'unreadable coverage summary or floors').toBe(
      true,
    );
    if (!isRecord(summary) || !isRecord(floors)) return;

    const pair = (v: unknown): number => (Array.isArray(v) && typeof v[0] === 'number' ? v[0] : -1);
    const codes = isRecord(summary.codes) ? summary.codes : {};
    const lifecycle = isRecord(summary.lifecycle) ? summary.lifecycle : {};
    const floorCodes = isRecord(floors.assertedByStatus) ? floors.assertedByStatus : {};
    // Every bucket the report counts needs a numeric floor, or its guard would silently go missing.
    expect(
      Object.keys(floorCodes).sort(),
      'floors must cover exactly the report status buckets',
    ).toEqual(Object.keys(codes).sort());
    const isFloor = (v: unknown): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0;
    const badFloors = [
      ...Object.entries(floorCodes).map(([k, v]) => [`assertedByStatus.${k}`, v] as const),
      ...(
        [
          'optionalFieldsSent',
          'requestChecksCovered',
          'fullyAssertedOperations',
          'lifecycleCreateCovered',
          'lifecycleRestoreCovered',
          'lifecycleEdgeCovered',
          'maxOperationsWithNoRequestTest',
          'maxShapeUnvalidated',
        ] as const
      ).map((k) => [k, floors[k]] as const),
    ].filter(([, v]) => !isFloor(v));
    expect(
      badFloors.map(([k]) => k),
      'floors must be non-negative integers',
    ).toEqual([]);
    const regressed: string[] = [];
    for (const [status, floor] of Object.entries(floorCodes)) {
      const actual = pair(codes[status]);
      if (typeof floor === 'number' && actual < floor) {
        regressed.push(`${status}: ${actual} asserted, floor ${floor}`);
      }
    }
    const single: [string, number, number][] = [
      [
        'optional request fields sent',
        pair(summary.optionalFields),
        Number(floors.optionalFieldsSent),
      ],
      ['request checks covered', pair(summary.requestChecks), Number(floors.requestChecksCovered)],
      [
        'fully asserted operations',
        Number(summary.fullyAsserted),
        Number(floors.fullyAssertedOperations),
      ],
      [
        'resources with a create-read-delete flow test',
        pair(lifecycle.create),
        Number(floors.lifecycleCreateCovered),
      ],
      [
        'resources with a delete-restore flow test',
        pair(lifecycle.restore),
        Number(floors.lifecycleRestoreCovered),
      ],
      [
        'add-and-remove links with a flow test',
        pair(lifecycle.edge),
        Number(floors.lifecycleEdgeCovered),
      ],
    ];
    for (const [label, actual, floor] of single) {
      if (!(actual >= floor)) regressed.push(`${label}: ${actual}, floor ${floor}`);
    }
    // Per scenario kind: how many endpoints have at least one scenario of it. The report lists only the kinds a
    // generator can build as missing, so a generator that silently stops producing a kind would no longer show up
    // there; this floor catches it. A kind the suite generates needs a floor too, or its guard would go missing.
    const kindFloors = isRecord(floors.requestKindEndpoints) ? floors.requestKindEndpoints : {};
    const kindActual = isRecord(summary.requestKindEndpoints) ? summary.requestKindEndpoints : {};
    expect(
      Object.keys(kindActual)
        .filter((k) => !(k in kindFloors))
        .sort(),
      'scenario kinds the suite generates but requestKindEndpoints has no floor for (add one)',
    ).toEqual([]);
    for (const [kind, floor] of Object.entries(kindFloors)) {
      const actual = typeof kindActual[kind] === 'number' ? kindActual[kind] : 0;
      if (!isFloor(floor)) regressed.push(`requestKindEndpoints.${kind}: floor is not a count`);
      else if (actual < floor) {
        regressed.push(
          `scenario kind ${kind}: ${actual} endpoints have one, floor ${floor} (a generator stopped producing it?)`,
        );
      }
    }
    // A scenario type that COVERAGE.json counts under another kind's name (body-top-type-mismatch as type-mismatch)
    // is invisible to the endpoint counts above. Its raw scenario count has its own floor, so that generator cannot
    // vanish while the kind it is counted under keeps the same endpoints.
    const typeFloors = isRecord(floors.requestScenarioTypes) ? floors.requestScenarioTypes : {};
    const typeActual = isRecord(summary.requestScenarioTypes) ? summary.requestScenarioTypes : {};
    expect(
      Object.keys(typeActual)
        .filter((t) => !(t in kindActual) && !(t in typeFloors))
        .sort(),
      'scenario types counted under another kind but with no floor in requestScenarioTypes (add one)',
    ).toEqual([]);
    for (const [type, floor] of Object.entries(typeFloors)) {
      const actual = typeof typeActual[type] === 'number' ? typeActual[type] : 0;
      if (!isFloor(floor)) regressed.push(`requestScenarioTypes.${type}: floor is not a count`);
      else if (actual < floor) {
        regressed.push(
          `scenario type ${type}: ${actual} scenarios, floor ${floor} (a generator stopped producing it?)`,
        );
      }
    }
    expect(regressed, 'response coverage dropped below its floor').toEqual([]);

    const allowed = new Set(
      (Array.isArray(floors.zeroTestOperations) ? floors.zeroTestOperations : [])
        .filter(isRecord)
        .map((e) => {
          expect(
            typeof e.reason === 'string' && e.reason,
            `${String(e.operationId)} needs a reason`,
          ).toBeTruthy();
          return e.operationId;
        }),
    );
    const zero = Array.isArray(summary.zeroTestOperations) ? summary.zeroTestOperations : [];
    expect(
      zero.filter((id) => !allowed.has(id)),
      'operations with no test at all (add one, or list it in zeroTestOperations with a reason)',
    ).toEqual([]);
    expect(
      [...allowed].filter((id) => !zero.includes(id)),
      'zeroTestOperations lists operations that now have tests; remove them',
    ).toEqual([]);
    // Ceilings (ratchet to zero): a config may carry a non-zero baseline of endpoints with no
    // request-validation test, or success responses not schema-validated, as long as it does not grow.
    const noTests = Array.isArray(summary.requestNoTests) ? summary.requestNoTests : [];
    expect(
      noTests.length <= Number(floors.maxOperationsWithNoRequestTest),
      `operations with no request-validation test: ${noTests.length}, ceiling ${Number(floors.maxOperationsWithNoRequestTest)}${noTests.length ? ` (${noTests.join(', ')})` : ''}`,
    ).toBe(true);
    const unvalidated = Array.isArray(summary.shapeUnvalidated) ? summary.shapeUnvalidated : [];
    expect(
      unvalidated.length <= Number(floors.maxShapeUnvalidated),
      `success responses not schema-validated: ${unvalidated.length}, ceiling ${Number(floors.maxShapeUnvalidated)}${unvalidated.length ? ` (${unvalidated.join(', ')})` : ''}`,
    ).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
