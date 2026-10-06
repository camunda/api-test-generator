export interface CsharpDiscriminatorSubtype {
  value: string;
  properties: string[];
  required: string[];
}

export interface CsharpDiscriminator {
  path: string;
  propertyName: string;
  subtypes: CsharpDiscriminatorSubtype[];
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

// Builds one subtype entry per `oneOf`/`anyOf` branch not already covered by
// an explicit `discriminator.mapping` entry. Used both for branches left over
// after a PARTIAL mapping, and for a discriminator with NO mapping at all
// (`mapping` is `undefined`, so every branch is "uncovered").
function collectUnmappedSubtypes(
  branches: unknown[],
  mappedRefs: ReadonlySet<string>,
  stores: ComponentStores,
): CsharpDiscriminatorSubtype[] {
  const subtypes: CsharpDiscriminatorSubtype[] = [];
  for (const subtype of branches) {
    const name = isRecord(subtype) && typeof subtype.$ref === 'string' ? subtype.$ref : undefined;
    if (name === undefined || mappedRefs.has(name)) continue;
    subtypes.push({
      value: name.split('/').at(-1) ?? name,
      properties: [...collectProperties(subtype, stores)],
      required: [...collectRequired(subtype, stores)],
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
      if (typeof subtype === 'string') mappedRefs.add(subtype);
      subtypes.push({
        value,
        properties: [...collectProperties(subtype, stores)],
        required: [...collectRequired(subtype, stores)],
      });
    }
  }

  // A mapping can legitimately cover only SOME of a `oneOf`/`anyOf`'s
  // branches: the remaining referenced branches still participate in
  // selection under their implicit schema-name value (per the OpenAPI
  // discriminator spec), so they must still be collected here rather than
  // dropped. When there is no mapping at all, every branch is "unmapped".
  subtypes.push(...collectUnmappedSubtypes(oneOf, mappedRefs, stores));
  subtypes.push(...collectUnmappedSubtypes(anyOf, mappedRefs, stores));
  return subtypes;
}

function walkSchema(
  schema: unknown,
  path: string,
  stores: ComponentStores,
  output: CsharpDiscriminator[],
  visited: Set<string>,
  activeRefs: Set<string>,
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
    // Only dedupe on an actual `$ref` + path pair — that's the only other
    // case that can recur (the SAME ref reached again at the SAME path,
    // e.g. via two sibling branches). An inline schema has no identity
    // beyond its position in the tree: the wrapper and EVERY one of its
    // `allOf`/`oneOf`/`anyOf` branches are walked with the SAME `path` (see
    // below), so keying an inline visit on `<inline>:path` collided the
    // wrapper with its first inline branch — and every inline sibling
    // branch under a `$ref`-resolved parent with every other inline sibling
    // at that same path — silently dropping their discriminators. Skipping
    // the cache entirely for inline schemas is safe: inline schemas form a
    // bounded tree with no cycles of their own.
    const visitKey = `${ref}:${path}`;
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
    });
  }

  if (ref !== undefined) activeRefs.add(ref);
  try {
    if (isRecord(resolved.properties)) {
      for (const [name, property] of Object.entries(resolved.properties)) {
        walkSchema(property, path ? `${path}.${name}` : name, stores, output, visited, activeRefs);
      }
    }
    if (isRecord(resolved.items)) {
      walkSchema(resolved.items, `${path}[]`, stores, output, visited, activeRefs);
    }
    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      const parts = resolved[key];
      if (Array.isArray(parts)) {
        for (const part of parts) walkSchema(part, path, stores, output, visited, activeRefs);
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
    requestBodies: isRecord(bundle.components.requestBodies)
      ? bundle.components.requestBodies
      : {},
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
): { name: string; value: string } | undefined {
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
  const matching = entries.filter((candidate) => candidate.path === path);
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
  return selected ? { name: selected.name, value: selected.value } : undefined;
}
