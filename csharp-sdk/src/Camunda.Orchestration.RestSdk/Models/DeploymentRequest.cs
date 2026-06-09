using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Models;

public sealed record DeploymentRequest
{
    public IReadOnlyList<DeploymentResource> Resources { get; init; } = Array.Empty<DeploymentResource>();
    public TenantId? TenantId { get; init; }
}
