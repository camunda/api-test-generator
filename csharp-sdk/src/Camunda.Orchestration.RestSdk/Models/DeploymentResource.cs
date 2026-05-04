namespace Camunda.Orchestration.RestSdk.Models;

public sealed record DeploymentResource(
    string FileName,
    string ContentType,
    byte[] Content
);
