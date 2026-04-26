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
  // `list` for an immediately-readable inline summary; `json` so
  // `npm run summarize` can produce a grouped failure breakdown;
  // `html` so `npx playwright show-report` opens the full failure detail
  // (request.json / response.json attachments, expected vs. actual status).
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    trace: 'off',
  },
});
