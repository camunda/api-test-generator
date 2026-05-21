# JS SDK Emitter (`--target=js-sdk`)

Lowers `EndpointScenarioCollection` graphs onto the
[`@camunda8/orchestration-cluster-api`](https://github.com/camunda/orchestration-cluster-api-js)
JavaScript SDK and emits self-contained **Vitest** test suites.

## Generated file layout

```
<outDir>/
  <operationId>.feature.test.ts    # Feature scenarios
  <operationId>.integration.test.ts
  <operationId>.variant.test.ts
  support/
    seeding.ts
    seed-rules.json
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  README.md
```

## Running the generated suite

```bash
cd <outDir>
npm install
npm test
```

## Prerequisites

The operation-map file must be fetched before generation:

```bash
npm run fetch-js-sdk-map
```

This performs a git sparse clone of `camunda/orchestration-cluster-api-js` and
writes `examples/operation-map.json` to `spec/js-sdk/operation-map.json`.
Requires `git` on PATH. Without it, the emitter falls back to identity mapping
(operationId unchanged).

⚠️ **Warning**: Fallback identity mapping may not work for all operations —
some SDK methods have different names than their operationIds. Run
`npm run fetch-js-sdk-map` to ensure correct method names in generated tests.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CAMUNDA_BASE_URL` | `http://localhost:8080` | Camunda REST API base URL |
| `CAMUNDA_CLIENT_ID` | — | OAuth2 client ID (SaaS) |
| `CAMUNDA_CLIENT_SECRET` | — | OAuth2 client secret (SaaS) |
| `CAMUNDA_OAUTH_URL` | — | OAuth2 token endpoint (SaaS) |
| `JS_SDK_REF` | `main` | Branch, tag, or SHA of `camunda/orchestration-cluster-api-js` to fetch the operation map from |
