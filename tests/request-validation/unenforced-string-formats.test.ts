import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateFormatInvalid } from '../../request-validation/src/analysis/advancedSchema.js';
import { loadRequestValidationConfig } from '../../request-validation/src/config.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture: `unenforcedStringFormats` (createCluster date-time false
 * positive).
 *
 * `generateFormatInvalid` emits a 400-expecting test for every string field
 * whose `format` is recognised (uuid/date-time/email/uri). But a server that
 * does NOT validate a given format binds the field to a plain String, so a
 * malformed value passes schema validation and the request proceeds to the
 * next gate (authority → 403, resource lookup → 404) — never the expected
 * 400. `unenforcedStringFormats` lets a config declare which formats are not
 * enforced so the false-positive tests are not emitted. Mirrors
 * `enumCaseInsensitive` (issue #129).
 *
 * Pins both directions plus the loader parse/validation.
 */

function buildOp(properties: Record<string, { type: string; format?: string }>): OperationModel {
  return {
    operationId: 'createThing',
    method: 'POST',
    path: '/things',
    tags: [],
    bodyRequired: true,
    requiredProps: Object.keys(properties),
    requestBodySchema: {
      type: 'object',
      required: Object.keys(properties),
      properties,
    },
    parameters: [],
  };
}

describe('request-validation: unenforcedStringFormats', () => {
  const op = buildOp({
    expiresAt: { type: 'string', format: 'date-time' },
    contact: { type: 'string', format: 'email' },
  });

  it('emits format-invalid for every recognised format by default', () => {
    const scenarios = generateFormatInvalid([op], {});
    const targets = new Set(scenarios.map((s) => s.target));
    expect(targets.has('expiresAt')).toBe(true);
    expect(targets.has('contact')).toBe(true);
  });

  it('skips only the listed format, keeping the enforced ones', () => {
    const scenarios = generateFormatInvalid([op], { unenforcedStringFormats: ['date-time'] });
    const targets = new Set(scenarios.map((s) => s.target));
    // date-time is not enforced by the server → no false-positive 400 test.
    expect(targets.has('expiresAt')).toBe(false);
    // email IS enforced → its test remains.
    expect(targets.has('contact')).toBe(true);
  });

  describe('config loader', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-fmt-'));
    const cfgDir = path.join(tmpRoot, 'configs', 'probe');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'configs.json'), '{}');

    afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    it('defaults to an empty list when the field is absent', () => {
      fs.writeFileSync(path.join(cfgDir, 'request-validation.json'), '{}');
      expect(loadRequestValidationConfig(tmpRoot, 'probe').unenforcedStringFormats).toEqual([]);
    });

    it('parses a string array', () => {
      fs.writeFileSync(
        path.join(cfgDir, 'request-validation.json'),
        JSON.stringify({ unenforcedStringFormats: ['date-time', 'uri'] }),
      );
      expect(loadRequestValidationConfig(tmpRoot, 'probe').unenforcedStringFormats).toEqual([
        'date-time',
        'uri',
      ]);
    });

    it('rejects a non-array (fails loud rather than silently ignoring)', () => {
      fs.writeFileSync(
        path.join(cfgDir, 'request-validation.json'),
        JSON.stringify({ unenforcedStringFormats: 'date-time' }),
      );
      expect(() => loadRequestValidationConfig(tmpRoot, 'probe')).toThrow(
        /unenforcedStringFormats/,
      );
    });
  });
});
