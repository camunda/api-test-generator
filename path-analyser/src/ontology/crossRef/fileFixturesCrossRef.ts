// Per-slice cross-reference module for `fileFixturesSchema.ts`.
//
// The file-fixtures ABox maps operationId → fieldName → fixturePath.
// Cross-reference checks: operationIds and fixture paths are validated
// at L3 invariant time (against the live graph and fixtures directory)
// rather than here, because the cross-ref validator runs before the
// graph is fully assembled.
//
// No structural coherence invariants are needed beyond what the JSON
// Schema TBox already enforces (pattern-validated paths, no duplicate
// keys since objects can't have duplicate keys in JSON).

import type { SliceCrossRefModule } from './types.js';

export const FILE_FIXTURES_CROSS_REF: SliceCrossRefModule = {
  slice: 'fileFixtures',
  checks: [],
  noChecksRationale:
    'The file-fixtures ABox only maps operationId → fieldName → fixturePath. ' +
    'Cross-references against the live operation graph and the fixtures directory ' +
    'are enforced as L3 invariants in configs/<config>/regression-invariants.test.ts ' +
    'rather than here, because the cross-ref validator runs before the graph is assembled.',
};
