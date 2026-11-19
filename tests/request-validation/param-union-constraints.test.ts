import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSpecBundleDir } from '../../path-analyser/src/configResolver.js';
import {
  generateParamConstraintViolations,
  isParamConstraintEligible,
} from '../../request-validation/src/analysis/paramConstraintViolations.js';
import type { OperationModel, ParameterModel } from '../../request-validation/src/model/types.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';

/**
 * A param constraint-violation scenario sends a value that must break the parameter's schema. When
 * the schema is a `oneOf`/`anyOf`, the value must break EVERY branch: a constraint taken from one
 * branch can build a value another branch accepts, and the test would expect 400 for a valid
 * request (PR #802 review).
 *
 * Property: every param-constraint-violation value fails every union branch of its parameter.
 */

const LONG_KEY = { type: 'string', pattern: '^-?[0-9]+$', minLength: 1, maxLength: 25 };

function opWith(p: ParameterModel): OperationModel {
  return {
    operationId: 'op',
    method: 'GET',
    path: p.in === 'path' ? `/things/{${p.name}}` : '/things',
    tags: [],
    parameters: [p],
  };
}

describe('param constraint violations on union schemas', () => {
  it('builds no length violation when the branches disagree on length', () => {
    // 15 `a`s breaks branch 1 (maxLength 5) but satisfies branch 2 (minLength 6).
    const op = opWith({
      name: 'code',
      in: 'query',
      required: true,
      schema: {
        oneOf: [
          { type: 'string', maxLength: 5 },
          { type: 'string', minLength: 6 },
        ],
      },
    });
    const kinds = generateParamConstraintViolations([op], {}).map((s) => s.constraintKind);
    expect(kinds).not.toContain('length-max');
    expect(kinds).not.toContain('length-min');
    expect(isParamConstraintEligible(op)).toBe(false);
  });

  it('builds no pattern violation when the branches have different patterns', () => {
    const op = opWith({
      name: 'code',
      in: 'query',
      required: true,
      schema: {
        anyOf: [
          { type: 'string', pattern: '^[0-9]+$' },
          { type: 'string', pattern: '^[a-z]+$' },
        ],
      },
    });
    const kinds = generateParamConstraintViolations([op], {}).map((s) => s.constraintKind);
    expect(kinds).not.toContain('pattern');
  });

  it('keeps the pattern violation when every branch shares it (ResourceKey)', () => {
    const branch = (format: string) => ({ type: 'string', format, allOf: [LONG_KEY] });
    const op = opWith({
      name: 'resourceKey',
      in: 'path',
      required: true,
      schema: {
        type: 'string',
        format: 'ResourceKey',
        oneOf: [
          branch('ProcessDefinitionKey'),
          branch('DecisionRequirementsKey'),
          branch('FormKey'),
          branch('DecisionDefinitionKey'),
        ],
      },
    });
    const kinds = generateParamConstraintViolations([op], {}).map((s) => s.constraintKind);
    expect(kinds).toContain('pattern');
  });
});

// ---------------------------------------------------------------------------
// Class-scoped: every param-constraint-violation scenario from the bundled spec.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function compile(pattern: string): RegExp | undefined {
  for (const flags of ['u', '']) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      // try the next mode
    }
  }
  return undefined;
}

/** Does the string `value` satisfy `schema`? allOf parts all apply; a oneOf/anyOf needs one branch. */
function accepts(schema: unknown, value: string): boolean {
  if (!isRecord(schema)) return true;
  if (Array.isArray(schema.allOf) && !schema.allOf.every((part) => accepts(part, value)))
    return false;
  for (const key of ['oneOf', 'anyOf']) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length && !branches.some((b) => accepts(b, value)))
      return false;
  }
  if (Array.isArray(schema.enum) && schema.enum.length && !schema.enum.includes(value))
    return false;
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === 'string') {
    const re = compile(schema.pattern);
    if (re && !re.test(value)) return false;
  }
  return true;
}

function hasUnion(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return true;
  return Array.isArray(schema.allOf) && schema.allOf.some(hasUnion);
}

describe('bundled spec: param constraint violations break every union branch', async () => {
  const m = await loadSpec(join(getSpecBundleDir(process.cwd()), 'rest-api.bundle.json'));
  const scenarios = generateParamConstraintViolations(m.operations, {});
  const opById = new Map(m.operations.map((o) => [o.operationId, o]));

  it('no invalid value is accepted by any branch of its parameter schema', () => {
    const bad: string[] = [];
    let unionChecked = 0;
    for (const s of scenarios) {
      const [where, name] = (s.target ?? '').split('.');
      const p = opById
        .get(s.operationId)
        ?.parameters.find((x) => x.in === where && x.name === name);
      const value = s.params?.[name];
      if (!p || value === undefined) continue;
      if (hasUnion(p.schema)) unionChecked++;
      if (accepts(p.schema, String(value)))
        bad.push(`${s.operationId} ${s.target} ${s.constraintKind}: ${JSON.stringify(value)}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
    // The property must actually reach union-typed params (ResourceKey), or it proves nothing.
    expect(unionChecked).toBeGreaterThan(0);
  });
});
