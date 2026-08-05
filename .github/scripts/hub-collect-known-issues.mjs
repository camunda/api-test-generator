#!/usr/bin/env node
// Collect every knownIssue entry across the camunda-hub configs, grouped by
// blocking issue URL, and print it as JSON to stdout for
// hub-reenable-check.sh to consume.
//
// Two shapes, per #432's design notes:
//   - opScoped: suppress[]/excludeOperations[] entries — each names a real
//     operationId, so a closed blocker has something mechanical to remove.
//   - suiteWide: top-level knownIssues[] entries (request-validation.json
//     only) — no operationId, describes a broader skipped test SHAPE rather
//     than one operation, so there is nothing to auto-unskip. Reported
//     separately; the caller only ever surfaces these, never acts on them.
//
// Usage: node hub-collect-known-issues.mjs <positive-suppress.json> <request-validation.json>

import { readFileSync } from 'node:fs';

const [positiveSuppressPath, requestValidationPath] = process.argv.slice(2);
if (!positiveSuppressPath || !requestValidationPath) {
  console.error(
    'usage: hub-collect-known-issues.mjs <positive-suppress.json> <request-validation.json>',
  );
  process.exit(2);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const positiveSuppress = loadJson(positiveSuppressPath);
const requestValidation = loadJson(requestValidationPath);

const opScopedByUrl = new Map();
function addOpScoped(file, arrayKey, entries) {
  for (const entry of entries ?? []) {
    const url = entry?.knownIssue?.url;
    if (!url) continue;
    const group = opScopedByUrl.get(url) ?? { url, summary: entry.knownIssue.summary, entries: [] };
    group.entries.push({ file, arrayKey, operationId: entry.operationId });
    opScopedByUrl.set(url, group);
  }
}

addOpScoped(positiveSuppressPath, 'suppress', positiveSuppress.suppress);
addOpScoped(requestValidationPath, 'excludeOperations', requestValidation.excludeOperations);

const suiteWide = (requestValidation.knownIssues ?? []).map((ki) => ({
  url: ki.url,
  summary: ki.summary,
}));

console.log(
  JSON.stringify(
    {
      opScoped: [...opScopedByUrl.values()],
      suiteWide,
    },
    null,
    2,
  ),
);
