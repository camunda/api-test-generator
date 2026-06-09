using Camunda.Orchestration.RestSdk.Client;
using Camunda.Orchestration.RestSdk.Models;
using Camunda.Orchestration.RestSdk.Types;

var httpClient = new HttpClient();
var client = new OrchestrationClusterClient(
    httpClient,
    new ClientOptions { BaseUri = new Uri("http://localhost:8080/v2/") }
);

var deployment = await client.CreateDeploymentAsync(
    new DeploymentRequest
    {
        TenantId = new TenantId("<default>"),
        Resources = new List<DeploymentResource>
        {
            new(
                FileName: "process.bpmn",
                ContentType: "application/octet-stream",
                Content: await File.ReadAllBytesAsync("process.bpmn")
            ),
        },
    }
);

var createInstance = await client.CreateProcessInstanceAsync(
    new CreateProcessInstanceRequest
    {
        ProcessDefinitionKey = deployment.Deployments[0].ProcessDefinition?.ProcessDefinitionKey,
        Variables = new Dictionary<string, object?> { ["foo"] = "bar" },
    }
);

var activation = await client.ActivateJobsAsync(
    new ActivateJobsRequest
    {
        Type = "service-task",
        Timeout = 45000,
        MaxJobsToActivate = 1,
        Worker = "sdk-sample",
    }
);

if (activation.Jobs.Count > 0)
{
    await client.CompleteJobAsync(activation.Jobs[0].JobKey!, new CompleteJobRequest());
}
