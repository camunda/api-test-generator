namespace Camunda.Orchestration.RestSdk.Models;

public sealed record CompleteJobRequest
{
    public Dictionary<string, object?>? Variables { get; init; }
    public JobResult? Result { get; init; }
}

public sealed record JobResult
{
    public string? Type { get; init; }
    public bool? Denied { get; init; }
    public string? DeniedReason { get; init; }
    public JobResultCorrections? Corrections { get; init; }
}

public sealed record JobResultCorrections
{
    public string? Assignee { get; init; }
    public DateTimeOffset? DueDate { get; init; }
    public DateTimeOffset? FollowUpDate { get; init; }
    public IReadOnlyList<string>? CandidateUsers { get; init; }
    public IReadOnlyList<string>? CandidateGroups { get; init; }
    public int? Priority { get; init; }
}
