# Camunda Path-Analyser Suite (Generated)

This directory was produced by the [api-test-generator](https://github.com/camunda/api-test-generator) `path-analyser` Playwright emitter. Every file here is regenerated on each codegen run — **do not edit manually**.

## Run

```bash
npm install
API_BASE_URL=http://localhost:8080/v2 npm test
```

If your Camunda cluster is reachable at `http://localhost:8080/v2` you can simply run:

```bash
npm install
npm test
```

See `.env.example` for the full list of supported environment variables.

## What this suite covers

End-to-end request scenarios derived from path-traversal of the OpenAPI spec — each test exercises a single endpoint plus its prerequisite setup steps. The runtime helpers under `support/` are vendored copies; do not import anything outside this directory.

## Response-shape validation

Each test that expects a success response calls `validateResponse(...)` from [`assert-json-body`](https://www.npmjs.com/package/assert-json-body), which validates the JSON body against the OpenAPI response schema in `json-body-assertions/responses.json`. That file is generated alongside the specs by the codegen step and shipped with the suite — no spec file is required at test-runtime.

### Regenerating `responses.json` against a different spec

If you want to validate against a different OpenAPI spec, place it next to this `package.json` (for example as `openapi.json`) and run:

```bash
npm run responses:regenerate
```

The default script targets `./openapi.json` and writes to `./json-body-assertions/`. To use a different path, invoke the CLI directly:

```bash
npx assert-json-body extract --specFile=path/to/spec.json --outputDir=./json-body-assertions
```

