import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EndpointScenarioCollection } from '../types.js';
import type { Emitter } from './emitter.js';

/**
 * Write all files emitted by an {@link Emitter} into `outDir`. Centralising
 * the write step lets emitters stay pure and lets us add cross-cutting
 * concerns (formatting, license headers, idempotency checks) in one place.
 *
 * Returns the absolute paths of files written, in emit order.
 */
export async function writeEmitted(
  emitter: Emitter,
  collection: EndpointScenarioCollection,
  ctx: { outDir: string; suiteName: string; mode: 'feature' | 'integration' },
): Promise<string[]> {
  const files = await emitter.emit(collection, ctx);
  const written: string[] = [];
  for (const f of files) {
    if (path.isAbsolute(f.relativePath)) {
      throw new Error(
        `Emitter '${emitter.id}' returned absolute path '${f.relativePath}'. ` +
          'Emitted file paths must be relative to ctx.outDir.',
      );
    }
    if (f.relativePath.includes('..')) {
      throw new Error(
        `Emitter '${emitter.id}' returned path '${f.relativePath}' that escapes ctx.outDir.`,
      );
    }
    const abs = path.join(ctx.outDir, f.relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
    written.push(abs);
  }
  return written;
}
