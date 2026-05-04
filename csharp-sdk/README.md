# Camunda Orchestration REST SDK (C#)

Minimal REST client scaffold intended for the api-test-generator SDK emitter.

Status: minimal endpoints and DTOs are stubbed and should be verified against the
bundled OpenAPI spec before production use.

## Included endpoints

- Create deployment
- Create process instance
- Cancel process instance
- Search process instances
- Activate jobs
- Complete job

## Usage (sample)

See [csharp-sdk/examples/usage.cs](csharp-sdk/examples/usage.cs) for a minimal example.

## Build

Requires .NET SDK 8.x:

```bash
dotnet build csharp-sdk/src/Camunda.Orchestration.RestSdk/Camunda.Orchestration.RestSdk.csproj
```
