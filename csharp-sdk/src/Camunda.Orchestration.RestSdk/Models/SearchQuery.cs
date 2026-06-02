namespace Camunda.Orchestration.RestSdk.Models;

public record SearchQueryRequest
{
    public SearchQueryPageRequest? Page { get; init; }
}

public sealed record SearchQueryPageRequest
{
    public int? Limit { get; init; }
    public int? From { get; init; }
    public string? After { get; init; }
    public string? Before { get; init; }
}

public record SearchQueryResponse
{
    public SearchQueryPageResponse? Page { get; init; }
}

public sealed record SearchQueryPageResponse
{
    public long? TotalItems { get; init; }
    public bool? HasMoreTotalItems { get; init; }
    public string? StartCursor { get; init; }
    public string? EndCursor { get; init; }
}

public enum SortOrder
{
    ASC,
    DESC,
}
