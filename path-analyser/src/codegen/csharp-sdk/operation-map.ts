import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CsharpOperationMap, CsharpOperationMapEntry } from './emitter.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is CsharpOperationMapEntry {
  if (!isRecord(value)) return false;
  const file = value.file;
  const region = value.region;
  const label = value.label;
  return (
    (file === undefined || typeof file === 'string') &&
    (region === undefined || typeof region === 'string') &&
    (label === undefined || typeof label === 'string')
  );
}

export async function loadCsharpOperationMap(baseDir: string): Promise<CsharpOperationMap> {
  const filePath = path.resolve(baseDir, '..', 'csharp-sdk', 'examples', 'operation-map.json');
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const result: CsharpOperationMap = {};
  for (const [opId, rawEntries] of Object.entries(parsed)) {
    if (!Array.isArray(rawEntries)) continue;
    const entries = rawEntries.filter(isEntry);
    if (entries.length > 0) {
      result[opId] = entries;
    }
  }
  return result;
}
