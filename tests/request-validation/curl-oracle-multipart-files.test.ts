import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type {
  OperationModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import { splitMultipartFileParts } from '../../request-validation/src/util/multipartFiles.js';

/**
 * Guards the curl oracle (scripts/e2e/curl_compare.py, also used by
 * verify-negative-failures.py) against dropping multipart file parts. The
 * suite sends createDeployment's `resources` as a File; an oracle that
 * rebuilt the request from `multipartFields` alone replayed it without
 * `resources` and got the unrelated 400 "Required part 'resources' is not
 * present.", while still matching the expected status.
 */

const SCRIPTS_DIR = join(import.meta.dirname, '..', '..', 'scripts', 'e2e');

const op: OperationModel = {
  operationId: 'createDeployment',
  method: 'POST',
  path: '/deployments',
  tags: [],
  parameters: [],
  mediaTypes: ['multipart/form-data'],
  multipartSchema: {
    type: 'object',
    properties: {
      resources: { type: 'array', items: { type: 'string', format: 'binary' } },
      tenantId: { type: 'string' },
    },
    required: ['resources'],
  },
  multipartRequiredProps: ['resources'],
};

const scenario: ValidationScenario = {
  id: 'createDeployment__cv_tenantId',
  operationId: 'createDeployment',
  method: 'POST',
  path: '/deployments',
  type: 'constraint-violation',
  target: 'tenantId',
  expectedStatus: 400,
  description: 'tenantId too long',
  headersAuth: true,
  bodyEncoding: 'multipart',
  multipartForm: { resources: '["x"]', tenantId: '@a<b' },
};

function runPython(code: string, ...args: string[]): unknown {
  const res = spawnSync('python3', ['-I', '-c', code, SCRIPTS_DIR, ...args], {
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`python failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

describe('curl oracle: multipart file parts', () => {
  it('parses the File parts the emitted test appends', () => {
    const block = renderScenarioForTest(
      splitMultipartFileParts(scenario, op),
      'createDeployment - Constraint violation tenantId',
    );
    const file = join(mkdtempSync(join(tmpdir(), 'curl-oracle-')), 'block.ts');
    writeFileSync(file, block);
    const parsed = runPython(
      [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'import curl_compare as cc',
        'd = cc.parse_block(open(sys.argv[2], encoding="utf-8").read(), "http://h", "v2")',
        'print(json.dumps({"multipart": d["multipart"], "files": d["files"]}))',
      ].join('\n'),
      file,
    );
    expect(parsed).toEqual({
      multipart: { tenantId: '@a<b' },
      files: {
        resources: {
          filename: 'resources.bin',
          content: 'x',
          type: 'application/octet-stream',
        },
      },
    });
  });

  it('sends text fields literally and file parts as files', () => {
    const argv = runPython(
      [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'import curl_compare as cc',
        'files = {"resources": {"filename": "resources.bin", "content": "x", "type": "application/octet-stream"}}',
        'args, tmp = cc.curl_args("POST", "http://h/v2/deployments", [], None, {"tenantId": "@a<b"}, files)',
        'print(json.dumps([a if not a.startswith("resources=@") else "resources=@;" + a.split(";", 1)[1] for a in args]))',
        'cc.cleanup(tmp)',
      ].join('\n'),
    );
    expect(argv).toEqual(expect.arrayContaining(['--form-string', 'tenantId=@a<b']));
    expect(argv).toEqual(
      expect.arrayContaining([
        '-F',
        'resources=@;filename=resources.bin;type=application/octet-stream',
      ]),
    );
  });

  it('sends an empty multipart body, not no body, for an empty FormData', () => {
    const argv = runPython(
      [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'import curl_compare as cc',
        'args, tmp = cc.curl_args("POST", "http://h/v2/deployments", [], None, {}, {})',
        'print(json.dumps(args))',
      ].join('\n'),
    );
    expect(argv).toEqual(
      expect.arrayContaining(['Content-Type: multipart/form-data; boundary=curlcompare']),
    );
    expect(argv).toEqual(expect.arrayContaining(['--data-binary']));
  });
});
