import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardrail for the `knownIssue` reporting convention (#425 review).
 *
 * The nightly's "skipped due to known issues" Slack thread is auto-derived from
 * the `knownIssue { summary, url }` fields on the suppress/exclude entries, and
 * it **dedupes bullets by `url`** — so if two entries in the same config point
 * at the same issue `url` with *different* `summary` strings, the bullet text
 * becomes config-order-dependent (first-seen wins). This test fails when that
 * happens, forcing entries that share a `url` to share a `summary`.
 *
 * Scope is PER config file: the same issue may legitimately have a different
 * summary in a different file/suite (e.g. camunda-hub#25801 reads "versions
 * can't be created" in positive-suppress but "updateVersion/restoreVersion
 * blocked" in request-validation — different threads, different context).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configsDir = path.join(repoRoot, 'configs');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Collect every knownIssue in a config object: per-entry `knownIssue` on the
// given entry arrays, plus a top-level `knownIssues[]`.
function collectKnownIssues(cfg: unknown, entryKeys: string[]): Record<string, unknown>[] {
  if (!isRecord(cfg)) return [];
  const out: Record<string, unknown>[] = [];
  for (const key of entryKeys) {
    const arr = cfg[key];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (isRecord(e) && isRecord(e.knownIssue)) out.push(e.knownIssue);
    }
  }
  const suiteWide = cfg.knownIssues;
  if (Array.isArray(suiteWide)) {
    for (const ki of suiteWide) if (isRecord(ki)) out.push(ki);
  }
  return out;
}

// (config-file relative path, entry-array keys carrying per-entry knownIssue).
const SOURCES: { file: string; entryKeys: string[] }[] = [
  { file: 'positive-suppress.json', entryKeys: ['suppress'] },
  { file: 'request-validation.json', entryKeys: ['excludeOperations'] },
];

function configNames(): string[] {
  if (!fs.existsSync(configsDir)) return [];
  return fs
    .readdirSync(configsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

describe('knownIssue summary consistency (#425)', () => {
  const cases: { config: string; file: string; entryKeys: string[] }[] = [];
  for (const config of configNames()) {
    for (const { file, entryKeys } of SOURCES) {
      if (fs.existsSync(path.join(configsDir, config, file))) {
        cases.push({ config, file, entryKeys });
      }
    }
  }

  it('discovers config files carrying knownIssue entries (sanity)', () => {
    // Not a specific-config assertion — just proves discovery works so a future
    // rename of the config files doesn't silently make this test vacuous.
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('$config/$file: each issue url has a single summary', ({
    config,
    file,
    entryKeys,
  }) => {
    const cfg = JSON.parse(fs.readFileSync(path.join(configsDir, config, file), 'utf8'));
    const byUrl = new Map<string, Set<string>>();
    for (const ki of collectKnownIssues(cfg, entryKeys)) {
      const { url, summary } = ki;
      if (typeof url !== 'string' || typeof summary !== 'string') continue;
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url)?.add(summary);
    }
    const conflicts = [...byUrl.entries()]
      .filter(([, summaries]) => summaries.size > 1)
      .map(([url, s]) => `${url} → ${[...s].map((x) => JSON.stringify(x)).join(' vs ')}`);
    expect(conflicts).toEqual([]);
  });
});
