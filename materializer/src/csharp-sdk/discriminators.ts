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

function isRecord(value: unknown): value is SchemaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaRefName(ref: string): string | undefined {
  const prefix = '#/components/schemas/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

function resolveSchema(schema: unknown, schemas: SchemaRecord): SchemaRecord | undefined {
  if (typeof schema === 'string') {
    const ref = schemaRefName(schema);
    const resolved = ref === undefined ? undefined : schemas[ref];
    return isRecord(resolved) ? resolved : undefined;
  }
  if (!isRecord(schema)) return undefined;
  const ref = typeof schema.$ref === 'string' ? schemaRefName(schema.$ref) : undefined;
  if (ref === undefined) return schema;
  const resolved = schemas[ref];
  if (!isRecord(resolved)) return undefined;
  return { ...resolved, $ref: schema.$ref };
}

function collectProperties(schema: unknown, schemas: SchemaRecord): Set<string> {
  const properties = new Set<string>();
  const resolved = resolveSchema(schema, schemas);
  if (!resolved) return properties;
  if (isRecord(resolved.properties)) {
    for (const name of Object.keys(resolved.properties)) properties.add(name);
  }
  if (Array.isArray(resolved.allOf)) {
    for (const part of resolved.allOf) {
      for (const name of collectProperties(part, schemas)) properties.add(name);
    }
  }
  return properties;
}

function collectRequired(schema: unknown, schemas: SchemaRecord): Set<string> {
  const required = new Set<string>();
  const resolved = resolveSchema(schema, schemas);
  if (!resolved) return required;
  if (Array.isArray(resolved.required)) {
    for (const name of resolved.required) {
      if (typeof name === 'string') required.add(name);
    }
  }
  if (Array.isArray(resolved.allOf)) {
    for (const part of resolved.allOf) {
      for (const name of collectRequired(part, schemas)) required.add(name);
    }
  }
  return required;
}

function collectSubtypes(
  schema: SchemaRecord,
  schemas: SchemaRecord,
): CsharpDiscriminatorSubtype[] {
  const discriminator = isRecord(schema.discriminator) ? schema.discriminator : undefined;
  const mapping =
    discriminator && isRecord(discriminator.mapping) ? discriminator.mapping : undefined;
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const subtypes: CsharpDiscriminatorSubtype[] = [];

  if (mapping) {
    for (const [value, subtype] of Object.entries(mapping)) {
      subtypes.push({
        value,
        properties: [...collectProperties(subtype, schemas)],
        required: [...collectRequired(subtype, schemas)],
      });
    }
    return subtypes;
  }

  for (const subtype of oneOf) {
    const properties = [...collectProperties(subtype, schemas)];
    const name = isRecord(subtype) && typeof subtype.$ref === 'string' ? subtype.$ref : undefined;
    if (name !== undefined) {
      subtypes.push({
        value: name.split('/').at(-1) ?? name,
        properties,
        required: [...collectRequired(subtype, schemas)],
      });
    }
  }
  return subtypes;
}

function walkSchema(
  schema: unknown,
  path: string,
  schemas: SchemaRecord,
  output: CsharpDiscriminator[],
  visited: Set<string>,
  activeRefs: Set<string>,
): void {
  const resolved = resolveSchema(schema, schemas);
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
      subtypes: collectSubtypes(resolved, schemas),
    });
  }

  if (ref !== undefined) activeRefs.add(ref);
  try {
    if (isRecord(resolved.properties)) {
      for (const [name, property] of Object.entries(resolved.properties)) {
        walkSchema(property, path ? `${path}.${name}` : name, schemas, output, visited, activeRefs);
      }
    }
    if (isRecord(resolved.items)) {
      walkSchema(resolved.items, `${path}[]`, schemas, output, visited, activeRefs);
    }
    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      const parts = resolved[key];
      if (Array.isArray(parts)) {
        for (const part of parts) walkSchema(part, path, schemas, output, visited, activeRefs);
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
  const schemas = bundle.components.schemas;
  if (!isRecord(bundle.paths)) return {};

  const table: Record<string, CsharpDiscriminator[]> = {};
  for (const pathItem of Object.values(bundle.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!isRecord(operation) || typeof operation.operationId !== 'string') continue;
      const requestBody = resolveSchema(operation.requestBody, schemas);
      if (!requestBody || !isRecord(requestBody.content)) continue;
      const json = resolveSchema(requestBody.content['application/json'], schemas);
      const schema = json?.schema;
      if (schema === undefined) continue;
      const discriminators: CsharpDiscriminator[] = [];
      walkSchema(schema, '', schemas, discriminators, new Set(), new Set());
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
