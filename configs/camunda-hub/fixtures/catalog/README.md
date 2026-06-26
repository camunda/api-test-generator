---
template: element-template.json
category: Test
tags:
  - apitest
  - generated
---
## Description

Catalog asset fixture for the generated API-test positive suite. Paired with
`element-template.json` (referenced above by file name, per the
ingestCatalogAssets contract).

## Usage

Ingested by the generated `ingestCatalogAssets` positive test to exercise the
`PUT /catalog/assets/ingestion` multipart upload. Not intended for production
catalogs.
