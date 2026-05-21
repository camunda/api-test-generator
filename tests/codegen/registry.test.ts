import type { EmitterStrategy } from '@camunda8/emitter-sdk';
import {
  _resetRegistriesForTests,
  getEmitter,
  listEmitters,
  registerEmitter,
} from '@camunda8/emitter-sdk';
import { beforeEach, describe, expect, test } from 'vitest';

function stubEmitter(id: string, name = id): EmitterStrategy {
  return {
    id,
    name,
    supportedConfigs: ['*'],
    async emit() {
      return [];
    },
  };
}

describe('emitter registry', () => {
  beforeEach(() => {
    _resetRegistriesForTests();
  });

  test('register + retrieve by id', () => {
    const e = stubEmitter('alpha');
    registerEmitter(e);
    expect(getEmitter('alpha')).toBe(e);
  });

  test('unknown id returns undefined', () => {
    expect(getEmitter('does-not-exist')).toBeUndefined();
  });

  test('list returns sorted ids', () => {
    registerEmitter(stubEmitter('charlie'));
    registerEmitter(stubEmitter('alpha'));
    registerEmitter(stubEmitter('bravo'));
    expect(listEmitters().map((e) => e.id)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('idempotent: registering the same instance twice is a no-op', () => {
    const e = stubEmitter('alpha');
    registerEmitter(e);
    expect(() => registerEmitter(e)).not.toThrow();
    expect(listEmitters()).toHaveLength(1);
  });

  test('id collision with a different instance throws', () => {
    registerEmitter(stubEmitter('alpha', 'first'));
    expect(() => registerEmitter(stubEmitter('alpha', 'second'))).toThrowError(
      /Emitter id collision: 'alpha'/,
    );
  });

  test('reset clears the registry (test-only helper)', () => {
    registerEmitter(stubEmitter('alpha'));
    _resetRegistriesForTests();
    expect(listEmitters()).toEqual([]);
  });
});
