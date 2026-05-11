import { describe, expect, test } from 'vitest';
import {
  PlaywrightEmitter,
  renderPlaywrightSuite,
} from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

// Class-scoped guard for the `recordResponses` codegen option
// (configs.json#configs.<active>.codegen.playwright.recordResponses). The
// option gates two related emissions in lockstep — the import statement
// for `recordResponse`/`sanitizeBody` and the per-step
// `try { ... await recordResponse({...}) ... } catch {}` block — so a future
// regression that flips only one of them (leaving a dangling import or an
// orphan call) will fail one of the assertions below.
const COLLECTION_WITH_STEP: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          expect: { status: 200 },
          bodyTemplate: { name: 'static' },
        },
      ],
    },
  ],
};

describe('emitter: recordResponses option gates recorder import + per-step call', () => {
  test('recordResponses=true emits both the import and the per-step recordResponse block', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION_WITH_STEP, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: true,
    });
    expect(file.content).toContain(
      "import { recordResponse, sanitizeBody } from './support/recorder';",
    );
    expect(file.content).toContain('await recordResponse({');
    expect(file.content).toContain('sanitizeBody(bodyJson)');
  });

  test('recordResponses=false drops both the import and the per-step recordResponse block', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION_WITH_STEP, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: false,
    });
    // Neither symbol may appear anywhere — the gate must lift the import
    // (otherwise the suite has a dead import that biome would flag) AND
    // the call (otherwise the suite references an unimported symbol).
    expect(file.content).not.toContain('recordResponse');
    expect(file.content).not.toContain('sanitizeBody');
    expect(file.content).not.toContain("from './support/recorder'");
  });

  test('recordResponses omitted defaults to the recording behaviour (preserves pre-config emit)', async () => {
    // Defaulting to `true` keeps the pre-option output byte-stable: a caller
    // that never sets the field must see the same suite the previous
    // generator emitted.
    const [withDefault] = await PlaywrightEmitter.emit(COLLECTION_WITH_STEP, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    const [withExplicitTrue] = await PlaywrightEmitter.emit(COLLECTION_WITH_STEP, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: true,
    });
    expect(withDefault.content).toBe(withExplicitTrue.content);
    expect(withDefault.content).toContain('await recordResponse({');
  });

  test('renderPlaywrightSuite honours the option independently of the Emitter wrapper', async () => {
    // The pure render function and the Emitter wrapper both flow through
    // buildSuiteSource; the assertion below guards against the option being
    // wired to only one entry point.
    const off = renderPlaywrightSuite(COLLECTION_WITH_STEP, {
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: false,
    });
    const on = renderPlaywrightSuite(COLLECTION_WITH_STEP, {
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: true,
    });
    expect(off).not.toContain('recordResponse');
    expect(on).toContain('await recordResponse({');
  });
});
