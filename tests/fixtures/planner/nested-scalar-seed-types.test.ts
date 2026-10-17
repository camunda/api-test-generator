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

/**
 * Nested enum leaves must be seeded with a declared enum value.
 *
 * `scalarSeedLiteral` resolved format → declared type → `'placeholder'`, but
 * never consulted `node.enum`, so a required nested enum leaf was seeded with a
 * value the schema does not permit. The reported instance is
 * `createAgentInstance`'s `history[].role` (an `allOf` `$ref` to
 * `AgentInstanceHistoryRoleEnum`): the synthesizer emitted `"role":"placeholder"`
 * and the broker rejected the whole body with
 * `400 Unexpected value 'placeholder' for enum field 'role'` — 28 live Python
 * failures across `createAgentInstance` / `updateAgentInstance` and their variants.
 *
 * Class-scoped: asserts the fix for string enums AND for non-string enums, where
 * the type-correct default is enum-invalid rather than merely schema-invalid
 * (`integer` seeded `1` is not a member of `[3, 4]`). Also pins the precedence
 * when a leaf declares both `format` and `enum` (the closed enum set wins), and
 * asserts that a leaf with no enum keeps the existing behaviour.
 */
describe('synthesizeObjectFromPrefix: enum-aware scalar seeds', () => {
  it('seeds a required nested string enum leaf with its first declared value, not "placeholder"', () => {
    const obj = synthesizeObjectFromPrefix('history[].', [
      {
        path: 'history[].role',
        type: 'string',
        required: true,
        enum: ['USER', 'ASSISTANT', 'TOOL_RESULT', 'CONFIGURATION'],
      },
      { path: 'history[].loopIteration', type: 'integer', required: true },
    ]);
    expect(obj.role).toBe('USER');
    // a sibling leaf with no enum keeps its type-correct default
    expect(obj.loopIteration).toBe(1);
  });

  it('seeds a non-string enum leaf with a declared member, not the type default', () => {
    // `1` is type-correct for `integer` but is NOT a member of this enum,
    // so a type-only seed would still be rejected by the server.
    const obj = synthesizeObjectFromPrefix('quota.', [
      { path: 'quota.level', type: 'integer', required: true, enum: [3, 4] },
    ]);
    expect(obj.level).toBe(3);
    expect([3, 4]).toContain(obj.level);
  });

  it('prefers the declared enum over the format literal when a leaf declares both', () => {
    // An `enum` is a closed value set: a format-valid literal that is not a
    // member is rejected outright, whereas enum members are authored to be
    // valid values. So the enum constraint wins. (No schema in the pinned
    // camunda-oca spec declares both — all 48 enum-bearing component schemas
    // have no `format` — so this pins the semantics rather than a live case.)
    const obj = synthesizeObjectFromPrefix('meta.', [
      {
        path: 'meta.correlationKey',
        type: 'string',
        required: true,
        format: 'uuid',
        enum: ['not-a-uuid'],
      },
    ]);
    expect(obj.correlationKey).toBe('not-a-uuid');
  });

  it('still emits "placeholder" for a string leaf with an empty enum array', () => {
    const obj = synthesizeObjectFromPrefix('meta.', [
      { path: 'meta.name', type: 'string', required: true, enum: [] },
    ]);
    expect(obj.name).toBe('placeholder');
  });
});
