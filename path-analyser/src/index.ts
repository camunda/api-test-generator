import fsSync from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCanonicalShapes } from './canonicalSchemas.js';
import {
  getActiveConfigDir,
  getActivePlannerConfig,
  getFeatureOutputDir,
  getScenariosDir,
  getTemplateScenariosDir,
  getTemplateScenariosRootDir,
  getVariantOutputDir,
} from './configResolver.js';
import { writeExtractionOutputs } from './extractSchemas.js';
import { generateFeatureCoverageForEndpoint } from './featureCoverageGenerator.js';
import { loadGraph, loadOpenApiSemanticHints } from './graphLoader.js';
import {
  loadEdgesAbox,
  loadEntityKindsAbox,
  loadScenarioTemplatesAbox,
} from './ontology/loader.js';
import { isDeploymentGatewayOp, isJobActivatorOp } from './ontology/operationRoles.js';
import {
  generateOptionalSubShapeVariants,
  generateScenariosForEndpoint,
} from './scenarioGenerator.js';
import { instantiateAllTemplates } from './scenarioTemplateInstantiator.js';
import { computeSeedBindings } from './seedBindings.js';
import type {
  ArtifactRegistryEntry,
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
import { PENDING_BINDING } from './types.js';
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
  // #288 Phase 2 (review feedback): load the entity-kinds ABox ONCE
  // per pipeline run and thread the parsed object to every consumer
  // (post-hint identifier filter below + template instantiation
  // further down). Re-loading + re-validating the same JSON file
  // multiple times in one run was wasted I/O.
  const entityKindsAbox = loadEntityKindsAbox(repoRoot);
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
  // Drift guard: every response-side semantic leaf reported by the
  // extractor must resolve in the canonical response shape produced by
  // the bundler. Mismatch points at an extractor↔bundler divergence
  // (e.g. one walked through an allOf branch the other didn't), which
  // would silently produce response extracts whose fieldPath cannot be
  // navigated at runtime.
  //
  // Pre-#251 this guard validated `domain.operationRequirements[*].valueBindings['response.*']`
  // LHSs against the canonical shape. Those entries were retired in
  // #251 once the planner began auto-deriving response extracts from
  // the dependency graph (`responseSemanticTypes` / `responseSemanticLeaves`,
  // both populated from `x-semantic-type` on response fields; the
  // `provider` flag tracked here is the authoritative-producer signal
  // sourced from the container's `x-semantic-provider: [...]` array).
  // The guard now reads from the same source the planner uses — the
  // graph — instead of from the ABox.
  const validationErrors: string[] = [];
  for (const [opId, op] of Object.entries(graph.operations)) {
    const leaves = op.responseSemanticLeaves;
    if (!leaves?.length) continue;
    const providerLeaves = leaves.filter((l) => l.provider);
    if (providerLeaves.length === 0) continue;
    const shape = canonical[opId];
    if (!shape) {
      // An op with `provider:true` response leaves MUST have a 2xx
      // JSON response shape; otherwise the extractor lifted a leaf
      // from a response the bundler didn't materialise — a true
      // extractor↔bundler divergence. Fail loud rather than skip.
      validationErrors.push(
        `${opId}: extractor reported ${providerLeaves.length} provider:true response leaf(s) but bundler produced no canonical response shape`,
      );
      continue;
    }
    const respSet = new Set((shape.response || []).map((n) => n.path));
    const seen = new Set<string>();
    for (const leaf of providerLeaves) {
      if (seen.has(leaf.fieldPath)) continue;
      seen.add(leaf.fieldPath);
      if (!respSet.has(leaf.fieldPath)) {
        validationErrors.push(`${opId}: '${leaf.fieldPath}' not in canonical response shape`);
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
  // #288 Phase 2: rebuild the kind→identifiers map locally so the
  // post-hint re-application of the establisher self-satisfaction drop
  // uses the same "owned identifier only" filter that graphLoader
  // applied during normalisation. Without this, foreign-key components
  // (e.g. `tenantId` on createTenantClusterVariable) get suppressed
  // from `requires.required` again here, undoing the Phase 2 fix and
  // letting BFS plan a single-op scenario with no chain to mint the
  // foreign key.
  const kindIdentifiersByKind: Map<string, Set<string>> | null =
    entityKindsAbox !== null
      ? new Map(entityKindsAbox.kinds.map((k) => [k.name, new Set(k.identifiers)]))
      : null;
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
      // #288 Phase 2: mirror the kind-identifier filter applied in
      // graphLoader.normalizeOp — only TRUE identifiers of the
      // established kind get suppressed here. Foreign-key components
      // (e.g. `tenantId` on `createTenantClusterVariable`) remain in
      // `requires` so BFS chains in the establisher of the referenced
      // entity (`createTenant`).
      const kindIdentifiers = kindIdentifiersByKind?.get(op.establishes.kind);
      const established = new Set(
        op.establishes.identifiedBy
          .filter((i) => !kindIdentifiers || kindIdentifiers.has(i.semanticType))
          .map((i) => i.semanticType),
      );
      op.requires.required = op.requires.required.filter((s) => !established.has(s));
      op.requires.optional = op.requires.optional.filter((s) => !established.has(s));
    }
  }

  const summaryEntries: GenerationSummaryEntry[] = [];
  let processed = 0;
  // Aggregate deployment artifacts referenced by scenarios for manifest output
  const artifactsManifest = new Map<string, { kind: string; path: string; description?: string }>();
  // #288 Phase 3b — canonical-scenario cache. Captures the planner's
  // authoritative scenario (`chainSource` after the producer-authority
  // filter, falling back to the first integration candidate, falling
  // back to the first scenario) for every endpoint. Consumed by
  // `generateFeatureCoverageForEndpoint` (variants inherit operations
  // + bindings) and by `instantiateAllTemplates` after the loop
  // (template prereq chains).
  const canonicalByEndpoint: Map<string, EndpointScenario> = new Map();

  // #292 — per-config planner caps. Resolved once per pipeline run so
  // every endpoint sees the same caps; the two literals previously
  // hard-coded here (BFS chain alternatives + variant scenarios per
  // endpoint) now flow from `configs/<active>/`'s `planner` block via
  // `getActivePlannerConfig`. Absent block → defaults preserve the
  // pre-#292 emission shape.
  const plannerConfig = getActivePlannerConfig(repoRoot);

  for (const op of Object.values(graph.operations)) {
    // Generate scenarios for every endpoint, even if it has no semantic requirements.
    const collection = generateScenariosForEndpoint(graph, op.operationId, {
      maxChainAlternatives: plannerConfig.maxChainAlternatives,
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
    //
    // #288 Phase 3b: this block runs BEFORE `generateFeatureCoverageForEndpoint`
    // so the canonical scenario can be passed in as the source of
    // operations + bindings inheritance for every variant. The
    // post-call graft/donor-binding-inherit blocks have been deleted
    // in favour of inheritance at variant-construction time.
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
    // Canonical scenario for this endpoint — fed into
    // `generateFeatureCoverageForEndpoint` below and into the template
    // instantiator after the loop. Falls back to any scenario so
    // single-op / unsatisfied-only endpoints still have an entry.
    const canonicalForEndpoint = chainSource || integrationCandidates[0] || collection.scenarios[0];
    if (canonicalForEndpoint) {
      // #288 Phase 3b — hydrate the canonical entry with `requestPlan`
      // + `seedBindings` if the planner did not already do so.
      // The planner's `if (resp)` augmentation block above only runs
      // when the endpoint has a response shape, so 204 No-Content
      // endpoints (cancelProcessInstance, completeJob, deleteUser, …)
      // arrive here without a plan. Pre-3b this didn't matter because
      // `featureScenarioStash` held the feature scenario (always
      // hydrated post-`buildRequestPlan`); 3b's template instantiator
      // reads from `canonicalByEndpoint` instead and refuses to
      // compile templates whose referenced scenarios lack a plan.
      //
      // The hydration runs on a SHALLOW CLONE rather than the live
      // `canonicalForEndpoint` reference, because `buildRequestPlan`
      // has side-effects that mutate `scenario.bindings` (body-builder
      // synthesises missing required-field placeholders, jobTypeVar
      // for artifact deploys, globalContextSeeds entries, etc.). The
      // original planner scenario is what feature-variant overlays
      // inherit bindings from — mutating it would shift the per-
      // variant binding-key insertion order in `feature-output/`,
      // perturbing files we want to keep byte-identical across the
      // refactor. The clone gets the plan; templates read it from
      // the clone via `canonicalByEndpoint`.
      let canonicalEntry = canonicalForEndpoint;
      if (!canonicalForEndpoint.requestPlan) {
        canonicalEntry = {
          ...canonicalForEndpoint,
          bindings: { ...(canonicalForEndpoint.bindings ?? {}) },
        };
        canonicalEntry.requestPlan = buildRequestPlan(
          canonicalEntry,
          resp,
          graph,
          canonical,
          requestIndex.byOperation,
          successStatusByOp,
        );
        canonicalEntry.seedBindings = computeSeedBindings(canonicalEntry);
      }
      canonicalByEndpoint.set(op.operationId, canonicalEntry);
    }

    // Feature coverage scenarios (enhanced with integration chain + rudimentary body synthesis)
    const featureCollection = generateFeatureCoverageForEndpoint(graph, op.operationId, {
      requestVariants: requestIndex.byOperation[op.operationId],
      // #288 Phase 3b — variants inherit operations + bindings from
      // the canonical scenario at construction time, unless a variant
      // explicitly sets `inheritChainPrereqs: false` (currently only
      // search-empty-negative).
      canonical: canonicalForEndpoint,
    });
    // Per-endpoint variant cap is enforced inside
    // `generateFeatureCoverageForEndpoint` (via `maxVariantOverlays`,
    // default 35), not here. The 90-cap previously at this site
    // (`MAX_FEATURE_SCENARIOS = 90`) was structurally unreachable
    // because the inner cap of 35 already truncates first; it was
    // removed in #288 Phase 3c. #292 will lift the variant cap into
    // per-config configuration.
    // #288 Phase 3b — the chain-graft and donor-binding-inherit blocks
    // that previously lived here have been moved into
    // `buildScenarioFromVariant` (`featureCoverageGenerator.ts`),
    // which now clones the canonical scenario's operations + bindings
    // before applying variant overlay. The post-pass below only adds
    // per-scenario response-shape data and rebuilds requestPlan +
    // seedBindings against the final (overlay-merged) bindings.
    for (const s of featureCollection.scenarios) {
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
        maxVariantsPerEndpoint: plannerConfig.maxVariantsPerEndpoint,
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

  // #270 — Phase 2 of #268. After every endpoint has been planned and
  // its feature scenario stashed, instantiate any ABox-declared
  // scenario templates against their applicable subjects and write
  // one JSON file per (template × subject) pair to
  //   generated/<config>/scenarios/templates/<TemplateName>/<SubjectName>.json
  // The output is purely additive — existing BFS-derived scenarios
  // under generated/<config>/scenarios/*.json are untouched, so this
  // step cannot perturb byte-stability of the per-endpoint suites.
  const templatesAbox = loadScenarioTemplatesAbox(repoRoot);
  const edgesAbox = loadEdgesAbox(repoRoot);
  const entityKindsAboxForTemplates = entityKindsAbox;
  if (templatesAbox && edgesAbox) {
    const results = instantiateAllTemplates(
      graph,
      templatesAbox,
      edgesAbox,
      canonicalByEndpoint,
      entityKindsAboxForTemplates,
    );
    // Wipe the ENTIRE templates partition first, then recreate the
    // per-template subdirectories we actually produced. Deriving the
    // wipe set from `results.map(r => r.templateName)` would miss
    // templates removed from the ABox (or whose `appliesTo` changed
    // to match no subject), leaving their previous per-template
    // directory — and stale per-subject JSON inside it — on disk
    // across runs. (#270 review.)
    await rm(getTemplateScenariosRootDir(repoRoot), { recursive: true, force: true });
    const templatesByName = new Set(results.map((r) => r.templateName));
    for (const tplName of templatesByName) {
      const dir = getTemplateScenariosDir(repoRoot, tplName);
      await mkdir(dir, { recursive: true });
    }
    for (const r of results) {
      const file: import('./types.js').TemplateScenarioFile = {
        templateName: r.templateName,
        subjectName: r.subjectName,
        subjectKind: r.subjectKind,
        scenario: r.scenario,
      };
      const dir = getTemplateScenariosDir(repoRoot, r.templateName);
      await writeFile(
        path.join(dir, `${r.subjectName}.json`),
        JSON.stringify(file, null, 2),
        'utf8',
      );
    }
    console.log(
      `Generated ${results.length} template scenario file(s) across ${templatesByName.size} template(s).`,
    );
  }
}

// Only auto-invoke main() when this module is executed directly as a
// CLI (e.g. `node path-analyser/dist/src/index.js`), not when imported
// by another module. Without the guard, importing exported helpers
// under Vitest would kick off the generator pipeline (filesystem
// writes against `generated/`) inside the test process. Standard ESM
// CLI idiom: the module's own URL matches the file URL of
// `process.argv[1]`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

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
    // #304: stamp 409-declaration so the emitter can flag client-minted
    // identifier bindings consumed by this step as `{ unique: true }`,
    // ensuring cross-run identifiers diverge and the second run against
    // the same cluster doesn't 409 on the first run's IDs.
    const declared = graph.operations[opRef.operationId]?.responseLeafPaths;
    if (declared && '409' in declared) {
      step.declares409 = true;
    }
    // The legacy `response.*` valueBindings-driven extract block was
    // retired in #251 — the ABox no longer carries `response.*` entries
    // because the planner now auto-derives the equivalent extracts from
    // `graph.operations[opId].responseSemanticTypes` (populated from
    // `x-semantic-type` on response field schemas). See the producer-
    // step block further down. (The authoritative-producer signal
    // sourced from `x-semantic-provider: [...]` lives on
    // `responseSemanticLeaves[].provider`, not on
    // `responseSemanticTypes` entries; the auto-derive intentionally
    // emits an extract for every annotated leaf, not just
    // provider:true ones, because some scenarios consume non-provider
    // identifier echoes for downstream filters.)
    // Canonical request body synthesis for POST/PUT/PATCH using requestByMediaType
    if (['POST', 'PUT', 'PATCH'].includes(opRef.method)) {
      // #309 Phase A — intentional discovery body wrapping. When the
      // planner stamped a `discoveryIntent` on this opRef (it's the
      // inserted runtimeEmission discovery step, e.g. searchUserTasks
      // for UserTaskKey), emit ONLY the structurally-correct filter
      // wrapper `{ filter: { [filterBy]: '${fromBinding}' } }` and
      // skip the generic semantics synthesis pass. The intent guarantees
      // the upstream producer's binding name (`fromBinding`) was already
      // bound by an earlier step's extract; this step must therefore
      // query for *that exact* runtime-emitted entity, not throw a flat
      // bag of placeholder filters at the server.
      if (opRef.discoveryIntent) {
        const intent = opRef.discoveryIntent;
        step.bodyTemplate = {
          filter: { [intent.filterBy]: `\${${intent.fromBinding}}` },
        };
        step.bodyKind = 'json';
        step.discoveryIntent = intent;
      } else {
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
    // Producer-step auto-derive: emit semantic-labeled extracts from
    // the dependency graph's `responseSemanticTypes` (populated from
    // `x-semantic-type` on response field schemas, including nested
    // paths like `metadata.processInstanceKey` — unlike
    // `extractSchemas.flattenTopLevelFields`, which only sees
    // top-level). Without this, a grafted prerequisite chain could
    // exist but never populate the URL var, leaving `${...Var}`
    // literally in the emitted URL.
    //
    // Pre-#251 the equivalent extracts on FINAL steps were also seeded
    // by the now-retired ABox `response.*` valueBindings (see the
    // comment higher up in this function). Final-step behaviour is
    // preserved by `resp.fields` (top-level leaves) above; nested
    // leaves on a final step were extracted into ctx vars that no
    // later step consumes, so dropping them is behaviour-preserving
    // for runtime semantics. The L3 invariant in
    // configs/camunda-oca/regression-invariants.test.ts pins the
    // specific (op, fieldPath, bind) triples that downstream URL and
    // body templates rely on (each of which appears as a non-final
    // prereq in some scenario, where this block emits it).
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
          // normalise to first-element access.
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
    if (!scenario.bindings[bind]) scenario.bindings[bind] = PENDING_BINDING;
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
      if (!scenario.bindings[placeholderVar]) scenario.bindings[placeholderVar] = PENDING_BINDING;
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

/**
 * Synthesize a single placeholder element for a required `type: array`
 * request-body field whose item shape is described by canonical nodes.
 *
 * Background (#326): the body builder previously emitted `[]` for any
 * required array property without a binding/provider/default. Servers
 * reject that — `required` here is at the property level, but `[]`
 * carries no items, so validation messages like "No elements provided"
 * surface at runtime. The class-scoped fix is to ensure such fields
 * always emit at least one element whose shape honours the item
 * schema's own `required` set (recursive for nested arrays/objects).
 *
 * Strategy:
 *   - Direct children of `<basePath>[]` (i.e. nodes whose path equals
 *     `${basePath}[].${key}` with no further `.` or `[]` in the tail)
 *     describe the item-object's properties.
 *   - For each `required` direct child, emit a value:
 *       - object   → `{}` (matches existing top-level object handling)
 *       - array    → recurse to build a one-element array
 *       - other    → 'placeholder' (string seed; richer binding-aware
 *                    seeding lives in the variant suite)
 *   - If there are no direct children (array of primitives/enums),
 *     emit a string placeholder.
 *
 * Item-schema enums could in principle be sourced from the bundled
 * spec for stricter validity, but the canonical nodes don't carry
 * enum metadata today; the L3 invariant for #326 only requires that
 * the emitted value is not literally `[]`, and the broader live-cluster
 * acceptance is tracked separately.
 */
function synthesizeArrayElement(
  basePath: string,
  nodes: { path: string; type: string; required: boolean }[],
): unknown {
  const prefix = `${basePath}[].`;
  const directChildren = nodes.filter((n) => {
    if (!n.path.startsWith(prefix)) return false;
    const tail = n.path.slice(prefix.length);
    return tail.length > 0 && !tail.includes('.') && !tail.includes('[]');
  });
  if (directChildren.length === 0) {
    // Array of primitives/enums; the canonical node walker doesn't
    // record sub-paths for primitive item types beyond the array node
    // itself. A bare string placeholder is the safest seed.
    return 'placeholder';
  }
  const element: Record<string, unknown> = {};
  for (const child of directChildren) {
    if (!child.required) continue;
    const key = child.path.slice(prefix.length);
    if (child.type === 'object') {
      element[key] = {};
    } else if (child.type === 'array') {
      element[key] = [synthesizeArrayElement(`${basePath}[].${key}`, nodes)];
    } else {
      element[key] = 'placeholder';
    }
  }
  return element;
}

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
      // Top-level array fields are recorded by walkSchema as 'field[]' (with type: 'array').
      // Normalize those to bare name so declaredTypeByLeaf['field'] === 'array'.
      // Guard: stripped path must have no '.' (confirming it's truly top-level, not 'parent.items[]').
      const strippedPath = n.path.endsWith('[]') ? n.path.slice(0, -2) : n.path;
      const isTopLevelArray =
        n.path.endsWith('[]') && !strippedPath.includes('[]') && !strippedPath.includes('.');
      const normalizedPath = isTopLevelArray ? strippedPath : n.path;
      if (!normalizedPath.includes('[]')) {
        const leaf = normalizedPath.split('.').pop() ?? '';
        if (leaf && !declaredTypeByLeaf[leaf]) declaredTypeByLeaf[leaf] = n.type;
      }
    }
  } catch {}
  // Include top-level array required nodes (path ends with '[]', no '[]' or '.' in the base path)
  // so that required array fields like 'moveInstructions' are not silently dropped.
  const requiredFields = nodes.filter((n) => {
    if (!n.required) return false;
    if (!n.path.includes('[]')) return true;
    const strippedPath = n.path.slice(0, -2);
    return n.path.endsWith('[]') && !strippedPath.includes('[]') && !strippedPath.includes('.');
  });
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
  // Auto-derive semantic-type bindings from requestBodySemantics for consumer fields whose
  // semantic type has a graph-level response producer. This avoids the need to manually
  // duplicate x-semantic-type information in ontology-derived valueBindings entries.
  // Filter paths are excluded — those are deferred to issue #168 (setter-chain reuse).
  const semanticFallback: Record<string, string> = {};
  for (const entry of graph.operations[opId]?.requestBodySemantics ?? []) {
    if (entry.fieldPath.startsWith('filter.') || entry.fieldPath.startsWith('filter[')) continue;
    if (bindingMap[entry.fieldPath]) continue;
    // Only auto-derive when the graph has a response-producer for this semantic type.
    // This excludes clientMintedAttribute semantics (Tag, BusinessId) which have no
    // graph-level response producer — those used to be populated by the dedicated
    // bindClientMintedAttribute helper in the feature suite, which was removed in
    // issue #247 because the optional-population scenarios now live exclusively in
    // the variant suite (`generateOptionalSubShapeVariants`).
    if (!graph.producersByType[entry.semantic]?.length) continue;
    semanticFallback[entry.fieldPath] = camelCase(entry.semantic);
  }

  // If JSON and oneOf groups exist, figure out which fields are allowed
  const requestGroups = requestGroupsIndex?.[opId] || [];
  // Load request defaults (operation-level overrides global)
  const defaults = getRequestDefaultsForOperation(opId);
  let allowedFields: Set<string> | undefined;
  let chosenVariantRequired: string[] | undefined;
  let chosenVariant: RequestOneOfVariant | undefined;
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
    chosenVariant = chosen;
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
          const semanticParam = semanticFallback[mappedName];
          const varName = `${camelCase(bindingMap[mappedName] || semanticParam || name || 'value')}Var`;
          const hasBinding = !!(bindingMap[mappedName] || semanticParam);
          if (hasBinding) {
            scenario.bindings ||= {};
            if (!scenario.bindings[varName]) scenario.bindings[varName] = PENDING_BINDING;
            template[name] = `${'${'}${varName}}`;
          } else if (defaults && Object.hasOwn(defaults, name)) {
            template[name] = defaults[name];
          } else if ((declaredTypeByLeaf[name] ?? chosenVariant?.fieldTypes?.[name]) === 'object') {
            // Object-typed required field with no binding: emit {} rather than seeding
            // a string placeholder. An empty object is always a valid JSON value and
            // avoids "Request property [X] cannot be parsed" broker errors (#174 sub-class 1).
            template[name] = {};
          } else if ((declaredTypeByLeaf[name] ?? chosenVariant?.fieldTypes?.[name]) === 'array') {
            // #326 — emit a synthesised one-element array honouring the
            // item schema's own required set rather than `[]`, which
            // servers reject ("No elements provided" etc.).
            template[name] = [synthesizeArrayElement(name, nodes)];
          } else {
            scenario.bindings ||= {};
            if (!scenario.bindings[varName]) scenario.bindings[varName] = PENDING_BINDING;
            template[name] = `${'${'}${varName}}`;
            if (!bindingMap[mappedName]) missing.push(name);
          }
        }
      }
    } else {
      // Non-oneOf: use canonical required flags
      for (const f of requiredFields) {
        // Array nodes are recorded as 'field[]'; strip the suffix for the template key.
        const leaf = f.path.replace(/\[\]$/, '').split('.').pop() ?? '';
        if (allowedFields && !allowedFields.has(leaf)) continue;
        const viaProvider = resolveProvider(opId, leaf, scenario);
        if (viaProvider !== undefined) {
          template[leaf] = viaProvider;
          continue;
        }
        // Special-case: support mapping jobType -> type
        const hasJobType = !!bindingMap.jobType;
        const normalizedPath = f.path.replace(/\[\]$/, '');
        const mapJobTypeToType = leaf === 'type' && !bindingMap[normalizedPath] && hasJobType;
        const semanticParam = semanticFallback[normalizedPath];
        const mappedParamName = mapJobTypeToType
          ? 'jobType'
          : bindingMap[normalizedPath] || semanticParam || leaf || 'value';
        const varName = `${camelCase(mappedParamName)}Var`;
        const hasBinding = mapJobTypeToType
          ? true
          : !!(bindingMap[normalizedPath] || semanticParam);
        if (hasBinding) {
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = PENDING_BINDING;
          template[leaf] = `${'${'}${varName}}`;
        } else if (defaults && Object.hasOwn(defaults, leaf)) {
          template[leaf] = defaults[leaf];
        } else if (f.type === 'object') {
          // Object-typed required field with no binding: emit {} rather than seeding
          // a string placeholder. An empty object is always a valid JSON value and
          // avoids "Request property [X] cannot be parsed" broker errors (#174 sub-class 1).
          template[leaf] = {};
        } else if (f.type === 'array') {
          // #326 — see synthesizeArrayElement docblock. `f.path` is
          // recorded as `<field>[]` for top-level arrays; strip the
          // suffix so the helper's prefix match (`<base>[].<key>`)
          // lines up with the canonical sub-nodes.
          const basePath = f.path.replace(/\[\]$/, '');
          template[leaf] = [synthesizeArrayElement(basePath, nodes)];
        } else {
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = PENDING_BINDING;
          template[leaf] = `${'${'}${varName}}`;
          if (!bindingMap[normalizedPath]) missing.push(normalizedPath);
        }
      }
      // For search-like empty-negative scenarios, allow provider-injected optional filters to drive an empty result
      const isSearchLikeOp = isJobActivatorOp(graph.domain, opId) || /search/i.test(opId);
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
      if (!scenario.bindings[varName]) scenario.bindings[varName] = PENDING_BINDING;
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
    // For job-activator negative-empty scenarios, use config-driven non-existent job type and short requestTimeout
    if (
      isJobActivatorOp(graph.domain, opId) &&
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
      if (!scenario.bindings.jobTypeVar || scenario.bindings.jobTypeVar === PENDING_BINDING) {
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
      if (!kind && isDeploymentGatewayOp(graph.domain, opId)) {
        // Lift 17 / #257: derive the deployment-gateway's default
        // artifact kind from the ABox
        // (`operationArtifactRules[op].rules[0].artifactKind`) instead
        // of a hard-coded `'bpmnProcess'`. Lift 9 / #225 routed the
        // *operation lookup* through the ABox; this completes the chain
        // so the *kind* is also ABox-sourced. A second-API config whose
        // deployment-gateway op produces a different default artifact
        // kind no longer silently coerces to BPMN.
        kind = graph.domain?.operationArtifactRules?.[opId]?.rules?.[0]?.artifactKind;
      }
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
      const hardRequiredStates = computeDeploymentHardRequiredStates(scenario, graph.domain);
      const kindLevelProvides = new Set<string>(
        kind ? (graph.domain?.artifactKinds?.[kind]?.producesStates ?? []) : [],
      );
      const regHit = chooseFixtureFromRegistry(
        kind,
        requiredStates,
        kindLevelProvides,
        hardRequiredStates,
      );
      if (!regHit) {
        // Lift 17 / #257 retired the hard-coded `defaultFixtures` map
        // and the `'@@FILE:bpmn/simple.bpmn'` second-fallback that
        // previously masked this misconfiguration. The L3 invariant
        // "every artifact-kind referenced by an operationArtifactRule
        // resolves to at least one registry fixture" catches the
        // recurring shape of this defect at build time.
        throw new Error(
          `No deployment fixture available for operationId="${opId}", artifactKind="${kind ?? `(unresolved — declare operationRules[operationId="${opId}"].rules[0].artifactKind in the active config's ontology/artifact-kinds.json ABox)`}". ` +
            `Add a fixture entry of kind "${kind ?? '<kind>'}" to the active config's fixtures/deployment-artifacts.json, or declare a default ABox rule under operationRules[operationId="${opId}"].rules. ` +
            `Lift 17 / #257 removed the silent OCA-flavoured fallback (@@FILE:bpmn/simple.bpmn) that previously masked this case.`,
        );
      }
      const fileRef = regHit.ref;
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
    // Wire global context seeds (e.g. tenantIdVar) into multipart fields by
    // matching the seed's `fieldName` against the canonical schema nodes.
    // Each match seeds the planner binding with `__PENDING__` (resolved at
    // emission time by the universal-seed prologue derived from the same
    // `globalContextSeeds` entry — see codegen/playwright/emitter.ts) and
    // substitutes a `${binding}` reference into the multipart fields. Driven
    // entirely from the per-config sidecar so configs without relevant
    // globalContextSeeds entries get no field substitution. Lifts previously
    // hard-coded field/binding name literals out of generic planner code (#200).
    for (const seed of graph.domain?.globalContextSeeds ?? []) {
      const node = nodes.find((n) => n.path === seed.fieldName);
      if (!node) continue;
      scenario.bindings ||= {};
      if (!scenario.bindings[seed.binding]) scenario.bindings[seed.binding] = PENDING_BINDING;
      template.fields[seed.fieldName] = `\${${seed.binding}}`;
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
let artifactsRegistryCache: ArtifactRegistryEntry[] | undefined;
function getArtifactsRegistry(): ArtifactRegistryEntry[] {
  if (artifactsRegistryCache) return artifactsRegistryCache;
  // The fixture registry lives under the active config directory at the repo
  // root (#221 / Lift 11: `configs/<config>/fixtures/deployment-artifacts.json`).
  // Probe both repo-root and path-analyser-relative cwds so the script keeps
  // working from either invocation site, mirroring loadRequestDefaults().
  //
  // Only treat "configs.json absent at this candidate" and ENOENT/ENOTDIR
  // on the registry file as "try the next candidate". Any other error
  // (malformed JSON, EACCES, unknown CONFIG, malformed configs.json) is
  // a real misconfiguration that we surface rather than silently falling
  // back to an empty registry — an empty registry changes planner
  // behaviour (no fixture selection, no providesValues seeding) and would
  // be very confusing to debug.
  const repoRootCandidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  let firstRealError: Error | undefined;
  for (const root of repoRootCandidates) {
    let configDir: string;
    try {
      configDir = getActiveConfigDir(root);
    } catch (err) {
      // configs.json missing or unreadable at this candidate — try next.
      // getActiveConfigDir throws "Failed to read configs.json at <p>: ENOENT…"
      // for the missing-file case; treat any "configs.json"-mentioning error
      // here as "wrong candidate root".
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('configs.json')) continue;
      throw err;
    }
    const p = path.resolve(configDir, 'fixtures', 'deployment-artifacts.json');
    let data: string;
    try {
      data = fsSync.readFileSync(p, 'utf8');
    } catch (err) {
      let code: string | undefined;
      if (err && typeof err === 'object') {
        const c = Reflect.get(err, 'code');
        if (typeof c === 'string') code = c;
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      firstRealError ??= err instanceof Error ? err : new Error(String(err));
      continue;
    }
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
  }
  if (firstRealError) {
    throw new Error(
      `getArtifactsRegistry: failed to read deployment-artifacts.json under any of ` +
        `[${repoRootCandidates.join(', ')}]: ${firstRealError.message}`,
    );
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
 * Selection algorithm:
 *   1. Filter to entries whose `kind` matches.
 *   2. Two-tier match (#305 Phase 3):
 *        a. Keep entries whose effective providesStates is a superset of
 *           `requiredStates` (hard + soft). An empty `requiredStates`
 *           matches every entry — chains that don't impose runtime
 *           characteristics on the fixture fall through to the tie-break.
 *        b. If no entry covers (a) AND `hardRequiredStates` is non-empty,
 *           retry the superset check against `hardRequiredStates` alone.
 *           Hard states (semantic `op.requires`, `runtimeEmission.emittedBy.
 *           guardedBy` guards) are necessary for the chain to function at
 *           runtime; soft states (`chainCleanupRequires`) are hygiene
 *           preferences that may legitimately conflict with a hard
 *           requirement — e.g. a self-completing BPMN cannot simultaneously
 *           contain a user-task element. Correctness wins over hygiene.
 *   3. Tie-break across surviving candidates: smallest |entry.providesStates|
 *      wins (most specific match; fewer extra states the chain didn't ask
 *      for). Ties break by array order in the registry.
 *
 * Returns the chosen entry's `@@FILE:<path>` ref plus its `providesValues`
 * (the per-fixture modelDerived value source — #162 PR 1), or `undefined`
 * when no entry of the right kind exists at all.
 *
 * When neither (a) nor (b) finds a covering candidate (a real
 * misconfiguration — the chain asked for a state nothing provides), the
 * function still returns the first entry of that kind so the caller can
 * emit a runnable suite; the diagnostic should be caught earlier by the
 * fixture-registry validator or the bundled-spec invariants.
 *
 * `hardRequiredStates` is optional — callers that don't compute a hard/
 * soft split pass `undefined` and get single-tier (a)-only selection.
 */
function chooseFixtureFromRegistry(
  kind: string | undefined,
  requiredStates: ReadonlySet<string>,
  kindLevelProvides: ReadonlySet<string>,
  hardRequiredStates?: ReadonlySet<string>,
): { ref: string; providesValues?: Record<string, string[]> } | undefined {
  if (!kind) return undefined;
  const candidates = getArtifactsRegistry().filter((e) => e.kind === kind);
  if (candidates.length === 0) return undefined;

  const effectiveProvides = (e: { providesStates?: string[] }) => {
    const provides = new Set<string>(kindLevelProvides);
    for (const s of e.providesStates ?? []) provides.add(s);
    return provides;
  };
  const isSuperset = (provides: Set<string>, required: ReadonlySet<string>) => {
    for (const r of required) if (!provides.has(r)) return false;
    return true;
  };

  // Two-tier selection (#305 Phase 3): try the full requirement set first
  // (hard + soft). If nothing covers, drop the soft `chainCleanupRequires`
  // bias and retry with hardRequiredStates alone — hard states (semantic
  // op.requires, runtimeEmission `emittedBy.guardedBy` guards) are
  // necessary for the chain to function at runtime; soft states are
  // hygiene preferences that may legitimately conflict with a hard
  // requirement (e.g. a self-completing BPMN can't also contain a
  // user-task element). Only when no fixture covers the hard set
  // either do we fall through to the first registered candidate.
  let covers = candidates.filter((e) => isSuperset(effectiveProvides(e), requiredStates));
  if (covers.length === 0 && hardRequiredStates && hardRequiredStates.size > 0) {
    covers = candidates.filter((e) => isSuperset(effectiveProvides(e), hardRequiredStates));
  }

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
 * Compute the set of runtime states the deployment-gateway step in a chain
 * must provide. Walks every operation in the scenario chain, accumulating
 * required states from `operationRequirements.<op>.requires` and from the
 * post-condition hygiene set `chainCleanupRequires` (#249), then subtracts
 * states produced by any non-deployment-gateway op in the chain (those are
 * satisfied by their own producer step, not by the deployment gateway). The
 * chain is BFS-ordered with producers before their consumers, so a simple
 * unordered subtraction is equivalent to a left-to-right walk here.
 *
 * `chainCleanupRequires` differs from `requires` in that it is INVISIBLE to
 * the BFS scenario planner — it never gates feasibility, never schedules a
 * producer op, and never filters the consumer op out of the scenario set.
 * It exists solely to bias fixture selection toward fixtures that leave the
 * broker in the desired terminal state (e.g. a self-completing BPMN process
 * for `createProcessInstance`'s base scenario, so the test doesn't strand
 * a running instance). Subsequent ops in the chain whose `produces` /
 * `implicitAdds` cover the state discharge the hygiene requirement.
 *
 * The deployment-gateway op is identified via `isDeploymentGatewayOp`
 * (Lift 9 / #225 — see `ontology/operationRoles.ts`), not by a hard-coded
 * operationId.
 *
 * Returns the residual — states that have to come from the
 * deployment-gateway step's fixture selection. An empty set means any
 * fixture of the right kind is acceptable.
 */
function computeDeploymentRequiredStates(
  scenario:
    | { operations?: ReadonlyArray<{ operationId: string }>; producedSemanticTypes?: string[] }
    | undefined,
  domain: DomainSemantics | undefined,
): Set<string> {
  const result = new Set<string>();
  if (!scenario?.operations || !domain?.operationRequirements) return result;
  const opReqs = domain.operationRequirements;
  for (const opRef of scenario.operations) {
    const req = opReqs[opRef.operationId];
    if (!req) continue;
    for (const s of req.requires ?? []) result.add(s);
    for (const s of req.chainCleanupRequires ?? []) result.add(s);
  }
  for (const g of collectRuntimeEmissionGuards(scenario, domain)) result.add(g);
  // States produced by non-deployment-gateway ops earlier in the chain are
  // satisfied by their own producer step; the deployment gateway doesn't
  // need to provide them. The deployment-gateway op is identified via the
  // ABox role lookup (Lift 9 / #225) instead of a hard-coded literal.
  for (const opRef of scenario.operations) {
    if (isDeploymentGatewayOp(domain, opRef.operationId)) continue;
    const req = opReqs[opRef.operationId];
    if (!req) continue;
    for (const s of req.produces ?? []) result.delete(s);
    for (const s of req.implicitAdds ?? []) result.delete(s);
  }
  return result;
}

/**
 * #305 Phase 3 — the **hard** subset of deployment-required states: those
 * whose absence would break the chain at runtime (semantic op.requires +
 * runtimeEmission `emittedBy.guardedBy` guards), excluding the soft
 * hygiene preferences from `chainCleanupRequires`. Used by the fixture
 * selector as a fallback predicate when no candidate covers the full
 * (hard ∪ soft) requirement set — a self-completing BPMN can't
 * simultaneously contain a user-task element, so the selector must
 * privilege correctness over hygiene.
 */
function computeDeploymentHardRequiredStates(
  scenario:
    | { operations?: ReadonlyArray<{ operationId: string }>; producedSemanticTypes?: string[] }
    | undefined,
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
  for (const g of collectRuntimeEmissionGuards(scenario, domain)) result.add(g);
  for (const opRef of scenario.operations) {
    if (isDeploymentGatewayOp(domain, opRef.operationId)) continue;
    const req = opReqs[opRef.operationId];
    if (!req) continue;
    for (const s of req.produces ?? []) result.delete(s);
    for (const s of req.implicitAdds ?? []) result.delete(s);
  }
  return result;
}

/**
 * Walk the scenario's `producedSemanticTypes` and yield every
 * `emittedBy.guardedBy` capability declared by a `runtimeEmission`
 * semantic type in the ABox. Shared by `computeDeploymentRequiredStates`
 * and `computeDeploymentHardRequiredStates`.
 */
function collectRuntimeEmissionGuards(
  scenario:
    | { producedSemanticTypes?: string[]; operations?: ReadonlyArray<{ operationId: string }> }
    | undefined,
  domain: DomainSemantics | undefined,
): string[] {
  const out: string[] = [];
  const semantics = domain?.semanticTypes;
  if (!semantics || !scenario) return out;
  const seen = new Set<string>();
  for (const s of scenario.producedSemanticTypes ?? []) {
    const decl = semantics[s];
    if (decl?.kind === 'runtimeEmission' && decl.emittedBy?.guardedBy) {
      for (const g of decl.emittedBy.guardedBy) {
        if (!seen.has(g)) {
          seen.add(g);
          out.push(g);
        }
      }
    }
  }
  // Feature/variant scenarios are cloned from the canonical scenario with
  // `producedSemanticTypes` stripped (overlay rebuild). Re-derive the
  // guards by scanning operations for any `runtimeEmission` semantic whose
  // `discoveredVia.operationId` appears in the chain — that's the
  // structural signal that the planner expanded a runtimeEmission for
  // this scenario, independent of whether `producedSemanticTypes` was
  // re-hydrated.
  const opIds = new Set((scenario.operations ?? []).map((o) => o.operationId));
  if (opIds.size > 0) {
    for (const decl of Object.values(semantics)) {
      if (
        decl?.kind === 'runtimeEmission' &&
        decl.discoveredVia?.operationId &&
        opIds.has(decl.discoveredVia.operationId) &&
        decl.emittedBy?.guardedBy
      ) {
        for (const g of decl.emittedBy.guardedBy) {
          if (!seen.has(g)) {
            seen.add(g);
            out.push(g);
          }
        }
      }
    }
  }
  return out;
}
