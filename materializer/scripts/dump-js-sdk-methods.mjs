#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Regenerates materializer/src/js-sdk/known-sdk-methods.json — the list of
// real method names on the installed @camunda8/sdk's orchestration-cluster
// client, used by the js-sdk emitter to detect operationIds that have no
// backing SDK method (spec/SDK version skew) and emit a skipped test
// instead of code that throws an opaque runtime TypeError.
//
// Run whenever @camunda8/sdk is bumped (materializer/package.json
// devDependency): `npm run js-sdk:dump-methods --workspace materializer`
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Camunda8 } from '@camunda8/sdk';

const require = createRequire(import.meta.url);
const sdkVersion = require('@camunda8/sdk/package.json').version;

// Utility/lifecycle methods on the client that aren't OpenAPI operations —
// never real operationId targets, so excluding them keeps the known-methods
// list scoped to actual REST operations.
const NON_OPERATION_METHODS = new Set([
  'clearAuthCache',
  'configure',
  'createJobWorker',
  'deployResourcesFromFiles',
  'emitSupportLogPreamble',
  'forceAuthRefresh',
  'getAuthHeaders',
  'getBackpressureState',
  'getConfig',
  'getErrorMode',
  'getWorkers',
  'logger',
  'onAuthHeaders',
  'stopAllWorkers',
  'withCorrelation',
]);

const client = new Camunda8().getOrchestrationClusterApiClientLoose();
const methods = new Set();
let proto = Object.getPrototypeOf(client);
while (proto && proto !== Object.prototype) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (
      typeof client[name] === 'function' &&
      name !== 'constructor' &&
      !name.startsWith('_') &&
      !NON_OPERATION_METHODS.has(name)
    ) {
      methods.add(name);
    }
  }
  proto = Object.getPrototypeOf(proto);
}

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'js-sdk',
  'known-sdk-methods.json',
);
const sorted = [...methods].sort();
writeFileSync(
  outPath,
  `${JSON.stringify({ sdkVersion, methods: sorted }, null, 2)}\n`,
);
console.log(`Wrote ${sorted.length} methods (sdkVersion ${sdkVersion}) to ${outPath}`);
