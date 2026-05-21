# C# SDK Emitter (`--target=csharp-sdk`)

Lowers `EndpointScenarioCollection` graphs onto the
[Camunda.Orchestration.RestSdk](https://github.com/camunda/camunda-orchestration-rest-sdk-csharp)
C# SDK and emits self-contained **.NET 8** test classes.

## Generated file layout

```
<outDir>/
  CamundaIntegrationTests.csproj
  .env.example
  README.md
  csharp/
    <operationId>.feature.cs
    <operationId>.integration.cs
    <operationId>.variant.cs
```

## Running the generated suite

```bash
cd <outDir>
cp .env.example .env   # fill in connection details
dotnet restore
dotnet run
```

## Prerequisites

The C# operation-map file must be present before generation. The map is
bundled with the `csharp-sdk/` workspace under `operation-map.ts`. Unlike
the JS/Python SDK emitters, the C# map is a static JSON document committed
to the repository — no separate fetch step is required.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CAMUNDA_BASE_URL` | `http://localhost:8080/v2/` | Camunda REST API base URL |
| `CAMUNDA_CLIENT_ID` | — | OAuth2 client ID (SaaS only) |
| `CAMUNDA_CLIENT_SECRET` | — | OAuth2 client secret (SaaS only) |
| `CAMUNDA_OAUTH_URL` | — | OAuth2 token endpoint URL (SaaS only) |

## Code structure

Each emitted `.cs` file declares a single `public static class GeneratedSuite`
in the `Camunda.Orchestration.RestSdk.Generated` namespace. Each scenario
becomes an `async Task` method. Helper methods (`FromTemplate<T>`,
`ResolveTemplate`, `ApplyExtract`, `TryExtract`) are inlined per file so the
suite is self-contained with no cross-file dependencies.
