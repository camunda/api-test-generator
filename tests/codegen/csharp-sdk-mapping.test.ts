import { describe, expect, test } from 'vitest';
import {
  CsharpOperationMapSource,
  FallbackMappingSource,
} from '../../materializer/src/csharp-sdk/sdk-mapping.js';

const OPERATION_MAP = {
  activateJobs: [{ file: 'noop', region: 'ActivateJobsAsync' }],
  createProcessInstance: [{ file: 'noop', region: 'CreateProcessInstanceAsync' }],
  completeJob: [{ file: 'noop', region: 'CompleteJobAsync' }],
} as const;

describe('C# SDK mapping fallback', () => {
  test('keeps PascalCase Async method names unchanged', () => {
    const mapping = new FallbackMappingSource();

    expect(mapping.resolveMethod('ActivateJobsAsync')).toBe('ActivateJobsAsync');
    expect(mapping.resolveMethod('CreateProcessInstanceAsync')).toBe('CreateProcessInstanceAsync');
    expect(mapping.resolveMethod('CompleteJobAsync')).toBe('CompleteJobAsync');
  });

  test('still converts non-method operation ids to PascalCase Async names', () => {
    const mapping = new FallbackMappingSource();

    expect(mapping.resolveMethod('createProcessInstance')).toBe('CreateProcessInstanceAsync');
  });
});

describe('C# SDK operation map source', () => {
  test('builds a Map once and returns mapped PascalCase methods unchanged', () => {
    const mapping = new CsharpOperationMapSource(OPERATION_MAP);

    expect(mapping.resolveMethod('activateJobs')).toBe('ActivateJobsAsync');
    expect(mapping.resolveMethod('createProcessInstance')).toBe('CreateProcessInstanceAsync');
    expect(mapping.resolveMethod('completeJob')).toBe('CompleteJobAsync');
  });

  test('falls back for unmapped operation ids', () => {
    const mapping = new CsharpOperationMapSource(OPERATION_MAP);

    expect(mapping.resolveMethod('searchUsers')).toBe('SearchUsersAsync');
  });
});
