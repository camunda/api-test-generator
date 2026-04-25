import { describe, expect, test } from 'vitest';
import {
  PlaywrightEmitter,
  playwrightSuiteFileName,
  renderPlaywrightSuite,
} from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

const COLLECTION: EndpointScenarioCollection = {
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
    },
  ],
};

describe('PlaywrightEmitter (Emitter contract)', () => {
  test('id and name are stable identifiers', () => {
    expect(PlaywrightEmitter.id).toBe('playwright');
    expect(PlaywrightEmitter.name).toMatch(/Playwright/);
  });

  test('returns one EmittedFile per scenario collection with the expected file name', async () => {
    const files = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('createWidget.feature.spec.ts');
    expect(files[0].relativePath).toBe(playwrightSuiteFileName(COLLECTION, 'feature'));
  });

  test('integration mode produces an integration.spec.ts file name', async () => {
    const files = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'integration',
    });
    expect(files[0].relativePath).toBe('createWidget.integration.spec.ts');
  });

  test('emit() is pure: does not touch the filesystem (outDir is unused)', async () => {
    // outDir is intentionally a non-existent path; emit() must not throw.
    await expect(
      PlaywrightEmitter.emit(COLLECTION, {
        outDir: '/this/does/not/exist',
        suiteName: 'createWidget',
        mode: 'feature',
      }),
    ).resolves.toBeDefined();
  });

  test('rendered suite contains the expected Playwright preamble and describe block', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(file.content).toContain("import { test, expect } from '@playwright/test'");
    expect(file.content).toContain("test.describe('createWidget'");
    expect(file.content).toContain("test('sc1 - happy path'");
  });

  test('renderPlaywrightSuite is byte-identical to the EmittedFile content', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    const direct = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(file.content).toBe(direct);
  });
});
