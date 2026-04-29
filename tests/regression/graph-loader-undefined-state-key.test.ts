import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../path-analyser/src/graphLoader.ts';

describe('graphLoader: domainProducers validation', () => {
  it('does not write invalid keys to domainProducers', async () => {
    // Point it at the real path-analyser directory which has the real domain-semantics.json
    const baseDir = path.resolve('path-analyser');
    const graph = await loadGraph(baseDir);

    const producers = graph.domainProducers ?? {};
    const keys = Object.keys(producers);

    expect(keys, 'domainProducers should not contain the literal string "undefined"').not.toContain(
      'undefined',
    );

    for (const key of keys) {
      expect(typeof key, 'key should be a string').toBe('string');
      expect(key.length, `key "${key}" should not be empty`).toBeGreaterThan(0);
    }
  });
});
