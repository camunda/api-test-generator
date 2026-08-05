#!/usr/bin/env node
// Remove every entry in <file>'s <arrayKey> array whose knownIssue.url equals
// <issueUrl>, rewriting the file with the same 2-space-indent + trailing-
// newline formatting the config files already use. Prints the removed
// operationIds, one per line, so the caller can report exactly what was
// re-enabled. A no-op call (no matching entries) never touches the file.
//
// Usage: node hub-remove-known-issue-entries.mjs <file> <arrayKey> <issueUrl>
//
// Called by hub-reenable-check.sh — see that script + AGENTS.md's "Standing
// rule: every new request-validation scenario kind needs an applicability
// rule" neighbourhood for the broader knownIssue convention this operates on.

import { readFileSync, writeFileSync } from 'node:fs';

const [file, arrayKey, issueUrl] = process.argv.slice(2);
if (!file || !arrayKey || !issueUrl) {
  console.error('usage: hub-remove-known-issue-entries.mjs <file> <arrayKey> <issueUrl>');
  process.exit(2);
}

const raw = readFileSync(file, 'utf8');
const data = JSON.parse(raw);

const entries = data[arrayKey];
if (!Array.isArray(entries)) {
  console.error(`::error::${file} has no array at "${arrayKey}"`);
  process.exit(2);
}

const removed = [];
const kept = entries.filter((entry) => {
  const matches = entry?.knownIssue?.url === issueUrl;
  if (matches) removed.push(entry.operationId ?? '(no operationId)');
  return !matches;
});

if (removed.length === 0) {
  // Nothing to do — leave the file untouched (no rewrite, no trailing diff).
  process.exit(0);
}

data[arrayKey] = kept;
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

for (const operationId of removed) {
  console.log(operationId);
}
