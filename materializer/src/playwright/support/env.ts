export function buildBaseUrl(): string {
  return process.env.API_BASE_URL || '{{{defaultBaseUrl}}}';
}

export async function authHeaders(): Promise<Record<string, string>> {
  // Do not set Content-Type here; request options (data vs multipart) will determine it.
  const token = process.env.BEARER_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}
