import fsSync from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalShapes } from './canonicalSchemas.js';
import { writeExtractionOutputs } from './extractSchemas.js';
import { generateFeatureCoverageForEndpoint } from './featureCoverageGenerator.js';
import { loadGraph, loadOpenApiSemanticHints } from './graphLoader.js';
import { generateScenariosForEndpoint } from './scenarioGenerator.js';
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
  await mkdir(outputDir, { recursive: true });
  await mkdir(featureDir, { recursive: true });

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
  const semanticTypes = Object.keys(graph.bySemanticProducer || {});
  const { requestIndex, responses } = await writeExtractionOutputs(baseDir, semanticTypes);
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
    const collection = generateScenariosForEndpoint(graph, op.operationId, { maxScenarios: 20 });
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
        s.requestPlan = buildRequestPlan(s, resp, graph, canonical, requestIndex.byOperation);
      }
    }
    const fileName = normalizeEndpointFileName(op.method, op.path);
    await writeFile(path.join(outputDir, fileName), JSON.stringify(collection, null, 2), 'utf8');
    // Feature coverage scenarios (enhanced with integration chain + rudimentary body synthesis)
    const featureCollection = generateFeatureCoverageForEndpoint(graph, op.operationId, {
      requestVariants: requestIndex.byOperation[op.operationId],
    });
    // Expand schema-missing-required into combinations (cap at 35) before planning
    {
      const baseScenarios = featureCollection.scenarios;
      const expanded: EndpointScenario[] = [];
      const requiredFields = getRequiredRequestLeafFields(op.operationId, canonical);
      const hasSchemaMissing = baseScenarios.some(
        (s) => typeof s.variantKey === 'string' && s.variantKey.includes('schemaMissingRequired'),
      );
      const hasSchemaWrongType = baseScenarios.some(
        (s) => typeof s.variantKey === 'string' && s.variantKey.includes('schemaWrongType'),
      );
      if (requiredFields.length && hasSchemaMissing) {
        const originals = baseScenarios.filter(
          (s) => typeof s.variantKey === 'string' && s.variantKey.includes('schemaMissingRequired'),
        );
        const others = baseScenarios.filter(
          (s) =>
            !(typeof s.variantKey === 'string' && s.variantKey.includes('schemaMissingRequired')),
        );
        expanded.push(...others);
        // generate subsets of fields to include (missing others): sizes 0..n-1, cap 15
        const fields = [...requiredFields].sort();
        const cap = 35;
        let budget = cap;
        for (let k = 0; k <= Math.max(0, fields.length - 1) && budget > 0; k++) {
          const combos = k === 0 ? [[]] : k === fields.length ? [] : kCombinations(fields, k);
          for (const combo of combos) {
            if (budget <= 0) break;
            for (const orig of originals) {
              const clone: EndpointScenario = {
                ...orig,
                id: `${orig.id}-mr-${k}-${expanded.length + 1}`,
              };
              clone.schemaMissingInclude = combo;
              // Pre-compute suppress list (required fields not in include)
              const requiredClusterOverrides: Record<string, string[]> = {
                activateJobs: ['type', 'timeout', 'maxJobsToActivate'],
              };
              const cluster = fields.length
                ? fields
                : requiredClusterOverrides[op.operationId] || fields;
              clone.schemaMissingSuppress = cluster.filter((f) => !combo.includes(f));
              // CONTRACT: schemaMissingInclude lists the required fields we intentionally KEEP.
              // schemaMissingSuppress lists required fields (including endpoint-specific cluster augmentations)
              // we intentionally DROP. Synthesis will skip or remove suppressed fields in one final pass so
              // emitter stays generic.
              clone.name = `${orig.name} [include=${combo.join(',') || '∅'}]`;
              clone.description = `${orig.description || ''} Include only: ${combo.join(',') || '∅'}.`;
              expanded.push(clone);
              budget--;
              if (budget <= 0) break;
            }
          }
        }
        featureCollection.scenarios = expanded;
      }
      // Expand wrong-type negatives similarly, but operate on a small subset of fields to keep within cap
      if (requiredFields.length && hasSchemaWrongType) {
        const base = featureCollection.scenarios;
        const originals = base.filter(
          (s) => typeof s.variantKey === 'string' && s.variantKey.includes('schemaWrongType'),
        );
        const others = base.filter(
          (s) => !(typeof s.variantKey === 'string' && s.variantKey.includes('schemaWrongType')),
        );
        const result: EndpointScenario[] = [];
        result.push(...others);
        const fields = [...requiredFields].sort();
        // SUPPRESSION: If no candidate fields (after any future filtering) skip emitting placeholder wrong-type scenarios.
        if (!fields.length) {
          featureCollection.scenarios = result; // drop originals entirely
          continue; // proceed to next endpoint
        }
        const capWT = 50; // new expanded cap for wrong-type scenarios per endpoint
        let budget = capWT; // allow up to capWT (will naturally be much smaller for small R)
        // Create single-field wrong-type and small pairs first
        const combos1: string[][] = fields.map((f) => [f]);
        for (const c of combos1) {
          if (budget <= 0) break;
          for (const orig of originals) {
            const clone: EndpointScenario = {
              ...orig,
              id: `${orig.id}-wt-1-${result.length + 1}`,
            };
            clone.schemaWrongTypeInclude = c;
            clone.name = `${orig.name} [wrongType=${c.join('+')}]`;
            clone.description = `${orig.description || ''} Wrong type fields: ${c.join(',')}.`;
            result.push(clone);
            budget--;
            if (budget <= 0) break;
          }
        }
        // Optionally add a couple of 2-field combos if budget remains
        if (budget > 0) {
          const combos2 = kCombinations(fields, 2);
          for (const c of combos2) {
            if (budget <= 0) break;
            for (const orig of originals) {
              const clone: EndpointScenario = {
                ...orig,
                id: `${orig.id}-wt-2-${result.length + 1}`,
              };
              clone.schemaWrongTypeInclude = c;
              clone.name = `${orig.name} [wrongType=${c.join('+')}]`;
              clone.description = `${orig.description || ''} Wrong type fields: ${c.join(',')}.`;
              result.push(clone);
              budget--;
              if (budget <= 0) break;
            }
          }
        }
        // If field count small (<=4) add higher-order combos (triples and full set) for comprehensive coverage
        if (fields.length <= 4 && budget > 0) {
          if (fields.length >= 3) {
            // triples (if R=3 this is also the full set, still treat as size 3 label)
            const combos3 = kCombinations(fields, 3);
            for (const c of combos3) {
              if (budget <= 0) break;
              for (const orig of originals) {
                const clone: EndpointScenario = {
                  ...orig,
                  id: `${orig.id}-wt-3-${result.length + 1}`,
                };
                clone.schemaWrongTypeInclude = c;
                clone.name = `${orig.name} [wrongType=${c.join('+')}]`;
                clone.description = `${orig.description || ''} Wrong type fields: ${c.join(',')}.`;
                result.push(clone);
                budget--;
                if (budget <= 0) break;
              }
            }
          }
          if (fields.length === 4 && budget > 0) {
            // full set (size 4)
            const c = [...fields];
            for (const orig of originals) {
              if (budget <= 0) break;
              const clone: EndpointScenario = {
                ...orig,
                id: `${orig.id}-wt-4-${result.length + 1}`,
              };
              clone.schemaWrongTypeInclude = c;
              clone.name = `${orig.name} [wrongType=${c.join('+')}]`;
              clone.description = `${orig.description || ''} Wrong type fields: ${c.join(',')}.`;
              result.push(clone);
              budget--;
            }
          }
          if (fields.length === 3 && budget > 0) {
            // For R=3 add explicit full set (already produced as triple but ensure label consistency if desired)
            // (Skip duplicate if already added by combos3)
          }
        }
        featureCollection.scenarios = result;
      }
    }
    // Final guardrail: enforce max scenarios per endpoint after expansions (cap 35)
    const MAX_FEATURE_SCENARIOS = 90; // raised to accommodate expanded wrong-type coverage
    if (featureCollection.scenarios.length > MAX_FEATURE_SCENARIOS) {
      featureCollection.scenarios = featureCollection.scenarios.slice(0, MAX_FEATURE_SCENARIOS);
    }
    // Post-expansion cleanup: remove placeholder wrong-type scenarios that ended up with no fields to mutate
    featureCollection.scenarios = featureCollection.scenarios.filter((sc) => {
      const vk = sc.variantKey;
      if (typeof vk === 'string' && vk.includes('schemaWrongType')) {
        const incl = sc.schemaWrongTypeInclude;
        if (!Array.isArray(incl) || incl.length === 0) {
          return false; // drop
        }
      }
      return true;
    });
    // Choose a representative integration scenario to supply dependency chain (shortest non-unsatisfied with >1 ops; fallback scenario-1)
    const integrationCandidates = collection.scenarios.filter((sc) => sc.id !== 'unsatisfied');
    const chainSource =
      integrationCandidates
        .filter((sc) => sc.operations.length > 1)
        .sort((a, b) => a.operations.length - b.operations.length)[0] || integrationCandidates[0];
    if (resp) {
      for (const s of featureCollection.scenarios) {
        // Graft chain if available and feature scenario currently only has endpoint op
        // Special-case: for search-like empty-negative, skip grafting to produce an empty result without prerequisites
        const isSearchLikeOp =
          (op.method.toUpperCase() === 'POST' && /\/search$/.test(op.path)) ||
          /search/i.test(op.operationId) ||
          op.operationId === 'activateJobs';
        const isEmptyNeg = s.expectedResult && s.expectedResult.kind === 'empty';
        const isOneOfPair =
          Array.isArray(s.requestVariants) &&
          s.requestVariants.some(
            (rv) => typeof rv.variant === 'string' && rv.variant.startsWith('pair:'),
          );
        const isUnionAll =
          Array.isArray(s.exclusivityViolations) &&
          s.exclusivityViolations.some((t) => t.includes('oneOf:') && t.endsWith('union-all'));
        const skipGraft = (isSearchLikeOp && isEmptyNeg) || isUnionAll || isOneOfPair;
        if (
          !skipGraft &&
          chainSource &&
          s.operations.length === 1 &&
          chainSource.operations.length > 1
        ) {
          s.operations = chainSource.operations.map((o) => ({ ...o }));
        }
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
        s.requestPlan = buildRequestPlan(s, resp, graph, canonical, requestIndex.byOperation);
        // Carry forward suppress metadata (already on scenario) no action needed here except sanity (noop)
        // Consolidation fix: ensure schemaMissingRequired variants truly omit excluded required fields
        try {
          const isMissingReq =
            typeof s.variantKey === 'string' && s.variantKey.includes('schemaMissingRequired');
          const includeArr: string[] | undefined = Array.isArray(s.schemaMissingInclude)
            ? s.schemaMissingInclude
            : undefined;
          if (isMissingReq && includeArr) {
            const finalStep = s.requestPlan?.[s.requestPlan.length - 1];
            const bodyTpl = finalStep?.bodyTemplate;
            if (finalStep && finalStep.bodyKind === 'json' && isPlainRecord(bodyTpl)) {
              const reqFields = getRequiredRequestLeafFields(op.operationId, canonical);
              for (const rf of reqFields) {
                if (!includeArr.includes(rf) && Object.hasOwn(bodyTpl, rf)) {
                  delete bodyTpl[rf];
                }
              }
            }
          }
        } catch {}
        // Validation: for JSON requests with oneOf groups, non-negative scenarios must set exactly one variant's required keys
        try {
          const final = s.requestPlan?.[s.requestPlan.length - 1];
          const groups = requestIndex.byOperation[op.operationId] || [];
          const isError = s.expectedResult && s.expectedResult.kind === 'error';
          const unionViolation =
            Array.isArray(s.exclusivityViolations) &&
            s.exclusivityViolations.some(
              (t: string) => t.includes('oneOf:') && t.endsWith('union-all'),
            );
          if (
            final?.bodyKind === 'json' &&
            final?.bodyTemplate &&
            groups.length &&
            !isError &&
            !unionViolation
          ) {
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
        // Inject detailed wrong-type mapping into scenario name for clarity (expectedType -> sentType per field)
        try {
          if (
            s.schemaWrongTypeInclude &&
            Array.isArray(s.schemaWrongTypeDetail) &&
            s.schemaWrongTypeDetail.length
          ) {
            const det = s.schemaWrongTypeDetail;
            const count = det.length;
            const segments = det.map(
              (d, i) => `${i === 0 ? '' : ' | + '}${d.field}: ${d.expectedType} -> ${d.sentType}`,
            );
            const mapping = segments.join('');
            if (s.name && /negative wrong type/.test(s.name)) {
              s.name = s.name.replace(
                /negative wrong type \([^)]*\)/,
                `negative wrong type (${count})`,
              );
              // Remove any existing [wrongType=...] suffix then append our detailed mapping
              s.name = s.name.replace(/\s\[wrongType=[^\]]*\]$/, '');
              s.name = `${s.name} [wrongType=${mapping}]`;
            }
          }
        } catch {}
      }
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
      expect: { status: determineExpectedStatus(scenario, resp, isFinal) },
    };
    // Domain valueBindings driven response extraction (non-final steps included)
    const opDom = graph.domain?.operationRequirements?.[opRef.operationId];
    if (opDom?.valueBindings) {
      const extracts: { fieldPath: string; bind: string; note?: string }[] = [];
      for (const [k, v] of Object.entries(opDom.valueBindings)) {
        if (!k.startsWith('response.')) continue; // only handle response mappings here
        const fieldPathRaw = k.slice('response.'.length); // canonical path with [] markers
        const norm = fieldPathRaw.replace(/\[\]/g, '[0]'); // first element access for arrays
        // Determine target variable name based on parameter portion after last '.' in mapping (state.parameter)
        const mapping = v;
        const paramPart = mapping.split('.').pop() ?? '';
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
  return steps;
}

function determineExpectedStatus(
  scenario: EndpointScenario,
  resp: ResponseShapeSummary | undefined,
  isFinal: boolean,
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
  return resp?.successStatus || (isFinal ? 200 : 200);
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
      template: { fields: Record<string, string>; files: Record<string, string> };
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
  // Bindings map from domain valueBindings (request.* -> state.parameter)
  const opDom = graph.domain?.operationRequirements?.[opId];
  const bindingMap: Record<string, string> = {};
  if (opDom?.valueBindings) {
    for (const [k, v] of Object.entries<string>(opDom.valueBindings)) {
      if (k.startsWith('request.')) {
        const raw = k.slice('request.'.length);
        bindingMap[raw] = v.split('.').pop() ?? ''; // take parameter name
      }
    }
  }
  // If JSON and oneOf groups exist, figure out which fields are allowed
  const requestGroups = requestGroupsIndex?.[opId] || [];
  // Load request defaults (operation-level overrides global)
  const defaults = getRequestDefaultsForOperation(opId);
  let allowedFields: Set<string> | undefined;
  let forceUnionAll = false;
  let chosenVariantRequired: string[] | undefined;
  let unionFieldsForGroup: string[] | undefined;
  let pairFields: string[] | undefined;
  if (chosenCt === 'application/json' && requestGroups.length) {
    // Determine selected variant for endpoint scenarios
    const selected = isEndpoint ? scenario.requestVariants?.[0] : undefined;
    const groupId = selected?.groupId || requestGroups[0]?.groupId;
    const group = requestGroups.find((g) => g.groupId === groupId) || requestGroups[0];
    unionFieldsForGroup = group?.unionFields || [];
    // Detect pairwise negative (requestVariantName: 'pair:a+b')
    if (
      isEndpoint &&
      selected?.variant &&
      typeof selected.variant === 'string' &&
      selected.variant.startsWith('pair:')
    ) {
      const pair = selected.variant.slice('pair:'.length);
      const parts = pair.split('+').filter(Boolean);
      if (parts.length === 2) {
        pairFields = parts;
        allowedFields = new Set(parts);
      }
    } else if (
      isEndpoint &&
      scenario.exclusivityViolations?.includes(`oneOf:${groupId}:union-all`)
    ) {
      // Negative: include union of all fields to provoke 400
      forceUnionAll = true;
      allowedFields = new Set(group.unionFields);
    } else {
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
  }
  // Build template
  if (chosenCt === 'application/json') {
    const template: Record<string, unknown> = {};
    const missing: string[] = [];
    // Detect missing-required negative either by original variantKey marker or by presence of expansion metadata
    const isSchema400Neg =
      (scenario?.variantKey &&
        typeof scenario.variantKey === 'string' &&
        scenario.variantKey.includes('schemaMissingRequired')) ||
      Array.isArray(scenario.schemaMissingInclude);
    const isSchemaWrongType =
      scenario?.variantKey &&
      typeof scenario.variantKey === 'string' &&
      scenario.variantKey.includes('schemaWrongType');
    const includeSet: Set<string> | undefined =
      isSchema400Neg && Array.isArray(scenario.schemaMissingInclude)
        ? new Set(scenario.schemaMissingInclude)
        : undefined;
    const omitSet: Set<string> | undefined =
      isSchema400Neg && Array.isArray(scenario.schemaMissingSuppress)
        ? new Set(scenario.schemaMissingSuppress)
        : undefined;
    const wrongTypeSet: Set<string> | undefined =
      isSchemaWrongType && Array.isArray(scenario.schemaWrongTypeInclude)
        ? new Set(scenario.schemaWrongTypeInclude)
        : undefined;
    // If wrong-type negative, populate detailed mapping (expectedType -> sentType) for test naming later.
    if (wrongTypeSet?.size) {
      const detail: { field: string; expectedType: string; sentType: string }[] = [];
      for (const f of Array.from(wrongTypeSet)) {
        const expectedType = (declaredTypeByLeaf[f] || 'unknown').toLowerCase();
        const sentVal = chooseWrongTypeValue(declaredTypeByLeaf[f]);
        let sentType: string = typeof sentVal;
        // Map JS typeof to schema-like type names for readability
        if (Array.isArray(sentVal)) sentType = 'array';
        if (sentVal === null) sentType = 'null';
        // Persist mapping (we also still need to actually apply wrong-type assignment below in synthesis)
        detail.push({ field: f, expectedType, sentType });
      }
      scenario.schemaWrongTypeDetail = detail;
    }
    if (requestGroups.length) {
      // oneOf-aware synthesis
      if (pairFields && pairFields.length === 2) {
        for (const name of pairFields) {
          const viaProvider = resolveProvider(opId, name, scenario);
          if (viaProvider !== undefined) {
            template[name] = viaProvider;
            continue;
          }
          const varName = `${camelCase(bindingMap[name] || name || 'value')}Var`;
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
          // If wrong-type negative applies for this field, inject a mismatched type
          if (wrongTypeSet?.has(name)) {
            template[name] = chooseWrongTypeValue(declaredTypeByLeaf[name]);
          } else {
            template[name] = `${'${'}${varName}}`;
          }
          if (!bindingMap[name]) missing.push(name);
        }
      } else if (forceUnionAll && unionFieldsForGroup) {
        for (const name of unionFieldsForGroup) {
          const viaProvider = resolveProvider(opId, name, scenario);
          if (viaProvider !== undefined) {
            template[name] = viaProvider;
            continue;
          }
          const varName = `${camelCase(bindingMap[name] || name || 'value')}Var`;
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
          if (wrongTypeSet?.has(name)) {
            template[name] = chooseWrongTypeValue(declaredTypeByLeaf[name]);
          } else {
            template[name] = `${'${'}${varName}}`;
          }
          if (!bindingMap[name]) missing.push(name);
        }
      } else if (chosenVariantRequired?.length) {
        for (const name of chosenVariantRequired) {
          if (omitSet?.has(name)) continue;
          if (includeSet && !includeSet.has(name)) continue; // omit required not selected for include
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
            if (wrongTypeSet?.has(name)) {
              template[name] = chooseWrongTypeValue(declaredTypeByLeaf[name]);
            } else {
              template[name] = `${'${'}${varName}}`;
            }
          } else if (defaults && Object.hasOwn(defaults, name)) {
            if (wrongTypeSet?.has(name)) {
              template[name] = chooseWrongTypeValue(declaredTypeByLeaf[name]);
            } else {
              template[name] = defaults[name];
            }
          } else {
            scenario.bindings ||= {};
            if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
            if (wrongTypeSet?.has(name)) {
              template[name] = chooseWrongTypeValue(declaredTypeByLeaf[name]);
            } else {
              template[name] = `${'${'}${varName}}`;
            }
            if (!bindingMap[mappedName]) missing.push(name);
          }
        }
      }
    } else {
      // Non-oneOf: use canonical required flags
      for (const f of requiredFields) {
        const leaf = f.path.split('.').pop() ?? '';
        if (omitSet?.has(leaf)) continue;
        if (includeSet && !includeSet.has(leaf)) continue; // omit required not selected for include
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
          if (wrongTypeSet?.has(leaf)) {
            template[leaf] = chooseWrongTypeValue(declaredTypeByLeaf[leaf]);
          } else {
            template[leaf] = `${'${'}${varName}}`;
          }
        } else if (defaults && Object.hasOwn(defaults, leaf)) {
          if (wrongTypeSet?.has(leaf)) {
            template[leaf] = chooseWrongTypeValue(declaredTypeByLeaf[leaf]);
          } else {
            template[leaf] = defaults[leaf];
          }
        } else {
          scenario.bindings ||= {};
          if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
          if (wrongTypeSet?.has(leaf)) {
            template[leaf] = chooseWrongTypeValue(declaredTypeByLeaf[leaf]);
          } else {
            template[leaf] = `${'${'}${varName}}`;
          }
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
      if (allowedFields && !allowedFields.has(leaf) && !forceUnionAll) continue;
      // For schemaMissingRequired negatives, do not re-add omitted required fields
      if (
        isSchema400Neg &&
        includeSet &&
        !includeSet.has(leaf) &&
        requiredFields.some(
          (rf) => rf.path.endsWith(`.${leaf}`) || rf.path.split('.').pop() === leaf,
        )
      )
        continue;
      const varName = `${camelCase(param)}Var`;
      scenario.bindings ||= {};
      if (!scenario.bindings[varName]) scenario.bindings[varName] = '__PENDING__';
      if (template[leaf] === undefined) {
        if (wrongTypeSet?.has(leaf)) {
          template[leaf] = chooseWrongTypeValue(declaredTypeByLeaf[leaf]);
        } else {
          template[leaf] = `${'${'}${varName}}`;
        }
      }
    }
    // Post-process: if jobType binding exists but schema expects 'type', prefer mapping into 'type'
    if (bindingMap.jobType) {
      const jtVar = 'jobTypeVar';
      if (template.type === undefined) {
        // If this is a schema-missing-required negative and 'type' was intentionally omitted, do NOT map it in.
        if (
          !(isSchema400Neg && (omitSet?.has('type') || (includeSet && !includeSet.has('type'))))
        ) {
          template.type = `${'${'}${jtVar}}`;
        }
      }
      // ensure we don't carry a non-schema jobType field
      if (!leafSet.has('jobType')) delete template.jobType;
    }
    // Final single-pass omission enforcement (contract):
    // - schemaMissingInclude = fields we intentionally keep
    // - schemaMissingSuppress = fields we intentionally drop (precomputed)
    // We compute union of: requiredFields (canonical), chosenVariantRequired (oneOf), plus endpoint cluster hint for activateJobs.
    if (isSchema400Neg && (includeSet || omitSet)) {
      const unionRequired = new Set<string>();
      for (const f of requiredFields) {
        const leaf = f.path.split('.').pop();
        if (leaf) unionRequired.add(leaf);
      }
      for (const n of chosenVariantRequired || []) unionRequired.add(n);
      if (opId === 'activateJobs')
        ['type', 'timeout', 'maxJobsToActivate'].forEach((n) => {
          unionRequired.add(n);
        });
      for (const n of unionRequired) {
        const shouldKeep = includeSet ? includeSet.has(n) : false;
        const explicitlyDrop = omitSet ? omitSet.has(n) : false;
        if ((!shouldKeep || explicitlyDrop) && Object.hasOwn(template, n)) delete template[n];
      }
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
    const template: { fields: Record<string, string>; files: Record<string, string> } = {
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

// -------- Helpers for schema-missing-required expansion ---------
function getRequiredRequestLeafFields(
  opId: string,
  canonical: Record<string, CanonicalShape>,
): string[] {
  const shape = canonical[opId];
  if (!shape?.requestByMediaType) return [];
  const nodes = shape.requestByMediaType['application/json'] || [];
  const fields = nodes
    .filter((n) => n.required && !n.path.includes('[]'))
    .map((n) => n.path.split('.').pop() ?? '')
    .filter(Boolean);
  return Array.from(new Set(fields));
}

function kCombinations<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const n = arr.length;
  if (k <= 0 || k > n) return res;
  const idx = Array.from({ length: k }, (_, i) => i);
  const take = () => res.push(idx.map((i) => arr[i]));
  while (true) {
    take();
    let i: number;
    for (i = k - 1; i >= 0; i--) {
      if (idx[i] !== i + n - k) break;
    }
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return res;
}

// Choose a deliberately wrong-type value for a field given its declared type.
// Strategy keeps values primitive & JSON-serializable while maximizing mismatch likelihood.
function chooseWrongTypeValue(declared?: string): unknown {
  switch ((declared || '').toLowerCase()) {
    case 'string':
      return 12345; // number for string
    case 'number':
    case 'integer':
      return 'not-a-number'; // string for numeric
    case 'boolean':
      return 'NOT_A_BOOLEAN'; // clearly non-boolean string
    case 'array':
      return {}; // object for array
    case 'object':
      return 42; // number for object
    default:
      return null; // unexpected type -> null (often invalid if not nullable)
  }
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
