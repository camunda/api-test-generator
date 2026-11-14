/**
 * Shared Layer-3 check for the emitter lowering contract (#812): every
 * binding a lowered step reads (a path parameter or a body/multipart ref
 * that is not omitted when unset) must already be set when the step runs,
 * either by the seeding plan or by an earlier step's extract. A witness
 * polled after a step (`waitsAfter`) may also read the step's own extracts,
 * but never a later step's.
 *
 * SDK adapters render `lowerScenario()` output without re-checking this, so
 * a planner change that breaks it would make every SDK suite send
 * `undefined`. Each config's invariants file calls this over its own
 * generated scenarios.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalContextSeed } from 'path-analyser/types';
import { type LoweredValue, lowerScenario } from '../../emitter-sdk/src/lowering.ts';

function collectRefs(value: LoweredValue | undefined, out: string[]): void {
  if (!value) return;
  if (value.kind === 'ref' && !value.omitWhenUnbound) out.push(value.binding);
  if (value.kind === 'object') for (const e of value.entries) collectRefs(e.value, out);
  if (value.kind === 'array') for (const item of value.items) collectRefs(item, out);
}

export interface LoweringContractResult {
  scenarios: number;
  steps: number;
  /** `<file> <scenarioId> step<N> <operationId> reads <binding>` */
  unboundReads: string[];
  /** `<file> <scenarioId>: <error>` for scenarios lowerScenario rejects. */
  loweringErrors: string[];
}

export function checkLoweringContract(
  scenarioDirs: readonly string[],
  globalContextSeeds: readonly GlobalContextSeed[],
): LoweringContractResult {
  const result: LoweringContractResult = {
    scenarios: 0,
    steps: 0,
    unboundReads: [],
    loweringErrors: [],
  };
  for (const dir of scenarioDirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const collection = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        scenarios?: Parameters<typeof lowerScenario>[0][];
      };
      for (const scenario of collection.scenarios ?? []) {
        if (!scenario.requestPlan?.length) continue;
        result.scenarios++;
        let lowered: ReturnType<typeof lowerScenario>;
        try {
          lowered = lowerScenario(scenario, { globalContextSeeds });
        } catch (err) {
          result.loweringErrors.push(`${file} ${scenario.id}: ${String(err)}`);
          continue;
        }
        const bound = new Set(lowered.seeds.map((s) => s.binding));
        for (const step of lowered.steps) {
          result.steps++;
          const reads = step.pathParams.map((p) => p.binding);
          if (step.body?.kind === 'json') collectRefs(step.body.value, reads);
          if (step.body?.kind === 'multipart') {
            for (const e of [...step.body.fields, ...step.body.files]) collectRefs(e.value, reads);
          }
          // Echo assertions run on this step's response before its extracts
          // are stored, so they may only read already-bound values.
          for (const check of step.echoChecks ?? []) collectRefs(check.value, reads);
          for (const binding of reads) {
            if (!bound.has(binding)) {
              result.unboundReads.push(
                `${file} ${scenario.id} step${step.index} ${step.operationId} reads ${binding}`,
              );
            }
          }
          // The step's own extracts land before its post-step witness polls,
          // so they may legitimately supply a witness binding.
          for (const e of step.extract) bound.add(e.binding);
          for (const wait of step.waitsAfter) {
            for (const p of wait.pathParams) {
              if (!bound.has(p.binding)) {
                result.unboundReads.push(
                  `${file} ${scenario.id} step${step.index} ${step.operationId} witness ${wait.operationId} reads ${p.binding}`,
                );
              }
            }
          }
        }
      }
    }
  }
  return result;
}
