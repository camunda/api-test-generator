import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSpecBundleDir } from '../../path-analyser/src/configResolver.js';
import { generateAdditionalPropsViolations } from '../../request-validation/src/analysis/additionalProps.js';
import { generateUniversalAdditionalProp } from '../../request-validation/src/analysis/additionalPropUniversal.js';
import {
  generateFormatInvalid,
  generateMultipleOfViolations,
  generateNestedAdditionalProps,
  generateUniqueItemsViolations,
} from '../../request-validation/src/analysis/advancedSchema.js';
import {
  generateAllOfConflicts,
  generateAllOfMissingRequired,
} from '../../request-validation/src/analysis/allOf.js';
import { generateBodyTypeMismatch } from '../../request-validation/src/analysis/bodyTypeMismatch.js';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import { generateEnumViolations } from '../../request-validation/src/analysis/enumViolations.js';
import { generatePaginationCursorInvalid } from '../../request-validation/src/analysis/paginationCursor.js';
import { generatePaginationLimitInvalid } from '../../request-validation/src/analysis/paginationLimit.js';
import { generatePaginationOffsetPastTotal } from '../../request-validation/src/analysis/paginationOffset.js';
import type {
  OperationModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import { loadSpec } from '../../request-validation/src/spec/loader.js';
import type { CapabilityGateInfo } from '../../request-validation/src/util/capabilityGate.js';

/**
 * A body scenario changes one field of a baseline body and expects the server to reject that
 * field. If another field in the baseline is itself invalid (`scopeKey: "x"` for a numeric key),
 * the server rejects that first and the test checks the wrong field. If an optional
 * capability-gated field (`tenantId` while multi-tenancy is off) is in the baseline, the server
 * answers for the gate instead.
 *
 * Property: in every body scenario, each field other than the target satisfies its own schema, and
 * an optional gated field is present only when it is the target.
 *
 * Seen on the OCA nightly from 2026-11-04: `evaluateExpression - Constraint violation tenantId`
 * sent `scopeKey: "x"` and got the scopeKey error instead of the multi-tenancy one.
 */

const LONG_KEY = { type: 'string', pattern: '^-?[0-9]+$', minLength: 1, maxLength: 25 };
const TENANT_ID = {
  type: 'string',
  format: 'TenantId',
  minLength: 1,
  maxLength: 31,
  pattern: '^(<default>|[\\w\\.\\-]{1,31})$',
};

// Shaped like POST /expression/evaluation on main after 2026-11-04, dereferenced.
const evaluateExpression: OperationModel = {
  operationId: 'evaluateExpression',
  method: 'POST',
  path: '/expression/evaluation',
  tags: [],
  parameters: [],
  bodyRequired: true,
  requiredProps: ['expression'],
  requestBodySchema: {
    type: 'object',
    required: ['expression'],
    properties: {
      expression: { type: 'string' },
      tenantId: { allOf: [TENANT_ID], description: 'tenant' },
      scopeKey: {
        allOf: [
          {
            type: 'string',
            format: 'ScopeKey',
            oneOf: [
              { type: 'string', format: 'ProcessInstanceKey', allOf: [LONG_KEY] },
              { type: 'string', format: 'ElementInstanceKey', allOf: [LONG_KEY] },
            ],
          },
        ],
        description: 'scope',
      },
      variables: { type: 'object', additionalProperties: true, nullable: true },
    },
  },
};

const gates: ReadonlyMap<string, CapabilityGateInfo> = new Map([
  ['tenantId', { disabledDetailContains: 'multi-tenancy is disabled' }],
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

describe('evaluateExpression: body siblings are valid', () => {
  const constraint = generateConstraintViolations([evaluateExpression], {
    capabilityGates: gates,
  });

  it('still emits the tenantId constraint scenarios, expecting the gate message', () => {
    const tenant = constraint.filter((s) => s.target === 'tenantId');
    expect(tenant.length).toBeGreaterThan(0);
    for (const s of tenant) expect(s.expectDetailContains).toBe('multi-tenancy is disabled');
  });

  it('sends scopeKey as a numeric key, or not at all, next to the tenantId mutation', () => {
    for (const s of constraint) {
      if (s.target === 'scopeKey') continue;
      const body = isRecord(s.requestBody) ? s.requestBody : {};
      if ('scopeKey' in body) expect(String(body.scopeKey), s.id).toMatch(/^-?[0-9]+$/);
    }
  });

  it('leaves the gated tenantId out of every scenario that does not target it', () => {
    const all = [
      ...constraint,
      ...generateBodyTypeMismatch([evaluateExpression], { capabilityGates: gates }),
    ];
    const others = all.filter((s) => s.target !== 'tenantId');
    expect(others.length).toBeGreaterThan(0);
    for (const s of others)
      expect(s.requestBody, `${s.type} ${s.target}`).not.toHaveProperty('tenantId');
  });

  it('keeps the same targets with and without gates', () => {
    // Leaving the gated field out of the baseline must not drop the scenarios that target it.
    const targets = (xs: ValidationScenario[]) => xs.map((s) => `${s.type}:${s.target}`).sort();
    expect(
      targets(generateBodyTypeMismatch([evaluateExpression], { capabilityGates: gates })),
    ).toEqual(targets(generateBodyTypeMismatch([evaluateExpression], {})));
    const lengthKinds = (xs: ValidationScenario[]) =>
      xs
        // Blank mutations of a gated field are skipped by design (#404), so compare the length ones.
        .filter(
          (s) => s.constraintKind === 'aboveMaxLength' || s.constraintKind === 'wayAboveMaxLength',
        )
        .map((s) => `${s.target}:${s.constraintKind}`)
        .sort();
    expect(lengthKinds(constraint)).toEqual(
      lengthKinds(generateConstraintViolations([evaluateExpression], {})),
    );
    expect(lengthKinds(constraint)).toContain('tenantId:aboveMaxLength');
  });
});

// ---------------------------------------------------------------------------
// Class-scoped: every body scenario generated from the bundled spec.
// ---------------------------------------------------------------------------

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every way the value could be checked: a schema's allOf parts all apply, a oneOf/anyOf needs one. */
function why(schema: unknown, value: unknown): string | undefined {
  if (!isRecord(schema)) return undefined;
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const w = why(part, value);
      if (w) return w;
    }
  }
  for (const key of ['oneOf', 'anyOf']) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length) {
      const reasons = branches.map((b) => why(b, value));
      if (reasons.every((r) => r !== undefined)) return `no ${key} branch: ${reasons[0]}`;
    }
  }
  if (Array.isArray(schema.enum) && schema.enum.length && !schema.enum.includes(value))
    return 'not in enum';
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return 'too short';
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return 'too long';
    if (typeof schema.pattern === 'string') {
      let re: RegExp | undefined;
      for (const flags of ['u', '']) {
        try {
          re = new RegExp(schema.pattern, flags);
          break;
        } catch {
          re = undefined;
        }
      }
      if (re && !re.test(value)) return `pattern ${schema.pattern}`;
    }
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) return 'not a date-time';
    if (schema.format === 'date' && !DATE.test(value)) return 'not a date';
    if (schema.format === 'uuid' && !UUID.test(value)) return 'not a uuid';
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return 'below minimum';
    if (typeof schema.maximum === 'number' && value > schema.maximum) return 'above maximum';
  }
  return undefined;
}

/** The schema of `key` under an object schema, looking through allOf parts. */
function propertySchema(schema: unknown, key: string): unknown {
  if (!isRecord(schema)) return undefined;
  if (isRecord(schema.properties) && key in schema.properties) return schema.properties[key];
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const found = propertySchema(part, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function itemsSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return undefined;
  if (schema.items !== undefined) return schema.items;
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const found = itemsSchema(part);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Leaves of `value` that break their schema, skipping the target and anything below it. */
function invalidLeaves(schema: unknown, value: unknown, path: string[], target: string): string[] {
  const here = path.join('.');
  if (here && (here === target || here.startsWith(`${target}.`))) return [];
  if (Array.isArray(value)) {
    const items = itemsSchema(schema);
    return value.flatMap((v, i) => invalidLeaves(items, v, [...path, String(i)], target));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      invalidLeaves(propertySchema(schema, k), v, [...path, k], target),
    );
  }
  const w = why(schema, value);
  return w ? [`${here}=${JSON.stringify(value)} (${w})`] : [];
}

/** Optional gated fields at the body root, other than the target. */
function gatedSiblings(op: OperationModel, body: unknown, target: string): string[] {
  if (!isRecord(body)) return [];
  const required = new Set(op.requiredProps ?? []);
  return [...gates.keys()].filter((k) => k !== target && !required.has(k) && k in body);
}

describe('bundled spec: in every body scenario, fields other than the target are valid', async () => {
  const m = await loadSpec(join(getSpecBundleDir(process.cwd()), 'rest-api.bundle.json'));
  const ops = m.operations;
  const byKind: Record<string, ValidationScenario[]> = {
    'constraint-violation': generateConstraintViolations(ops, { capabilityGates: gates }),
    'type-mismatch': generateBodyTypeMismatch(ops, { capabilityGates: gates }),
    'enum-violation': generateEnumViolations(ops, { capabilityGates: gates }),
    'format-invalid': generateFormatInvalid(ops, { capabilityGates: gates }),
    'multiple-of': generateMultipleOfViolations(ops, { capabilityGates: gates }),
    'unique-items': generateUniqueItemsViolations(ops, { capabilityGates: gates }),
    'nested-additional-prop': generateNestedAdditionalProps(ops, { capabilityGates: gates }),
    'additional-prop': generateAdditionalPropsViolations(ops, { capabilityGates: gates }),
    'additional-prop-general': generateUniversalAdditionalProp(ops, { capabilityGates: gates }),
    'allof-missing-required': generateAllOfMissingRequired(ops, { capabilityGates: gates }),
    'allof-conflict': generateAllOfConflicts(ops, { capabilityGates: gates }),
    'pagination-limit': generatePaginationLimitInvalid(ops, { capabilityGates: gates }),
    'pagination-offset': generatePaginationOffsetPastTotal(ops, { capabilityGates: gates }),
    'pagination-cursor': generatePaginationCursorInvalid(ops, { capabilityGates: gates }),
  };
  const opById = new Map(ops.map((o) => [o.operationId, o]));

  for (const [kind, scenarios] of Object.entries(byKind)) {
    it(`${kind}: no invalid sibling and no gated sibling`, () => {
      const bad: string[] = [];
      for (const s of scenarios) {
        const op = opById.get(s.operationId);
        if (!op) continue;
        const target = s.target ?? '';
        const leaves = invalidLeaves(op.requestBodySchema, s.requestBody, [], target);
        const gated = gatedSiblings(op, s.requestBody, target);
        for (const l of [...leaves, ...gated.map((g) => `${g} (gated)`)])
          bad.push(`${s.operationId} [${target}]: ${l}`);
      }
      expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
    });
  }
});
