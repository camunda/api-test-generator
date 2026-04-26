# Camunda Request Validation Suite (Generated)

This directory was produced by the [api-test-generator](https://github.com/camunda/api-test-generator) `request-validation` generator. Every file here is regenerated on each codegen run — **do not edit manually**.

## Run

```bash
npm install
CORE_APPLICATION_URL=http://localhost:8080 npm test
```

For a Camunda cluster that requires Basic auth:

```bash
CAMUNDA_BASIC_AUTH_USER=demo CAMUNDA_BASIC_AUTH_PASSWORD=demo npm test
```

See `.env.example` for the full list of supported environment variables.

## What this suite covers

Negative request-validation scenarios — every test sends an intentionally malformed request and asserts the server responds with HTTP 400. Coverage details are in `COVERAGE.md`.
