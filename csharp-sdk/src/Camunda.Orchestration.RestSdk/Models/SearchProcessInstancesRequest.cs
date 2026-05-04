using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record SearchProcessInstancesRequest : SearchQueryRequest
{
    public IReadOnlyList<ProcessInstanceSearchSort>? Sort { get; init; }
    public Dictionary<string, object?>? Filter { get; init; }
}

public sealed record ProcessInstanceSearchSort
{
    public string? Field { get; init; }
    public SortOrder? Order { get; init; }
}
