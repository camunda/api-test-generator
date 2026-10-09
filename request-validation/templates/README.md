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

Negative request-validation scenarios — most tests send an intentionally malformed request and assert a refusal (HTTP 400, or 401, 403 or 404 for the auth and not-found kinds). A few send an edge case the server accepts (a pagination offset past the total, a search filter that is never validated) and assert HTTP 200. Coverage details are in `COVERAGE.md`.
