import fsSync from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalShapes } from './canonicalSchemas.js';
import { writeExtractionOutputs } from './extractSchemas.js';
import { generateFeatureCoverageForEndpoint } from './featureCoverageGenerator.js';
import { loadGraph, loadOpenApiSemanticHints } from './graphLoader.js';
import {
  generateOptionalSubShapeVariants,
  generateScenariosForEndpoint,
} from './scenarioGenerator.js';
import type {
  EndpointScenario,
  GenerationSummary,
  GenerationSummaryEntry,
  OperationGraph,
  OperationRef,
  RequestOneOfGroupSummary,
  RequestOneOfVariant,
  RequestStep,
  ResponseShapeSummary,
} from './types.js';
import { normalizeEndpointFileName } from './utils.js';

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function main() {
  // Robust base directory detection: if the current working directory already IS the
  // path-analyser package, use it directly; otherwise append the relative path.
  const cwd = process.cwd();
  const suffix = 'path-analyser';
  const baseDir = cwd.endsWith(suffix) ? cwd : path.resolve(cwd, suffix);
  const outputDir = path.resolve(baseDir, 'dist/output');
  const featureDir = path.resolve(baseDir, 'dist/feature-output');
  const variantDir = path.resolve(baseDir, 'dist/variant-output');
  // Wipe before write so files left over from a previous spec version (e.g.
  // an operationId that no longer exists upstream) cannot survive into the
  // current run and silently break Layer-3 invariants. Without this, local
  // pre-push validation can diverge from CI — CI checks out a fresh tree
  // and never sees the stale files.
  await rm(outputDir, { recursive: true, force: true });
  await rm(featureDir, { recursive: true, force: true });
  await rm(variantDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(featureDir, { recursive: true });
  await mkdir(variantDir, { recursive: true });

  const graph = await loadGraph(baseDir);
  // Build canonical deep schema shapes (requests + responses)
  const canonical = await buildCanonicalShapes(path.resolve(baseDir, '../'));
  // Validate domain valueBindings against canonical response paths (fail-hard soon; warn now)
  const validationErrors: string[] = [];
  const opReqs = graph.domain?.operationRequirements || {};
  for (const [opId, req] of Object.entries(opReqs)) {
    if (!req.valueBindings) continue;
    const shape = canonical[opId];
    const respSet = new Set((shape?.response || []).map((n) => n.path));
    for (const key of Object.keys(req.valueBindings)) {
      if (!key.startsWith('response.')) continue;
      const raw = key.slice('response.'.length).replace(/\[\]/g, '[]');
      if (!respSet.has(raw)) {
        validationErrors.push(`${opId}: '${raw}' not in canonical response shape`);
      }
    }
  }
  if (validationErrors.length) {
    const msg =
      'Canonical path validation failed with ' +
      validationErrors.length +
      ' issue(s)\n' +
      validationErrors.map((e) => `  - ${e}`).join('\n');
    throw new Error(msg);
  }
  // Extract response shapes & request variants (oneOf groups)
  const semanticTypes = Object.keys(graph.producersByType || {});
  const { requestIndex, responses, successStatusByOp } = await writeExtractionOutputs(
    baseDir,
    semanticTypes,
  );
  const responseByOp: Record<string, ResponseShapeSummary> = {};
  for (const r of responses) responseByOp[r.operationId] = r;

  // Enrich requirements from OpenAPI hints
  const hints = await loadOpenApiSemanticHints(baseDir);
  for (const [opId, op] of Object.entries(graph.operations)) {
    const hint = hints[opId];
    if (hint) {
      const reqReq = new Set(op.requires.required);
      hint.required.forEach((s) => {
        reqReq.add(s);
      });
      op.requires.required = [...reqReq];
      const optReq = new Set(op.requires.optional);
      hint.optional.forEach((s) => {
        optReq.add(s);
      });
      op.requires.optional = [...optReq];
    }
  }

  const summaryEntries: GenerationSummaryEntry[] = [];
  let processed = 0;
  // Aggregate deployment artifacts referenced by scenarios for manifest output
  const artifactsManifest = new Map<string, { kind: string; path: string; description?: string }>();

  for (const op of Object.values(graph.operations)) {
    // Generate scenarios for every endpoint, even if it has no semantic requirements.
    const collection = generateScenariosForEndpoint(graph, op.operationId, {
      maxScenarios: 20,
    });
    // Augment scenarios with response shape
    const resp = responseByOp[op.operationId];
    if (resp) {
      for (const s of collection.scenarios) {
        s.responseShapeSemantics = resp.producedSemantics || undefined;
        s.responseShapeFields = resp.fields.map((f) => ({
          name: f.name,
          type: f.type,
          semantic: f.semantic,
          required: f.required,
          nullable: f.nullable,
        }));
        if (resp.nestedSlices) s.responseNestedSlices = resp.nestedSlices;
        if (resp.nestedItems) s.responseArrayItemFields = resp.nestedItems;
        s.requestPlan = buildRequestPlan(
          s,
          resp,
          graph,
          canonical,
          requestIndex.byOperation,
          successStatusByOp,
        );
      }
    }
    const fileName = normalizeEndpointFileName(op.method, op.path);
    await writeFile(path.join(outputDir, fileName), JSON.stringify(collection, null, 2), 'utf8');
    // Feature coverage scenarios (enhanced with integration chain + rudimentary body synthesis)
    const featureCollection = generateFeatureCoverageForEndpoint(graph, op.operationId, {
      requestVariants: requestIndex.byOperation[op.operationId],
    });
    // Final guardrail: enforce max scenarios per endpoint (cap 90)
    const MAX_FEATURE_SCENARIOS = 90;
    if (featureCollection.scenarios.length > MAX_FEATURE_SCENARIOS) {
      featureCollection.scenarios = featureCollection.scenarios.slice(0, MAX_FEATURE_SCENARIOS);
    }
    // Choose a representative integration scenario to supply the
    // dependency chain. Shortest non-`unsatisfied` chain with >1 ops,
    // *gated on producer authority for the endpoint's required types*.
    //
    // The planner's `producersByType` index is intentionally permissive
    // (it includes echo-only response fields so domain-progression and
    // witness lenses stay connected — see graphLoader.ts #95). That
    // means a chain like `createDocument -> cancelProcessInstance` can
    // satisfy the BFS for ProcessInstanceKey even though createDocument
    // merely echoes `metadata.processInstanceKey` (provider:false) from
    // the request. If the selector picked that chain, the extracted
    // value would be empty at runtime and the URL placeholder would
    // leak.
    //
    // Resolution: among multi-op chains, prefer those whose prerequisite
    // operations include at least one *authoritative* (provider:true)
    // producer for every required semantic type. Fall back to the
    // length-only sort when no such chain exists, so endpoints whose
    // required types have no authoritative producer anywhere in the
    // graph (an upstream-spec gap) are not regressed.
    const integrationCandidates = collection.scenarios.filter((sc) => sc.id !== 'unsatisfied');
    const requiredTypes = collection.requiredSemanticTypes ?? [];
    // Restrict the authoritative-producer check to required types that
    // actually have an authoritative producer somewhere in the graph.
    // If an endpoint requires types `[A, B]` and only `A` has an
    // authoritative producer anywhere, requiring chains to authoritatively
    // produce both would reject every candidate and force the fallback to
    // length-only selection — at which point the chain might also miss
    // the authoritative producer for `A`. Filtering first means we still
    // gate on `A` while exempting `B` (an upstream-spec gap), matching
    // the L3 invariant's exemption rule.
    const requiredTypesWithAuthoritativeProducer = requiredTypes.filter((t) =>
      (graph.producersByType[t] ?? []).some(
        (opId) => graph.operations[opId]?.providerMap?.[t] === true,
      ),
    );
    const isAuthoritativeChain = (sc: EndpointScenario): boolean => {
      if (!requiredTypesWithAuthoritativeProducer.length) return true;
      // Endpoint-self does not count: an op cannot bind its own URL
      // placeholder from its own response.
      const prereqOpIds = sc.operations.slice(0, -1).map((o) => o.operationId);
      if (!prereqOpIds.length) return false;
      return requiredTypesWithAuthoritativeProducer.every((t) =>
        prereqOpIds.some((opId) => graph.operations[opId]?.providerMap?.[t] === true),
      );
    };
    const multiOpCandidates = integrationCandidates.filter((sc) => sc.operations.length > 1);
    const byLength = (a: EndpointScenario, b: EndpointScenario) =>
      a.operations.length - b.operations.length;
    const authoritativeMultiOp = multiOpCandidates.filter(isAuthoritativeChain);
    const chainSource =
      [...authoritativeMultiOp].sort(byLength)[0] ||
      [...multiOpCandidates].sort(byLength)[0] ||
      integrationCandidates[0];
    // The chain-graft + requestPlan synthesis must run for every endpoint,
    // not just those with a response shape. Operations with a
    // 204 No-Content response (cancelProcessInstance, completeJob,
    // resolveIncident, deleteRole, deleteUser, …) used to fall into the
    // `if (resp)` branch's else and be left as a single-step scenario, which
    // the emitter then rendered with literal `${var}` placeholders in URLs.
    // The response-shape assignments below are still gated on `resp` because
    // they have no meaning when the response body is empty.
    for (const s of featureCollection.scenarios) {
      // Graft chain if available and feature scenario currently only has endpoint op
      // Special-case: for search-like empty-negative, skip grafting to produce an empty result without prerequisites
      const isSearchLikeOp =
        (op.method.toUpperCase() === 'POST' && /\/search$/.test(op.path)) ||
        /search/i.test(op.operationId) ||
        op.operationId === 'activateJobs';
      const isEmptyNeg = s.expectedResult && s.expectedResult.kind === 'empty';
      const skipGraft = isSearchLikeOp && isEmptyNeg;
      if (
        !skipGraft &&
        chainSource &&
        s.operations.length === 1 &&
        chainSource.operations.length > 1
      ) {
        s.operations = chainSource.operations.map((o) => ({ ...o }));
      }
      if (resp) {
        s.responseShapeSemantics = resp.producedSemantics || undefined;
        s.responseShapeFields = resp.fields.map((f) => ({
          name: f.name,
          type: f.type,
          semantic: f.semantic,
          required: f.required,
          nullable: f.nullable,
        }));
        if (resp.nestedSlices) s.responseNestedSlices = resp.nestedSlices;
        if (resp.nestedItems) s.responseArrayItemFields = resp.nestedItems;
      }
      s.requestPlan = buildRequestPlan(
        s,
        resp,
        graph,
        canonical,
        requestIndex.byOperation,
        successStatusByOp,
      );
      // Validation: for JSON requests with oneOf groups, non-negative scenarios must set exactly one variant's required keys
      try {
        const final = s.requestPlan?.[s.requestPlan.length - 1];
        const groups = requestIndex.byOperation[op.operationId] || [];
        const isError = s.expectedResult && s.expectedResult.kind === 'error';
        if (final?.bodyKind === 'json' && final?.bodyTemplate && groups.length && !isError) {
          const presentKeys = new Set(Object.keys(final.bodyTemplate));
          for (const g of groups) {
            // Count variants whose required keys are fully present in the body
            const hits = g.variants.filter((v) => v.required.every((k) => presentKeys.has(k)));
            // Deduplicate by required set (some variants only differ by discriminator value but share the same required keys)
            const uniqByReq = new Map<string, (typeof hits)[number]>();
            for (const v of hits) {
              const key = [...v.required].sort().join('|');
              if (!uniqByReq.has(key)) uniqByReq.set(key, v);
            }
            const uniqCount = uniqByReq.size;
            if (uniqCount !== 1) {
              throw new Error(
                `oneOf validation failed for ${op.operationId} group '${g.groupId}': expected exactly 1 variant's required keys present, found ${uniqCount}`,
              );
            }
          }
        }
      } catch {}
    }
    // Collect artifact references from feature scenarios (multipart files)
    try {
      const domainRules = graph.domain?.operationArtifactRules || {};
      for (const sc of featureCollection.scenarios) {
        const steps = sc.requestPlan || [];
        for (const st of steps) {
          const mt = isPlainRecord(st?.multipartTemplate) ? st.multipartTemplate : undefined;
          const mtFiles = mt && isPlainRecord(mt.files) ? mt.files : undefined;
          if (st?.bodyKind === 'multipart' && mtFiles) {
            for (const [_k, v] of Object.entries<unknown>(mtFiles)) {
              const s = typeof v === 'string' ? v : '';
              if (!s.startsWith('@@FILE:')) continue;
              const rel = s.slice('@@FILE:'.length);
              // Determine artifact kind: prefer scenario artifact rule mapping
              let kind: string | undefined;
              const rulesForOp = domainRules?.[st.operationId]?.rules || [];
              if (Array.isArray(sc.artifactsApplied) && sc.artifactsApplied.length) {
                const rid = sc.artifactsApplied[0];
                const r = rulesForOp.find((r) => r.id === rid);
                kind = r?.artifactKind;
              }
              // Fallback by extension mapping
              if (!kind) {
                const ext = path.extname(rel).toLowerCase();
                const kinds = graph.domain?.artifactFileKinds?.[ext] || [];
                kind = kinds[0];
              }
              const desc = getArtifactsRegistry().find(
                (e) => e.kind === kind && e.path === rel,
              )?.description;
              const key = `${kind || 'unknown'}::${rel}`;
              if (!artifactsManifest.has(key))
                artifactsManifest.set(key, {
                  kind: kind || 'unknown',
                  path: rel,
                  description: desc,
                });
            }
          }
        }
      }
    } catch {}
    await writeFile(
      path.join(featureDir, fileName),
      JSON.stringify(featureCollection, null, 2),
      'utf8',
    );

    // Issue #37: optional sub-shape variant scenarios. Only emit a file
    // when this endpoint has at least one optional sub-shape, so the
    // variant-output directory remains a clear signal of which endpoints
    // have populated-shape coverage.
    if (op.optionalSubShapes?.length) {
      const variantCollection = generateOptionalSubShapeVariants(graph, op.operationId, {
        maxScenarios: 20,
      });
      // Augment with response shape (when available) so downstream codegen
      // has the same metadata as base/feature scenarios. The requestPlan
      // call is intentionally unconditional — variant scenarios for
      // 204/no-response endpoints (e.g. modifyProcessInstance) still need
      // a plan so the emitter renders runnable test bodies. Without this,
      // those tests would render an empty body that fails biome's
      // unused-`request`-param lint after `dist/generated-tests` is
      // formatted (#105).
      for (const s of variantCollection.scenarios) {
        if (resp) {
          s.responseShapeSemantics = resp.producedSemantics || undefined;
          s.responseShapeFields = resp.fields.map((f) => ({
            name: f.name,
            type: f.type,
            semantic: f.semantic,
            required: f.required,
            nullable: f.nullable,
          }));
          if (resp.nestedSlices) s.responseNestedSlices = resp.nestedSlices;
          if (resp.nestedItems) s.responseArrayItemFields = resp.nestedItems;
        }
        s.requestPlan = buildRequestPlan(
          s,
          resp,
          graph,
          canonical,
          requestIndex.byOperation,
          successStatusByOp,
        );
      }
      if (variantCollection.scenarios.length) {
        await writeFile(
          path.join(variantDir, fileName),
          JSON.stringify(variantCollection, null, 2),
          'utf8',
        );
      }
    }
    summaryEntries.push({
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      scenarioCount: collection.scenarios.length,
      unsatisfied: !!collection.unsatisfied,
      missingSemanticTypes: collection.scenarios.find((s) => s.id === 'unsatisfied')
        ?.missingSemanticTypes,
    });
    processed++;
  }

  const summary: GenerationSummary = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    endpoints: summaryEntries,
  };
  await writeFile(path.join(outputDir, 'index.json'), JSON.stringify(summary, null, 2), 'utf8');
  // Write artifact manifest for programmatic builds
  if (artifactsManifest.size) {
    const artifacts = Array.from(artifactsManifest.values()).sort((a, b) =>
      (a.kind + a.path).localeCompare(b.kind + b.path),
    );
    await writeFile(
      path.join(outputDir, 'deployment-artifacts.manifest.json'),
      JSON.stringify({ artifacts }, null, 2),
      'utf8',
    );
  }

  console.log(`Generated scenario files for ${processed} endpoints.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function buildRequestPlan(
  scenario: EndpointScenario,
  resp: ResponseShapeSummary | undefined,
  graph: OperationGraph,
  canonical: Record<string, CanonicalShape>,
  requestGroupsIndex: Record<string, RequestOneOfGroupSummary[]>,
  successStatusByOp: Record<string, number>,
): RequestStep[] {
  const steps: RequestStep[] = [];
  // Each operation becomes a step; final step uses response shape for extraction
  const lastOpId = scenario.operations[scenario.operations.length - 1].operationId;
  for (const opRef of scenario.operations) {
    const isFinal = opRef.operationId === lastOpId;
    const step: RequestStep = {
      operationId: opRef.operationId,
      method: opRef.method,
      pathTemplate: opRef.path,
      expect: {
        status: determineExpectedStatus(
          scenario,
          resp,
          isFinal,
          successStatusByOp[opRef.operationId],
        ),
      },
    };
    // Domain valueBindings driven response extraction (non-final steps included)
    const opDom = graph.domain?.operationRequirements?.[opRef.operationId];
    if (opDom?.valueBindings) {
      const extracts: { fieldPath: string; bind: string; note?: string }[] = [];
      for (const [k, v] of Object.entries(opDom.valueBindings)) {
        if (!k.startsWith('response.')) continue; // only handle response mappings here
        const fieldPathRaw = k.slice('response.'.length); // canonical path with [] markers
        const norm = fieldPathRaw.replace(/\[\]/g, '[0]'); // first element access for arrays
        // #70: under the new grammar `semantic:<SemanticType>`, the binding
        // variable is derived from the LHS field-path leaf instead of from
        // the RHS state.parameter pair (which the typed-dataflow lens replaces).
        const mapping = v;
        const isSemantic = mapping.startsWith('semantic:');
        const paramPart = isSemantic
          ? (fieldPathRaw.split('.').pop() ?? '')
          : (mapping.split('.').pop() ?? '');
        let bind = `${camelCase(paramPart)}Var`;
        if (k.endsWith('$key')) {
          // explicit key semantic mapping
          bind = `${camelCase(paramPart.replace(/Id$/, 'Key'))}Var`;
        }
        // Ensure binding variable exists in scenario.bindings placeholder if not set
        scenario.bindings ||= {};
        if (!scenario.bindings[bind]) scenario.bindings[bind] = `__PENDING__`;
        extracts.push({ fieldPath: norm, bind, note: 'domainBinding' });
      }
      if (extracts.length) step.extract = extracts;
    }
    // Canonical request body synthesis for POST/PUT/PATCH using requestByMediaType
    if (['POST', 'PUT', 'PATCH'].includes(opRef.method)) {
      const plan = buildRequestBodyFromCanonical(
        opRef.operationId,
        scenario,
        graph,
        canonical,
        requestGroupsIndex,
        isFinal,
      );
      if (plan?.kind === 'json') {
        step.bodyTemplate = plan.template;
        step.bodyKind = 'json';
      } else if (plan?.kind === 'multipart') {
        step.multipartTemplate = plan.template;
        step.bodyKind = 'multipart';
        step.expectedDeploymentSlices = plan.expectedSlices;
      }
    }
    if (isFinal && resp?.fields?.length) {
      // Basic extraction: semantic-labeled fields
      const extract: { fieldPath: string; bind: string; semantic?: string }[] = [];
      for (const f of resp.fields) {
        if (f.semantic) {
          const bind = `${camelCase(f.semantic)}Var`;
          extract.push({ fieldPath: f.name, bind, semantic: f.semantic });
        }
      }
      if (extract.length) step.extract = (step.extract || []).concat(extract);
    }
    // Non-final producer steps: emit semantic-labeled extracts using the
    // dependency graph's `responseSemanticTypes` (which captures nested
    // fieldPaths like `metadata.processInstanceKey`, unlike
    // `extractSchemas.flattenTopLevelFields` which only sees top-level).
    // Without this, a grafted prerequisite chain could exist but never
    // populate the URL var, leaving `${...Var}` literally in the emitted
    // URL.
    if (!isFinal) {
      const stepNode = graph.operations[opRef.operationId];
      const stepSuccess = successStatusByOp[opRef.operationId];
      const responseEntries = stepNode?.responseSemanticTypes?.[String(stepSuccess)] ?? [];
      if (responseEntries.length) {
        const extract: { fieldPath: string; bind: string; semantic?: string }[] = [];
        const existingBinds = new Set((step.extract ?? []).map((e) => e.bind));
        for (const entry of responseEntries) {
          const bind = `${camelCase(entry.semanticType)}Var`;
          if (existingBinds.has(bind)) continue;
          // semantic-graph-extractor emits array item paths with `[]`
          // markers (schema-analyzer.ts: `${fieldPath}[]`). The Playwright
          // emitter's accessor builder expects numeric indices, so
          // normalise to first-element access — same convention used for
          // domainBinding extracts above.
          const fieldPath = entry.fieldPath.replace(/\[\]/g, '[0]');
          extract.push({
            fieldPath,
            bind,
            semantic: entry.semanticType,
          });
          existingBinds.add(bind);
        }
        if (extract.length) step.extract = (step.extract || []).concat(extract);
      }
    }
    steps.push(step);
    // If this is the final step and scenario has duplicateTest, append a duplicate invocation
    if (isFinal && scenario.duplicateTest) {
      const dup: RequestStep = {
        ...step,
        expect: {
          status:
            scenario.duplicateTest.secondStatus ||
            (scenario.duplicateTest.mode === 'conflict' ? 409 : 200),
        },
      };
      // Mark duplicate step for emitter logic
      dup.notes = `${dup.notes ? `${dup.notes}; ` : ''}duplicate-invocation`;
      steps.push(dup);
    }
  }
  // Issue #105 (Phase 3): for variant scenarios, deep-merge the populated
  // sub-shape into the FINAL step's bodyTemplate. The planner stamps
  // `populatesSubShape` on each variant scenario; the emitter expects the
  // `${semanticVar}` placeholders to already be present in the body so it
  // can substitute them via its standard `"${var}"` → `ctx["var"]` rewrite.
  // Producer extracts for each leaf semantic are populated by the
  // non-final-step block above (responseSemanticTypes), so the placeholders
  // resolve at runtime to values pulled from the prerequisite chain.
  mergePopulatesSubShapeIntoFinalBody(scenario, steps);
  // Issue #61: alias producer extracts under placeholder-derived var names.
  // The Playwright emitter substitutes `{placeholder}` with
  // `ctx.<camelCase(placeholder)>Var`, but producer steps bind under
  // `<camelCase(semanticType)>Var`. When the OpenAPI path-param's name
  // differs from its `x-semantic-type` (e.g. `{adHocSubProcessInstanceKey}`
  // with semantic type `ElementInstanceKey`), the names never meet and the
  // literal `${...}` leaks into the URL at runtime. For each path
  // placeholder on the final step whose semantic type was already extracted
  // by an earlier step under a differently-named bind, push an additional
  // alias extract on that producer step bound to the placeholder-derived
  // name. Keeps the emitter dumb and the alias visible in scenario JSON.
  aliasProducerExtractsToPlaceholders(scenario, steps, graph);
  return steps;
}

function mergePopulatesSubShapeIntoFinalBody(
  scenario: EndpointScenario,
  steps: RequestStep[],
): void {
  const sub = scenario.populatesSubShape;
  if (!sub || !sub.leafPaths?.length) return;
  if (!steps.length) return;
  const finalStep = steps[steps.length - 1];
  if (finalStep.bodyKind !== 'json') return;
  const body: Record<string, unknown> = isPlainRecord(finalStep.bodyTemplate)
    ? { ...finalStep.bodyTemplate }
    : {};
  const leafSemantics = sub.leafSemantics ?? [];
  for (let i = 0; i < sub.leafPaths.length; i++) {
    const leafPath = sub.leafPaths[i];
    const semantic = leafSemantics[i];
    if (!semantic) continue;
    const bind = `${camelCase(semantic)}Var`;
    setLeafPlaceholder(body, leafPath, `\${${bind}}`);
    scenario.bindings ||= {};
    if (!scenario.bindings[bind]) scenario.bindings[bind] = '__PENDING__';
  }
  finalStep.bodyTemplate = body;
}

/**
 * Walks `path` (e.g. `startInstructions[].elementId`, or
 * `filter.processInstanceKey`) and inserts `value` at the leaf, creating
 * intermediate objects/arrays as needed. `[]` segments coerce the parent
 * to a single-element array.
 */
function setLeafPlaceholder(root: Record<string, unknown>, path: string, value: string): void {
  // Tokenise: each segment is either `name` or `name[]`.
  const segments = path.split('.');
  // current is the container we mutate; for array segments we descend
  // into element [0]. Track parent + key so we can rewrite after type
  // coercion when needed.
  let cursor: unknown = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isArray = seg.endsWith('[]');
    const key = isArray ? seg.slice(0, -2) : seg;
    const isLast = i === segments.length - 1;
    if (!isPlainRecord(cursor)) return; // defensive: malformed input
    if (isArray) {
      // Ensure cursor[key] is an array with at least one element object.
      const existing = cursor[key];
      let arr: unknown[];
      if (Array.isArray(existing)) {
        arr = existing;
      } else {
        arr = [];
        cursor[key] = arr;
      }
      if (arr.length === 0 || !isPlainRecord(arr[0])) {
        arr[0] = {};
      }
      if (isLast) {
        // Leaf is itself an array root with no further segment; treat as
        // scalar slot at index 0. (The planner currently only emits
        // sub-shapes whose leaf is a deeper field, so this branch is a
        // safety net for future leaf-as-root variants.)
        arr[0] = value;
        return;
      }
      cursor = arr[0];
      continue;
    }
    if (isLast) {
      cursor[key] = value;
      return;
    }
    const next = cursor[key];
    if (isPlainRecord(next)) {
      cursor = next;
    } else {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    }
  }
}

function aliasProducerExtractsToPlaceholders(
  scenario: EndpointScenario,
  steps: RequestStep[],
  graph: OperationGraph,
): void {
  if (steps.length < 2) return;
  const finalStep = steps[steps.length - 1];
  const placeholders = [...finalStep.pathTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (placeholders.length === 0) return;
  const finalNode = graph.operations[finalStep.operationId];
  const pathParams = finalNode?.pathParameters ?? [];
  for (const ph of placeholders) {
    const param = pathParams.find((p) => p.name === ph);
    const semanticType = param?.semanticType;
    if (!semanticType) continue;
    const placeholderVar = `${camelCase(ph)}Var`;
    const semanticVar = `${camelCase(semanticType)}Var`;
    if (placeholderVar === semanticVar) continue;
    // Walk earlier steps to find an extract bound under the semanticType-
    // derived var. Prefer the most recent such extract so the alias points
    // at the freshest production in the chain.
    for (let i = steps.length - 2; i >= 0; i--) {
      const earlier = steps[i];
      const sourceExtract = (earlier.extract ?? []).find((e) => e.bind === semanticVar);
      if (!sourceExtract) continue;
      const existingBinds = new Set((earlier.extract ?? []).map((e) => e.bind));
      if (existingBinds.has(placeholderVar)) break;
      earlier.extract = (earlier.extract ?? []).concat({
        fieldPath: sourceExtract.fieldPath,
        bind: placeholderVar,
        semantic: sourceExtract.semantic,
        note: 'placeholderAlias',
      });
      scenario.bindings ||= {};
      if (!scenario.bindings[placeholderVar]) scenario.bindings[placeholderVar] = '__PENDING__';
      break;
    }
  }
}

function determineExpectedStatus(
  scenario: EndpointScenario,
  resp: ResponseShapeSummary | undefined,
  isFinal: boolean,
  opSuccessStatus: number | undefined,
): number {
  if (
    isFinal &&
    scenario.expectedResult &&
    scenario.expectedResult.kind === 'error' &&
    scenario.expectedResult.code
  ) {
    const n = Number(scenario.expectedResult.code);
    if (!Number.isNaN(n)) return n;
  }
  // Prefer the operation's own declared success status for every step
  // (covers 204 endpoints, and prerequisite steps whose status differs
  // from the final step). Only the final step falls back to the
  // endpoint response shape's `successStatus`; non-final steps fall
  // back directly to 200 because `resp` describes the final endpoint,
  // not the prerequisite.
  return opSuccessStatus ?? (isFinal ? (resp?.successStatus ?? 200) : 200);
}

function _synthesizeBodyTemplate(scenario: EndpointScenario, opRef: OperationRef) {
  // Heuristic: for search endpoints, include binding-derived fields
  const bindings = scenario.bindings || {};
  if (!bindings || Object.keys(bindings).length === 0) return undefined;
  const result: Record<string, string> = {};
  const isSearch = /\/search$/.test(opRef.path) || /search/i.test(opRef.operationId);
  // Map binding var names like processDefinitionKeyVar -> processDefinitionKey
  for (const [k, _v] of Object.entries(bindings)) {
    if (!k.endsWith('Var')) continue;
    const base = k.slice(0, -3); // remove 'Var'
    // Only include if variant actually uses this optional semantic OR it's required semantic for endpoint
    const used = scenario.filtersUsed?.includes(capitalizeFirst(base.replace(/Var$/, ''))) || false;
    if (isSearch && used) {
      result[base] = `\${${k}}`; // placeholder replaced later in emitter
    }
  }
  return result;
}

function capitalizeFirst(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function camelCase(name: string) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

type CanonicalShape = {
  requestByMediaType?: Record<string, { path: string; type: string; required: boolean }[]>;
};

type RequestBodyPlan =
  | { kind: 'json'; template: Record<string, unknown> }
  | {
      kind: 'multipart';
      template: {
        fields: Record<string, string>;
        files: Record<string, string>;
      };
      expectedSlices: string[];
    };

function buildRequestBodyFromCanonical(
  opId: string,
  scenario: EndpointScenario,
  graph: OperationGraph,
  canonical: Record<string, CanonicalShape>,
  requestGroupsIndex: Record<string, RequestOneOfGroupSummary[]>,
  isEndpoint: boolean,
): RequestBodyPlan | undefined {
  const shape = canonical[opId];
  if (!shape?.requestByMediaType) return undefined;
  // Prefer multipart when available (e.g., createDeployment), else application/json
  const ctOrder = ['multipart/form-data', 'application/json'];
  let chosenCt: string | undefined;
  for (const ct of ctOrder)
    if (shape.requestByMediaType[ct]) {
      chosenCt = ct;
      break;
    }
  if (!chosenCt) return undefined;
  const nodes = shape.requestByMediaType[chosenCt] ?? [];
  // Build quick lookup of expected (declared) JSON field types by leaf name (top-level) for type-aware wrong-type mutation
  const declaredTypeByLeaf: Record<string, string> = {};
  try {
    for (const n of nodes) {
      if (!n.path.includes('[]')) {
        const leaf = n.path.split('.').pop() ?? '';
        if (leaf && !declaredTypeByLeaf[leaf]) declaredTypeByLeaf[leaf] = n.type;
      }
    }
  } catch {}
  const requiredFields = nodes.filter((n) => n.required && !n.path.includes('[]'));
  // Bindings map from domain valueBindings (request.* -> parameter name).
  // Two RHS grammars are supported:
  //   1. `state.parameter`        — legacy form; parameter name is the leaf of the RHS.
  //   2. `semantic:<SemanticType>` — witness form (#70); parameter name is the leaf
  //      of the LHS field-path, since the typed-dataflow lens replaces the
  //      state.parameter pair.
  const opDom = graph.domain?.operationRequirements?.[opId];
  const bindingMap: Record<string, string> = {};
  if (opDom?.valueBindings) {
    for (const [k, v] of Object.entries<string>(opDom.valueBindings)) {
      if (k.startsWith('request.')) {
        const raw = k.slice('request.'.length);
        const param = v.startsWith('semantic:')
          ? (raw.split('.').pop() ?? '')
          : (v.split('.').pop() ?? '');
        bindingMap[raw] = param;
      }
    }
  }
  // If JSON and oneOf groups exist, figure out which fields are allowed
  const requestGroups = requestGroupsIndex?.[opId] || [];
  // Load request defaults (operation-level overrides global)
  const defaults = getRequestDefaultsForOperation(opId);
  let allowedFields: Set<string> | undefined;
  let chosenVariantRequired: string[] | undefined;
  if (chosenCt === 'application/json' && requestGroups.length) {
    // Determine selected variant for endpoint scenarios
    const selected = isEndpoint ? scenario.requestVariants?.[0] : undefined;
    const groupId = selected?.groupId || requestGroups[0]?.groupId;
    const group = requestGroups.find((g) => g.groupId === groupId) || requestGroups[0];
    // Choose a concrete variant: prefer one that contains a '*Key' field if possible
    const variants: RequestOneOfVariant[] = group?.variants || [];
    let chosen = selected ? variants.find((v) => v.variantName === selected.variant) : undefined;
    if (!chosen)
      chosen = variants.find((v) => v.required.some((f) => /Key$/.test(f))) || variants[0];
    // For non-endpoint dependent steps, prefer Key similarly
    if (!isEndpoint) {
      chosen = variants.find((v) => v.required.some((f) => /Key$/.test(f))) || chosen;
    }
    chosenVariantRequired = [...(chosen?.required || [])];
    // Allow chosen required, plus chosen optional that are NOT required by any other variant
    const otherRequired = new Set<string>(
      variants.filter((v) => v !== chosen).flatMap((v) => v.required || []),
    );
    const safeOptional = (chosen?.optional || []).filter((n) => !otherRequired.has(n));
    const names: string[] = [...(chosen?.required || []), ...safeOptional];
    allowedFields = new Set(names);
  }
  // Build template
  if (chosenCt === 'application/json') {
    const template: Record<string, unknown> = {};
    const missing: string[] = [];
    if (requestGroups.length) {
      // oneOf-aware synthesis
      if (chosenVariantRequired?.length) {
        for (const name of chosenVariantRequired) {
          if (allowedFields && !allowedFields.has(name)) continue;
          // Special-case: map domain jobType -> request.type if not explicitly bound
          const mappedName =
            name === 'type' && !bindingMap[name] && bindingMap.jobType ? 'jobType' : name;
          const viaProvider = resolveProvider(opId, name, scenario);
          if (viaProvider !== undefined) {
            template[name] = viaProvider;
            continue;
          }
          const varName = `${camelCase(bindingMap[mappedName] || name || 'value')}Var`;
          const hasBinding = !!bindingMap[mappedName];
          if (hasBinding) {
            scenario.bindings ||= {};
            if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
            template[name] = `${'${'}${varName}}`;
          } else if (defaults && Object.hasOwn(defaults, name)) {
            template[name] = defaults[name];
          } else {
            scenario.bindings ||= {};
            if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
            template[name] = `${'${'}${varName}}`;
            if (!bindingMap[mappedName]) missing.push(name);
          }
        }
      }
    } else {
      // Non-oneOf: use canonical required flags
      for (const f of requiredFields) {
        const leaf = f.path.split('.').pop() ?? '';
        if (allowedFields && !allowedFields.has(leaf)) continue;
        const viaProvider = resolveProvider(opId, leaf, scenario);
        if (viaProvider !== undefined) {
          template[leaf] = viaProvider;
          continue;
        }
        // Special-case: support mapping jobType -> type
        const hasJobType = !!bindingMap.jobType;
        const mapJobTypeToType = leaf === 'type' && !bindingMap[f.path] && hasJobType;
        const mappedParamName = mapJobTypeToType
          ? 'jobType'
          : bindingMap[f.path] || leaf || 'value';
        const varName = `${camelCase(mappedParamName)}Var`;
        const hasBinding = mapJobTypeToType ? true : !!bindingMap[f.path];
        if (hasBinding) {
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
          template[leaf] = `${'${'}${varName}}`;
        } else if (defaults && Object.hasOwn(defaults, leaf)) {
          template[leaf] = defaults[leaf];
        } else {
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
          template[leaf] = `${'${'}${varName}}`;
          if (!bindingMap[f.path]) missing.push(f.path);
        }
      }
      // For search-like empty-negative scenarios, allow provider-injected optional filters to drive an empty result
      const isSearchLikeOp = opId === 'activateJobs' || /search/i.test(opId);
      const isEmptyNeg = scenario?.expectedResult && scenario.expectedResult.kind === 'empty';
      if (isSearchLikeOp && isEmptyNeg) {
        for (const f of nodes.filter((n) => !n.required && !n.path.includes('[]'))) {
          const leaf = f.path.split('.').pop() ?? '';
          if (allowedFields && !allowedFields.has(leaf)) continue;
          if (template[leaf] !== undefined) continue;
          const viaProvider = resolveProvider(opId, leaf, scenario);
          if (viaProvider !== undefined) {
            template[leaf] = viaProvider;
          }
        }
      }
    }
    // Fill a few optional fields if present and we have bindings
    for (const f of nodes.filter((n) => !n.required && !n.path.includes('[]'))) {
      const leaf = f.path.split('.').pop() ?? '';
      if (allowedFields && !allowedFields.has(leaf)) continue;
      const varBase = `${camelCase(bindingMap[f.path] || leaf || 'value')}Var`;
      if (!template[leaf]) {
        if (scenario.bindings?.[varBase]) {
          template[leaf] = `${'${'}${varBase}}`;
        } else if (defaults && Object.hasOwn(defaults, leaf)) {
          template[leaf] = defaults[leaf];
        }
      }
    }
    // Fallback: ensure all domain request.* bindings are present even if canonical nodes are missing (e.g., oneOf variants).
    const leafSet = new Set(
      nodes.filter((n) => !n.path.includes('[]')).map((n) => n.path.split('.').pop() ?? ''),
    );
    for (const [fieldPath, param] of Object.entries(bindingMap)) {
      const leaf = fieldPath.split('.').pop() ?? '';
      if (!leafSet.has(leaf)) continue; // don't inject fields not in schema
      if (allowedFields && !allowedFields.has(leaf)) continue;
      const varName = `${camelCase(param)}Var`;
      scenario.bindings ||= {};
      if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
      if (template[leaf] === undefined) {
        template[leaf] = `${'${'}${varName}}`;
      }
    }
    // Post-process: if jobType binding exists but schema expects 'type', prefer mapping into 'type'
    if (bindingMap.jobType) {
      const jtVar = 'jobTypeVar';
      if (template.type === undefined) {
        template.type = `${'${'}${jtVar}}`;
      }
      // ensure we don't carry a non-schema jobType field
      if (!leafSet.has('jobType')) delete template.jobType;
    }
    // Scenario-specific overrides
    // For activateJobs negative-empty scenarios, use config-driven non-existent job type and short requestTimeout
    if (
      opId === 'activateJobs' &&
      scenario?.expectedResult &&
      scenario.expectedResult.kind === 'empty'
    ) {
      const opDefaults = getRequestDefaultsForOperation(opId) || {};
      const negRaw = opDefaults.negativeEmpty;
      const neg: Record<string, unknown> =
        negRaw !== null && typeof negRaw === 'object' ? { ...negRaw } : {};
      const nonExistentType = typeof neg.type === 'string' ? neg.type : '__NON_EXISTENT_JOB_TYPE__';
      const shortTimeout =
        typeof neg.requestTimeout === 'number' && Number.isFinite(neg.requestTimeout)
          ? neg.requestTimeout
          : 250;
      template.type = nonExistentType;
      template.requestTimeout = shortTimeout;
      // Seed binding for completeness, though template uses a literal
      scenario.bindings ||= {};
      if (!scenario.bindings.jobTypeVar || scenario.bindings.jobTypeVar === '__PENDING__') {
        scenario.bindings.jobTypeVar = nonExistentType;
      }
    }
    // Removed prior absolute guard (folded into unified omission pass above).
    return { kind: 'json' as const, template };
  }
  if (chosenCt === 'multipart/form-data') {
    // Represent multipart template as { fields: Record<string,string>, files: Record<string,string> }
    // Detect array of binaries: look for paths matching resources[] with type string/binary
    const template: {
      fields: Record<string, string>;
      files: Record<string, string>;
    } = {
      fields: {},
      files: {},
    };
    const fileFields = nodes.filter(
      (n) => /\bstring\b/i.test(n.type) && /resources\[\]/.test(n.path),
    );
    if (fileFields.length) {
      // Choose fixture based on artifact rule selection if present
      const ruleId = scenario.artifactsApplied?.[0] || undefined;
      const domainRules = graph.domain?.operationArtifactRules?.[opId]?.rules || [];
      const rule = ruleId ? domainRules.find((r) => r.id === ruleId) : undefined;
      let kind = rule?.artifactKind;
      if (!kind) {
        // Default to BPMN process for deployments when unspecified
        if (opId === 'createDeployment') kind = 'bpmnProcess';
      }
      // Map artifact kind -> default fixture path
      const defaultFixtures: Record<string, string> = {
        bpmnProcess: '@@FILE:bpmn/simple.bpmn',
        form: '@@FILE:forms/simple.form',
        dmnDecision: '@@FILE:dmn/decision.dmn',
        dmnDrd: '@@FILE:dmn/drd.dmn',
      };
      // Prefer registry-defined artifact if available for this kind
      // If downstream requires ModelHasServiceTaskType/JobType, prefer an entry carrying a jobType parameter
      const preferJobType = true; // simple heuristic: jobs-related ops exist; could inspect scenario.operations
      const regHit = chooseFixtureFromRegistry(kind, preferJobType);
      const fileRef = regHit?.ref || defaultFixtures[kind || ''] || '@@FILE:bpmn/simple.bpmn';
      // If registry provides a jobType parameter, bind it for later request body use
      if (regHit?.params && typeof regHit.params.jobType === 'string') {
        const varName = 'jobTypeVar';
        scenario.bindings ||= {};
        if (!scenario.bindings[varName]) scenario.bindings[varName] = regHit.params.jobType;
      }
      template.files.resources = fileRef;
    }
    const tenant = nodes.find((n) => n.path === 'tenantId');
    if (tenant) {
      const varName = 'tenantIdVar';
      scenario.bindings ||= {};
      if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
      template.fields.tenantId = `\
${'${'}${varName}}`;
    }
    // Derive expected deployment slices using domain sidecar mapping (explicit). Fallback to heuristic later in emitter.
    const expectedSlicesSet = new Set<string>();
    try {
      const fileKinds = graph.domain?.artifactFileKinds;
      const kindsSpec = graph.domain?.artifactKinds;
      for (const [_name, val] of Object.entries<unknown>(template.files)) {
        const s = typeof val === 'string' ? val : '';
        const pth = s.startsWith('@@FILE:') ? s.slice('@@FILE:'.length) : s;
        if (!pth) continue;
        const ext = path.extname(pth).toLowerCase();
        const kinds = fileKinds?.[ext] || [];
        for (const k of kinds) {
          const spec = kindsSpec?.[k];
          const slices: string[] = spec?.deploymentSlices || [];
          slices.forEach((x) => {
            expectedSlicesSet.add(x);
          });
        }
      }
    } catch {}
    const expectedSlices = Array.from(expectedSlicesSet);
    return { kind: 'multipart' as const, template, expectedSlices };
  }
  return undefined;
}

// -------- Artifact Registry support ---------
type ArtifactRegistryEntry = {
  kind: string;
  path: string;
  description?: string;
  parameters?: Record<string, unknown>;
};
let artifactsRegistryCache: ArtifactRegistryEntry[] | undefined;
function getArtifactsRegistry(): ArtifactRegistryEntry[] {
  if (artifactsRegistryCache) return artifactsRegistryCache;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Invoked from path-analyser
    path.resolve(process.cwd(), 'fixtures', 'deployment-artifacts.json'),
    // Invoked from repo root
    path.resolve(process.cwd(), 'path-analyser', 'fixtures', 'deployment-artifacts.json'),
    // Relative to compiled module (dist/src)
    path.resolve(moduleDir, '../fixtures/deployment-artifacts.json'),
    path.resolve(moduleDir, '../../fixtures/deployment-artifacts.json'),
  ];
  for (const p of candidates) {
    try {
      const data = fsSync.readFileSync(p, 'utf8');
      const json = JSON.parse(data);
      const arr = Array.isArray(json?.artifacts) ? json.artifacts : Array.isArray(json) ? json : [];
      artifactsRegistryCache = arr.map((e: ArtifactRegistryEntry) => ({
        kind: e.kind,
        path: e.path,
        description: e.description,
        parameters: e.parameters,
      }));
      return artifactsRegistryCache || [];
    } catch {}
  }
  artifactsRegistryCache = [];
  return artifactsRegistryCache;
}

// -------- Request Defaults support ---------
type RequestDefaults = {
  operations?: Record<string, Record<string, unknown>>;
  global?: Record<string, unknown>;
};
let requestDefaultsCache: RequestDefaults | null = null;
function loadRequestDefaults(): RequestDefaults {
  if (requestDefaultsCache) return requestDefaultsCache;
  const candidates = [
    path.resolve(process.cwd(), 'request-defaults.json'),
    path.resolve(process.cwd(), 'path-analyser', 'request-defaults.json'),
  ];
  for (const p of candidates) {
    try {
      const data = fsSync.readFileSync(p, 'utf8');
      // biome-ignore lint/plugin: JSON.parse returns `any`; the file shape is the runtime contract for request-defaults.json.
      const json = JSON.parse(data) as RequestDefaults;
      requestDefaultsCache = json;
      return requestDefaultsCache;
    } catch {}
  }
  requestDefaultsCache = { operations: {}, global: {} };
  return requestDefaultsCache;
}
function getRequestDefaultsForOperation(opId: string): Record<string, unknown> | undefined {
  const all = loadRequestDefaults();
  const op = all.operations?.[opId] || {};
  const glob = all.global || {};
  return { ...glob, ...op };
}

// -------- Filter Providers (search filters, oneOf negatives) ---------
type ProviderSpec = {
  from: 'ctx' | 'const' | 'enumFirst' | 'base64' | 'now';
  var?: string;
  value?: unknown;
};
type ProviderConfig = {
  globals?: Record<string, ProviderSpec>;
  operations?: Record<string, Record<string, ProviderSpec>>;
};
let providerConfigCache: ProviderConfig | null = null;
function loadProviderConfig(): ProviderConfig {
  if (providerConfigCache) return providerConfigCache;
  const candidates = [
    path.resolve(process.cwd(), 'filter-providers.json'),
    path.resolve(process.cwd(), 'path-analyser', 'filter-providers.json'),
  ];
  for (const p of candidates) {
    try {
      const data = fsSync.readFileSync(p, 'utf8');
      // biome-ignore lint/plugin: JSON.parse returns `any`; the file shape is the runtime contract for filter-providers.json.
      providerConfigCache = JSON.parse(data) as ProviderConfig;
      return providerConfigCache;
    } catch {}
  }
  providerConfigCache = { globals: {}, operations: {} };
  return providerConfigCache;
}
function resolveProvider(opId: string, field: string, scenario: EndpointScenario): unknown {
  const cfg = loadProviderConfig();
  const opMap = cfg.operations?.[opId] || {};
  const spec = opMap[field] || cfg.globals?.[field];
  if (!spec) return undefined;
  switch (spec.from) {
    case 'ctx': {
      const vname = spec.var || `${field}Var`;
      return scenario.bindings && scenario.bindings[vname] !== undefined
        ? `\${${vname}}`
        : undefined;
    }
    case 'const':
      return spec.value;
    case 'base64':
      return typeof spec.value === 'string' ? spec.value : 'AA==';
    case 'now':
      return new Date().toISOString();
    case 'enumFirst':
      return undefined;
  }
}

function chooseFixtureFromRegistry(
  kind?: string,
  preferJobType = false,
): { ref: string; params?: Record<string, unknown> } | undefined {
  if (!kind) return undefined;
  const reg = getArtifactsRegistry();
  let hit = reg.find(
    (e) =>
      e.kind === kind && preferJobType && e.parameters && typeof e.parameters.jobType === 'string',
  );
  if (!hit) hit = reg.find((e) => e.kind === kind);
  if (hit?.path) return { ref: `@@FILE:${hit.path}`, params: hit.parameters };
  return undefined;
}
