import { describe, expect, it } from 'vitest';
import { resolveServerOverride } from '../../request-validation/src/spec/loader.js';

/**
 * Layer-1 fixture for the `servers` override handling added alongside the
 * materializer/positive-suite fix (PR #564): `request-validation` parses the
 * spec directly (via SwaggerParser) rather than through the semantic-graph
 * extractor's intermediate graph JSON, so it carries its own, independent
 * copy of this logic — see `semantic-graph-extractor/schema-analyzer.ts`'s
 * equivalent fixtures in `tests/fixtures/extractor/extractor-constructs.test.ts`.
 *
 * `resolveServerOverride` only accepts the document root with its version
 * segment stripped — the one relationship `buildUrl`'s `useRoot` parameter
 * actually implements — and throws for anything else, so an override that
 * changes the authority or adds a query/fragment can't slip through as if
 * it were routable (PR #564 review round 4).
 */
describe('resolveServerOverride', () => {
  const ROOT_AUTHORITY = '{schema}://{host}:{port}';
  const DOCUMENT_ROOT = `${ROOT_AUTHORITY}/v2`;

  it('returns undefined when there is no raw override', () => {
    expect(resolveServerOverride('getThing', undefined, DOCUMENT_ROOT)).toBeUndefined();
  });

  it('returns undefined when the override merely restates the document root', () => {
    expect(resolveServerOverride('listThings', DOCUMENT_ROOT, DOCUMENT_ROOT)).toBeUndefined();
  });

  it('returns the override when it is exactly the document root with its version segment stripped', () => {
    expect(resolveServerOverride('getClusterStatus', ROOT_AUTHORITY, DOCUMENT_ROOT)).toBe(
      ROOT_AUTHORITY,
    );
  });

  it('throws when there is no document root to derive the expected override from', () => {
    expect(() => resolveServerOverride('getClusterStatus', ROOT_AUTHORITY, undefined)).toThrow(
      /unsupported servers override/,
    );
  });

  it('throws for an override with a path suffix beyond the stripped root', () => {
    expect(() =>
      resolveServerOverride(
        'triggerClusterRebalance',
        `${ROOT_AUTHORITY}/not-a-bare-root`,
        DOCUMENT_ROOT,
      ),
    ).toThrow(/unsupported servers override/);
  });

  it('throws for an override that changes the authority (different host/port)', () => {
    expect(() =>
      resolveServerOverride('getClusterStatus', '{schema}://{host}:{otherPort}', DOCUMENT_ROOT),
    ).toThrow(/unsupported servers override/);
  });

  it('throws for an override with a query or fragment, even without a path segment', () => {
    expect(() =>
      resolveServerOverride('getClusterStatus', 'http://host:8080?x=1', 'http://host:8080/v2'),
    ).toThrow(/unsupported servers override/);
    expect(() =>
      resolveServerOverride('getClusterStatus', 'http://host:8080#frag', 'http://host:8080/v2'),
    ).toThrow(/unsupported servers override/);
  });
});
