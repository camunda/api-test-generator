import { promises as fs } from 'fs';
import path from 'path';

interface Observation {
  timestamp: string;
  operationId: string;
  scenarioId?: string;
  scenarioName?: string;
  stepIndex?: number;
  isFinal?: boolean;
  method: string;
  pathTemplate: string;
  status: number;
  expectedStatus?: number;
  errorScenario?: boolean;
  bodyShape?: any;
}

interface OpSummary {
  operationId: string;
  count: number;
  statusCounts: Record<string, number>;
  finalCount: number;
  finalStatusCounts: Record<string, number>;
  topLevelKeys: Record<string, { present: number; absent: number }>;
  examplesByStatus: Record<string, any>;
}

function ensureObj(v: any): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

async function main() {
  const cwd = process.cwd();
  const baseDir = cwd.endsWith('path-analyser') ? cwd : path.resolve(cwd, 'path-analyser');
  const input = path.join(baseDir, 'dist/runtime-observations/responses.jsonl');
  const outDir = path.join(baseDir, 'dist/runtime-observations');
  let text = '';
  try {
    text = await fs.readFile(input, 'utf8');
  } catch (e) {
    console.error('No observations found at', input);
    process.exit(1);
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const byOp = new Map<string, OpSummary>();
  for (const line of lines) {
    let obs: Observation;
    try {
      obs = JSON.parse(line);
    } catch {
      continue;
    }
    const op = obs.operationId || 'unknown';
    if (!byOp.has(op)) {
      byOp.set(op, {
        operationId: op,
        count: 0,
        statusCounts: {},
        finalCount: 0,
        finalStatusCounts: {},
        topLevelKeys: {},
        examplesByStatus: {},
      });
    }
    const s = byOp.get(op)!;
    s.count++;
    s.statusCounts[obs.status] = (s.statusCounts[obs.status] || 0) + 1;
    if (obs.isFinal) {
      s.finalCount++;
      s.finalStatusCounts[obs.status] = (s.finalStatusCounts[obs.status] || 0) + 1;
      const obj = ensureObj(obs.bodyShape);
      if (obj) {
        // Track top-level key presence frequency across final responses
        const keys = new Set(Object.keys(obj));
        const allKeys = new Set([...Object.keys(s.topLevelKeys), ...keys]);
        for (const k of allKeys) {
          const rec = s.topLevelKeys[k] || { present: 0, absent: 0 };
          if (keys.has(k)) rec.present++;
          else rec.absent++;
          s.topLevelKeys[k] = rec;
        }
        // Keep a single example per status
        if (!s.examplesByStatus[String(obs.status)]) {
          s.examplesByStatus[String(obs.status)] = obj;
        }
      }
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    operations: Array.from(byOp.values()).sort((a, b) =>
      a.operationId.localeCompare(b.operationId),
    ),
  };
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('Wrote observation summary to', path.join(outDir, 'summary.json'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
