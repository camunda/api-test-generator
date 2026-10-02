/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // For `unsecured`/`secured`: provisions real userTaskKey/jobKey/
  // elementInstanceKey/processInstanceKey fixtures so by-key/by-instance
  // operations don't 404 on a filler placeholder before reaching the
  // validation a scenario targets (see support/global-setup.ts). For
  // `rbac`: provisions the zero-grant deny-test probe user (#359) instead.
  globalSetup: './support/global-setup',
  // Cancels the process instances global-setup.ts created, once the whole
  // suite finishes — a successful run otherwise leaves them (and the job
  // under the service-task one) running on the broker forever. No-op for
  // `rbac` or any config that never created anything.
  globalTeardown: './support/global-teardown',
  // `list` for an immediately-readable inline summary; `json` so
  // `npm run summarize` can produce a grouped failure breakdown;
  // `html` so `npx playwright show-report` opens the full failure detail
  // (request.json / response.json attachments, expected vs. actual status);
  // `junit` for TestRail ingestion (trcli parse_junit). Each reporter's output
  // path is overridable at runtime via PLAYWRIGHT_<NAME>_OUTPUT_FILE/_DIR.
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'junit-report.xml' }],
  ],
  use: {
    trace: 'off',
  },
});
