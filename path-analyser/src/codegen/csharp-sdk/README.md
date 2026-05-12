# C# SDK emitter

Emitter id: `csharp-sdk`

## Overview
Generates a runnable xUnit integration test suite that uses the Camunda C#
orchestration SDK (`Camunda.Orchestration.Sdk`). Each endpoint emits one
`*.Tests.cs` file under a per-operation directory.

## Output layout
```
<outDir>/
	CamundaIntegrationTests.csproj
	TestFixtureBase.cs
	README.md
	ActivateJobs/
		ActivateJobs.feature.Tests.cs
	CreateProcessInstance/
		CreateProcessInstance.feature.Tests.cs
```

## SDK method mapping
The emitter maps `operationId` values to SDK methods using the C# SDK's
`examples/operation-map.json`. The path is resolved as follows:

1. `CAMUNDA_CSHARP_SDK_PATH` if set (directory; file path also accepted)
2. `../orchestration-cluster-api-csharp/examples/operation-map.json`

If no mapping is available, the emitter falls back to
`PascalCase(operationId) + "Async"`.

## Environment variables
The generated suite relies on `CamundaClient.Create()` and the SDK's
environment-variable configuration:

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

Multipart request bodies are not supported by the emitter and will throw.
