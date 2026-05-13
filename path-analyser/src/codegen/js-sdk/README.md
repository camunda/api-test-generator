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

This downloads the SDK's method-to-operationId mapping from the
`@camunda8/orchestration-cluster-api` npm package and writes it to
`spec/js-sdk/operation-map.json`. Without it, the emitter falls back to
identity mapping (operationId unchanged) which works for most Camunda REST
API operations.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CAMUNDA_BASE_URL` | `http://localhost:8080` | Camunda REST API base URL |
| `CAMUNDA_CLIENT_ID` | — | OAuth2 client ID (SaaS) |
| `CAMUNDA_CLIENT_SECRET` | — | OAuth2 client secret (SaaS) |
| `CAMUNDA_OAUTH_URL` | — | OAuth2 token endpoint (SaaS) |
