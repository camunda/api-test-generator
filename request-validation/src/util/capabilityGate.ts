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

/** A field's capability-gate rejection, as declared in `global-context-seeds.json`. */
export interface CapabilityGateInfo {
  disabledDetailContains: string;
  /** HTTP status the rejection returns. Defaults to 400 when omitted. */
  disabledStatus?: string;
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
): Map<string, CapabilityGateInfo> {
  const seedsPath = path.join(
    repoRoot,
    'configs',
    configName,
    'ontology',
    'global-context-seeds.json',
  );
  const out = new Map<string, CapabilityGateInfo>();
  if (!fs.existsSync(seedsPath)) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse ${seedsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Structural validation, not just a best-effort read: a typo'd or
  // wrong-shaped `capabilityGate` entry must fail loudly rather than
  // silently disabling gating — generating the exact known-bad tenant
  // scenarios this file exists to prevent, with no signal anything is
  // wrong (Copilot review). path-analyser's loader
  // (`path-analyser/src/ontology/loader.ts`) validates the full ABox
  // against the canonical ajv schema; request-validation is an independent
  // pipeline that doesn't share that machinery, so this mirrors just the
  // structural shape this one field needs, rather than importing it.
  if (!isPlainObject(parsed)) {
    throw new Error(`Malformed ${seedsPath}: expected a JSON object at the root.`);
  }
  if (!Array.isArray(parsed.seeds)) {
    throw new Error(`Malformed ${seedsPath}: expected "seeds" to be an array.`);
  }
  for (const [i, entry] of parsed.seeds.entries()) {
    if (!isPlainObject(entry)) {
      throw new Error(`Malformed ${seedsPath}: seeds[${i}] must be an object.`);
    }
    if (typeof entry.fieldName !== 'string' || entry.fieldName.length === 0) {
      throw new Error(`Malformed ${seedsPath}: seeds[${i}].fieldName must be a non-empty string.`);
    }
    if (entry.capabilityGate === undefined) continue;
    if (!isPlainObject(entry.capabilityGate)) {
      throw new Error(`Malformed ${seedsPath}: seeds[${i}].capabilityGate must be an object.`);
    }
    if (
      typeof entry.capabilityGate.disabledDetailContains !== 'string' ||
      entry.capabilityGate.disabledDetailContains.length === 0
    ) {
      throw new Error(
        `Malformed ${seedsPath}: seeds[${i}].capabilityGate.disabledDetailContains must be a non-empty string.`,
      );
    }
    const { disabledStatus } = entry.capabilityGate;
    if (
      disabledStatus !== undefined &&
      (typeof disabledStatus !== 'string' || !/^[0-9]{3}$/.test(disabledStatus))
    ) {
      throw new Error(
        `Malformed ${seedsPath}: seeds[${i}].capabilityGate.disabledStatus must be a 3-digit status string.`,
      );
    }
    out.set(entry.fieldName, {
      disabledDetailContains: entry.capabilityGate.disabledDetailContains,
      ...(disabledStatus !== undefined ? { disabledStatus } : {}),
    });
  }
  return out;
}

/** Is a string value blank or whitespace-only? */
export function isBlankValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}
