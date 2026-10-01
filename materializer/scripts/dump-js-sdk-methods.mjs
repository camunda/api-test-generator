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
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Camunda8 } from '@camunda8/sdk';

const require = createRequire(import.meta.url);
const sdkVersion = require('@camunda8/sdk/package.json').version;
// @camunda8/sdk only declares a range (`>=8.8.4 <9.0.0`) for its
// orchestration-cluster-api dependency, so the actually-installed version is
// what the method inventory above truly reflects. Recorded here so the
// generated project's package.json can pin it via `overrides`, keeping a
// fresh `npm install` of the generated project reproducible against this
// inventory (Copilot PR #575 review).
//
// The package doesn't export its own `package.json` (no matching `exports`
// entry), so `require('<pkg>/package.json')` 404s — resolve its main entry
// instead and walk up to the nearest package.json.
function resolveInstalledVersion(pkgName) {
  let dir = path.dirname(require.resolve(pkgName));
  while (true) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
      if (pkg.name === pkgName) return pkg.version;
    } catch {
      // not here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate package.json for ${pkgName}`);
    dir = parent;
  }
}
const ocaVersion = resolveInstalledVersion('@camunda8/orchestration-cluster-api');

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
  `${JSON.stringify({ sdkVersion, ocaVersion, methods: sorted }, null, 2)}\n`,
);
console.log(`Wrote ${sorted.length} methods (sdkVersion ${sdkVersion}, ocaVersion ${ocaVersion}) to ${outPath}`);
