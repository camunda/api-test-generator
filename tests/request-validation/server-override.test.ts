import { describe, expect, it } from 'vitest';
import {
  isBareRootServerUrl,
  resolveServerOverride,
} from '../../request-validation/src/spec/loader.js';

/**
 * Layer-1 fixture for the `servers` override handling added alongside the
 * materializer/positive-suite fix (PR #564): `request-validation` parses the
 * spec directly (via SwaggerParser) rather than through the semantic-graph
 * extractor's intermediate graph JSON, so it carries its own, independent
 * copy of this logic — see `semantic-graph-extractor/schema-analyzer.ts`'s
 * equivalent fixtures in `tests/fixtures/extractor/extractor-constructs.test.ts`.
 */

describe('isBareRootServerUrl', () => {
  it('accepts a bare scheme://host:port authority', () => {
    expect(isBareRootServerUrl('{schema}://{host}:{port}')).toBe(true);
    expect(isBareRootServerUrl('http://localhost:8080')).toBe(true);
  });

  it('rejects a URL with a path suffix beyond the authority', () => {
    expect(isBareRootServerUrl('{schema}://{host}:{port}/v2')).toBe(false);
  });

  it('rejects a value with no scheme separator (e.g. the empty string)', () => {
    expect(isBareRootServerUrl('')).toBe(false);
  });
});

describe('resolveServerOverride', () => {
  const CLUSTER_ADMIN_SERVER = '{schema}://{host}:{port}';

  it('returns undefined when there is no raw override', () => {
    expect(resolveServerOverride('getThing', undefined, undefined)).toBeUndefined();
  });

  it('returns undefined when the override merely restates the document root', () => {
    expect(
      resolveServerOverride('listThings', CLUSTER_ADMIN_SERVER, CLUSTER_ADMIN_SERVER),
    ).toBeUndefined();
  });

  it('returns the override when it differs from the document root', () => {
    expect(resolveServerOverride('getClusterStatus', CLUSTER_ADMIN_SERVER, undefined)).toBe(
      CLUSTER_ADMIN_SERVER,
    );
  });

  it('throws for an override shape it cannot route (a path suffix beyond the authority)', () => {
    expect(() =>
      resolveServerOverride(
        'triggerClusterRebalance',
        '{schema}://{host}:{port}/not-a-bare-root',
        undefined,
      ),
    ).toThrow(/unsupported servers override/);
  });
});
