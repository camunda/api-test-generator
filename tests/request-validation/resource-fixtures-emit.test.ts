import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { ValidationScenario } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture for issue #352 (resource fixtures).
 *
 * A malformed-field negative test must ride on an otherwise-valid envelope: the
 * path key and any referenced body resource (project/folder) must EXIST, so the
 * request reaches the body-validation layer (400) instead of being short-
 * circuited by a resource lookup (404) or access check (403) on the `'x'`
 * placeholder. The emitter substitutes `process.env.<ENV> ?? '<filler>'` for any
 * path param / body field whose name is in the fixture map and whose value is a
 * FILLER placeholder (`'x'` or `'1'`) — never for a deliberately-malformed value.
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
