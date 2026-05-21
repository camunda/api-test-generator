import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildCoverage } from '../../materializer/src/coverage.ts';

/**
 * Coverage extractor unit tests (#331 / PR #332).
 *
 * These lock in three behaviours that are easy to break by a rename or
 * a default-flip and have no upstream test guarding them:
 *
 *  1. `suppressesFeatureTest: false` on the ABox is honoured (the
 *     reader's property name and the schema field name must agree).
 *  2. Omitting `suppressesFeatureTest` defaults to suppressing.
 *  3. `prereqChain` steps are excluded — only `invoke` / `observe`
 *     step kinds contribute to the suppression set. This is the
 *     closed taxonomy declared in `scenarioTemplateSchema.ts`.
 */
describe('buildCoverage (#331)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeScenario(
    templateScenariosRootDir: string,
    templateName: string,
    subjectName: string,
    steps: Array<{ kind: string; operationId?: string }>,
  ) {
    const dir = path.join(templateScenariosRootDir, templateName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${subjectName}.json`),
      JSON.stringify({
        templateName,
        subjectName,
        subjectKind: 'Entity',
        scenario: { steps },
      }),
    );
  }

  test('default (no ABox) treats every template as suppressing', async () => {
    const root = path.join(tmp, 'scenarios', 'templates');
    await writeScenario(root, 'EntityLifecycle', 'User', [
      { kind: 'invoke', operationId: 'createUser' },
      { kind: 'observe', operationId: 'getUser' },
    ]);

    const result = await buildCoverage({
      templateScenariosRootDir: root,
      templatesAboxPath: undefined,
      templateOutputDirs: { EntityLifecycle: 'entities' },
    });

    expect([...result.suppressedOpIds].sort()).toEqual(['createUser', 'getUser']);
  });

  test('suppressesFeatureTest: false on the ABox excludes that template from suppression', async () => {
    const root = path.join(tmp, 'scenarios', 'templates');
    await writeScenario(root, 'EntityLifecycle', 'User', [
      { kind: 'invoke', operationId: 'createUser' },
    ]);
    await writeScenario(root, 'SmokeTemplate', 'Tenant', [
      { kind: 'invoke', operationId: 'createTenant' },
    ]);

    const aboxPath = path.join(tmp, 'scenario-templates.json');
    await fs.writeFile(
      aboxPath,
      JSON.stringify({
        templates: [
          { name: 'EntityLifecycle' }, // default → true
          { name: 'SmokeTemplate', suppressesFeatureTest: false }, // explicit opt-out
        ],
      }),
    );

    const result = await buildCoverage({
      templateScenariosRootDir: root,
      templatesAboxPath: aboxPath,
      templateOutputDirs: {
        EntityLifecycle: 'entities',
        SmokeTemplate: 'smoke',
      },
    });

    expect(result.suppressedOpIds.has('createUser')).toBe(true);
    expect(result.suppressedOpIds.has('createTenant')).toBe(false);
  });

  test('only invoke and observe steps contribute — prereqChain is scaffolding', async () => {
    const root = path.join(tmp, 'scenarios', 'templates');
    await writeScenario(root, 'EntityLifecycle', 'User', [
      { kind: 'prereqChain', operationId: 'createTenant' }, // excluded
      { kind: 'invoke', operationId: 'createUser' },
      { kind: 'observe', operationId: 'getUser' },
    ]);

    const result = await buildCoverage({
      templateScenariosRootDir: root,
      templatesAboxPath: undefined,
      templateOutputDirs: { EntityLifecycle: 'entities' },
    });

    expect([...result.suppressedOpIds].sort()).toEqual(['createUser', 'getUser']);
    expect(result.suppressedOpIds.has('createTenant')).toBe(false);
  });

  test('templates not wired into templateOutputDirs are skipped (no spec emitted, no coverage claimed)', async () => {
    const root = path.join(tmp, 'scenarios', 'templates');
    await writeScenario(root, 'UnwiredTemplate', 'Thing', [
      { kind: 'invoke', operationId: 'doThing' },
    ]);

    const result = await buildCoverage({
      templateScenariosRootDir: root,
      templatesAboxPath: undefined,
      templateOutputDirs: {}, // not wired
    });

    expect(result.suppressedOpIds.size).toBe(0);
    expect(result.entries).toEqual([]);
  });
});
