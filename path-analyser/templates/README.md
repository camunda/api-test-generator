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
