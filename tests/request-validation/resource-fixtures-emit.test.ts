import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { ValidationScenario } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture for issue #352 (resource fixtures).
 *
 * A malformed-field negative test must ride on an otherwise-valid envelope: the
 * path key and any referenced body resource (project/folder) must EXIST, so the
 * request reaches the body-validation layer (400) instead of being short-
 * circuited by a resource lookup (404) or access check (403) on a filler
 * placeholder. The emitter substitutes `process.env.<ENV> || '<filler>'` (`||` so
 * an unset OR empty env var falls back) for any path param / body field whose
 * name is in the fixture map and whose value is a FILLER placeholder (`'x'` or
 * `'1'`) — never for a deliberately-malformed value.
 *
 * Guards locked in here:
 *   1. path param filler → env lookup (using the path-override map);
 *   2. body field filler → env lookup (using the base map);
 *   3. a deliberately-malformed value on a fixture field is left intact;
 *   4. the `'1'` filler (constraintViolations/parameters) is substituted too;
 *   5. pathResourceFixtures override applies to path params only, not the body.
 */

function scenario(overrides: Partial<ValidationScenario>): ValidationScenario {
  return {
    id: 'probe',
    operationId: 'probe',
    method: 'PATCH',
    path: '/files/{fileKey}',
    type: 'additional-prop',
    expectedStatus: 400,
    description: 'probe',
    headersAuth: true,
    ...overrides,
  };
}

const FIX = { fileKey: 'RV_FIXTURE_FILE_KEY', projectKey: 'RV_FIXTURE_PROJECT_KEY' };

/** The real camunda-hub `resourceFixtures` map, string-valued entries only. */
function loadHubResourceFixtures(): Record<string, string> {
  const raw: unknown = JSON.parse(
    readFileSync(join(process.cwd(), 'configs/camunda-hub/request-validation.json'), 'utf8'),
  );
  const fixtures =
    typeof raw === 'object' && raw !== null && 'resourceFixtures' in raw
      ? raw.resourceFixtures
      : undefined;
  if (typeof fixtures !== 'object' || fixtures === null) {
    throw new Error('configs/camunda-hub/request-validation.json has no resourceFixtures object');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fixtures)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

describe('request-validation: resource-fixture emit (#352)', () => {
  it('substitutes env lookups for path-key and body-field fillers', () => {
    const out = renderScenarioForTest(
      scenario({ params: { fileKey: 'x' }, requestBody: { projectKey: 'x', name: 'x' } }),
      'probe',
      FIX,
    );
    // path param
    expect(out).toContain('process.env["RV_FIXTURE_FILE_KEY"] || "x"');
    // body field
    expect(out).toContain('process.env["RV_FIXTURE_PROJECT_KEY"] || "x"');
  });

  it('does NOT substitute a deliberately-malformed value on a fixture field', () => {
    const out = renderScenarioForTest(
      // param-type-mismatch puts a wrong-type value on the key itself.
      scenario({ requestBody: { projectKey: 123 } }),
      'probe',
      FIX,
    );
    expect(out).toContain('projectKey: 123');
    expect(out).not.toContain('RV_FIXTURE_PROJECT_KEY');
  });

  it("substitutes the '1' filler (constraintViolations/parameters) too", () => {
    const out = renderScenarioForTest(scenario({ params: { fileKey: '1' } }), 'probe', FIX);
    expect(out).toContain('process.env["RV_FIXTURE_FILE_KEY"] || "1"');
  });

  it('substitutes the catalog assetKey filler from the hub config map', () => {
    // Regression guard: /catalog/assets/{assetKey} binds the path variable to a
    // CatalogAsset via findById, so a filler key 404s before body validation and
    // every 400-expecting scenario on that path fails (camunda-hub#28600's
    // searchCatalogAssetProjectUsages surfaced this). The mapping must stay in
    // configs/camunda-hub/request-validation.json for the fixture to reach the
    // emitted suite.
    const hubFixtures = loadHubResourceFixtures();
    expect(hubFixtures.assetKey).toBe('RV_FIXTURE_CATALOG_ASSET_KEY');
    const out = renderScenarioForTest(
      scenario({
        method: 'POST',
        path: '/catalog/assets/{assetKey}/project-usages/search',
        params: { assetKey: 'x' },
      }),
      'probe',
      hubFixtures,
    );
    expect(out).toContain('process.env["RV_FIXTURE_CATALOG_ASSET_KEY"] || "x"');
  });

  it('applies pathResourceFixtures override to the PATH param only, not the body', () => {
    const out = renderScenarioForTest(
      scenario({
        path: '/projects/{projectKey}',
        params: { projectKey: 'x' },
        requestBody: { projectKey: 'x' },
      }),
      'probe',
      { projectKey: 'RV_FIXTURE_PROJECT_KEY' }, // base (body)
      { projectKey: 'RV_FIXTURE_V2_PROJECT_KEY' }, // path override
    );
    // path uses the override env...
    expect(out).toMatch(/buildUrl\([^)]*RV_FIXTURE_V2_PROJECT_KEY/s);
    // ...the body still uses the base env.
    expect(out).toContain(
      'const requestBody = {projectKey: process.env["RV_FIXTURE_PROJECT_KEY"] || "x"}',
    );
  });
});
