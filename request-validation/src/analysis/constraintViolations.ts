import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { synthesizeValid, validItems } from '../schema/validValue.js';
import { buildWalk, type WalkNode } from '../schema/walker.js';
import { type CapabilityGateInfo, isBlankValue } from '../util/capabilityGate.js';
import { shouldSkipForMultipart } from '../util/multipartSkip.js';
import { buildGuaranteedPatternMismatch } from '../util/patternMismatch.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
  /**
   * Field name -> capability-gate rejection detail, from
   * `configs/<config>/ontology/global-context-seeds.json`'s
   * `capabilityGate` entries (#404) — e.g. `tenantId` under single-tenant
   * mode. Only applies to an OPTIONAL occurrence of the name
   * (`node.requiredByParent` falsy); a required occurrence (e.g. the
   * owning resource's own identifier) is never affected.
   *
   * Confirmed live behaviour for a gated, optional, FLAT field:
   *  - a non-blank mutation value is always rejected, 400, with `detail`
   *    containing the gate's `disabledDetailContains` — regardless of the
   *    value's own shape (garbage length, bad pattern, …). Flip the
   *    expectation to that instead of the field's own constraint.
   *  - a blank/whitespace-only value is silently normalized to a default
   *    and the request proceeds to whatever that operation's own outcome
   *    is for a capability-omitted request — not a 400 for ANY operation,
   *    and not generalizable to a single alternate expectation either, so
   *    this mutation is skipped rather than asserting a guess.
   * A NESTED occurrence (e.g. a search filter field) is a different,
   * separately-confirmed case: never validated regardless of value, always
   * 200 with empty results.
   */
  capabilityGates?: ReadonlyMap<string, CapabilityGateInfo>;
  /** Keep only scenarios this accepts; `capPerOperation` counts kept ones only. */
  accept?: (s: ValidationScenario) => boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function generateConstraintViolations(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  const capabilityGates = opts.capabilityGates ?? new Map();
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const walk = buildWalk(op);
    const root = walk?.root;
    if (!root) continue;
    if (!buildBaselineBody(op, { gates: capabilityGates })) continue;
    let produced = 0;
    for (const node of walk.byPointer.values()) {
      const t = Array.isArray(node.type) ? node.type?.[0] : node.type;
      if (!node.constraints || !t) continue;
      const path = findPathFromRoot(root, node);
      if (!path) continue;
      const gate =
        node.key && node.requiredByParent !== true ? capabilityGates.get(node.key) : undefined;
      const isNested = path.length > 1;
      // Confirmed live ONLY for a search/list operation's `filter` object
      // (e.g. `filter.tenantId`): a malformed-but-correctly-typed value
      // inside it is never validated, always a non-matching predicate. A
      // gated field nested under some OTHER root (not yet observed in the
      // bundled spec) is NOT assumed to behave the same way — leave it
      // ungated rather than guess.
      const isFilterNested = isNested && path[0] === 'filter';
      const mutations = planConstraintMutations(node.constraints, t, node);
      // Built for this target: the target stays in even when gated or unsatisfiable.
      const baseline = buildBaselineBody(op, { gates: capabilityGates, keep: path });
      if (!baseline) continue;
      for (const mut of mutations) {
        if (opts.capPerOperation && produced >= opts.capPerOperation) break;
        // #404 — a gated, optional, FLAT field's blank/whitespace-only
        // mutation is silently normalized and the request proceeds to
        // whatever that operation's own outcome is; not a 400 for any
        // operation, and not generalizable to one alternate expectation,
        // so skip it rather than assert a guess.
        if (gate && !isNested && isBlankValue(mut.value)) continue;
        // A gated field nested under some root OTHER than `filter` has no
        // confirmed behaviour either way — skip it rather than assert the
        // filter-specific 200/empty-items outcome or the flat rejection,
        // neither of which is verified for this shape (see isFilterNested
        // comment above).
        if (gate && isNested && !isFilterNested) continue;
        const body = structuredClone(baseline);
        if (!applyAtPath(body, root, path, mut.value)) continue;
        const target = path.join('.');
        const scenario: ValidationScenario = {
          id: makeId([op.operationId, 'constraint', path.join('_'), mut.kind]),
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          type: 'constraint-violation',
          target,
          requestBody: body,
          params: buildParams(op.path),
          expectedStatus: 400,
          description: `Constraint violation ${mut.kind} on ${target}`,
          headersAuth: true,
          constraintKind: mut.kind,
          constraintOrigin: 'body',
        };
        if (gate && isFilterNested) {
          // Confirmed: a search/filter field is never validated regardless
          // of value — always 200 with empty results.
          scenario.expectedStatus = 200;
          scenario.expectEmptyItems = true;
          scenario.description = `Malformed ${target} is accepted as a non-matching search filter, not a constraint violation (#404)`;
        } else if (gate) {
          // Confirmed: any non-blank value is rejected while the
          // capability is off, independent of the value's own shape.
          if (gate.disabledStatus) scenario.expectedStatus = Number(gate.disabledStatus);
          scenario.expectDetailContains = gate.disabledDetailContains;
          scenario.description = `${target} is rejected because the capability is disabled, not for its ${mut.kind} violation (#404)`;
        }
        if (opts.accept && !opts.accept(scenario)) continue;
        out.push(scenario);
        produced++;
      }
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
    }
  }
  return out;
}

/**
 * The coverage report's applicability check for `constraint-violation`. A constraint alone is not
 * enough: the generator needs the field in the baseline body, so a limit inside an optional search
 * `page` oneOf (covered by pagination-limit-invalid) never yields a scenario. Asking the generator
 * itself keeps the two from drifting apart; capping it at one scenario stops it at the first hit.
 */
export function isConstraintViolationEligible(
  op: OperationModel,
  opts: Pick<Opts, 'capabilityGates'>,
): boolean {
  // generate.ts drops what the multipart skip rejects, so only a scenario that survives it counts.
  return (
    generateConstraintViolations([op], {
      ...opts,
      capPerOperation: 1,
      accept: (s) => !shouldSkipForMultipart(s, op),
    }).length > 0
  );
}

function planConstraintMutations(
  cons: Record<string, unknown>,
  type: string,
  node: WalkNode,
): { kind: string; value: unknown }[] {
  const out: { kind: string; value: unknown }[] = [];
  if (type === 'string') {
    if (typeof cons.minLength === 'number') {
      out.push({
        kind: 'belowMinLength',
        value: ''.padEnd(Math.max(0, cons.minLength - 1), 'a'),
      });
      if (cons.minLength > 0) out.push({ kind: 'emptyString', value: '' });
    }
    if (typeof cons.maxLength === 'number') {
      out.push({
        kind: 'aboveMaxLength',
        value: ''.padEnd(cons.maxLength + 1, 'a'),
      });
      out.push({
        kind: 'wayAboveMaxLength',
        value: ''.padEnd(cons.maxLength + 10, 'a'),
      });
    }
    if (typeof cons.pattern === 'string') {
      const invalid = buildGuaranteedPatternMismatch(cons.pattern);
      if (invalid !== undefined) out.push({ kind: 'patternMismatch', value: invalid });
    }
  } else if (type === 'integer' || type === 'number') {
    if (typeof cons.minimum === 'number') {
      out.push({ kind: 'belowMinimum', value: cons.minimum - 1 });
      out.push({ kind: 'wayBelowMinimum', value: cons.minimum - 100 });
      out.push({ kind: 'atMinimumMinusEpsilon', value: cons.minimum - 0.00001 });
    }
    if (typeof cons.exclusiveMinimum === 'number')
      out.push({ kind: 'belowExclusiveMinimum', value: cons.exclusiveMinimum });
    if (typeof cons.maximum === 'number') {
      out.push({ kind: 'aboveMaximum', value: cons.maximum + 1 });
      out.push({ kind: 'wayAboveMaximum', value: cons.maximum + 100 });
      out.push({ kind: 'atMaximumPlusEpsilon', value: cons.maximum + 0.00001 });
    }
    if (typeof cons.exclusiveMaximum === 'number')
      out.push({ kind: 'aboveExclusiveMaximum', value: cons.exclusiveMaximum });
  } else if (type === 'array') {
    if (typeof cons.minItems === 'number' && cons.minItems > 0)
      out.push({ kind: 'belowMinItems', value: [] });
    if (typeof cons.maxItems === 'number') {
      // Valid (and, under uniqueItems, distinct) items, so the item count is the only thing wrong with the array. No
      // mutation when such items cannot be built: a 400 for a bad item would hide a server that ignores maxItems.
      for (const [kind, length] of [
        ['aboveMaxItems', cons.maxItems + 1],
        ['wayAboveMaxItems', cons.maxItems + 5],
      ] as const) {
        const value = node.items ? validItems(node, length) : Array.from({ length }, () => 1);
        if (value) out.push({ kind, value });
      }
    }
  }
  return out; // no slice; allow expansion
}

function findPathFromRoot(root: WalkNode, node: WalkNode): string[] | undefined {
  let found: string[] | undefined;
  function dfs(cur: WalkNode, path: string[]) {
    if (cur === node) {
      found = path;
      return;
    }
    if (cur.properties) {
      for (const [k, v] of Object.entries(cur.properties)) {
        dfs(v, [...path, k]);
        if (found) return;
      }
    }
    if (cur.items) dfs(cur.items, [...path, '0']);
  }
  dfs(root, []);
  return found;
}

/**
 * Set `value` at `path` (a property name, or '0' for an array's first item). An optional field the baseline left out,
 * and any parent on the way to it, is added first with a value that meets its own constraints (required fields only,
 * `minItems` items), so only the target is invalid. Returns false, skipping the case, when no such value exists.
 */
function applyAtPath(obj: unknown, root: WalkNode, path: string[], value: unknown): boolean {
  let target: unknown = obj;
  let node = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const last = i === path.length - 1;
    if (Array.isArray(target)) {
      if (seg !== '0' || !node.items) return false;
      // An array that cannot hold an item would be rejected for its length, not for the target inside it.
      const maxItems = node.constraints?.maxItems;
      if (typeof maxItems === 'number' && maxItems < 1) return false;
      if (last) {
        target[0] = value;
        return true;
      }
      if (target.length === 0) {
        const item = synthesizeValid(node.items);
        if (item === undefined) return false;
        target.push(item);
      }
      node = node.items;
      target = target[0];
    } else if (isObject(target)) {
      const child = node.properties?.[seg];
      if (!child) return false;
      if (last) {
        target[seg] = value;
        return true;
      }
      if (!(seg in target)) {
        const built = synthesizeValid(child);
        if (built === undefined) return false;
        target[seg] = built;
      }
      node = child;
      target = target[seg];
    } else {
      return false;
    }
  }
  return false;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const t of m) params[t.slice(1, -1)] = '1';
  return params;
}

// Local pattern mismatch generator removed in favor of shared util.
