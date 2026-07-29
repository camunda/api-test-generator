#!/usr/bin/env tsx
/**
 * spec-field-diff — compare two spec-fields.ts JSON snapshots (old vs new) and
 * report, per operation present in BOTH (an added/removed operationId is
 * already handled by spec-operations.ts's diff, and is out of scope here):
 *   - added properties (request or response)
 *   - removed properties (request or response)
 *   - newly-required properties, REQUEST side only
 *
 * A newly-required request property is the one case that can silently need
 * generator work (a fixture/semantic-type mapping an existing minimal request
 * body doesn't provide) without the generate/invariants/unmapped-operations
 * checks necessarily catching it — everything else here is purely
 * informational (an added/removed property doesn't by itself mean the
 * generator is wrong, see #492's clusters.profiles precedent: additive,
 * nullable, optional, needed no generator change).
 *
 * Usage: spec-field-diff.ts <old.json> <new.json>
 * Prints a JSON report to stdout: { added: [...], removed: [...], newlyRequired: [...] }
 * and exits 1 if newlyRequired is non-empty (so the workflow can gate on it
 * with a plain `if` on the exit code, same convention as the rest of this
 * pipeline's shell scripts).
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

interface FieldInfo {
  type: string;
  required: boolean;
}
interface SideFields {
  properties: Record<string, FieldInfo>;
}
interface OperationFields {
  request: SideFields | null;
  response: SideFields | null;
}
type Snapshot = Record<string, OperationFields>;

interface Change {
  operationId: string;
  side: 'request' | 'response';
  property: string;
  type?: string;
}

// Exit 2 on any read/parse failure — NOT the bare 1 an uncaught exception
// would otherwise produce (confirmed: Node exits 1 on an uncaught JSON.parse
// SyntaxError), which would be indistinguishable from main()'s intentional
// exit-1 "newlyRequired found" signal. The workflow depends on that
// distinction (0 = clean, 1 = newly-required, anything else = real failure)
// to avoid silently routing a script crash down the same path as a genuine
// newly-required-field finding.
function loadSnapshot(path: string): Snapshot {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[spec-field-diff] cannot read ${path}: ${String(err)}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[spec-field-diff] ${path} is not valid JSON: ${String(err)}`);
    process.exit(2);
  }
}

function diffSide(
  operationId: string,
  side: 'request' | 'response',
  oldSide: SideFields | null,
  newSide: SideFields | null,
  added: Change[],
  removed: Change[],
  newlyRequired: Change[],
): void {
  const oldProps = oldSide?.properties ?? {};
  const newProps = newSide?.properties ?? {};
  for (const [name, info] of Object.entries(newProps)) {
    const isNew = !(name in oldProps);
    if (isNew) {
      added.push({ operationId, side, property: name, type: info.type });
    }
    // A brand-new required property is at least as significant as an
    // existing one flipping to required — there is no existing fixture for
    // it either way, so both land in newlyRequired (in addition to `added`
    // for a brand-new one, for visibility).
    const becameRequired =
      side === 'request' && info.required && (isNew || !oldProps[name].required);
    if (becameRequired) {
      newlyRequired.push({ operationId, side, property: name, type: info.type });
    }
  }
  for (const name of Object.keys(oldProps)) {
    if (!(name in newProps)) {
      removed.push({ operationId, side, property: name });
    }
  }
}

function main(): void {
  const [oldPath, newPath] = process.argv.slice(2);
  if (!oldPath || !newPath) {
    console.error('Usage: spec-field-diff.ts <old.json> <new.json>');
    process.exit(2);
  }
  const oldSnap = loadSnapshot(oldPath);
  const newSnap = loadSnapshot(newPath);

  const added: Change[] = [];
  const removed: Change[] = [];
  const newlyRequired: Change[] = [];

  // Only operations present in BOTH snapshots — an added/removed operationId
  // is spec-operations.ts's job, not this script's.
  for (const operationId of Object.keys(newSnap)) {
    if (!(operationId in oldSnap)) continue;
    const oldOp = oldSnap[operationId];
    const newOp = newSnap[operationId];
    diffSide(operationId, 'request', oldOp.request, newOp.request, added, removed, newlyRequired);
    diffSide(
      operationId,
      'response',
      oldOp.response,
      newOp.response,
      added,
      removed,
      newlyRequired,
    );
  }

  console.log(JSON.stringify({ added, removed, newlyRequired }, null, 2));
  if (newlyRequired.length > 0) process.exit(1);
}

main();
