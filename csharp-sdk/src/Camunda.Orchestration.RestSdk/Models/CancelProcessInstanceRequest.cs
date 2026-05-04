namespace Camunda.Orchestration.RestSdk.Models;

public sealed record CancelProcessInstanceRequest
{
    public long? OperationReference { get; init; }
}
