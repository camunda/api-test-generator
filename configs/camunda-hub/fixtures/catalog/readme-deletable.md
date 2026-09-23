---
template: test-catalog-asset-deletable.json
category: Test
tags:
  - test
---
## Test Catalog Asset (deletable)

A dedicated, disposable element template fixture for deleteCatalogAsset's
positive test. Kept separate from the shared test-catalog-asset-fixture so
deleting it doesn't break sibling tests that expect that asset to still exist.
