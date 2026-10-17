/**
 * Item 5A — the Python emitter must honour a per-path `serverOverride`.
 *
 * The bundled spec declares a path-level `servers` override
 * (`{schema}://{host}:{port}` — the API root, WITHOUT `/v2`) on the 15
 * `/cluster/v2/...` path items, while the document-root server is
 * `{schema}://{host}:{port}/v2`. Per OpenAPI the effective URL is
 * path-item-server + path, e.g. `http://localhost:8080/cluster/v2/status`.
 *
 * The extractor already models this (`resolveServerOverride`) and the planner
 * already plumbs it (`RequestStep.serverOverride`, documented as "carried
 * through so the emitter can build this step's request URL against the right
 * base"). Playwright already consumes it (`resolveScenarioServerOverride` →
 * `buildBaseUrl(true)`). The Python emitter ignored the field entirely, so it
 * emitted `url_1 = f'cluster/v2/status'`, which httpx resolves against the
 * client's `base_url` (`http://localhost:8080/v2/`) as
 * `/v2/cluster/v2/status` → 404 "No endpoint GET /v2/cluster/v2/status".
 *
 * The leading-slash strip in `buildPythonUrlExpression` is itself correct and
 * deliberate (RFC 3986: a root-relative path would REPLACE base_url's path and
 * silently drop `/v2`). The defect is the missing override branch.
 *
 * Mechanism: httpx passes an ABSOLUTE url through `_merge_url` untouched, so
 * prefixing the path with a root base URL is sufficient and needs no second
 * client fixture. Verified:
 *   _merge_url('cluster/v2/status')                -> .../v2/cluster/v2/status
 *   _merge_url('http://localhost:8080/cluster/...') -> .../cluster/v2/status
 *
 * Resolution is per STEP, not per test: Python emits one `url_N` per step, so
 * the mixed-override hazard that makes Playwright's
 * `resolveScenarioServerOverride` throw cannot arise here.
 */

import { describe, expect, test } from 'vitest';
import {
  buildPythonUrlExpression,
  renderPythonSuite,
} from '../../materializer/src/python-sdk/emitter.js';
import { loadPythonProjectScaffoldingFiles } from '../../materializer/src/python-sdk/materialize-support.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.js';

/** The override value the extractor emits for every `/cluster/v2/...` path item. */
const CLUSTER_ROOT_OVERRIDE = '{schema}://{host}:{port}';

function clusterStep(overrides: Partial<RequestStep> = {}): RequestStep {
  return {
    operationId: 'getClusterStatus',
    method: 'GET',
    pathTemplate: '/cluster/v2/status',
    serverOverride: CLUSTER_ROOT_OVERRIDE,
    expect: { status: 200 },
    ...overrides,
  };
}

function collectionFor(steps: RequestStep[]): EndpointScenarioCollection {
  const first = steps[0];
  if (first === undefined) throw new Error('collectionFor needs at least one step');
  return {
    endpoint: {
      operationId: first.operationId,
      method: first.method,
      path: first.pathTemplate,
    },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'cluster status',
        description: 'Read the cluster status',
        operations: steps.map((s) => ({
          operationId: s.operationId,
          method: s.method,
          path: s.pathTemplate,
          serverOverride: s.serverOverride,
        })),
        requestPlan: steps,
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
      },
    ],
  };
}

describe('buildPythonUrlExpression honours a per-path serverOverride (Item 5A)', () => {
  test('a step WITH a serverOverride builds its URL against the API root, not the /v2 base', () => {
    const url = buildPythonUrlExpression('/cluster/v2/status', undefined, CLUSTER_ROOT_OVERRIDE);

    // Absolute against the root base: httpx passes an absolute URL through
    // _merge_url untouched, so this cannot be re-prefixed with '/v2'.
    expect(url).toContain('root_base_url()');
    // The path keeps its leading '/' stripped so it extends the root base
    // rather than replacing its path.
    expect(url).toContain('cluster/v2/status');
    expect(url).not.toContain('/cluster/v2/status');
  });

  test('a step WITHOUT a serverOverride keeps the existing relative-to-/v2 form', () => {
    const url = buildPythonUrlExpression('/topology');

    expect(url).toBe("f'topology'");
    expect(url).not.toContain('root_base_url()');
  });

  test('an explicitly undefined serverOverride is not treated as an override', () => {
    // `!== undefined`, never a truthiness check: an OpenAPI `servers[].url`
    // can legitimately be the empty string (relative to the current host),
    // which is a real override and must not be conflated with "no override".
    expect(buildPythonUrlExpression('/topology', undefined, undefined)).toBe("f'topology'");
  });

  test('an empty-string serverOverride IS an override (root-relative server)', () => {
    const url = buildPythonUrlExpression('/cluster/v2/status', undefined, '');

    expect(url).toContain('root_base_url()');
  });

  test('path-param substitution still works under a serverOverride', () => {
    const url = buildPythonUrlExpression(
      '/cluster/v2/backups/history/{backupId}',
      undefined,
      CLUSTER_ROOT_OVERRIDE,
    );

    expect(url).toContain('root_base_url()');
    expect(url).toContain('cluster/v2/backups/history/');
    expect(url).toContain('ctx.get("backupIdVar")');
    // Double-quoted inner literals: the expression is embedded in a
    // single-quoted f-string, so a single quote here would close it early.
    expect(url).not.toContain("'backupIdVar'");
  });
});

describe('renderPythonSuite wires the root base for serverOverride steps (Item 5A)', () => {
  test('imports root_base_url when a step carries a serverOverride', () => {
    const output = renderPythonSuite(collectionFor([clusterStep()]));

    expect(output).toContain('from support.base_url import root_base_url');
    expect(output).toContain('root_base_url()');
  });

  test('does NOT import root_base_url when no step carries a serverOverride', () => {
    const output = renderPythonSuite(
      collectionFor([clusterStep({ serverOverride: undefined, pathTemplate: '/topology' })]),
    );

    expect(output).not.toContain('root_base_url');
  });

  test('resolves per STEP, so a mixed scenario routes each step to its own base', () => {
    // Python emits one url_N per step, so unlike Playwright (which hoists a
    // single baseUrl per test and must throw on a mix) this is representable.
    const output = renderPythonSuite(
      collectionFor([
        clusterStep({
          operationId: 'getTopology',
          pathTemplate: '/topology',
          serverOverride: undefined,
        }),
        clusterStep(),
      ]),
    );

    expect(output).toContain('from support.base_url import root_base_url');
    // Step 1 (no override) stays relative to the /v2 base.
    expect(output).toMatch(/url_1 = f'topology'/);
    // Step 2 (override) is absolute against the root.
    expect(output).toMatch(/url_2 = f'\{root_base_url\(\)\}cluster\/v2\/status'/);
  });
});

describe('the python support package ships root_base_url (Item 5A)', () => {
  test('support/base_url.py is emitted and defines root_base_url', () => {
    const files = loadPythonProjectScaffoldingFiles();
    const baseUrl = files.find((f) => f.relativePath === 'support/base_url.py');

    expect(baseUrl).toBeDefined();
    expect(baseUrl?.content).toContain('def root_base_url()');
  });

  test('root_base_url mirrors playwright buildBaseUrl(true) precedence', () => {
    const files = loadPythonProjectScaffoldingFiles();
    const content = files.find((f) => f.relativePath === 'support/base_url.py')?.content ?? '';

    // Explicit root override wins.
    expect(content).toContain('CAMUNDA_ROOT_URL');
    // Else the /v2 base with a trailing '/v2' stripped.
    expect(content).toContain('CAMUNDA_BASE_URL');
    expect(content).toContain('r"/v2/?$"');
    // Else the localhost default.
    expect(content).toContain('http://localhost:8080');
    // Must end with '/' so an emitted relative path EXTENDS it (RFC 3986).
    expect(content).toContain('endswith("/")');
  });
});
