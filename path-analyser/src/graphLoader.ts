import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BootstrapSequence, DomainSemantics, OperationGraph, OperationNode } from './types.js';

// Sibling semantic-graph-extractor package produces the operation dependency graph.
const GRAPH_RELATIVE = '../semantic-graph-extractor/dist/output/operation-dependency-graph.json';
// The bundled OpenAPI spec lives at the repo root under spec/bundled/.
const OPENAPI_SPEC = '../spec/bundled/rest-api.bundle.json';

// ---- Raw shapes for permissive JSON ingestion ----
interface RawOp {
  operationId?: string;
  id?: string;
  name?: string;
  method?: string;
  httpMethod?: string;
  verb?: string;
  path?: string;
  route?: string;
  url?: string;
  produces?: unknown;
  producesSemanticType?: string;
  producesSemanticTypes?: unknown;
  outputsSemanticTypes?: unknown;
  responseSemanticTypes?: Record<string, unknown>;
  requires?: unknown;
  requiresSemanticTypes?: unknown;
  parameters?: Array<{
    schema?: { semanticType?: string };
    semanticType?: string;
    required?: boolean;
  }>;
  requestBodySemanticTypes?: Array<{ semanticType?: string; required?: boolean }>;
  edges?: string[];
  outgoingEdges?: string[];
  dependencies?: string[];
  deps?: string[];
  eventuallyConsistent?: boolean;
  operationMetadata?: OperationNode['operationMetadata'];
  conditionalIdempotency?: OperationNode['conditionalIdempotency'];
  'x-eventually-consistent'?: boolean;
}

interface RawGraphRoot {
  operationsById?: Record<string, RawOp>;
  operations?: Record<string, RawOp> | RawOp[];
  nodes?: Record<string, RawOp> | RawOp[];
  operationNodes?: Record<string, RawOp> | RawOp[];
  graph?: RawGraphRoot;
  data?: RawGraphRoot;
  bootstrapSequences?: RawBootstrapSeq[];
  bootstrap_sequences?: RawBootstrapSeq[];
  sequences?: RawBootstrapSeq[];
}

interface RawBootstrapSeq {
  name?: string;
  id?: string;
  description?: string;
  desc?: string;
  operations?: unknown[];
  produces?: string[];
}

interface RawSchema {
  required?: string[];
  properties?: Record<string, RawSchema>;
  items?: RawSchema;
  allOf?: RawSchema[];
  oneOf?: RawSchema[];
  anyOf?: RawSchema[];
  'x-semantic-type'?: string;
}

interface RawOpenApiOp {
  operationId?: string;
  parameters?: Array<{ schema?: RawSchema & { 'x-semantic-type'?: string }; required?: boolean }>;
  requestBody?: { content?: Record<string, { schema?: RawSchema }> };
}

interface RawOpenApiDoc {
  paths?: Record<string, Record<string, RawOpenApiOp>>;
}

export async function loadGraph(baseDir: string): Promise<OperationGraph> {
  // Allow override via env vars (relative to baseDir or absolute)
  const overrideGraph = process.env.OPERATION_GRAPH_PATH;
  const graphPath = path.resolve(baseDir, overrideGraph || GRAPH_RELATIVE);
  const raw = await readFile(graphPath, 'utf8');
  let parsed: RawGraphRoot | RawOp[];
  try {
    // biome-ignore lint/plugin: JSON.parse returns `any`; the operation graph file is the runtime contract.
    parsed = JSON.parse(raw) as RawGraphRoot | RawOp[];
    // debug: graph JSON loaded from computed path
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse graph JSON at ${graphPath}: ${msg}`);
  }

  const operations: Record<string, OperationNode> = {};

  // Support multiple possible root shapes
  // Prefer object map if available (operationsById) to avoid loss of operations due to large array truncation
  let candidateOps: Record<string, RawOp> | RawOp[] | null = Array.isArray(parsed)
    ? parsed
    : (parsed.operationsById ?? parsed.operations ?? parsed.nodes ?? parsed.operationNodes ?? null);

  if (!candidateOps && !Array.isArray(parsed)) {
    const g = parsed.graph || parsed.data;
    if (g) {
      candidateOps = Array.isArray(g) ? g : (g.operations ?? g.nodes ?? null);
    }
  }

  if (!candidateOps) {
    throw new Error(
      `Unrecognized graph structure. Adjust loader. Keys seen: ${Object.keys(parsed).join(',')}`,
    );
  }

  if (Array.isArray(candidateOps)) {
    for (const op of candidateOps) {
      if (!op) continue;
      const opId = op.operationId || op.id || op.name;
      if (!opId) {
        // warn: skipping malformed node without identifiers
        console.warn('[graphLoader] Skipping node without operationId/id/name:', Object.keys(op));
        continue;
      }
      operations[opId] = normalizeOp(opId, op);
    }
  } else {
    for (const [opId, op] of Object.entries(candidateOps)) {
      operations[opId] = normalizeOp(opId, op);
    }
  }

  const bySemanticProducer: Record<string, string[]> = {};
  for (const op of Object.values(operations)) {
    for (const st of op.produces) {
      const list = bySemanticProducer[st] ?? [];
      list.push(op.operationId);
      bySemanticProducer[st] = list;
    }
  }

  if (Object.keys(operations).length === 0) {
    console.warn('[graphLoader] Loaded 0 operations. Check graph path / structure.');
  } else {
    // debug: normalization summary
  }

  // Bootstrap sequences (optional)
  const bootstrapSequences: BootstrapSequence[] = [];
  const rawSequences: RawBootstrapSeq[] = !Array.isArray(parsed)
    ? parsed.bootstrapSequences || parsed.bootstrap_sequences || parsed.sequences || []
    : [];
  if (Array.isArray(rawSequences)) {
    for (const seq of rawSequences) {
      if (!seq) continue;
      const name = seq.name || seq.id;
      if (!name || !Array.isArray(seq.operations)) continue;
      bootstrapSequences.push({
        name,
        description: seq.description || seq.desc,
        operations: seq.operations.filter((o): o is string => typeof o === 'string'),
        produces: Array.isArray(seq.produces) ? unique(seq.produces) : [],
      });
    }
    if (bootstrapSequences.length) {
      // debug: number of bootstrap sequences loaded
    }
  }

  // Domain sidecar load (optional)
  let domain: DomainSemantics | undefined;
  let domainProducers: Record<string, string[]> | undefined;
  try {
    const domainPath = path.resolve(baseDir, 'domain-semantics.json');
    const domainRaw = await readFile(domainPath, 'utf8');
    // biome-ignore lint/plugin: JSON.parse returns `any`; domain-semantics.json is the runtime contract.
    domain = JSON.parse(domainRaw) as DomainSemantics;
    // debug: domain semantics sidecar loaded
    if (domain?.operationRequirements) {
      for (const [opId, req] of Object.entries(domain.operationRequirements)) {
        const node = operations[opId];
        if (!node) continue;
        if (req.requires) node.domainRequiresAll = req.requires;
        if (req.disjunctions) node.domainDisjunctions = req.disjunctions;
        if (req.produces) node.domainProduces = req.produces;
        if (req.implicitAdds) node.domainImplicitAdds = req.implicitAdds;
      }
    }
    // Build domainProducers
    const producers: Record<string, string[]> = {};
    domainProducers = producers;
    const addProducer = (state: string, opId: string) => {
      const list = producers[state] ?? [];
      list.push(opId);
      producers[state] = list;
      const node = operations[opId];
      if (node) {
        if (!node.domainProduces) node.domainProduces = [state];
        else if (!node.domainProduces.includes(state)) node.domainProduces.push(state);
      }
    };
    if (domain?.runtimeStates) {
      for (const [stateName, spec] of Object.entries(domain.runtimeStates)) {
        for (const opId of spec.producedBy ?? []) {
          if (operations[opId]) addProducer(stateName, opId);
        }
      }
    }
    if (domain?.capabilities) {
      for (const [capName, spec] of Object.entries(domain.capabilities)) {
        for (const opId of spec.producedBy ?? []) {
          if (operations[opId]) addProducer(capName, opId);
        }
      }
    }
    if (domain?.identifiers) {
      for (const [, spec] of Object.entries(domain.identifiers)) {
        const state = spec.validityState;
        for (const opId of spec.boundBy ?? []) {
          if (operations[opId]) addProducer(state, opId);
        }
      }
    }
    if (domain?.operationRequirements) {
      for (const [opId, spec] of Object.entries(domain.operationRequirements)) {
        if (!operations[opId]) continue;
        for (const st of spec.produces ?? []) addProducer(st, opId);
        for (const st of spec.implicitAdds ?? []) addProducer(st, opId);
      }
    }
  } catch {
    // ignore
  }

  return { operations, bySemanticProducer, bootstrapSequences, domain, domainProducers };
}

function normalizeOp(opId: string, op: RawOp): OperationNode {
  // Extract produced semantic types.
  // Priority:
  // 1. Explicit fields (producesSemanticTypes / producesSemanticType / produces / outputsSemanticTypes)
  // 2. Derived from responseSemanticTypes entries (objects containing semanticType)
  const directProduces =
    op.producesSemanticTypes ??
    (op.producesSemanticType ? [op.producesSemanticType] : undefined) ??
    op.produces ??
    op.outputsSemanticTypes ??
    [];

  const produces: string[] = [];
  const pushProduce = (v: unknown) => {
    if (v && typeof v === 'string') produces.push(v);
  };
  if (Array.isArray(directProduces)) directProduces.forEach(pushProduce);
  else pushProduce(directProduces);

  // First pass: derive providerMap & candidate semantics from responseSemanticTypes
  const responseDerived: string[] = [];
  const providerMap: Record<string, boolean> = {};
  if (op.responseSemanticTypes && typeof op.responseSemanticTypes === 'object') {
    for (const arr of Object.values(op.responseSemanticTypes)) {
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          const st: unknown = entry?.semanticType;
          if (st && typeof st === 'string') {
            responseDerived.push(st);
            if (entry?.provider) providerMap[st] = true;
          }
        }
      }
    }
  }
  // If any provider flags exist, restrict produced semantics to only provider:true; else, include all response-derived
  if (Object.keys(providerMap).length) {
    responseDerived.forEach((st) => {
      if (providerMap[st]) produces.push(st);
    });
  } else {
    responseDerived.forEach((st) => {
      produces.push(st);
    });
  }

  const { required, optional } = extractRequires(op);

  // providerMap already built above; if still empty leave as undefined later

  return {
    operationId: op.operationId ?? op.id ?? op.name ?? opId,
    method: (op.method ?? op.httpMethod ?? op.verb ?? 'GET').toUpperCase(),
    path: op.path ?? op.route ?? op.url ?? '',
    produces: unique(produces),
    requires: { required, optional },
    edges: op.edges ?? op.outgoingEdges ?? op.dependencies ?? op.deps ?? [],
    providerMap: Object.keys(providerMap).length ? providerMap : undefined,
    eventuallyConsistent:
      op.eventuallyConsistent === true || op['x-eventually-consistent'] === true,
    operationMetadata: op.operationMetadata || undefined,
    conditionalIdempotency: op.conditionalIdempotency || undefined,
  };
}

function extractRequires(op: RawOp): { required: string[]; optional: string[] } {
  // Include requestBodySemanticTypes / parameters with semanticType as input requirements.
  const accRequired: string[] = [];
  const accOptional: string[] = [];

  const mergeArray = (arr: unknown[], target: string[]) => {
    for (const v of arr) {
      if (typeof v === 'string') target.push(v);
    }
  };

  if (Array.isArray(op.requiresSemanticTypes)) mergeArray(op.requiresSemanticTypes, accRequired);
  if (Array.isArray(op.requires)) mergeArray(op.requires, accRequired);

  const reqLikeSem = asReqLike(op.requiresSemanticTypes);
  const reqLike = asReqLike(op.requires);
  const reqObjReq = reqLikeSem?.required ?? reqLike?.required;
  if (Array.isArray(reqObjReq)) mergeArray(reqObjReq, accRequired);
  const reqObjOpt = reqLikeSem?.optional ?? reqLike?.optional;
  if (Array.isArray(reqObjOpt)) mergeArray(reqObjOpt, accOptional);

  // Parameters (assume required flag indicates required vs optional)
  if (Array.isArray(op.parameters)) {
    for (const p of op.parameters) {
      const st = p?.schema?.semanticType || p?.semanticType;
      if (st) (p.required ? accRequired : accOptional).push(st);
    }
  }
  // Request body semantic types (extractor structure). The upstream extractor
  // (semantic-graph-extractor/schema-analyzer.ts) tracks the ancestor-required
  // chain when classifying leaves, so an `entry.required === true` here means
  // every ancestor on the field path was also required. See iteration 1 of
  // camunda/api-test-generator#31.
  if (Array.isArray(op.requestBodySemanticTypes)) {
    for (const entry of op.requestBodySemanticTypes) {
      const st = entry?.semanticType;
      if (st) (entry.required ? accRequired : accOptional).push(st);
    }
  }

  return { required: unique(accRequired), optional: unique(accOptional) };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// Narrow `unknown` to a permissive `{ required?, optional? }` shape — `requires` and
// `requiresSemanticTypes` may legally be either a string[] (handled by the Array.isArray
// branches in extractRequires) or an object carrying nested required/optional arrays.
function asReqLike(v: unknown): { required?: unknown; optional?: unknown } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const required = Reflect.get(v, 'required');
  const optional = Reflect.get(v, 'optional');
  return { required, optional };
}

export async function loadOpenApiSemanticHints(
  baseDir: string,
): Promise<Record<string, { required: string[]; optional: string[] }>> {
  const overrideSpec = process.env.OPENAPI_SPEC_PATH;
  const specPath = path.resolve(baseDir, overrideSpec || OPENAPI_SPEC);
  let raw: string;
  try {
    raw = await readFile(specPath, 'utf8');
  } catch {
    console.warn(
      `[graphLoader] OpenAPI spec not found at ${specPath}, continuing without semantic hints.`,
    );
    return {};
  }
  let doc: RawOpenApiDoc;
  try {
    // biome-ignore lint/plugin: parseYaml returns `any`; the OpenAPI spec is the runtime contract.
    doc = parseYaml(raw) as RawOpenApiDoc;
  } catch {
    return {};
  }
  const result: Record<string, { required: string[]; optional: string[] }> = {};
  if (doc.paths) {
    for (const [_p, methods] of Object.entries(doc.paths)) {
      for (const [_m, operation] of Object.entries(methods)) {
        if (!operation || typeof operation !== 'object') continue;
        const opId = operation.operationId;
        if (!opId) continue;
        const required: string[] = [];
        const optional: string[] = [];
        if (Array.isArray(operation.parameters)) {
          for (const param of operation.parameters) {
            if (param?.schema?.['x-semantic-type']) {
              const st = param.schema['x-semantic-type'];
              if (param.required) required.push(st);
              else optional.push(st);
            }
          }
        }
        const rb = operation.requestBody;
        if (rb?.content && typeof rb.content === 'object') {
          for (const media of Object.values(rb.content)) {
            collectSemanticTypesFromSchema(media?.schema, required, optional);
          }
        }
        result[opId] = { required: unique(required), optional: unique(optional) };
      }
    }
    // debug: extracted semantic hints summary
  }
  return result;
}

function collectSemanticTypesFromSchema(
  schema: RawSchema | undefined,
  required: string[],
  optional: string[],
  ancestorAllRequired = true,
) {
  if (!schema || typeof schema !== 'object') return;
  // A leaf x-semantic-type at this node inherits the requiredness of the path
  // taken to reach it. See iteration 1 of camunda/api-test-generator#31:
  // descendants under an optional object property or under array `items` are
  // treated as optional and must not force prerequisite operations. By
  // contrast, `oneOf` / `anyOf` branch selection is currently flattened
  // separately: the parent's requiredness propagates into each branch
  // unchanged, and only the per-branch `required` list affects descendants.
  if (schema['x-semantic-type']) {
    const st = schema['x-semantic-type'];
    (ancestorAllRequired ? required : optional).push(st);
  }
  if (schema.properties) {
    const propsReq: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      const childAllRequired = ancestorAllRequired && propsReq.includes(prop);
      if (propSchema?.['x-semantic-type']) {
        const st = propSchema['x-semantic-type'];
        (childAllRequired ? required : optional).push(st);
      }
      collectSemanticTypesFromSchema(propSchema, required, optional, childAllRequired);
    }
  }
  // allOf composes the schema; every branch contributes and inherits the
  // ancestor chain unchanged.
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((s) => {
      collectSemanticTypesFromSchema(s, required, optional, ancestorAllRequired);
    });
  }
  // oneOf/anyOf describe alternative shapes. Each branch is a complete schema
  // with its own `required` list and exactly one branch is selected per
  // request, so the parent's requiredness propagates into each branch
  // unchanged — the per-branch `required` list then drives leaf classification.
  // This mirrors `extractSemanticTypesFromSchemaReference` in
  // semantic-graph-extractor/schema-analyzer.ts; the two walkers must agree on
  // requiredness or the planner can omit prerequisites for operations whose
  // request schema is a required `oneOf`.
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key])) {
      schema[key]?.forEach((s) => {
        collectSemanticTypesFromSchema(s, required, optional, ancestorAllRequired);
      });
    }
  }
  // Array items are present only when the array itself is non-empty. Treat them
  // as optional for iteration 1; later iterations may use minItems > 0 to keep
  // strictly required items.
  if (schema.items) {
    collectSemanticTypesFromSchema(schema.items, required, optional, false);
  }
}
