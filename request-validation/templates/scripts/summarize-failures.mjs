#!/usr/bin/env node
/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Analyse Playwright JSON reporter output and print a grouped failure
// breakdown. Designed for the request-validation suite, where every test
// expects a specific HTTP status (typically 400) and failures usually
// cluster by:
//   * actual HTTP status returned by the server
//   * scenario kind (e.g. param-constraint-violation, missing-required)
//   * operationId
//
// Reads ./test-results.json by default (produced by the JSON reporter
// configured in playwright.config.ts). Pass a path as the first argument
// to override.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'test-results.json');

if (!existsSync(inputPath)) {
  console.error(`No JSON report found at ${inputPath}.`);
  console.error(`Run \`npm test\` first; it writes the report on every run.`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  console.error(`Failed to parse ${inputPath}: ${e?.message ?? e}`);
  process.exit(2);
}

const failures = [];
walkSuites(report.suites ?? [], failures);

if (failures.length === 0) {
  console.log('All tests passed — no failures to summarise.');
  process.exit(0);
}

console.log(`\nRequest-validation failure summary (${failures.length} failing tests)\n`);

groupAndPrint('By actual HTTP status', failures, (f) => f.actualStatus ?? '(unknown)');
groupAndPrint('By scenario kind', failures, (f) => f.scenarioKind ?? '(unknown)');
groupAndPrint('By operationId', failures, (f) => f.operationId ?? '(unknown)', 15);

console.log('\n--- Per-failure detail (first 20) ---\n');
for (const f of failures.slice(0, 20)) {
  console.log(`✘ ${f.title}`);
  console.log(`    file:        ${f.file}`);
  if (f.method && f.url) console.log(`    request:     ${f.method} ${f.url}`);
  if (f.expectedStatus != null) console.log(`    expected:    ${f.expectedStatus}`);
  if (f.actualStatus != null) console.log(`    actual:      ${f.actualStatus}`);
  if (f.responseBody) {
    const truncated =
      f.responseBody.length > 240 ? `${f.responseBody.slice(0, 240)}…` : f.responseBody;
    console.log(`    body:        ${truncated.replace(/\n/g, '\n                 ')}`);
  }
  console.log();
}
if (failures.length > 20) {
  console.log(
    `(${failures.length - 20} more failures omitted; open playwright-report/index.html or inspect ${path.basename(inputPath)} for the full list.)`,
  );
}

console.log(`\nFull HTML report: npx playwright show-report`);

// ---------------------------------------------------------------------------

function walkSuites(suites, out, fileHint) {
  for (const suite of suites) {
    const file = suite.file ?? fileHint;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        // Only inspect the final attempt: with Playwright `retries > 0` a
        // flaky test that eventually passes will leave failed entries in
        // `test.results`, which would otherwise inflate failure counts and
        // misattribute groupings.
        const results = test.results ?? [];
        const result = results[results.length - 1];
        if (!result) continue;
        if (result.status === 'passed' || result.status === 'skipped') continue;
        const ctx = extractContext(result);
        out.push({
          title: spec.title,
          file: file ?? '(unknown)',
          ...ctx,
        });
      }
    }
    if (suite.suites) walkSuites(suite.suites, out, file);
  }
}

function extractContext(result) {
  const out = {};
  // Attachments: the assertResponseStatus helper writes request.json and response.json.
  for (const att of result.attachments ?? []) {
    if (att.contentType !== 'application/json' || !att.body) continue;
    let parsed;
    try {
      // Playwright's JSON reporter base64-encodes attachment bodies.
      const decoded = Buffer.from(att.body, 'base64').toString('utf8');
      parsed = JSON.parse(decoded);
    } catch {
      continue;
    }
    if (att.name === 'request.json') {
      out.operationId = parsed.operationId;
      out.scenarioKind = parsed.scenarioKind;
      out.method = parsed.method;
      out.url = parsed.url;
      out.expectedStatus = parsed.expectedStatus;
    } else if (att.name === 'response.json') {
      out.actualStatus = parsed.status;
      out.responseBody =
        typeof parsed.body === 'string' ? parsed.body : JSON.stringify(parsed.body);
    }
  }
  // Fallback: scrape the error message if attachments are missing.
  if (out.actualStatus == null && result.errors?.length) {
    const msg = result.errors[0].message ?? '';
    const m = msg.match(/actual status:\s+(\d+)/);
    if (m) out.actualStatus = Number(m[1]);
    const m2 = msg.match(/expected status:\s+(\d+)/);
    if (m2) out.expectedStatus = Number(m2[1]);
  }
  return out;
}

function groupAndPrint(heading, items, keyFn, maxRows = 20) {
  const counts = new Map();
  for (const it of items) {
    const k = String(keyFn(it));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${heading}:`);
  for (const [k, n] of sorted.slice(0, maxRows)) {
    console.log(`  ${String(n).padStart(4, ' ')}  ${k}`);
  }
  if (sorted.length > maxRows) {
    console.log(`  (${sorted.length - maxRows} more groups omitted)`);
  }
  console.log();
}
