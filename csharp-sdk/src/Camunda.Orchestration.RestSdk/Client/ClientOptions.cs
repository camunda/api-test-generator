namespace Camunda.Orchestration.RestSdk.Client;

public sealed class ClientOptions
{
    public required Uri BaseUri { get; init; }
    public string? BearerToken { get; init; }
}
