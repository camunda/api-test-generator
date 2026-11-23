import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type {
  OperationModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import {
  binaryMultipartParts,
  splitMultipartFileParts,
} from '../../request-validation/src/util/multipartFiles.js';

/**
 * Guards the nightly createDeployment tenantId failure: binary multipart parts
 * must be sent as files. The JSON-to-multipart adaptation turned the baseline
 * `resources: ['x']` into the text field `resources=["x"]`, which the server
 * does not treat as a file part ("Required part 'resources' is not present."),
 * so the request never reached the tenantId check the scenario targets.
 */

const deploymentOp: OperationModel = {
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
      tenantId: { type: 'string', maxLength: 31 },
    },
    required: ['resources'],
  },
  multipartRequiredProps: ['resources'],
};

const documentOp: OperationModel = {
  ...deploymentOp,
  operationId: 'createDocument',
  path: '/documents',
  multipartSchema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' }, metadata: { type: 'object' } },
    required: ['file'],
  },
  multipartRequiredProps: ['file'],
};

const tenantScenario: ValidationScenario = {
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
  multipartForm: { resources: '["x"]', tenantId: 'a'.repeat(41) },
};

describe('request-validation: binary multipart parts are sent as files', () => {
  it('finds binary strings and arrays of binary strings, not text parts', () => {
    expect([...binaryMultipartParts(deploymentOp)]).toEqual(['resources']);
    expect([...binaryMultipartParts(documentOp)]).toEqual(['file']);
  });

  it('moves a binary array part out of the text fields, using its first item as content', () => {
    const out = splitMultipartFileParts(tenantScenario, deploymentOp);
    expect(out.multipartForm).toEqual({ tenantId: 'a'.repeat(41) });
    expect(out.multipartFiles).toEqual({ resources: 'x' });
  });

  it('moves a single binary part', () => {
    const s: ValidationScenario = {
      ...tenantScenario,
      operationId: 'createDocument',
      multipartForm: { file: 'x', metadata: '{}' },
    };
    const out = splitMultipartFileParts(s, documentOp);
    expect(out.multipartForm).toEqual({ metadata: '{}' });
    expect(out.multipartFiles).toEqual({ file: 'x' });
  });

  it('leaves a scenario that omits the binary part unchanged', () => {
    const s: ValidationScenario = { ...tenantScenario, multipartForm: {} };
    expect(splitMultipartFileParts(s, deploymentOp)).toBe(s);
  });

  it('emits the file part as a File, not a text field', () => {
    const rendered = renderScenarioForTest(
      splitMultipartFileParts(tenantScenario, deploymentOp),
      'createDeployment - Constraint violation tenantId',
    );
    expect(rendered).toContain(
      `formData.append("resources", new File(["x"], "resources.bin", { type: 'application/octet-stream' }))`,
    );
    expect(rendered).not.toMatch(/const multipartFields[^;]*resources/);
    // Evidence keeps the file part apart from the text fields, for replays.
    expect(rendered).toContain(
      'multipartFiles: {"resources":{"filename":"resources.bin","content":"x","type":"application/octet-stream"}}',
    );
  });
});
