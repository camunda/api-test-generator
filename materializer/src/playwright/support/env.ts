export function buildBaseUrl(): string {
  return process.env.API_BASE_URL || '{{{defaultBaseUrl}}}';
}

export async function authHeaders(): Promise<Record<string, string>> {
  // Do not set Content-Type here; request options (data vs multipart) will determine it.
  // Trim: a BEARER_TOKEN pasted from a .env file or terminal often carries a
  // trailing newline / surrounding whitespace, which would otherwise emit an
  // invalid `Authorization: Bearer <token>\n` header.
  const token = process.env.BEARER_TOKEN?.trim();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}
