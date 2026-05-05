namespace Camunda.Orchestration.RestSdk.Models;

public sealed record JobFailRequest
{
    public int? Retries { get; init; }
    public string? ErrorMessage { get; init; }
    public long? RetryBackOff { get; init; }
    public Dictionary<string, object?>? Variables { get; init; }
}
