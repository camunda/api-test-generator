/**
 * One valid and one invalid sample for each string `format` the request validators check.
 * The generators use the valid value to fill parameters they are not testing, and the invalid one
 * as the bad value. A format missing from these tables is not checkable, so no scenario targets it.
 */
export const VALID_BY_FORMAT: Readonly<Record<string, string>> = {
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  'date-time': '2025-01-01T00:00:00Z',
  date: '2025-01-01',
  email: 'user@example.com',
  uri: 'https://example.com',
};

export const INVALID_BY_FORMAT: Readonly<Record<string, string>> = {
  uuid: 'not-a-uuid',
  'date-time': 'not-a-datetime',
  date: 'not-a-date',
  email: 'not-an-email',
  uri: 'not a uri',
};
