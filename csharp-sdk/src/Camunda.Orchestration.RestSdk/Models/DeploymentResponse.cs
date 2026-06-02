using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record DeploymentResponse
{
    public DeploymentKey? DeploymentKey { get; init; }
    public TenantId? TenantId { get; init; }
    public IReadOnlyList<DeploymentMetadataResult> Deployments { get; init; } =
        Array.Empty<DeploymentMetadataResult>();
}

public sealed record DeploymentMetadataResult
{
    public DeploymentProcessResult? ProcessDefinition { get; init; }
    public DeploymentDecisionResult? DecisionDefinition { get; init; }
    public DeploymentDecisionRequirementsResult? DecisionRequirements { get; init; }
    public DeploymentFormResult? Form { get; init; }
    public DeploymentResourceResult? Resource { get; init; }
}

public sealed record DeploymentProcessResult
{
    public ProcessDefinitionId? ProcessDefinitionId { get; init; }
    public int? ProcessDefinitionVersion { get; init; }
    public string? ResourceName { get; init; }
    public TenantId? TenantId { get; init; }
    public ProcessDefinitionKey? ProcessDefinitionKey { get; init; }
}

public sealed record DeploymentDecisionResult
{
    public DecisionDefinitionId? DecisionDefinitionId { get; init; }
    public int? Version { get; init; }
    public string? Name { get; init; }
    public TenantId? TenantId { get; init; }
    public string? DecisionRequirementsId { get; init; }
    public DecisionDefinitionKey? DecisionDefinitionKey { get; init; }
    public DecisionRequirementsKey? DecisionRequirementsKey { get; init; }
}

public sealed record DeploymentDecisionRequirementsResult
{
    public string? DecisionRequirementsId { get; init; }
    public string? DecisionRequirementsName { get; init; }
    public int? Version { get; init; }
    public string? ResourceName { get; init; }
    public TenantId? TenantId { get; init; }
    public DecisionRequirementsKey? DecisionRequirementsKey { get; init; }
}

public sealed record DeploymentFormResult
{
    public FormId? FormId { get; init; }
    public int? Version { get; init; }
    public string? ResourceName { get; init; }
    public TenantId? TenantId { get; init; }
    public FormKey? FormKey { get; init; }
}

public sealed record DeploymentResourceResult
{
    public string? ResourceId { get; init; }
    public string? ResourceName { get; init; }
    public int? Version { get; init; }
    public TenantId? TenantId { get; init; }
    public ResourceKey? ResourceKey { get; init; }
}
