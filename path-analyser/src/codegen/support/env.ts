export function buildBaseUrl(): string {
  return process.env.API_BASE_URL || 'http://localhost:8080/v2';
}

export async function authHeaders(): Promise<Record<string,string>> {
  // Local server requires empty headers (no Authorization)
  // Do not set Content-Type here; request options (data vs multipart) will determine it.
  return {};
}
