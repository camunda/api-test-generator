import fs from 'node:fs';
import path from 'node:path';

// Environment-capability accessor over the global-context-seeds ABox (#404).
//
// `configs/<config>/ontology/global-context-seeds.json` declares, per field,
// that the config's target environment may have disabled the capability
// that field represents (e.g. `tenantId` under single-tenant mode) via a
// `capabilityGate` entry. path-analyser's planner consults that same file
// directly (`path-analyser/src/ontology/explicitValueGate.ts`) through its
// ABox-merge machinery; request-validation is an independent pipeline with
// no such machinery, so this module reads the file as plain JSON instead of
// duplicating that loader.
//
// Confirmed live (#404): a FLAT optional occurrence of a gated field with a
// non-blank value is always rejected while the capability is off,
// regardless of the value's own shape — safe to assert generically. A
// blank/whitespace-only value is instead silently normalized and the
// request proceeds to whatever that operation's own outcome is, which
// isn't generalizable, so callers exclude that case themselves rather than
// asking this module for an answer it can't give.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Load the map of field name -> capability-gate rejection detail that
 * `configs/<config>/ontology/global-context-seeds.json` declares. Absent
 * file or absent `capabilityGate` entries ⇒ empty map (no-op), matching
 * `loadRequestValidationConfig`'s own convention.
 */
export function loadCapabilityGates(
  repoRoot: string,
  configName: string,
): Map<string, { disabledDetailContains: string }> {
  const seedsPath = path.join(
    repoRoot,
    'configs',
    configName,
    'ontology',
    'global-context-seeds.json',
  );
  const out = new Map<string, { disabledDetailContains: string }>();
  if (!fs.existsSync(seedsPath)) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse ${seedsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.seeds)) return out;
  for (const entry of parsed.seeds) {
    if (
      isPlainObject(entry) &&
      typeof entry.fieldName === 'string' &&
      isPlainObject(entry.capabilityGate) &&
      typeof entry.capabilityGate.disabledDetailContains === 'string'
    ) {
      out.set(entry.fieldName, {
        disabledDetailContains: entry.capabilityGate.disabledDetailContains,
      });
    }
  }
  return out;
}

/** Is a string value blank or whitespace-only? */
export function isBlankValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}
