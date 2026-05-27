using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record SearchProcessInstancesResponse : SearchQueryResponse
{
    public IReadOnlyList<ProcessInstanceResult> Items { get; init; } = Array.Empty<ProcessInstanceResult>();
}

public sealed record ProcessInstanceResult
{
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public string? ProcessDefinitionName { get; init; }
    public int? ProcessDefinitionVersion { get; init; }
    public string? ProcessDefinitionVersionTag { get; init; }
    public DateTimeOffset? StartDate { get; init; }
    public DateTimeOffset? EndDate { get; init; }
    public string? State { get; init; }
    public bool? HasIncident { get; init; }
    public TenantId? TenantId { get; init; }
    public ProcessInstanceKey? ProcessInstanceKey { get; init; }
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
    public ProcessInstanceKey? ParentProcessInstanceKey { get; init; }
    public ElementInstanceKey? ParentElementInstanceKey { get; init; }
    public ProcessInstanceKey? RootProcessInstanceKey { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
    public BusinessId? BusinessId { get; init; }
}
