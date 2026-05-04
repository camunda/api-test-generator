using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record ActivateJobsRequest
{
    public required string Type { get; init; }
    public required long Timeout { get; init; }
    public required int MaxJobsToActivate { get; init; }
    public string? Worker { get; init; }
    public int? RequestTimeout { get; init; }
    public IReadOnlyList<string>? FetchVariable { get; init; }
    public IReadOnlyList<TenantId>? TenantIds { get; init; }
    public string? TenantFilter { get; init; }
}
