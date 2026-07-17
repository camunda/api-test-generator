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

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// Inspect every knownIssue in a config: per-entry `knownIssue` on the given
// entry arrays, plus a top-level `knownIssues[]`. Returns the well-formed ones
// (for the dedup check) AND a list of malformed ones — a `knownIssue` that is
// *present* but isn't an object with non-empty string `summary`/`url` (or has a
// non-string `tracker`). positive-suppress.json isn't schema-validated for
// knownIssue, so a typo like `{ summray: … }` would otherwise silently drop the
// Slack bullet; failing here catches it early.
function inspectKnownIssues(
  cfg: unknown,
  entryKeys: string[],
): { issues: { url: string; summary: string }[]; malformed: string[] } {
  const issues: { url: string; summary: string }[] = [];
  const malformed: string[] = [];
  const consider = (ki: unknown, where: string): void => {
    if (!isRecord(ki)) {
      malformed.push(`${where}: knownIssue is not an object (${JSON.stringify(ki)})`);
      return;
    }
    const bad: string[] = [];
    if (!nonEmptyString(ki.summary)) bad.push('summary');
    if (!nonEmptyString(ki.url)) bad.push('url');
    if (ki.tracker !== undefined && !nonEmptyString(ki.tracker)) bad.push('tracker');
    if (bad.length > 0) {
      malformed.push(`${where}: knownIssue has invalid ${bad.join('/')} (${JSON.stringify(ki)})`);
      return;
    }
    // Narrowed by the nonEmptyString checks above.
    if (nonEmptyString(ki.url) && nonEmptyString(ki.summary)) {
      issues.push({ url: ki.url, summary: ki.summary });
    }
  };
  if (isRecord(cfg)) {
    for (const key of entryKeys) {
      const arr = cfg[key];
      if (!Array.isArray(arr)) continue;
      arr.forEach((e, i) => {
        if (isRecord(e) && 'knownIssue' in e) {
          const op = nonEmptyString(e.operationId) ? e.operationId : '?';
          consider(e.knownIssue, `${key}[${i}] (${op})`);
        }
      });
    }
    const suiteWide = cfg.knownIssues;
    if (Array.isArray(suiteWide)) {
      suiteWide.forEach((ki, i) => {
        consider(ki, `knownIssues[${i}]`);
      });
    }
  }
  return { issues, malformed };
}

// (config-file relative path, entry-array keys carrying per-entry knownIssue).
const SOURCES: { file: string; entryKeys: string[] }[] = [
  { file: 'positive-suppress.json', entryKeys: ['suppress'] },
  {
    file: 'request-validation.json',
    entryKeys: ['excludeOperations', 'knownProblemDetailShapeGaps'],
  },
];

function configNames(): string[] {
  if (!fs.existsSync(configsDir)) return [];
  return fs
    .readdirSync(configsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(); // stable order — readdir order varies across platforms/filesystems
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
    const { issues, malformed } = inspectKnownIssues(cfg, entryKeys);
    // (1) a present knownIssue must be well-formed (catches silent-drop typos
    //     like `{ summray: … }` — positive-suppress.json isn't schema-validated).
    expect(malformed).toEqual([]);
    // (2) entries sharing a url must share a summary (bullets are deduped by url).
    const byUrl = new Map<string, Set<string>>();
    for (const { url, summary } of issues) {
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url)?.add(summary);
    }
    const conflicts = [...byUrl.entries()]
      .filter(([, summaries]) => summaries.size > 1)
      .map(([url, s]) => `${url} → ${[...s].map((x) => JSON.stringify(x)).join(' vs ')}`);
    expect(conflicts).toEqual([]);
  });
});
