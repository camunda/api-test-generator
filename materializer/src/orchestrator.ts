import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EmitContext, EmitterStrategy } from '@camunda8/emitter-sdk';
import type { EndpointScenarioCollection } from 'path-analyser/types';

/**
 * Invoke an emitter's optional {@link EmitterStrategy.scaffold} method and
 * write its returned files into `ctx.outDir`. Centralised here so every
 * emitter — Playwright today, JS/C#/Python OCA SDK emitters soon — uses
 * the same write-path safety checks as {@link writeEmitted}: relative-path
 * enforcement, escape-out-of-outDir rejection, and idempotent mkdir.
 *
 * No-op when the emitter does not implement `scaffold` (the SDK contract
 * marks it optional for emitters that drop loose specs into an existing
 * project).
 *
 * Returns the absolute paths of files written, in emit order.
 */
export async function writeScaffolded(
  emitter: EmitterStrategy,
  ctx: EmitContext,
): Promise<string[]> {
  if (!emitter.scaffold) return [];
  const files = await emitter.scaffold(ctx);
  return writeFiles(emitter, files, ctx.outDir, 'scaffold');
}

/**
 * Write all files emitted by an {@link Emitter} into `outDir`. Centralising
 * the write step lets emitters stay pure and lets us add cross-cutting
 * concerns (formatting, license headers, idempotency checks) in one place.
 *
 * Returns the absolute paths of files written, in emit order.
 */
export async function writeEmitted(
  emitter: EmitterStrategy,
  collection: EndpointScenarioCollection,
  ctx: EmitContext,
): Promise<string[]> {
  const files = await emitter.emit(collection, ctx);
  return writeFiles(emitter, files, ctx.outDir, 'emit');
}

async function writeFiles(
  emitter: EmitterStrategy,
  files: Awaited<ReturnType<EmitterStrategy['emit']>>,
  outDir: string,
  callSite: 'emit' | 'scaffold',
): Promise<string[]> {
  const written: string[] = [];
  for (const f of files) {
    if (path.isAbsolute(f.relativePath)) {
      throw new Error(
        `Emitter '${emitter.id}' (${callSite}) returned absolute path '${f.relativePath}'. ` +
          'Emitted file paths must be relative to ctx.outDir.',
      );
    }
    // Resolve and assert the destination stays within outDir. A naive
    // substring check on `..` would reject legitimate filenames like
    // `foo..bar.ts` and would not catch escapes hidden inside deeper segments.
    const resolvedOutDir = path.resolve(outDir);
    const abs = path.resolve(resolvedOutDir, f.relativePath);
    const rel = path.relative(resolvedOutDir, abs);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(
        `Emitter '${emitter.id}' (${callSite}) returned path '${f.relativePath}' that escapes ctx.outDir.`,
      );
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
    written.push(abs);
  }
  return written;
}
