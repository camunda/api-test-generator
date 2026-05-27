using System.Text.Json;
using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record ActivateJobsResponse
{
    public IReadOnlyList<ActivatedJob> Jobs { get; init; } = Array.Empty<ActivatedJob>();
}

public sealed record ActivatedJob
{
    public JobKey? JobKey { get; init; }
    public ProcessInstanceKey? ProcessInstanceKey { get; init; }
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public int? ProcessDefinitionVersion { get; init; }
    public ElementId? ElementId { get; init; }
    public string? Type { get; init; }
    public string? Worker { get; init; }
    public int? Retries { get; init; }
    public long? Deadline { get; init; }
    public JsonElement? Variables { get; init; }
    public JsonElement? CustomHeaders { get; init; }
    public TenantId? TenantId { get; init; }
    public ElementInstanceKey? ElementInstanceKey { get; init; }
    public string? Kind { get; init; }
    public string? ListenerEventType { get; init; }
    public ProcessInstanceKey? RootProcessInstanceKey { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
    public JsonElement? UserTask { get; init; }
}
