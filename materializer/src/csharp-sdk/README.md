# C# SDK Emitter

Generates Camunda integration tests for the C# SDK using xUnit.

## Overview

Emitter id: `csharp-sdk`

Generates a runnable xUnit integration test suite that uses the Camunda C# orchestration SDK
(`Camunda.Orchestration.Sdk`). Each endpoint emits one `*.Tests.cs` file under a per-operation
directory.

## Output layout

```
<outDir>/
        CamundaIntegrationTests.csproj
        TestFixtureBase.cs
        README.md
        fixtures/
        ActivateJobs/
                ActivateJobs.feature.Tests.cs
        CreateProcessInstance/
                CreateProcessInstance.feature.Tests.cs
```

## SDK method mapping

The emitter maps `operationId` values to SDK methods using a mapping loaded from
`spec/csharp-sdk/operation-map.json` in the repository root. If no mapping is available, the
emitter falls back to `PascalCase(operationId) + "Async"`.

## Running the tests

```bash
cd <outDir>
dotnet test CamundaIntegrationTests.csproj
```

Tests are run via the `CamundaClient` SDK. Fixture paths (`@@FILE:<rel-path>` markers in scenarios)
are resolved via `AppContext.BaseDirectory` at runtime, so tests work regardless of the working
directory.

## Environment variables

The generated suite relies on `CamundaClient.Create()` and the SDK's environment-variable
configuration:

- CAMUNDA_REST_ADDRESS
- CAMUNDA_AUTH_STRATEGY (set to "OAUTH" for SaaS)
- CAMUNDA_CLIENT_ID
- CAMUNDA_CLIENT_SECRET
- CAMUNDA_OAUTH_URL

## Supported scenario shapes

- JSON request bodies
- Path parameters and request-body bindings
- Extraction into per-scenario context via response field paths
- Response shape assertions for final steps (top-level fields)
- Multipart request bodies (for deployments and document management)
