/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

/**
 * The path/body field names camunda-oca's runtime-key fixture provisioning
 * (`request-validation/templates/support/global-setup.ts`'s
 * `provisionRuntimeKeyFixtures`) understands.
 *
 * This list can't simply import `RUNTIME_KEY_ENV_VARS` from that template
 * file: `templates/support/*.ts` is vendored standalone into every
 * generated suite and deliberately uses extension-less relative imports
 * among themselves (`./env`, not `./env.js`) so they resolve under
 * Playwright's/tsx's loader without a build step. Pulling one of those
 * files into `request-validation`'s own `tsc -p .` build graph (this
 * package IS compiled — see `npm run build:request-validation`) makes
 * `tsc` emit it into `dist/templates/...` too, and THAT compiled copy's
 * own extension-less `from './env'` import then fails under plain Node
 * ESM resolution (`ERR_MODULE_NOT_FOUND`), breaking the compiled
 * generator (#614's review discussion).
 *
 * So this is a second, deliberately tiny copy — covered by
 * `tests/request-validation/resource-fixtures-emit.test.ts`, which asserts
 * this list and `global-setup.ts`'s `RUNTIME_KEY_ENV_VARS` keys stay
 * identical, so the two can't silently drift apart the way three
 * independent hand-typed arrays previously could.
 */
export const RUNTIME_KEY_FIXTURE_NAMES = [
  'userTaskKey',
  'jobKey',
  'elementInstanceKey',
  'processInstanceKey',
] as const;
