using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record JobSearchRequest : SearchQueryRequest
{
    public IReadOnlyList<JobSearchSort>? Sort { get; init; }
    public Dictionary<string, object?>? Filter { get; init; }
}

public sealed record JobSearchSort
{
    public string? Field { get; init; }
    public SortOrder? Order { get; init; }
}

public sealed record JobSearchResponse : SearchQueryResponse
{
    public IReadOnlyList<JobSearchResult> Items { get; init; } = Array.Empty<JobSearchResult>();
}

public sealed record JobSearchResult
{
    public Dictionary<string, string>? CustomHeaders { get; init; }
    public ElementId? ElementId { get; init; }
    public ElementInstanceKey? ElementInstanceKey { get; init; }
    public bool? HasFailedWithRetriesLeft { get; init; }
    public JobKey? JobKey { get; init; }
    public string? Kind { get; init; }
    public string? ListenerEventType { get; init; }
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
    public ProcessInstanceKey? ProcessInstanceKey { get; init; }
    public int? Retries { get; init; }
    public string? State { get; init; }
    public TenantId? TenantId { get; init; }
    public string? Type { get; init; }
    public string? Worker { get; init; }
    public ProcessInstanceKey? RootProcessInstanceKey { get; init; }
    public DateTimeOffset? CreationTime { get; init; }
    public DateTimeOffset? Deadline { get; init; }
    public string? DeniedReason { get; init; }
    public DateTimeOffset? EndTime { get; init; }
    public string? ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }
    public bool? IsDenied { get; init; }
    public DateTimeOffset? LastUpdateTime { get; init; }
}
