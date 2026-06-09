using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record CreateProcessInstanceRequest
{
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public int? ProcessDefinitionVersion { get; init; }
    public Dictionary<string, object?>? Variables { get; init; }
    public TenantId? TenantId { get; init; }
    public long? OperationReference { get; init; }
    public IReadOnlyList<StartInstruction>? StartInstructions { get; init; }
    public IReadOnlyList<RuntimeInstruction>? RuntimeInstructions { get; init; }
    public bool? AwaitCompletion { get; init; }
    public IReadOnlyList<string>? FetchVariables { get; init; }
    public long? RequestTimeout { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
    public BusinessId? BusinessId { get; init; }
}

public sealed record StartInstruction
{
    public ElementId? ElementId { get; init; }
}

public sealed record RuntimeInstruction
{
    public string? Type { get; init; }
    public ElementId? AfterElementId { get; init; }
}
