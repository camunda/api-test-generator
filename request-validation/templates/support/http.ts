/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Trimmed subset of the Camunda QA suite's utils/http
// module — exposes only the symbols the generated specs actually import:
// `jsonHeaders` and `buildUrl`. Auth/base-URL handling lives in `./env`.

import { credentials } from './env';

export { jsonHeaders, authHeaders, credentials } from './env';

const API_VERSION = 'v2';

/**
 * Build a fully-qualified URL for an OpenAPI path template.
 *
 * - `pathTemplate` may include `{paramName}` placeholders.
 * - Missing path params are substituted with `__MISSING_PARAM__` so the
 *   server returns the expected validation error rather than a routing 404.
 */
export function buildUrl(
  pathTemplate: string,
  params?: Record<string, string | number | undefined>,
  query?: Record<string, string | number | undefined>,
): string {
  const base = credentials.baseUrl;
  let url = `${base}/${API_VERSION}${pathTemplate}`.replace(/\{(\w+)}/g, (_, k) => {
    const v = params?.[k];
    return v == null ? '__MISSING_PARAM__' : String(v);
  });
  if (query) {
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }
  return url;
}
