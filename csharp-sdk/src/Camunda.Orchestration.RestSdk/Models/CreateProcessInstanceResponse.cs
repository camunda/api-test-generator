using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record CreateProcessInstanceResponse
{
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public int? ProcessDefinitionVersion { get; init; }
    public TenantId? TenantId { get; init; }
    public Dictionary<string, object?>? Variables { get; init; }
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
    public ProcessInstanceKey? ProcessInstanceKey { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
    public BusinessId? BusinessId { get; init; }
}
