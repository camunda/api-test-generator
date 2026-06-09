import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { ValidationScenario } from '../../request-validation/src/model/types.js';

/**
 * Guards #362 — multipart request-validation tests must attach the auth header.
 *
 * Before the fix, a multipart scenario rendered `headers: {}` even when it
 * needed auth (`headersAuth: true`), so against a secured server the request was
 * rejected with 401 before validation instead of returning the intended 400.
 * The fix emits `authHeaders()` (Authorization only — never `jsonHeaders()`,
 * whose `Content-Type: application/json` would break the multipart boundary).
 * Auth-absent multipart scenarios (`headersAuth: false`) must still send no
 * header at all.
 */

const base: Omit<ValidationScenario, 'headersAuth'> = {
  id: 'createDocument__additional_prop',
  operationId: 'createDocument',
  method: 'POST',
  path: '/documents',
  type: 'additional-prop',
  expectedStatus: 400,
  description: 'unknown form part',
  bodyEncoding: 'multipart',
  multipartForm: { file: 'x', __unexpectedField: 'x' },
};

describe('request-validation: multipart auth header (#362)', () => {
  it('attaches authHeaders() on a multipart request that needs auth', () => {
    const rendered = renderScenarioForTest({ ...base, headersAuth: true }, 'createDocument - x');
    expect(rendered).toContain('headers: authHeaders()');
    // never the JSON helper (its content-type breaks the multipart boundary)…
    expect(rendered).not.toContain('jsonHeaders()');
    // …and not the old empty-headers bug.
    expect(rendered).not.toContain('headers: {}');
    // still a multipart submission.
    expect(rendered).toContain('multipart: formData');
  });

  it('sends no auth header for an auth-absent multipart scenario', () => {
    const rendered = renderScenarioForTest({ ...base, headersAuth: false }, 'createDocument - x');
    expect(rendered).toContain('headers: {}');
    expect(rendered).not.toContain('authHeaders()');
  });
});
