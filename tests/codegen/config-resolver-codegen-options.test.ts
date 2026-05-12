import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getPlaywrightCodegenOptions } from '../../path-analyser/src/configResolver.ts';

// Each test materialises a fresh temp directory containing a configs.json
// with a single active config named "scratch", then invokes
// getPlaywrightCodegenOptions against it. The active config name comes from
// process.env.CONFIG; we set it explicitly per test and restore the
// previous value so other tests in the suite aren't affected.

describe('getPlaywrightCodegenOptions', () => {
  let tmp: string;
  let prevConfig: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'configres-'));
    prevConfig = process.env.CONFIG;
    process.env.CONFIG = 'scratch';
  });

  afterEach(async () => {
    if (prevConfig === undefined) delete process.env.CONFIG;
    else process.env.CONFIG = prevConfig;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeConfig(scratchEntry: unknown): Promise<void> {
    const content = {
      default: 'scratch',
      configs: { scratch: scratchEntry },
    };
    await fs.writeFile(path.join(tmp, 'configs.json'), JSON.stringify(content), 'utf8');
  }

  // The recorder is opt-in tooling. Default is OFF so suites that
  // don't consume responses.jsonl skip the boilerplate + per-step fs writes.
  test('defaults to recordResponses=false when the config has no codegen block', async () => {
    await writeConfig({ description: 'test' });
    expect(getPlaywrightCodegenOptions(tmp)).toEqual({ recordResponses: false });
  });

  test('defaults to recordResponses=false when codegen has no playwright block', async () => {
    await writeConfig({ codegen: {} });
    expect(getPlaywrightCodegenOptions(tmp)).toEqual({ recordResponses: false });
  });

  test('defaults to recordResponses=false when playwright omits recordResponses', async () => {
    await writeConfig({ codegen: { playwright: {} } });
    expect(getPlaywrightCodegenOptions(tmp)).toEqual({ recordResponses: false });
  });

  test('returns recordResponses=true when explicitly set', async () => {
    await writeConfig({ codegen: { playwright: { recordResponses: true } } });
    expect(getPlaywrightCodegenOptions(tmp)).toEqual({ recordResponses: true });
  });

  test('returns recordResponses=false when explicitly set', async () => {
    await writeConfig({ codegen: { playwright: { recordResponses: false } } });
    expect(getPlaywrightCodegenOptions(tmp)).toEqual({ recordResponses: false });
  });

  test('throws when codegen is a non-object', async () => {
    await writeConfig({ codegen: 'invalid' });
    expect(() => getPlaywrightCodegenOptions(tmp)).toThrow(/codegen must be an object/);
  });

  test('throws when codegen.playwright is a non-object', async () => {
    await writeConfig({ codegen: { playwright: 'invalid' } });
    expect(() => getPlaywrightCodegenOptions(tmp)).toThrow(/playwright must be an object/);
  });

  test('throws when recordResponses is a non-boolean', async () => {
    await writeConfig({ codegen: { playwright: { recordResponses: 'yes' } } });
    expect(() => getPlaywrightCodegenOptions(tmp)).toThrow(/recordResponses must be a boolean/);
  });
});
