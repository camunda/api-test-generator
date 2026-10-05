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
): void {
  const resolved = resolveSchema(schema, schemas);
  if (!resolved) return;
  const ref = typeof resolved.$ref === 'string' ? resolved.$ref : undefined;
  const visitKey = `${ref ?? '<inline>'}:${path}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

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

  if (isRecord(resolved.properties)) {
    for (const [name, property] of Object.entries(resolved.properties)) {
      walkSchema(property, path ? `${path}.${name}` : name, schemas, output, visited);
    }
  }
  if (isRecord(resolved.items)) {
    walkSchema(resolved.items, `${path}[]`, schemas, output, visited);
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const parts = resolved[key];
    if (Array.isArray(parts)) {
      for (const part of parts) walkSchema(part, path, schemas, output, visited);
    }
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
      walkSchema(schema, '', schemas, discriminators, new Set());
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
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry || Object.hasOwn(value, entry.propertyName)) return undefined;
  const candidates = entry.subtypes
    .filter((subtype) =>
      subtype.required
        .filter((name) => name !== entry.propertyName)
        .every((name) => Object.hasOwn(value, name)),
    )
    .filter((subtype) => [...Object.keys(value)].every((name) => subtype.properties.includes(name)))
    .sort((left, right) => right.required.length - left.required.length);
  const selected = candidates[0];
  return selected ? { name: entry.propertyName, value: selected.value } : undefined;
}
