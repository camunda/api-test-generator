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
  // Common properties/required declared by SIBLING `allOf` parts of the
  // schema that CONTAINS this discriminator-bearing part (see `walkSchema`'s
  // `allOf` loop below) — a composition the wrapper-field merge just below
  // cannot see on its own, since `collectProperties`/`collectRequired` on
  // THIS schema only walk its OWN `properties`/`allOf`, never a sibling
  // part's (PR #668 review, round 9: "Previously missed" advisory).
  extraProperties: readonly string[] = [],
  extraRequired: readonly string[] = [],
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

  // A discriminated wrapper can declare its own common fields as SIBLINGS of
  // `oneOf`/`anyOf`/`discriminator` (not merged into every branch via
  // `allOf`) — e.g. `{ discriminator, oneOf: [A, B], properties: { common },
  // required: [common] }`. Every branch's actual runtime shape still carries
  // those common fields, so a subtype whose property list only reflects its
  // OWN schema rejects an otherwise-matching value that also sets them, and
  // `chooseCsharpDiscriminator` silently omits the discriminator instead of
  // selecting the matching branch (PR #668 review, round 7: "Previously
  // missed" advisory). `collectProperties`/`collectRequired` on the WRAPPER
  // schema itself only walk its own `properties`/`allOf` — never `oneOf`/
  // `anyOf` — so this adds exactly the wrapper's own directly-declared
  // fields, without re-pulling in a sibling branch's fields.
  const wrapperProperties = new Set([...collectProperties(schema, stores), ...extraProperties]);
  const wrapperRequired = new Set([...collectRequired(schema, stores), ...extraRequired]);
  if (wrapperProperties.size === 0 && wrapperRequired.size === 0) return subtypes;
  return subtypes.map((subtype) => ({
    ...subtype,
    properties: [...new Set([...subtype.properties, ...wrapperProperties])],
    required: [...new Set([...subtype.required, ...wrapperRequired])],
  }));
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
  // Common properties/required contributed by SIBLING `allOf` parts of the
  // schema THIS call is visiting (see the `allOf` loop below) — passed
  // through to `collectSubtypes` so a discriminator declared in ONE `allOf`
  // part still sees the common fields a SIBLING part declares (PR #668
  // review, round 9: "Previously missed" advisory). Reset to empty for
  // `properties`/`items` descent: those are nested fields of a DIFFERENT
  // object, not more of THIS schema's own composition.
  extraProperties: readonly string[] = [],
  extraRequired: readonly string[] = [],
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
      subtypes: collectSubtypes(resolved, stores, extraProperties, extraRequired),
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
    // The enclosing schema's own directly-declared `properties`/`required`
    // are legal to sit alongside `allOf`/`oneOf`/`anyOf`/`discriminator.mapping`
    // in JSON Schema, and belong to the SAME object as any nested
    // discriminator reached through those keywords — exactly like a sibling
    // `allOf` part's fields. Fold them into whatever this call already
    // inherited so every descent below (allOf siblings, oneOf/anyOf
    // branches, mapping targets) sees them (PR #668 review, round 10:
    // extends the "Previously missed" advisory from round 9, which only
    // covered allOf siblings, to the enclosing schema's own fields AND to
    // the oneOf/anyOf/mapping descents below, which previously dropped
    // `extraProperties`/`extraRequired` entirely instead of threading them
    // through).
    const ownProperties = isRecord(resolved.properties) ? Object.keys(resolved.properties) : [];
    const ownRequired = Array.isArray(resolved.required)
      ? resolved.required.filter((name): name is string => typeof name === 'string')
      : [];
    const inheritedProperties = [...new Set([...extraProperties, ...ownProperties])];
    const inheritedRequired = [...new Set([...extraRequired, ...ownRequired])];
    const allOfParts = resolved.allOf;
    if (Array.isArray(allOfParts)) {
      for (const part of allOfParts) {
        // A discriminator nested in ONE `allOf` part has no visibility into
        // a SIBLING part's own common `properties`/`required` — those never
        // get merged by `properties`/`allOf`-only `collectProperties`/
        // `collectRequired` on the part itself. Gather every OTHER sibling
        // part's own properties/required (plus whatever this call already
        // inherited, including the enclosing schema's own fields above) and
        // thread it through so a value combining a `common` branch with a
        // discriminator/`oneOf` branch is still recognised (PR #668 review,
        // round 9: "Previously missed" advisory).
        const siblingProperties = new Set(inheritedProperties);
        const siblingRequired = new Set(inheritedRequired);
        for (const other of allOfParts) {
          if (other === part) continue;
          for (const name of collectProperties(other, stores)) siblingProperties.add(name);
          for (const name of collectRequired(other, stores)) siblingRequired.add(name);
        }
        walkSchema(
          part,
          path,
          stores,
          output,
          visited,
          activeRefs,
          ownerRef,
          [...siblingProperties],
          [...siblingRequired],
        );
      }
    }
    for (const key of ['oneOf', 'anyOf']) {
      const parts = resolved[key];
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const branchRef = isRecord(part) && typeof part.$ref === 'string' ? part.$ref : undefined;
          const branchOwner = propertyName !== undefined ? (branchRef ?? ownerRef) : ownerRef;
          walkSchema(
            part,
            path,
            stores,
            output,
            visited,
            activeRefs,
            branchOwner,
            inheritedProperties,
            inheritedRequired,
          );
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
          inheritedProperties,
          inheritedRequired,
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

// A subtype's OWN `properties` (its directly-declared fields, plus the
// wrapper's common fields merged in by `collectSubtypes`) never include the
// fields of a FURTHER discriminator nested one level down on the SAME
// object (e.g. `Success` itself only declares `kind`, never `Text`'s own
// `text` — that field belongs to `Text`, a *separate* schema `collectProperties`
// never follows into because it only walks `properties`/`allOf`, not
// `oneOf`/`anyOf`). So a value whose fields live entirely on the INNER
// subtype (`{ text: 'hi' }`, no explicit `family`/`kind`) fails the outer
// candidate's "every key in value is a known property" subset check before
// `resolveCsharpDiscriminatorChain`'s loop ever gets a chance to add
// `Success`'s ref to the owner chain and recurse into `kind` — the loop
// never starts (PR #668 review, round 8; adversarial finding, round 5 of
// this process). Fixing this requires the subset check to recognise that
// selecting `ref` doesn't just expose `ref`'s own properties: it also
// exposes every property reachable through a CHAIN of further same-object
// discriminators owned (transitively) by `ref`, since choosing `Success`
// and then `Text` and then `Plain` is exactly the scenario
// `resolveCsharpDiscriminatorChain` is designed to walk. This computes that
// transitive closure: own properties, plus (for every entry at the SAME
// `path` owned by `ref`) every one of ITS subtypes' own properties,
// recursively. `visited` guards a cycle (a chain can't visit the same ref
// twice, matching `resolveCsharpDiscriminatorChain`'s own termination
// argument).
function collectChainedSubtypeProperties(
  ref: string,
  own: readonly string[],
  entries: readonly CsharpDiscriminator[],
  path: string,
  visited: Set<string> = new Set(),
): Set<string> {
  const properties = new Set(own);
  if (visited.has(ref)) return properties;
  visited.add(ref);
  for (const entry of entries) {
    if (entry.path !== path || entry.ownerRef !== ref) continue;
    for (const subtype of entry.subtypes) {
      for (const name of subtype.properties) properties.add(name);
      if (subtype.ref !== undefined) {
        for (const name of collectChainedSubtypeProperties(
          subtype.ref,
          subtype.properties,
          entries,
          path,
          visited,
        )) {
          properties.add(name);
        }
      }
    }
  }
  return properties;
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
  // Refs already selected SPECIFICALLY for resolving `path` — used only for
  // the "don't re-offer an already-decided subtype" dedup below. Defaults to
  // `ownerChain` so a direct caller that supplies just `ownerChain` keeps the
  // pre-existing behaviour (dedup via the same chain used for eligibility).
  // `resolveCsharpDiscriminatorChain`'s RENDERER caller passes this
  // separately and EMPTY on each fresh object, because `ownerChain` also
  // carries every ref selected on UNRELATED ANCESTOR objects (different
  // `path`s entirely) — using it for dedup here rejected a value's own
  // independent discriminator candidate merely because an ancestor render
  // happened to select the SAME `$ref` schema for an unrelated decision
  // (e.g. a sibling property whose own union also references `Shared`),
  // never considering it "already decided for THIS path" at all (PR #668
  // review, round 9).
  selectedAtPath: ReadonlySet<string> = ownerChain,
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
  // A key already sitting on `value` under some OTHER same-path entry's own
  // `propertyName` (set explicitly by the caller, or injected by an EARLIER
  // pass of `resolveCsharpDiscriminatorChain`'s loop) is self-evidently
  // accounted for — it IS a declared discriminator field at this exact
  // path, whichever branch it belongs to — so it must not count against a
  // DIFFERENT entry's subset check just because that entry's own subtype
  // schema doesn't happen to declare it (`family` sitting on `probe` has
  // nothing to do with whether `Text`'s shape "explains" it; `family` is
  // explained by the entry that owns it).
  const knownDiscriminatorNames = new Set(
    entries
      .filter((entry) => entry.path === path && Object.hasOwn(value, entry.propertyName))
      .map((entry) => entry.propertyName),
  );
  const candidates = matching.flatMap((entry) => {
    if (Object.hasOwn(value, entry.propertyName)) return [];
    return (
      entry.subtypes
        .filter((subtype) =>
          subtype.required
            .filter((name) => name !== entry.propertyName)
            .every(
              (name) =>
                Object.hasOwn(value, name) ||
                // A required field that is ITSELF a further same-object
                // discriminator's `propertyName`, owned by this subtype (e.g.
                // `Success` requires `kind`, and `kind` is a discriminator
                // chained under `SUCCESS_REF`), is not "missing" — it is
                // exactly the field `resolveCsharpDiscriminatorChain`'s own
                // loop will inject on the NEXT pass once this subtype's ref
                // joins the owner chain. Rejecting the subtype here before
                // that pass ever runs stalls the chain at its very first
                // link (PR #668 review, round 9: "Previously missed"
                // advisory).
                entries.some(
                  (downstream) =>
                    downstream.path === path &&
                    downstream.ownerRef === subtype.ref &&
                    downstream.propertyName === name,
                ),
            ),
        )
        // A subtype whose `ref` was already selected for resolving THIS path
        // (see `selectedAtPath` above) was already chosen by an EARLIER pass
        // — re-offering it as a candidate here would spuriously re-derive an
        // already-decided field instead of letting a DIFFERENT, not-yet-owned
        // entry at this path make progress.
        .filter((subtype) => subtype.ref === undefined || !selectedAtPath.has(subtype.ref))
        .filter((subtype) => {
          // A subtype's own `properties` doesn't include fields that only
          // belong to a further same-object discriminator chained beneath it
          // (see `collectChainedSubtypeProperties` above) — expand the
          // allowed set to that transitive closure before rejecting a value
          // whose fields actually live on the SELECTED branch, just further
          // down the chain.
          const allowed =
            subtype.ref !== undefined
              ? collectChainedSubtypeProperties(subtype.ref, subtype.properties, entries, path)
              : new Set(subtype.properties);
          return [...Object.keys(value)].every(
            (name) => allowed.has(name) || knownDiscriminatorNames.has(name),
          );
        })
        .map((subtype) => ({ name: entry.propertyName, value: subtype.value, subtype }))
    );
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
  // See `chooseCsharpDiscriminator`'s identically-named parameter: refs
  // already selected SPECIFICALLY for `path`, used only to skip an
  // already-recorded match below — kept separate from `ownerChain` (which
  // also carries unrelated ancestor-object selections) so this never
  // wrongly treats a different object's coincidentally-same ref as already
  // decided for THIS path (PR #668 review, round 9).
  selectedAtPath: ReadonlySet<string> = ownerChain,
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
    // A ref already in `selectedAtPath` was already added by an EARLIER pass
    // of `resolveCsharpDiscriminatorChain`'s loop (or by the caller's
    // `initialOwnerChain`) — returning it again makes the caller's
    // `!ownerChain.has(explicitRef)` check fail, which stops the loop before
    // it ever reaches a LATER same-path entry (e.g. an intermediate `kind`
    // tag chained under the outer `family` tag) whose explicit value is
    // sitting right there in `value`. Skip it and keep scanning the
    // remaining entries instead of returning on the first (possibly stale)
    // match (PR #668 review, round 8).
    if (subtype?.ref !== undefined && !selectedAtPath.has(subtype.ref)) return subtype.ref;
  }
  return undefined;
}

export interface ResolvedCsharpDiscriminators {
  // Discriminator fields to inject at this path, in resolution order (an
  // outer wrapper's own tag before a subtype's own nested tag on the SAME
  // object).
  fields: [string, string][];
  ownerChain: ReadonlySet<string>;
}

// `chooseCsharpDiscriminator`/`findExplicitCsharpDiscriminatorRef` each
// resolve only the entries eligible under the `ownerChain` they are GIVEN —
// neither call can see an entry whose `ownerRef` that very call is about to
// add to the chain. So a single call per object misses a discriminator that
// shares its OWNER's path: a `family`-tagged wrapper whose selected branch
// (e.g. `Success`) itself declares its OWN `kind` discriminator on the SAME
// object is never revisited to inject/recognise `kind` (PR #668 review,
// round 7). This loops both resolvers at the SAME `path`, re-running after
// each owner-chain growth so a newly-eligible same-path entry is picked up,
// until a pass adds no new ref. Already-decided fields are folded into a
// local `probe` copy of `value` before the next pass, so a later pass's
// `Object.hasOwn` checks never re-select the same entry for the same
// property name. Termination is guaranteed without a separate recursion
// guard: `ownerChain` only grows, each distinct ref can be added at most
// once (the `!ownerChain.has(ref)` check short-circuits a repeat), and
// `entries` is a finite table, so the loop is bounded by the number of
// distinct owner refs reachable from `path`.
export function resolveCsharpDiscriminatorChain(
  value: Record<string, unknown>,
  entries: readonly CsharpDiscriminator[],
  path: string,
  initialOwnerChain: ReadonlySet<string> = new Set(),
  // Refs to treat as already selected FOR THIS PATH's own dedup, kept
  // separate from `initialOwnerChain` (used for cross-object `ownerRef`
  // eligibility). Defaults to `initialOwnerChain` so a caller resuming
  // resolution of the SAME path mid-chain (passing refs it already decided
  // right here) keeps the pre-existing dedup behaviour unchanged. The
  // RENDERER passes this explicitly empty for every fresh object, since its
  // `initialOwnerChain` also carries unrelated ancestor-object selections
  // that must not poison THIS path's own dedup (PR #668 review, round 9).
  initialSelectedAtPath: ReadonlySet<string> = initialOwnerChain,
): ResolvedCsharpDiscriminators {
  const fields: [string, string][] = [];
  let ownerChain = initialOwnerChain;
  let selectedAtPath = initialSelectedAtPath;
  let probe: Record<string, unknown> = value;
  for (;;) {
    const discriminator = chooseCsharpDiscriminator(
      probe,
      entries,
      path,
      ownerChain,
      selectedAtPath,
    );
    if (discriminator !== undefined && !Object.hasOwn(probe, discriminator.name)) {
      fields.push([discriminator.name, discriminator.value]);
      probe = { ...probe, [discriminator.name]: discriminator.value };
      // Gate continuation on `selectedAtPath` (THIS path's own progress),
      // not `ownerChain`: an ancestor render can have already added this
      // exact ref to `ownerChain` for an unrelated reason (see
      // `selectedAtPath` above), which would otherwise make a ref that is
      // genuinely NEW progress for this path look like a repeat and
      // terminate the loop before a further same-path entry owned by this
      // ref is ever reached (PR #668 review, round 9; self-review finding).
      if (discriminator.ref !== undefined && !selectedAtPath.has(discriminator.ref)) {
        ownerChain = new Set([...ownerChain, discriminator.ref]);
        selectedAtPath = new Set([...selectedAtPath, discriminator.ref]);
        continue;
      }
      break;
    }
    const explicitRef = findExplicitCsharpDiscriminatorRef(
      probe,
      entries,
      path,
      ownerChain,
      selectedAtPath,
    );
    // Same reasoning as above: gate on `selectedAtPath`, not `ownerChain`.
    if (explicitRef !== undefined && !selectedAtPath.has(explicitRef)) {
      ownerChain = new Set([...ownerChain, explicitRef]);
      selectedAtPath = new Set([...selectedAtPath, explicitRef]);
      continue;
    }
    break;
  }
  return { fields, ownerChain };
}
