/**
 * Type-aware nested-object scalar seeding — Gap B.
 *
 * `synthesizeObjectFromPrefix` seeds concrete literals for the leaves of a
 * required nested object (there is no `scenario.bindings` context inside a
 * nested object, so it cannot route through `${var}` runtime seeding). The
 * literal MUST match the field's declared JSON type, or the server rejects the
 * entire request body.
 *
 * Regression: `createCluster`'s `license.validLicense` is `type: boolean`, but
 * the synthesizer emitted the string `'placeholder'`, producing
 * `400 "Request body is not readable"`. Before the fix every non-object/array
 * leaf became a string; this asserts the seed honours the declared scalar type.
 *
 * Class-scoped: covers boolean, integer, and number (not just the boolean
 * instance that was reported), while preserving the existing string and
 * format-literal behaviour.
 */
import { describe, expect, it } from 'vitest';
import { synthesizeObjectFromPrefix } from '../../../path-analyser/src/index.ts';

describe('synthesizeObjectFromPrefix: type-aware scalar seeds (Gap B)', () => {
  it('seeds a boolean leaf as a boolean, not the string "placeholder"', () => {
    const obj = synthesizeObjectFromPrefix('license.', [
      { path: 'license.validLicense', type: 'boolean', required: true },
      { path: 'license.licenseType', type: 'string', required: true },
    ]);
    expect(obj.validLicense).toBe(true);
    expect(typeof obj.validLicense).toBe('boolean');
    // plain string field keeps the generic placeholder
    expect(obj.licenseType).toBe('placeholder');
  });

  it('seeds integer and number leaves as numbers', () => {
    const obj = synthesizeObjectFromPrefix('quota.', [
      { path: 'quota.maxNodes', type: 'integer', required: true },
      { path: 'quota.ratio', type: 'number', required: true },
    ]);
    expect(typeof obj.maxNodes).toBe('number');
    expect(typeof obj.ratio).toBe('number');
  });

  it('still emits a format-valid literal for format-constrained scalars (#397)', () => {
    const obj = synthesizeObjectFromPrefix('meta.', [
      { path: 'meta.correlationKey', type: 'string', required: true, format: 'uuid' },
    ]);
    expect(obj.correlationKey).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('still emits "placeholder" for a plain string leaf with no format', () => {
    const obj = synthesizeObjectFromPrefix('meta.', [
      { path: 'meta.name', type: 'string', required: true },
    ]);
    expect(obj.name).toBe('placeholder');
  });
});
