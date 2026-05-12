# Camunda C# SDK integration tests

## Requirements
- .NET 8 SDK
- Access to a Camunda REST endpoint (local or SaaS)

## Run
```
dotnet test
```

## Environment variables
The Camunda C# SDK uses environment variables for configuration. The generated
suite relies on the SDK defaults via `CamundaClient.Create()` and supports:

- CAMUNDA_REST_ADDRESS
- CAMUNDA_AUTH_STRATEGY (set to "OAUTH" for SaaS)
- CAMUNDA_CLIENT_ID
- CAMUNDA_CLIENT_SECRET
- CAMUNDA_OAUTH_URL
