export interface CsharpDiscriminatorSubtype {
  value: string;
  properties: string[];
  required: string[];
  // The subtype's own resolved `$ref` (when it has one). Selecting this
  // subtype at render time pushes `ref` onto the active "owner chain" (see
  // `CsharpDiscriminator.ownerRef` below), so a nested discriminator one
  // level down whose `ownerRef` is THIS ref is recognised as belonging to
  // the branch that was actually selected.
  ref?: string;
}

export interface CsharpDiscriminator {
  path: string;
  propertyName: string;
  subtypes: CsharpDiscriminatorSubtype[];
  // The ref of the nearest enclosing subtype whose OWN properties this
  // entry was discovered inside, if any. `undefined` means the entry is
  // unconditionally applicable (e.g. the top-level entry, or one reached
  // without ever descending into a oneOf/anyOf/mapping branch's own
  // property tree). Two sibling branches (e.g. `Success` and `Failure`)
  // can each define their OWN polymorphic property at the SAME path (e.g.
  // `payload`) with different, unrelated subtype sets; without this tag,
  // `chooseCsharpDiscriminator` could apply one branch's mapping while
  // actually rendering the other (PR #668 review, round 5).
  ownerRef?: string;
}

export type CsharpDiscriminatorTable = Readonly<Record<string, CsharpDiscriminator[]>>;

interface SchemaRecord {
  [key: string]: unknown;
}

// The two component stores a `$ref` can point into for discriminator
// discovery purposes: schema definitions, and request-body definitions (a
// request body can itself be `{ "$ref": "#/components/requestBodies/X" }`,
// which the extractor already resolves — see
// `semantic-graph-extractor/schema-analyzer.ts:967-971` — but discriminator
// discovery did not).
interface ComponentStores {
  schemas: SchemaRecord;
  requestBodies: SchemaRecord;
}

function isRecord(value: unknown): value is SchemaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REF_PREFIXES = {
  '#/components/schemas/': 'schemas',
  '#/components/requestBodies/': 'requestBodies',
} as const satisfies Record<string, keyof ComponentStores>;

function lookupRef(ref: string, stores: ComponentStores): SchemaRecord | undefined {
  for (const [prefix, store] of Object.entries(REF_PREFIXES)) {
    if (ref.startsWith(prefix)) {
      const candidate = stores[store][ref.slice(prefix.length)];
      return isRecord(candidate) ? candidate : undefined;
    }
  }
  return undefined;
}

// Resolves a `$ref` to its target, FOLLOWING an alias chain: a schema (or
// request body) whose own body is itself just `{ "$ref": "..." }` (e.g.
// `JobResultAlias` pointing at `JobResult`) is resolved all the way through
// to the schema that actually carries `properties`/`allOf`/`discriminator`,
// not just one hop. `seenRefs` guards against a chain that cycles back on
// itself (`A -> B -> A`); each TOP-level `resolveSchema` call (from
// `collectProperties`/`collectRequired`/`walkSchema`) starts walking a fresh
// alias chain, so this guard is local to that one resolution, independent of
// `activeRefs`'s allOf/property-descent ancestry tracking.
function resolveRefChain(
  ref: string,
  stores: ComponentStores,
  seenRefs: Set<string>,
): SchemaRecord | undefined {
  if (seenRefs.has(ref)) return undefined;
  const candidate = lookupRef(ref, stores);
  if (!candidate) return undefined;
  const innerRef = typeof candidate.$ref === 'string' ? candidate.$ref : undefined;
  if (innerRef === undefined) return candidate;
  seenRefs.add(ref);
  try {
    return resolveRefChain(innerRef, stores, seenRefs) ?? candidate;
  } finally {
    seenRefs.delete(ref);
  }
}

function resolveSchema(
  schema: unknown,
  stores: ComponentStores,
  seenRefs: Set<string> = new Set(),
): SchemaRecord | undefined {
  if (typeof schema === 'string') {
    return resolveRefChain(schema, stores, seenRefs);
  }
  if (!isRecord(schema)) return undefined;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (ref === undefined) return schema;
  const resolved = resolveRefChain(ref, stores, seenRefs);
  if (!resolved) return undefined;
  // Preserve the ORIGINAL ref (not the alias chain's final link) as `$ref`:
  // callers use it as the identity of THIS tree position for ancestry/visit
  // tracking (`activeRefs`/`visited`), which must key on the ref actually
  // reached here, not on whichever ref the chain happened to resolve through.
  return { ...resolved, $ref: ref };
}

function collectProperties(
  schema: unknown,
  stores: ComponentStores,
  activeRefs: Set<string> = new Set(),
): Set<string> {
  const properties = new Set<string>();
  const resolved = resolveSchema(schema, stores);
  if (!resolved) return properties;
  const ref = typeof resolved.$ref === 'string' ? resolved.$ref : undefined;
  if (ref !== undefined) {
    if (activeRefs.has(ref)) return properties;
    activeRefs.add(ref);
  }
  try {
    if (isRecord(resolved.properties)) {
      for (const name of Object.keys(resolved.properties)) properties.add(name);
    }
    if (Array.isArray(resolved.allOf)) {
      for (const part of resolved.allOf) {
        for (const name of collectProperties(part, stores, activeRefs)) properties.add(name);
      }
    }
  } finally {
    if (ref !== undefined) activeRefs.delete(ref);
  }
  return properties;
}

function collectRequired(
  schema: unknown,
  stores: ComponentStores,
  activeRefs: Set<string> = new Set(),
): Set<string> {
  const required = new Set<string>();
  const resolved = resolveSchema(schema, stores);
  if (!resolved) return required;
  const ref = typeof resolved.$ref === 'string' ? resolved.$ref : undefined;
  if (ref !== undefined) {
    if (activeRefs.has(ref)) return required;
    activeRefs.add(ref);
  }
  try {
    if (Array.isArray(resolved.required)) {
      for (const name of resolved.required) {
        if (typeof name === 'string') required.add(name);
      }
    }
    if (Array.isArray(resolved.allOf)) {
      for (const part of resolved.allOf) {
        for (const name of collectRequired(part, stores, activeRefs)) required.add(name);
      }
    }
  } finally {
    if (ref !== undefined) activeRefs.delete(ref);
  }
  return required;
}

// A `discriminator.mapping` value is either a full `$ref`-style string (any
// `REF_PREFIXES` prefix) OR, per the OpenAPI discriminator object spec, a
// BARE schema name that implicitly refers to `#/components/schemas/<name>`.
// `oneOf`/`anyOf` branches always carry the full `$ref` form. Without
// normalizing both to the same canonical string, a bare-name mapping value
// fails BOTH an exact-string dedupe match against its own `oneOf`/`anyOf`
// branch AND a `REF_PREFIXES` lookup when resolving its properties — so it
// surfaces as two conflicting subtype entries for one branch: a broken one
// (empty properties, keyed on the mapping's own `value`) from the mapping
// path, and a correct one from the oneOf/anyOf path, instead of being
// recognised as the same branch.
function normalizeMappingRef(value: string): string {
  for (const prefix of Object.keys(REF_PREFIXES)) {
    if (value.startsWith(prefix)) return value;
  }
  return `#/components/schemas/${value}`;
}

// Builds one subtype entry per `oneOf`/`anyOf` branch not already covered by
// an explicit `discriminator.mapping` entry. Used both for branches left over
// after a PARTIAL mapping, and for a discriminator with NO mapping at all
// (`mapping` is `undefined`, so every branch is "uncovered"). `seenRefs` is
// MUTATED (refs this call emits are added before returning): callers thread
// the SAME set through the `oneOf` and `anyOf` calls so a `$ref` listed in
// BOTH (unusual but spec-legal) is only emitted once, not duplicated.
function collectUnmappedSubtypes(
  branches: unknown[],
  seenRefs: Set<string>,
  stores: ComponentStores,
): CsharpDiscriminatorSubtype[] {
  const subtypes: CsharpDiscriminatorSubtype[] = [];
  for (const subtype of branches) {
    const name = isRecord(subtype) && typeof subtype.$ref === 'string' ? subtype.$ref : undefined;
    if (name === undefined || seenRefs.has(name)) continue;
    seenRefs.add(name);
    subtypes.push({
      value: name.split('/').at(-1) ?? name,
      properties: [...collectProperties(subtype, stores)],
      required: [...collectRequired(subtype, stores)],
      ref: name,
    });
  }
  return subtypes;
}

function collectSubtypes(
  schema: SchemaRecord,
  stores: ComponentStores,
): CsharpDiscriminatorSubtype[] {
  const discriminator = isRecord(schema.discriminator) ? schema.discriminator : undefined;
  const mapping =
    discriminator && isRecord(discriminator.mapping) ? discriminator.mapping : undefined;
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  const subtypes: CsharpDiscriminatorSubtype[] = [];
  const mappedRefs = new Set<string>();

  if (mapping) {
    for (const [value, subtype] of Object.entries(mapping)) {
      // Normalize the mapping value's ref form (if it's a string at all —
      // the spec requires it, but a malformed spec could supply something
      // else, in which case it can't be deduped or resolved as a ref and is
      // left as-is, matching the pre-existing behaviour for that case) BEFORE
      // using it both to dedupe against oneOf/anyOf and to resolve
      // properties, so a bare schema-name value resolves and dedupes
      // identically to the full `$ref` form.
      const normalizedRef = typeof subtype === 'string' ? normalizeMappingRef(subtype) : subtype;
      if (typeof normalizedRef === 'string') mappedRefs.add(normalizedRef);
      subtypes.push({
        value,
        properties: [...collectProperties(normalizedRef, stores)],
        required: [...collectRequired(normalizedRef, stores)],
        ref: typeof normalizedRef === 'string' ? normalizedRef : undefined,
      });
    }
  }

  // A mapping can legitimately cover only SOME of a `oneOf`/`anyOf`'s
  // branches: the remaining referenced branches still participate in
  // selection under their implicit schema-name value (per the OpenAPI
  // discriminator spec), so they must still be collected here rather than
  // dropped. When there is no mapping at all, every branch is "unmapped".
  // `seenRefs` is seeded from `mappedRefs` and then shared across BOTH calls
  // so a ref already mapped — or already emitted from `oneOf` — is never
  // re-emitted from `anyOf`.
  const seenRefs = new Set(mappedRefs);
  subtypes.push(...collectUnmappedSubtypes(oneOf, seenRefs, stores));
  subtypes.push(...collectUnmappedSubtypes(anyOf, seenRefs, stores));
  return subtypes;
}

function walkSchema(
  schema: unknown,
  path: string,
  stores: ComponentStores,
  output: CsharpDiscriminator[],
  visited: Set<string>,
  activeRefs: Set<string>,
  // The ref of the nearest enclosing `oneOf`/`anyOf`/`mapping` ALTERNATIVE
  // we have committed to on the current descent (see
  // `CsharpDiscriminator.ownerRef`). Unchanged across plain structural
  // descent (`properties`, `items`, `allOf` merge) — those aren't a choice
  // between alternatives, so nothing new is "selected". Refined to a
  // branch's own `$ref` only at the exact point we recurse into THAT
  // branch from a `oneOf`/`anyOf`/`mapping` loop below.
  ownerRef: string | undefined = undefined,
): void {
  const resolved = resolveSchema(schema, stores);
  if (!resolved) return;
  const ref = typeof resolved.$ref === 'string' ? resolved.$ref : undefined;
  if (ref !== undefined) {
    // A TRUE graph cycle (e.g. `Node.child` or `Node.children[]` referencing
    // `Node` again) is only detectable by ancestry, not by `path`: `path`
    // grows on every descent (`''`, `child`, `child.child`, ...), so it
    // never repeats and a `ref:path` key alone never fires for this case —
    // the walk would recurse until the call stack overflows. `activeRefs`
    // tracks the refs currently on the descent stack (pushed below, popped
    // in `finally`) and is checked here BEFORE the `ref:path` dedupe so a
    // cycle is caught regardless of how deep `path` has grown.
    if (activeRefs.has(ref)) return;
    // Only dedupe on an actual `$ref` + path (+ owner) triple — that's the
    // only other case that can recur (the SAME ref reached again at the
    // SAME path, e.g. via two sibling branches). An inline schema has no
    // identity beyond its position in the tree: the wrapper and EVERY one
    // of its `allOf`/`oneOf`/`anyOf` branches are walked with the SAME
    // `path` (see below), so keying an inline visit on `<inline>:path`
    // collided the wrapper with its first inline branch — and every inline
    // sibling branch under a `$ref`-resolved parent with every other inline
    // sibling at that same path — silently dropping their discriminators.
    // Skipping the cache entirely for inline schemas is safe: inline
    // schemas form a bounded tree with no cycles of their own.
    //
    // `ownerRef` is part of the key — not just `ref:path` — because the
    // SAME nested `$ref` schema can be reached at the SAME path through TWO
    // DIFFERENT sibling `oneOf`/`anyOf` branches (e.g. both `BranchA` and
    // `BranchB`'s own `payload` property point at a shared `Base` schema
    // that itself declares a discriminator). Each branch needs its OWN
    // table entry tagged with ITS OWN `ownerRef`, because
    // `chooseCsharpDiscriminator`/`findExplicitCsharpDiscriminatorRef`
    // gate selection on the owner actually chosen at render time — an
    // owner-blind key here would let the first-visited branch's walk
    // dedupe away the second branch's otherwise-identical entry, silently
    // making the nested discriminator only work for whichever branch
    // happens to be visited first (an arbitrary function of `oneOf` array
    // order), a regression this round's owner-scoping fix would otherwise
    // introduce (PR #668 review, round 6: adversarial finding).
    const visitKey = `${ref}:${path}:${ownerRef ?? ''}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
  }

  const discriminator = isRecord(resolved.discriminator) ? resolved.discriminator : undefined;
  const propertyName =
    discriminator && typeof discriminator.propertyName === 'string'
      ? discriminator.propertyName
      : undefined;
  if (propertyName !== undefined) {
    output.push({
      path,
      propertyName,
      subtypes: collectSubtypes(resolved, stores),
      ownerRef,
    });
  }

  // Once we descend into THIS schema's own `properties`/`items`, that is a
  // plain structural descent — NOT a branch choice — so discriminators
  // found there inherit the SAME owner as this schema itself (whatever
  // `ownerRef` this call was given). Ownership only changes at the single
  // point where we commit to ONE of several alternatives: see the
  // `oneOf`/`anyOf`/`mapping` loop below, which computes a NEW owner (that
  // branch's own ref) for its own recursive call rather than here. Tagging
  // every ref-resolved schema's descendants with ITS OWN ref — regardless
  // of whether reaching it required choosing among alternatives — wrongly
  // gates even unconditional nested discriminators (e.g. a top-level
  // request-body schema's own nested property) behind an owner ref that
  // never gets added to any render-time owner chain, since nothing ever
  // "selects" it.

  if (ref !== undefined) activeRefs.add(ref);
  try {
    if (isRecord(resolved.properties)) {
      for (const [name, property] of Object.entries(resolved.properties)) {
        walkSchema(
          property,
          path ? `${path}.${name}` : name,
          stores,
          output,
          visited,
          activeRefs,
          ownerRef,
        );
      }
    }
    if (isRecord(resolved.items)) {
      walkSchema(resolved.items, `${path}[]`, stores, output, visited, activeRefs, ownerRef);
    }
    // `allOf` branches merge into THIS schema (not an alternative), so they
    // inherit the incoming owner unchanged. `oneOf`/`anyOf` branches ARE
    // alternatives — but picking one is only a TRACKED discriminator
    // decision when THIS schema itself declares `discriminator.propertyName`
    // (`propertyName !== undefined`, i.e. we just pushed/would-have-pushed a
    // table entry for it above). A `oneOf` with no `discriminator` keyword
    // at all (structural-only union, resolved by required-field shape, not
    // a discriminator property) has NO table entry and thus no mechanism
    // that could ever add a branch's ref to the render-time owner chain —
    // gating its descendants on such a branch would permanently orphan
    // them, since nothing ever "selects" it. So: only compute a NEW owner
    // (that branch's own ref) when this schema DOES declare a
    // discriminator; otherwise the branch inherits the incoming owner
    // unchanged, same as `allOf`. The branch's own ref is taken from the
    // SAME raw `$ref` string `collectSubtypes`/`collectUnmappedSubtypes`
    // attach to that subtype's `ref` field, so the two line up at render
    // time. An inline branch (no `$ref`) has no identity to gate on, so it
    // falls back to the incoming owner either way.
    const allOfParts = resolved.allOf;
    if (Array.isArray(allOfParts)) {
      for (const part of allOfParts) {
        walkSchema(part, path, stores, output, visited, activeRefs, ownerRef);
      }
    }
    for (const key of ['oneOf', 'anyOf']) {
      const parts = resolved[key];
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const branchRef = isRecord(part) && typeof part.$ref === 'string' ? part.$ref : undefined;
          const branchOwner = propertyName !== undefined ? (branchRef ?? ownerRef) : ownerRef;
          walkSchema(part, path, stores, output, visited, activeRefs, branchOwner);
        }
      }
    }
    // A `discriminator.mapping` target does not have to also appear as a
    // `oneOf`/`anyOf` branch — a mapping-only subtype using `allOf`
    // inheritance (the subtype's own schema carries `allOf: [{ $ref: ... a
    // base with this discriminator }]`, not the other way around) is
    // perfectly spec-legal and is exactly what `collectSubtypes` above
    // already resolves for subtype selection. But the loop above only
    // walks `allOf`/`oneOf`/`anyOf` BRANCHES OF THIS SCHEMA, so a mapping
    // target reached only through `mapping` was never walked at all —
    // any discriminator nested inside ITS properties (e.g. a
    // `Success.payload` discriminator one level down) silently never made
    // it into the table. Walk every mapping target too, at the SAME path
    // as `oneOf`/`anyOf` branches: `visited` (keyed on `ref:path`) already
    // dedupes a target also reached via `oneOf`/`anyOf`, and `activeRefs`
    // already guards the cycle case, so this reuses the same machinery.
    // The mapping target IS a committed alternative exactly like a
    // `oneOf`/`anyOf` branch, so its own normalized ref becomes the owner
    // for anything nested inside it, matching `collectSubtypes`'s mapping
    // subtype `ref`.
    const mapping =
      discriminator && isRecord(discriminator.mapping) ? discriminator.mapping : undefined;
    if (mapping) {
      for (const target of Object.values(mapping)) {
        if (typeof target !== 'string') continue;
        const normalizedRef = normalizeMappingRef(target);
        walkSchema(
          { $ref: normalizedRef },
          path,
          stores,
          output,
          visited,
          activeRefs,
          normalizedRef,
        );
      }
    }
  } finally {
    // Pop on exit (not just "never remove"): a sibling branch reached via a
    // DIFFERENT path after this ref's subtree has fully unwound must still
    // be able to walk the same ref again — only an ref that is an ACTIVE
    // ancestor on the current descent is a cycle.
    if (ref !== undefined) activeRefs.delete(ref);
  }
}

export function buildCsharpDiscriminatorTable(bundle: unknown): CsharpDiscriminatorTable {
  if (!isRecord(bundle) || !isRecord(bundle.components) || !isRecord(bundle.components.schemas)) {
    throw new Error('Bundled OpenAPI spec is missing components.schemas');
  }
  const stores: ComponentStores = {
    schemas: bundle.components.schemas,
    requestBodies: isRecord(bundle.components.requestBodies) ? bundle.components.requestBodies : {},
  };
  if (!isRecord(bundle.paths)) return {};

  const table: Record<string, CsharpDiscriminator[]> = {};
  for (const pathItem of Object.values(bundle.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!isRecord(operation) || typeof operation.operationId !== 'string') continue;
      const requestBody = resolveSchema(operation.requestBody, stores);
      if (!requestBody || !isRecord(requestBody.content)) continue;
      const json = resolveSchema(requestBody.content['application/json'], stores);
      const schema = json?.schema;
      if (schema === undefined) continue;
      const discriminators: CsharpDiscriminator[] = [];
      walkSchema(schema, '', stores, discriminators, new Set(), new Set());
      if (discriminators.length > 0) table[operation.operationId] = discriminators;
    }
  }
  return table;
}

export function chooseCsharpDiscriminator(
  value: Record<string, unknown>,
  entries: readonly CsharpDiscriminator[],
  path: string,
  // Refs of subtypes already selected at ANCESTOR levels during this
  // render (see `renderCsharpValue`). An entry whose `ownerRef` is set
  // requires that ref to be in this chain — otherwise it belongs to a
  // sibling branch that was NOT the one actually selected, and must not be
  // used to tag-select a value rendered under a different branch (PR #668
  // review, round 5: a nested polymorphic property redeclared differently,
  // or not at all, by a sibling union member).
  ownerChain: ReadonlySet<string> = new Set(),
): { name: string; value: string; ref?: string } | undefined {
  // `buildCsharpDiscriminatorTable` can legitimately produce MULTIPLE entries
  // sharing the same `path` — distinct inline `oneOf`/`anyOf` sibling
  // branches each carry their own discriminator (see
  // "finds discriminators in every inline sibling branch of a oneOf under a
  // $ref parent" in discriminators.test.ts). Picking only the FIRST
  // path-matching entry (`entries.find(...)`) silently locked every value at
  // that path onto one entry's subtype set, even when the value actually
  // matched a sibling entry instead — the same class of bug the table-build
  // fix solved at discovery time, reappearing here at selection time. Score
  // every subtype across EVERY matching entry and pick the best overall
  // match instead of the first entry's best match.
  const matching = entries.filter(
    (candidate) =>
      candidate.path === path &&
      (candidate.ownerRef === undefined || ownerChain.has(candidate.ownerRef)),
  );
  const candidates = matching.flatMap((entry) => {
    if (Object.hasOwn(value, entry.propertyName)) return [];
    return entry.subtypes
      .filter((subtype) =>
        subtype.required
          .filter((name) => name !== entry.propertyName)
          .every((name) => Object.hasOwn(value, name)),
      )
      .filter((subtype) =>
        [...Object.keys(value)].every((name) => subtype.properties.includes(name)),
      )
      .map((subtype) => ({ name: entry.propertyName, value: subtype.value, subtype }));
  });
  candidates.sort((left, right) => right.subtype.required.length - left.subtype.required.length);
  const selected = candidates[0];
  return selected
    ? { name: selected.name, value: selected.value, ref: selected.subtype.ref }
    : undefined;
}

// `chooseCsharpDiscriminator` deliberately excludes an entry whose
// `propertyName` the value ALREADY carries explicitly (it has nothing to
// inject there). But a value that sets its discriminator field directly
// (rather than relying on shape inference) still SELECTS a branch, and a
// NESTED discriminator scoped to that branch (via `ownerRef`) must still be
// recognised when rendering the value's own properties — otherwise an
// explicit top-level selection would silently block every nested
// discriminator beneath it (PR #668 review, round 5). This returns the
// selected subtype's `ref` for that case, without affecting injection.
export function findExplicitCsharpDiscriminatorRef(
  value: Record<string, unknown>,
  entries: readonly CsharpDiscriminator[],
  path: string,
  ownerChain: ReadonlySet<string> = new Set(),
): string | undefined {
  const matching = entries.filter(
    (candidate) =>
      candidate.path === path &&
      (candidate.ownerRef === undefined || ownerChain.has(candidate.ownerRef)),
  );
  for (const entry of matching) {
    const explicitValue = value[entry.propertyName];
    if (typeof explicitValue !== 'string') continue;
    const subtype = entry.subtypes.find((candidate) => candidate.value === explicitValue);
    if (subtype?.ref !== undefined) return subtype.ref;
  }
  return undefined;
}
