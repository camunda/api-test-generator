import type { ScopedScenarioKind } from './config.js';
import type { ValidationScenario } from './model/types.js';

/**
 * A normalized scenarioKinds entry (see `ScopedScenarioKind` in config.ts)
 * used by `generate.ts`'s scoped-exclude filter. `targets`/`constraintKinds`
 * are plain arrays — typically 1-4 entries (see the doc comment on
 * `RequestValidationConfig.excludeOperations`), so a `Set` would only add
 * indirection with no measurable benefit. `undefined` means "don't filter on
 * this axis"; `toScopeRule` is the only place that decides bare-string vs
 * scoped-object, so nothing else needs to re-derive that distinction. Pure,
 * import-safe module (no CLI side effects) — see api-test-generator#610
 * review: `generate.ts` ends with an unconditional `main().catch(...)`, so
 * importing from it (even for pure helpers, e.g. from a test) re-runs the
 * whole generation pipeline as an import side effect. These helpers live
 * here instead so they can be imported without that risk.
 */
export interface ScopeRule {
  kind: string;
  targets?: string[];
  constraintKinds?: string[];
}

export function toScopeRule(k: string | ScopedScenarioKind): ScopeRule {
  if (typeof k === 'string') return { kind: k };
  return {
    kind: k.kind,
    targets: k.targets ? k.targets : undefined,
    constraintKinds: k.constraintKinds ? k.constraintKinds : undefined,
  };
}

export function scopeRuleMatches(rule: ScopeRule, s: ValidationScenario): boolean {
  return (
    rule.kind === s.type &&
    (rule.targets === undefined || (s.target !== undefined && rule.targets.includes(s.target))) &&
    (rule.constraintKinds === undefined ||
      (s.constraintKind !== undefined && rule.constraintKinds.includes(s.constraintKind)))
  );
}

/**
 * Whether `rule` (scoped to `operationId`) matches at least one of
 * `scenarios`. A rule shaped correctly but naming a target/constraintKind
 * value nothing ever sets — a typo, a value from a different generator's
 * vocabulary, or a kind whose scenarios never set `.target`/`.constraintKind`
 * at all — matches none and is a silent no-op; `generate.ts` calls this to
 * warn on exactly that case instead of leaving it quiet (api-test-generator#610).
 */
export function ruleMatchesAny(
  rule: ScopeRule,
  operationId: string,
  scenarios: readonly ValidationScenario[],
): boolean {
  return scenarios.some((s) => s.operationId === operationId && scopeRuleMatches(rule, s));
}

// Operates on the already-normalized ScopeRule (not the raw string |
// ScopedScenarioKind union) so the bare-vs-scoped discrimination lives in
// exactly one place, toScopeRule above — a rule with neither axis set
// (the bare-string case, or a scoped object that left both unset) describes
// as just its kind.
export function describeScopeRule(rule: ScopeRule): string {
  const scope = [
    rule.targets ? `targets=${rule.targets.join('|')}` : undefined,
    rule.constraintKinds ? `constraintKinds=${rule.constraintKinds.join('|')}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return scope ? `${rule.kind}[${scope}]` : rule.kind;
}
