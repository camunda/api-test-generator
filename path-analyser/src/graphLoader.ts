import { readFile } from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import type { BootstrapSequence, DomainSemantics, OperationGraph, OperationNode } from './types.js';

// Sibling semantic-graph-extractor package produces the operation dependency graph.
const GRAPH_RELATIVE = '../semantic-graph-extractor/dist/output/operation-dependency-graph.json';
// The bundled OpenAPI spec lives at the repo root under spec/bundled/.
const OPENAPI_SPEC = '../spec/bundled/rest-api.bundle.json';

export async function loadGraph(baseDir: string): Promise<OperationGraph> {
  // Allow override via env vars (relative to baseDir or absolute)
  const overrideGraph = process.env.OPERATION_GRAPH_PATH;
  const graphPath = path.resolve(baseDir, overrideGraph || GRAPH_RELATIVE);
  const raw = await readFile(graphPath, 'utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
    // debug: graph JSON loaded from computed path
  } catch (e) {
    throw new Error(`Failed to parse graph JSON at ${graphPath}: ${(e as Error).message}`);
  }

  const operations: Record<string, OperationNode> = {};

  // Support multiple possible root shapes
  // Prefer object map if available (operationsById) to avoid loss of operations due to large array truncation
  let candidateOps: any =
    parsed.operationsById ??
    parsed.operations ??
    parsed.nodes ??
    (Array.isArray(parsed) ? parsed : null) ??
    parsed.operationNodes ??
    null;

  if (!candidateOps) {
    const g = parsed.graph || parsed.data;
    if (g) {
      candidateOps = g.operations ?? g.nodes ?? (Array.isArray(g) ? g : null);
    }
  }

  if (!candidateOps) {
    throw new Error(
      'Unrecognized graph structure. Adjust loader. Keys seen: ' + Object.keys(parsed).join(','),
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
    for (const [opId, op] of Object.entries<any>(candidateOps)) {
      operations[opId] = normalizeOp(opId, op);
    }
  }

  const bySemanticProducer: Record<string, string[]> = {};
  for (const op of Object.values(operations)) {
    for (const st of op.produces) {
      (bySemanticProducer[st] ||= []).push(op.operationId);
    }
  }

  if (Object.keys(operations).length === 0) {
    console.warn('[graphLoader] Loaded 0 operations. Check graph path / structure.');
  } else {
    // debug: normalization summary
  }

  // Bootstrap sequences (optional)
  const bootstrapSequences: BootstrapSequence[] = [];
  const rawSequences: any[] =
    parsed.bootstrapSequences || parsed.bootstrap_sequences || parsed.sequences || [];
  if (Array.isArray(rawSequences)) {
    for (const seq of rawSequences) {
      if (!seq) continue;
      const name = seq.name || seq.id;
      if (!name || !Array.isArray(seq.operations)) continue;
      bootstrapSequences.push({
        name,
        description: seq.description || seq.desc,
        operations: seq.operations.filter((o: any) => typeof o === 'string'),
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
    domain = JSON.parse(domainRaw);
    // debug: domain semantics sidecar loaded
    if (domain && domain.operationRequirements) {
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
    domainProducers = {};
    const addProducer = (state: string, opId: string) => {
      (domainProducers![state] ||= []).push(opId);
      const node = operations[opId];
      if (node) {
        if (!node.domainProduces) node.domainProduces = [state];
        else if (!node.domainProduces.includes(state)) node.domainProduces.push(state);
      }
    };
    if (domain && domain.runtimeStates) {
      for (const [stateName, spec] of Object.entries(domain.runtimeStates)) {
        spec.producedBy?.forEach((opId) => {
          if (operations[opId]) addProducer(stateName, opId);
        });
      }
    }
    if (domain && domain.capabilities) {
      for (const [capName, spec] of Object.entries(domain.capabilities)) {
        spec.producedBy?.forEach((opId) => {
          if (operations[opId]) addProducer(capName, opId);
        });
      }
    }
    if (domain && domain.identifiers) {
      for (const [, spec] of Object.entries(domain.identifiers)) {
        const state = spec.validityState;
        spec.boundBy?.forEach((opId) => {
          if (operations[opId]) addProducer(state, opId);
        });
      }
    }
    if (domain && domain.operationRequirements) {
      for (const [opId, spec] of Object.entries(domain.operationRequirements)) {
        if (!operations[opId]) continue;
        spec.produces?.forEach((st) => addProducer(st, opId));
        spec.implicitAdds?.forEach((st) => addProducer(st, opId));
      }
    }
  } catch {
    // ignore
  }

  return { operations, bySemanticProducer, bootstrapSequences, domain, domainProducers };
}

function normalizeOp(opId: string, op: any): OperationNode {
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
  const pushProduce = (v: any) => {
    if (v && typeof v === 'string') produces.push(v);
  };
  if (Array.isArray(directProduces)) directProduces.forEach(pushProduce);
  else pushProduce(directProduces);

  // First pass: derive providerMap & candidate semantics from responseSemanticTypes
  const responseDerived: string[] = [];
  const providerMap: Record<string, boolean> = {};
  if (op.responseSemanticTypes && typeof op.responseSemanticTypes === 'object') {
    for (const arr of Object.values<any>(op.responseSemanticTypes)) {
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          const st = entry?.semanticType;
          if (st) {
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
    responseDerived.forEach((st) => produces.push(st));
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

function extractRequires(op: any): { required: string[]; optional: string[] } {
  // Include requestBodySemanticTypes / parameters with semanticType as input requirements.
  const accRequired: string[] = [];
  const accOptional: string[] = [];

  const mergeArray = (arr: any[], target: string[]) => {
    for (const v of arr) {
      if (typeof v === 'string') target.push(v);
    }
  };

  if (Array.isArray(op.requiresSemanticTypes)) mergeArray(op.requiresSemanticTypes, accRequired);
  if (Array.isArray(op.requires)) mergeArray(op.requires, accRequired);

  const reqObjReq = op.requiresSemanticTypes?.required || op.requires?.required;
  if (Array.isArray(reqObjReq)) mergeArray(reqObjReq, accRequired);
  const reqObjOpt = op.requiresSemanticTypes?.optional || op.requires?.optional;
  if (Array.isArray(reqObjOpt)) mergeArray(reqObjOpt, accOptional);

  // Parameters (assume required flag indicates required vs optional)
  if (Array.isArray(op.parameters)) {
    for (const p of op.parameters) {
      const st = p?.schema?.semanticType || p?.semanticType;
      if (st) (p.required ? accRequired : accOptional).push(st);
    }
  }
  // Request body semantic types (extractor structure)
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
  let doc: any;
  try {
    doc = parseYaml(raw);
  } catch {
    return {};
  }
  const result: Record<string, { required: string[]; optional: string[] }> = {};
  if (doc.paths) {
    for (const [p, methods] of Object.entries<any>(doc.paths)) {
      for (const [m, operation] of Object.entries<any>(methods)) {
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
          for (const media of Object.values<any>(rb.content)) {
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
  schema: any,
  required: string[],
  optional: string[],
  parentRequired: string[] = [],
) {
  if (!schema || typeof schema !== 'object') return;
  const ownRequired: string[] = Array.isArray(schema.required) ? schema.required : parentRequired;
  if (schema['x-semantic-type']) {
    const st = schema['x-semantic-type'];
    // Without property name context we treat as optional unless explicitly required list contains a synthetic name
    if (ownRequired.length === 0) optional.push(st);
    else required.push(st);
  }
  if (schema.properties) {
    const propsReq: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const [prop, propSchema] of Object.entries<any>(schema.properties)) {
      if (propSchema?.['x-semantic-type']) {
        const st = propSchema['x-semantic-type'];
        (propsReq.includes(prop) ? required : optional).push(st);
      }
      collectSemanticTypesFromSchema(propSchema, required, optional, propsReq);
    }
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]))
      schema[key].forEach((s: any) =>
        collectSemanticTypesFromSchema(s, required, optional, ownRequired),
      );
  }
  if (schema.items)
    collectSemanticTypesFromSchema(
      schema.items,
      required,
      optional,
      Array.isArray(schema.items.required) ? schema.items.required : [],
    );
}
