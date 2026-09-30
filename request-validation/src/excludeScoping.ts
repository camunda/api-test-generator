import type { ScopedScenarioKind } from './config.js';
import type { ValidationScenario } from './model/types.js';

/**
 * A normalized scenarioKinds entry (see `ScopedScenarioKind` in config.ts)
 * used by `generate.ts`'s scoped-exclude filter. `targets`/`constraintKinds`
 * are Sets for O(1) membership checks; undefined means "don't filter on this
 * axis". Pure, import-safe module (no CLI side effects) — see
 * api-test-generator#610 review: `generate.ts` ends with an unconditional
 * `main().catch(...)`, so importing from it (even for pure helpers, e.g. from
 * a test) re-runs the whole generation pipeline as an import side effect.
 * These helpers live here instead so they can be imported without that risk.
 */
export interface ScopeRule {
  kind: string;
  targets?: Set<string>;
  constraintKinds?: Set<string>;
}

export function toScopeRule(k: string | ScopedScenarioKind): ScopeRule {
  if (typeof k === 'string') return { kind: k };
  return {
    kind: k.kind,
    targets: k.targets ? new Set(k.targets) : undefined,
    constraintKinds: k.constraintKinds ? new Set(k.constraintKinds) : undefined,
  };
}

export function scopeRuleMatches(rule: ScopeRule, s: ValidationScenario): boolean {
  return (
    rule.kind === s.type &&
    (rule.targets === undefined || (s.target !== undefined && rule.targets.has(s.target))) &&
    (rule.constraintKinds === undefined ||
      (s.constraintKind !== undefined && rule.constraintKinds.has(s.constraintKind)))
  );
}

export function describeScenarioKindEntry(k: string | ScopedScenarioKind): string {
  if (typeof k === 'string') return k;
  const scope = [
    k.targets ? `targets=${k.targets.join('|')}` : undefined,
    k.constraintKinds ? `constraintKinds=${k.constraintKinds.join('|')}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return `${k.kind}[${scope}]`;
}
