import path from 'path';
import { buildCanonicalShapes } from '../canonicalSchemas.js';

async function main() {
  const opId = process.argv[2] || 'createDeployment';
  const baseDir = process.cwd().endsWith('path-analyser')
    ? process.cwd()
    : path.resolve(process.cwd(), 'path-analyser');
  const repoRoot = path.resolve(baseDir, '../');
  const shapes = await buildCanonicalShapes(repoRoot);
  const s = shapes[opId];
  if (!s) {
    console.error('No canonical shapes for', opId);
    process.exit(1);
  }
  console.log('Request media types:', Object.keys(s.requestByMediaType || {}));
  for (const [ct, nodes] of Object.entries(s.requestByMediaType || {})) {
    console.log(
      '  ',
      ct,
      'fields:',
      nodes.map((n: any) => `${n.path}${n.required ? '*' : ''}`),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
