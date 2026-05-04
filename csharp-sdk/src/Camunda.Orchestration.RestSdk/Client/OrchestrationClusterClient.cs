using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Camunda.Orchestration.RestSdk.Models;
using Camunda.Orchestration.RestSdk.Types;

namespace Camunda.Orchestration.RestSdk.Client;

public sealed class OrchestrationClusterClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient httpClient;
    private readonly Uri baseUri;

    public OrchestrationClusterClient(HttpClient httpClient, Uri baseUri, string? bearerToken = null)
    {
        this.httpClient = httpClient;
        this.baseUri = baseUri;
        if (!string.IsNullOrWhiteSpace(bearerToken))
        {
            this.httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", bearerToken);
        }
    }

    public OrchestrationClusterClient(HttpClient httpClient, ClientOptions options)
        : this(httpClient, options.BaseUri, options.BearerToken)
    {
    }

    public Uri BaseUri => baseUri;

    public async Task<DeploymentResponse> CreateDeploymentAsync(
        DeploymentRequest request,
        CancellationToken cancellationToken = default)
    {
        using var content = new MultipartFormDataContent();
        if (request.TenantId is not null)
        {
            content.Add(new StringContent(request.TenantId.ToString()!, Encoding.UTF8), "tenantId");
        }
        foreach (var resource in request.Resources)
        {
            var bytes = new ByteArrayContent(resource.Content);
            bytes.Headers.ContentType = new MediaTypeHeaderValue(resource.ContentType);
            content.Add(bytes, "resources", resource.FileName);
        }

        var response = await httpClient.PostAsync(BuildUri("/deployments"), content, cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return Deserialize<DeploymentResponse>(body);
    }

    public async Task<CreateProcessInstanceResponse> CreateProcessInstanceAsync(
        CreateProcessInstanceRequest request,
        CancellationToken cancellationToken = default)
    {
        return await PostJsonAsync<CreateProcessInstanceRequest, CreateProcessInstanceResponse>(
            "/process-instances",
            request,
            cancellationToken);
    }

    public async Task CancelProcessInstanceAsync(
        ProcessInstanceKey processInstanceKey,
        CancelProcessInstanceRequest? request = null,
        CancellationToken cancellationToken = default)
    {
        var path = $"/process-instances/{processInstanceKey}/cancellation";
        if (request is null)
        {
            await PostNoContentAsync(path, cancellationToken);
            return;
        }
        await PostJsonNoResponseAsync(path, request, cancellationToken);
    }

    public async Task<SearchProcessInstancesResponse> SearchProcessInstancesAsync(
        SearchProcessInstancesRequest request,
        CancellationToken cancellationToken = default)
    {
        return await PostJsonAsync<SearchProcessInstancesRequest, SearchProcessInstancesResponse>(
            "/process-instances/search",
            request,
            cancellationToken);
    }

    public async Task<ActivateJobsResponse> ActivateJobsAsync(
        ActivateJobsRequest request,
        CancellationToken cancellationToken = default)
    {
        return await PostJsonAsync<ActivateJobsRequest, ActivateJobsResponse>(
            "/jobs/activation",
            request,
            cancellationToken);
    }

    public async Task CompleteJobAsync(
        JobKey jobKey,
        CompleteJobRequest? request = null,
        CancellationToken cancellationToken = default)
    {
        var path = $"/jobs/{jobKey}/completion";
        if (request is null)
        {
            await PostNoContentAsync(path, cancellationToken);
            return;
        }
        await PostJsonNoResponseAsync(path, request, cancellationToken);
    }

    private async Task<TResponse> PostJsonAsync<TRequest, TResponse>(
        string path,
        TRequest request,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(request, JsonOptions);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await httpClient.PostAsync(BuildUri(path), content, cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return Deserialize<TResponse>(body);
    }

    private async Task PostJsonNoResponseAsync<TRequest>(
        string path,
        TRequest request,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(request, JsonOptions);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await httpClient.PostAsync(BuildUri(path), content, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task PostNoContentAsync(string path, CancellationToken cancellationToken)
    {
        var response = await httpClient.PostAsync(BuildUri(path), content: null, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private Uri BuildUri(string path) => new(baseUri, path);

    private static T Deserialize<T>(string json)
    {
        var result = JsonSerializer.Deserialize<T>(json, JsonOptions);
        if (result is null)
        {
            throw new InvalidOperationException("Response payload was empty or invalid JSON.");
        }
        return result;
    }
}
