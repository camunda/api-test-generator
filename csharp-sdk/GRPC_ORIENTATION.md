# gRPC Orientation Notes (zeebe-client-csharp)

This note documents the gRPC-only baseline of the community C# client so the
REST SDK work can be compared against it.

## What was reviewed

- `Client.Cloud.Example/Program.cs` shows `CamundaCloudClientBuilder` usage for
  Camunda Cloud, then calls `TopologyRequest().Send()`.
- `Client.Examples/Program.cs` shows a local gateway flow:
  deploy BPMN, create process instance, and open a job worker.

## Observations

- The client is a gRPC wrapper; all interaction is via gRPC commands.
- Key types are plain numeric values (e.g., `processDefinitionKey` and
  `job.Key` are `long`-like values), with no distinct semantic wrappers.
- The job worker API uses `IJobClient`/`IJob` with plain numeric keys and
  JSON string payloads.

## Local run attempt

- `dotnet build Zeebe.sln` succeeded, with analyzer warnings.
- Running the Camunda Cloud example was blocked by `global.json` requiring
  .NET SDK 10.0.201 (only 8.0.420 is installed here).
- The `camunda-platform` repo no longer ships Docker Compose files; the README
  points to the Camunda Docker Compose quickstart artifacts instead.
- Downloaded the Camunda 8 Docker Compose quickstart (8.9) from the Camunda
  distributions release and extracted it locally.
- `docker compose up -d` initially failed with a port bind error on
  `0.0.0.0:8080`. The compose file was updated to publish the HTTP port on
  `8088` instead, and the stack started successfully.
- The Orchestration Cluster container is healthy; gRPC is listening on
  `localhost:26500` and HTTP is reachable at `http://localhost:8088`.

## Next steps to fully execute the quick start

1. Install .NET SDK 10.0.201 or adjust `global.json` for a supported SDK.
2. Provide real Camunda Cloud credentials (`ZEEBE_CLIENT_ID`,
   `ZEEBE_CLIENT_SECRET`, `ZEEBE_ADDRESS`) or run against a local gateway.
3. Re-run the Cloud example and record the runtime outputs.

## Next steps for local Docker Compose

1. Re-run `docker compose up -d` in the extracted quickstart directory.
2. Verify the Orchestration Cluster is reachable:
  - REST API: `http://localhost:8088/v2`
  - gRPC API: `localhost:26500`
3. Re-run the local example and capture the console output.

## Local Zeebe gateway run recipe (when credentials are unavailable)

1. Start a local Camunda 8 / Zeebe gateway (for example, via your preferred
  docker-based dev stack) and confirm the gateway is reachable at a host:port
  such as `0.0.0.0:26500`.
2. In the zeebe client repo, run the local examples project:

  ```bash
  export PATH="$HOME/.dotnet:$PATH"
  dotnet run --project Client.Examples/Client.Examples.csproj
  ```

3. If your gateway is not on the default `0.0.0.0:26500`, update the
  `ZeebeUrl` constant in `Client.Examples/Program.cs` before running.
4. Confirm the deploy → create instance → job worker sequence completes and
  record the key types observed in the console output.
