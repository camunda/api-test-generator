import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../path-analyser/src/graphLoader.ts';

describe('graphLoader: producersByState validation', () => {
  it('does not write invalid keys to producersByState', async () => {
    // Anchor paths off this test file so the test does not depend on process.cwd().
    const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
    const baseDir = path.join(REPO_ROOT, 'path-analyser');
    const graph = await loadGraph(baseDir);

    expect(graph.producersByState, 'producersByState sidecar should be loaded').toBeDefined();

    const producers = graph.producersByState;
    const keys = Object.keys(producers ?? {});

    expect(
      keys,
      'producersByState should not contain the literal string "undefined"',
    ).not.toContain('undefined');

    for (const key of keys) {
      expect(typeof key, 'key should be a string').toBe('string');
      expect(key.length, `key "${key}" should not be empty`).toBeGreaterThan(0);
    }
  });
});
