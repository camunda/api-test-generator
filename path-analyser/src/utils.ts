export function normalizeEndpointFileName(method: string, path: string): string {
  const safePath = path
    .replace(/\//g, '--')
    .replace(/[^a-zA-Z0-9\-{}]/g, '_');
  return `${method.toLowerCase()}${safePath}-scenarios.json`;
}