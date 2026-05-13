import fsSync from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalShapes } from './canonicalSchemas.js';
import { deterministicSuffix } from './codegen/support/seeding.js';
import {
  getActiveConfigDir,
  getFeatureOutputDir,
  getScenariosDir,
  getVariantOutputDir,
} from './configResolver.js';
import { writeExtractionOutputs } from './extractSchemas.js';
import { generateFeatureCoverageForEndpoint } from './featureCoverageGenerator.js';
import { loadGraph, loadOpenApiSemanticHints } from './graphLoader.js';
import {
  generateOptionalSubShapeVariants,
  generateScenariosForEndpoint,
} from './scenarioGenerator.js';
import { computeSeedBindings } from './seedBindings.js';
import type {
  DomainSemantics,
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
  const repoRoot = path.resolve(baseDir, '..');
  // Per-config layout (#128 PR 2): scenario JSON + feature output land
  // under generated/<config>/, not inside the path-analyser workspace.
  const outputDir = getScenariosDir(repoRoot);
  const featureDir = getFeatureOutputDir(repoRoot);
  const variantDir = getVariantOutputDir(repoRoot);
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
    // Issue #104: re-apply the establisher self-satisfaction drop here.
    // graphLoader's `normalizeOp` already strips established semantics
    // from `requires`, but `loadOpenApiSemanticHints` walks the raw
    // OpenAPI request schema independently and re-adds the same
    // semantics back via the `x-semantic-type` annotations on the
    // identifier fields the establisher mints. Without this second
    // drop, self-establishing endpoints like `createUser` are
    // regenerated as needing their own `Username`, BFS skips them as
    // their own producer (`producerOpId === endpointOpId`), and the
    // endpoint plans an unsatisfied scenario instead of the trivial
    // "establisher alone" chain. Edge establishers (`shape: 'edge'`)
    // are skipped — their `identifiedBy` components are pre-existing
    // inputs and the hint-derived `requires` for them is correct.
    if (op.establishes && op.establishes.shape !== 'edge') {
      const established = new Set(op.establishes.identifiedBy.map((i) => i.semanticType));
      op.requires.required = op.requires.required.filter((s) => !established.has(s));
      op.requires.optional = op.requires.optional.filter((s) => !established.has(s));
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
        s.seedBindings = computeSeedBindings(s);
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
      s.seedBindings = computeSeedBindings(s);
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
        s.seedBindings = computeSeedBindings(s);
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
  // #162 PR 1: bind modelDerived semantics from the chain's deploy fixture
  // BEFORE merging populatesSubShape, so that the merge sees the
  // populatesSubShape entry the helper plants for nested-path values
  // (and so the binding has the fixture value rather than the
  // synthetic placeholder featureCoverageGenerator stamped earlier).
  bindModelDerivedFromFixture(scenario, steps, graph);
  // #162 PR 2: bind clientMintedAttribute semantics with a deterministic
  // minted value at setter sites in the same window (before the
  // populatesSubShape merge). Independent of bindModelDerivedFromFixture
  // — different value source (planner, not fixture) — but co-located so
  // both feed the same downstream materialization.
  bindClientMintedAttribute(scenario, steps, graph);
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
  // #159 PR B: for each consumer step whose requires names an eventual
  // state, find the most recent earlier producer step in the chain and
  // annotate it with `eventualWaitsAfter` so the emitter inserts an
  // `awaitEventually(witness)` block between producer and consumer.
  annotateEventualWaits(steps, graph);
  return steps;
}

/**
 * Walk a built request plan and stamp `eventualWaitsAfter` on every
 * producer step whose response advances an `eventual: true` state that a
 * later step requires. The annotation is self-contained — it carries the
 * witness's method + pathTemplate resolved against the graph here — so
 * the emitter does not need to re-consult `graph.operations` at
 * emission time (#159).
 *
 * Invariants:
 *   - The wait is attached to the producer step (earliest event-shape
 *     anchor), not the consumer, so emitter order is producer-block →
 *     wait-block → consumer-block without lookahead.
 *   - Duplicates are deduped per (producer step, state) — multiple
 *     downstream consumers that require the same eventual state collapse
 *     to a single wait.
 *   - Misconfigurations (eventual with no witness, unknown witness opId,
 *     non-GET witness method) are caught at load time:
 *     `validateDomainSemantics` rejects the eventual-without-witness
 *     shape, and `validateRuntimeStateWitnessGraphRefs` (called from
 *     `loadGraph`) rejects unknown opIds and non-GET methods. The
 *     defensive `continue` branches below are belt-and-braces for tests
 *     that build partial graphs without going through the loader.
 */
function annotateEventualWaits(steps: RequestStep[], graph: OperationGraph): void {
  const states = graph.domain?.runtimeStates;
  const opReqs = graph.domain?.operationRequirements;
  if (!states || !opReqs) return;
  for (let i = 0; i < steps.length; i++) {
    const consumerOp = steps[i].operationId;
    const requires = opReqs[consumerOp]?.requires ?? [];
    for (const stateName of requires) {
      const state = states[stateName];
      if (!state?.eventual || !state.witness) continue;
      const producers = new Set(state.producedBy ?? []);
      let producerIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (producers.has(steps[j].operationId)) {
          producerIdx = j;
          break;
        }
      }
      if (producerIdx < 0) continue; // no producer earlier in the chain
      const witnessOp = graph.operations[state.witness.operationId];
      if (!witnessOp) continue; // unknown witness — validator should have caught
      const producerStep = steps[producerIdx];
      producerStep.eventualWaitsAfter ||= [];
      if (producerStep.eventualWaitsAfter.some((w) => w.state === stateName)) continue;
      producerStep.eventualWaitsAfter.push({
        state: stateName,
        witness: {
          operationId: state.witness.operationId,
          method: witnessOp.method,
          pathTemplate: witnessOp.path,
          predicate: {
            path: state.witness.predicate.path,
            equals: state.witness.predicate.equals,
          },
          waitUpToMs: state.witness.waitUpToMs,
          pollIntervalMs: state.witness.pollIntervalMs,
        },
      });
    }
  }
}

/**
 * #162 PR 1: bind modelDerived semantic values from the chain's
 * createDeployment fixture and annotate `populatesSubShape` so the final
 * step's body materializes the value.
 *
 * "modelDerived" means the value comes from inside the deployment
 * artifact itself (e.g. an ElementId encoded in the BPMN), not from a
 * Camunda API response. The fixture registry's `providesValues` entry
 * declares which concrete values each fixture supplies.
 *
 * Scope (PR 1):
 *
 *   - Runs ONLY for feature-coverage scenarios. Variant scenarios
 *     continue using their producer-chain logic (see
 *     `generateOptionalSubShapeVariants`); PR 4 of #162 unifies them.
 *
 *   - Single-deploy chains only — the helper picks the FIRST
 *     `createDeployment` step's fixture as the value source. Multi-deploy
 *     chains (source + target models, e.g. migrateProcessInstance) need
 *     per-deploy-step fixture selection and are a follow-up.
 *
 *   - Index 0 of `providesValues[semantic]` is used unconditionally.
 *     A future per-consumer-site preference vocabulary can pick a
 *     specific entry; not load-bearing today.
 *
 * Side effects:
 *
 *   - For modelDerived semantics on nested optional sub-shape leaves from
 *     `endpoint.optionalSubShapes` (i.e. the leaves computed via
 *     `subShapeRootOf`), overrides any pre-existing binding (synthetic or
 *     otherwise) with the fixture value. The override is intentional:
 *     modelDerived values are authoritative over the `fc:pos:...`
 *     synthetic placeholder stamped by featureCoverageGenerator.
 *
 *   - For nested-array semantics (`fieldPath` containing `[]`), adds a
 *     `populatesSubShape` entry so `mergePopulatesSubShapeIntoFinalBody`
 *     materializes the nested structure. Top-level scalar semantics are
 *     handled by the existing flat-optional fill loop in
 *     `buildRequestBodyFromCanonical` and do not need a populatesSubShape
 *     annotation.
 */
export function bindModelDerivedFromFixture(
  scenario: EndpointScenario,
  steps: RequestStep[],
  graph: OperationGraph,
): void {
  if (scenario.strategy !== 'featureCoverage') return;
  const domain = graph.domain;
  if (!domain?.semanticTypes) return;
  if (!steps.length) return;
  const finalStep = steps[steps.length - 1];
  const endpoint = graph.operations[finalStep.operationId];
  // optionalSubShapes already filters to nested optional semantic leaves
  // (the graphLoader pre-computes this via `subShapeRootOf`). PR 1's
  // scope is exactly that subset — nested ElementId at consumer sites
  // like `startInstructions[].elementId`. Top-level scalar modelDerived
  // semantics (e.g. JobType) go through a different binding path and
  // are out of scope here.
  const subShapes = endpoint?.optionalSubShapes ?? [];
  if (!subShapes.length) return;
  // Find the first createDeployment step in the chain — single-deploy
  // only in PR 1; multi-deploy is a follow-up.
  const deployStep = steps.find((s) => s.operationId === 'createDeployment');
  if (!deployStep) return;
  const fixture = fixtureFromDeployStep(deployStep);
  if (!fixture?.providesValues) return;

  for (const subShape of subShapes) {
    for (const leaf of subShape.leaves) {
      const semKind = domain.semanticTypes[leaf.semantic]?.kind;
      if (semKind !== 'modelDerived') continue;
      const values = fixture.providesValues[leaf.semantic];
      if (!values?.length) continue;
      const varName = `${camelCase(leaf.semantic)}Var`;
      scenario.bindings ||= {};
      // Authoritative override: a featureCoverageGenerator synthetic
      // would otherwise shadow the real fixture value.
      scenario.bindings[varName] = values[0];

      const sub = scenario.populatesSubShape ?? {
        rootPath: subShape.rootPath,
        leafPaths: [],
        leafSemantics: [],
      };
      if (!sub.leafPaths.includes(leaf.fieldPath)) {
        sub.leafPaths.push(leaf.fieldPath);
        sub.leafSemantics ||= [];
        sub.leafSemantics.push(leaf.semantic);
      }
      if (!sub.rootPath) sub.rootPath = subShape.rootPath;
      scenario.populatesSubShape = sub;
    }
  }
}

/**
 * Find the fixture registry entry referenced by a `createDeployment`
 * step's multipart `resources` template. Multi-deploy steps carry
 * multiple file references; PR 1 returns the entry for the FIRST one
 * (single-deploy scope).
 */
function fixtureFromDeployStep(step: RequestStep): ArtifactRegistryEntry | undefined {
  const tpl = step.multipartTemplate;
  if (!isPlainRecord(tpl)) return undefined;
  const files = isPlainRecord(tpl.files) ? tpl.files : undefined;
  if (!files) return undefined;
  for (const v of Object.values(files)) {
    if (typeof v === 'string' && v.startsWith('@@FILE:')) {
      const path = v.slice('@@FILE:'.length);
      return getArtifactsRegistry().find((e) => e.path === path);
    }
  }
  return undefined;
}

/**
 * #162 PR 2: bind values for `kind: 'attribute'` + `clientMinted: true`
 * semantic types at SETTER sites in the chain. A setter site is an
 * operation whose request body declares the semantic — the value
 * originates from the planner (a deterministic minted token), not from
 * any producer endpoint, and gets stamped into the body via the
 * standard `populatesSubShape` materializer.
 *
 * Scope (PR 2):
 *
 *   - Runs ONLY for feature-coverage scenarios. Variant scenarios are
 *     handled by their own dedicated planner path; the unified-dispatch
 *     refactor is #162 PR 3.
 *
 *   - Setter-site only. If the endpoint accepts the semantic in its
 *     request body, we mint + populate here. Filter-consumer endpoints
 *     (search/batch ops where a tag is matched against existing
 *     entities) need setter-chain reuse — insert a setter step BEFORE
 *     the consumer step and thread the same minted value through — and
 *     are deferred to a follow-up issue. Without that work, filter
 *     scenarios would search for a non-existent value and return empty
 *     results, failing the non-empty assertion.
 *
 *   - Walks `endpoint.requestBodySemantics` (the inclusive index added
 *     in PR 2 for exactly this purpose) so scalar-array paths (`tags[]`)
 *     and top-level scalars (`businessId`) are visible alongside
 *     nested-object leaves. `optionalSubShapes` would miss them.
 *
 *   - The `fc:cma:<sem>:` prefix on the minted value tags the source
 *     (`fc` = feature coverage, `cma` = client-minted attribute) so
 *     a grep of the emitted output can distinguish it from
 *     `fc:pos:<sem>:` (the pre-#162 synthetic) and from
 *     producer-bound values.
 *
 * Side effects:
 *
 *   - Overrides any pre-existing binding (synthetic from
 *     featureCoverageGenerator) with the new minted value. Override is
 *     intentional — clientMintedAttribute values are authoritative over
 *     the pre-classification synthetic.
 *
 *   - Adds a `populatesSubShape` entry for the leaf (even when the path
 *     is top-level scalar or scalar-array) so the existing
 *     `mergePopulatesSubShapeIntoFinalBody` materializer fills the body.
 *     `setLeafPlaceholder` already handles scalar-array `[]` leaves
 *     correctly — building `tags: ['${tagVar}']` for top-level
 *     `tags[]` and `filter.tags: ['${tagVar}']` for nested
 *     `filter.tags[]`.
 */
export function bindClientMintedAttribute(
  scenario: EndpointScenario,
  steps: RequestStep[],
  graph: OperationGraph,
): void {
  if (scenario.strategy !== 'featureCoverage') return;
  const domain = graph.domain;
  if (!domain?.semanticTypes) return;
  if (!steps.length) return;
  const finalStep = steps[steps.length - 1];
  const endpoint = graph.operations[finalStep.operationId];
  const bodySems = endpoint?.requestBodySemantics ?? [];
  if (!bodySems.length) return;

  for (const bodySem of bodySems) {
    const spec = domain.semanticTypes[bodySem.semantic];
    if (spec?.kind !== 'attribute' || spec.clientMinted !== true) continue;
    // PR 2 narrowed scope: only fill at the endpoint that IS the setter
    // (the final-step body accepts the semantic). Filter-consumer sites
    // also have the semantic in their bodySemantics but need a separate
    // setter-chain pass to make the value meaningful — deferred.
    //
    // Heuristic for "this is a setter site" vs "this is a filter
    // consumer": filter consumers have the semantic under a path
    // beginning with `filter.` or `filter[` (the bundled spec uses
    // `filter.tags[]` and `filter.$or[].tags[]`); setters have the
    // semantic at top-level or under a non-filter parent. This is a
    // pragmatic shortcut for PR 2; the follow-up issue (#168) will use
    // the requestSettersByType index to discover setters generically
    // and prepend a setter step before each filter consumer.
    if (bodySem.fieldPath.startsWith('filter.') || bodySem.fieldPath.startsWith('filter[')) {
      continue;
    }

    const varName = `${camelCase(bodySem.semantic)}Var`;
    const mintedValue = `fc:cma:${camelCase(bodySem.semantic)}:${deterministicSuffix(`fc:cma:${finalStep.operationId}:${bodySem.semantic}`)}`;
    scenario.bindings ||= {};
    scenario.bindings[varName] = mintedValue;

    // Always plant a populatesSubShape entry so the body is filled by
    // the existing materializer. setLeafPlaceholder handles all three
    // shapes the planner emits: top-level scalar (`businessId`),
    // top-level scalar array (`tags[]`), and nested scalar array
    // (`filter.tags[]`, when setter-chain support lands).
    const sub = scenario.populatesSubShape ?? {
      rootPath: subShapeRootForFieldPath(bodySem.fieldPath),
      leafPaths: [],
      leafSemantics: [],
    };
    if (!sub.leafPaths.includes(bodySem.fieldPath)) {
      sub.leafPaths.push(bodySem.fieldPath);
      sub.leafSemantics ||= [];
      sub.leafSemantics.push(bodySem.semantic);
    }
    if (!sub.rootPath) sub.rootPath = subShapeRootForFieldPath(bodySem.fieldPath);
    scenario.populatesSubShape = sub;
  }
}

/**
 * Compute the sub-shape root for a fieldPath. Used by the
 * clientMintedAttribute helper to seed `populatesSubShape.rootPath` for
 * top-level scalar / scalar-array leaves where the graphLoader's
 * `subShapeRootOf` returns null. Mirrors the simpler cases:
 *
 *   "tags[]"           → "tags[]"
 *   "businessId"       → "businessId"
 *   "filter.tags[]"    → "filter"  (deepest object/array-of-object
 *                                   ancestor — but PR 2 skips this
 *                                   branch since filter sites are
 *                                   deferred)
 *
 * Single-segment paths return the segment itself rather than the empty
 * string the graphLoader's stricter rule would yield — the rootPath
 * is informational metadata on populatesSubShape and the merge logic
 * doesn't actually read it.
 */
function subShapeRootForFieldPath(fieldPath: string): string {
  const segments = fieldPath.split('.');
  if (segments.length === 1) return segments[0];
  return segments.slice(0, -1).join('.');
}

function mergePopulatesSubShapeIntoFinalBody(
  scenario: EndpointScenario,
  steps: RequestStep[],
): void {
  const sub = scenario.populatesSubShape;
  if (!sub?.leafPaths?.length) return;
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
  // `cursor` is the current container being mutated in place; for array
  // segments, we ensure `cursor[key]` is an array and then descend into
  // element [0].
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
      // Pick the registry entry whose effective providesStates covers the
      // states this createDeployment step must produce for the chain (#159).
      // requiredStates is derived from operationRequirements.<op>.requires
      // across the chain, minus states produced by non-deployment ops.
      // The selector then filters registry entries by `kind` and effective
      // providesStates (entry-level ∪ kind-level), tie-breaking by smallest
      // entry.providesStates so a chain that doesn't impose any runtime
      // characteristics on the fixture falls through to the most generic
      // candidate.
      const requiredStates = computeDeploymentRequiredStates(scenario, graph.domain);
      const kindLevelProvides = new Set<string>(
        kind ? (graph.domain?.artifactKinds?.[kind]?.producesStates ?? []) : [],
      );
      const regHit = chooseFixtureFromRegistry(kind, requiredStates, kindLevelProvides);
      const fileRef = regHit?.ref || defaultFixtures[kind || ''] || '@@FILE:bpmn/simple.bpmn';
      // Bind jobType from the chosen fixture for later use in the request
      // body (`activateJobs.type`, `completeJob`/`failJob`/`throwJobError`
      // path params, etc.). After #164 the SOLE source is
      // `providesValues.JobType[0]` (declared on the bpmnProcess fixture
      // alongside ElementId). The legacy `parameters.jobType` field and
      // its `??`-fallback reader are gone.
      //
      // The `jobType` → `type` mapping special-case elsewhere in
      // `buildRequestBodyFromCanonical` (pairing the semantically-named
      // `jobType` binding with the spec-named `type` field) is
      // intentionally left in place — that's a separate architectural
      // cleanup tracked by #162 PR 3 (unified dispatch).
      const jobTypeValue = regHit?.providesValues?.JobType?.[0];
      if (jobTypeValue !== undefined) {
        const varName = 'jobTypeVar';
        scenario.bindings ||= {};
        if (!scenario.bindings[varName]) scenario.bindings[varName] = jobTypeValue;
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

/**
 * Validate and copy a registry entry's `providesValues` shape. Each value
 * must be an array of strings; anything else is dropped silently so a
 * malformed entry doesn't poison the cache (the L3 coherence invariant
 * surfaces the issue separately). Returns `undefined` when the input
 * isn't a usable record, so callers can early-out cheaply.
 */
function normaliseProvidesValues(input: unknown): Record<string, string[]> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!Array.isArray(v)) continue;
    const strings: string[] = [];
    for (const x of v) {
      if (typeof x === 'string') strings.push(x);
    }
    if (strings.length) out[k] = strings;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// -------- Artifact Registry support ---------
type ArtifactRegistryEntry = {
  kind: string;
  path: string;
  description?: string;
  /**
   * Runtime characteristics this specific fixture provides BEYOND what
   * `artifactKinds.<kind>.producesStates` declares for the kind. The
   * selector picks the entry whose effective providesStates (entry ∪
   * kind) covers the chain's required states (#159).
   */
  providesStates?: string[];
  /**
   * Concrete values this fixture supplies for semantic types whose
   * `semanticTypes.<X>.kind === 'modelDerived'` (#162 PR 1). The planner
   * reads these out-of-band at plan time — no Camunda API round-trip is
   * needed to learn the values, because the BPMN/DMN/Form file already
   * encodes them (element IDs, job types, form IDs, …).
   *
   * Per-semantic the value is an array so a future per-consumer-site
   * preference vocabulary can pick a specific entry; PR 1's planner
   * takes index 0 unconditionally.
   *
   * After #164: this is the SOLE source of fixture-derived values. The
   * pre-#162 ad-hoc `parameters: { jobType: ... }` field was the
   * embryonic form of this idea and has been retired; any new
   * fixture-derived value must be declared here.
   */
  providesValues?: Record<string, string[]>;
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
        providesStates: Array.isArray(e.providesStates) ? [...e.providesStates] : undefined,
        providesValues: normaliseProvidesValues(e.providesValues),
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
  // Sidecar lives under the active config directory at the repo root
  // (see #128). Probe both repo-root and path-analyser-relative cwds
  // so the script keeps working from either invocation site. Each
  // candidate is computed lazily because getActiveConfigDir reads
  // configs.json and throws when it is absent (e.g. the parent of the
  // repo root).
  const repoRootCandidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  for (const root of repoRootCandidates) {
    try {
      const p = path.resolve(getActiveConfigDir(root), 'request-defaults.json');
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
  // Sidecar lives under the active config directory at the repo root
  // (see #128). Probe both repo-root and path-analyser-relative cwds
  // so the script keeps working from either invocation site. Each
  // candidate is computed lazily because getActiveConfigDir reads
  // configs.json and throws when it is absent (e.g. the parent of the
  // repo root).
  const repoRootCandidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  for (const root of repoRootCandidates) {
    try {
      const p = path.resolve(getActiveConfigDir(root), 'filter-providers.json');
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

/**
 * Pick the fixture registry entry whose effective providesStates (per-entry ∪
 * kind-level `artifactKinds.<kind>.producesStates`) covers `requiredStates`.
 *
 * Selection algorithm (#159, PR A):
 *   1. Filter to entries whose `kind` matches.
 *   2. Of those, keep entries whose effective providesStates is a superset of
 *      `requiredStates`. An empty `requiredStates` matches every entry — so
 *      chains that don't impose runtime characteristics on the fixture fall
 *      through to step 3 with all candidates.
 *   3. Tie-break: smallest |entry.providesStates| wins (most specific match;
 *      fewer extra states the chain didn't ask for). Ties at that point
 *      break by array order in the registry.
 *
 * Returns the chosen entry's `@@FILE:<path>` ref plus its `providesValues`
 * (the per-fixture modelDerived value source — #162 PR 1), or `undefined`
 * when no entry of the right kind exists at all (the caller then falls
 * back to a hard-coded default).
 *
 * When no entry of the right kind covers `requiredStates` (a real
 * misconfiguration — the chain asked for a state nothing provides), the
 * function still returns the first entry of that kind so the caller can
 * emit a runnable suite; the diagnostic should be caught earlier by the
 * fixture-registry validator or the bundled-spec invariants.
 */
function chooseFixtureFromRegistry(
  kind: string | undefined,
  requiredStates: ReadonlySet<string>,
  kindLevelProvides: ReadonlySet<string>,
): { ref: string; providesValues?: Record<string, string[]> } | undefined {
  if (!kind) return undefined;
  const candidates = getArtifactsRegistry().filter((e) => e.kind === kind);
  if (candidates.length === 0) return undefined;

  const covers = candidates.filter((e) => {
    const provides = new Set<string>(kindLevelProvides);
    for (const s of e.providesStates ?? []) provides.add(s);
    for (const r of requiredStates) {
      if (!provides.has(r)) return false;
    }
    return true;
  });

  // Fall back to the first registered candidate when the requirement is
  // unsatisfiable — the caller still gets a runnable suite, and the
  // misconfiguration surfaces through the L3 invariant rather than as a
  // generator crash. Skipping the tie-break here keeps fallback behaviour
  // deterministic and matches the docstring.
  if (covers.length === 0) {
    const fallback = candidates[0];
    return {
      ref: `@@FILE:${fallback.path}`,
      providesValues: fallback.providesValues,
    };
  }
  const best = covers.reduce((acc, e) => {
    const accSize = acc.providesStates?.length ?? 0;
    const eSize = e.providesStates?.length ?? 0;
    return eSize < accSize ? e : acc;
  });
  return {
    ref: `@@FILE:${best.path}`,
    providesValues: best.providesValues,
  };
}

/**
 * Compute the set of runtime states the `createDeployment` step in a chain
 * must provide. Walks every operation in the scenario chain, accumulating
 * required states from `operationRequirements.<op>.requires`, then subtracts
 * states produced by any non-deployment op in the chain (those are
 * satisfied by their own producer step, not by the deployment). The chain
 * is BFS-ordered with producers before their consumers, so a simple
 * unordered subtraction is equivalent to a left-to-right walk here.
 *
 * Returns the residual — states that have to come from the
 * `createDeployment` step's fixture selection. An empty set means any
 * fixture of the right kind is acceptable.
 */
function computeDeploymentRequiredStates(
  scenario: { operations?: ReadonlyArray<{ operationId: string }> } | undefined,
  domain: DomainSemantics | undefined,
): Set<string> {
  const result = new Set<string>();
  if (!scenario?.operations || !domain?.operationRequirements) return result;
  const opReqs = domain.operationRequirements;
  for (const opRef of scenario.operations) {
    const req = opReqs[opRef.operationId];
    if (!req) continue;
    for (const s of req.requires ?? []) result.add(s);
  }
  // States produced by non-deployment ops earlier in the chain are
  // satisfied by their own producer step; the deployment doesn't need to
  // provide them.
  for (const opRef of scenario.operations) {
    if (opRef.operationId === 'createDeployment') continue;
    const req = opReqs[opRef.operationId];
    if (!req) continue;
    for (const s of req.produces ?? []) result.delete(s);
    for (const s of req.implicitAdds ?? []) result.delete(s);
  }
  return result;
}
