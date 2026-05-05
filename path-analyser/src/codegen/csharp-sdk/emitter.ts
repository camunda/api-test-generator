import type { EndpointScenarioCollection } from '../../types.js';
import type { EmitContext, EmittedFile, Emitter } from '../emitter.js';

export interface CsharpOperationMapEntry {
  file?: string;
  region?: string;
  label?: string;
}

export type CsharpOperationMap = Record<string, CsharpOperationMapEntry[]>;

export function createCsharpEmitter(map: CsharpOperationMap): Emitter {
  return {
    id: 'csharp-sdk',
    name: 'C# SDK',
    async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
      const relativePath = `csharp/${collection.endpoint.operationId}.${ctx.mode}.cs`;
      const content = renderCsharpSuite(collection, ctx, map);
      return [{ relativePath, content }];
    },
  };
}

function renderCsharpSuite(
  collection: EndpointScenarioCollection,
  ctx: EmitContext,
  map: CsharpOperationMap,
): string {
  const lines: string[] = [];
  const suiteName = ctx.suiteName || collection.endpoint.operationId;
  lines.push('using System;');
  lines.push('using System.Collections.Generic;');
  lines.push('using System.IO;');
  lines.push('using System.Net.Http;');
  lines.push('using System.Text.Json;');
  lines.push('using System.Threading.Tasks;');
  lines.push('using Camunda.Orchestration.RestSdk.Client;');
  lines.push('using Camunda.Orchestration.RestSdk.Models;');
  lines.push('using Camunda.Orchestration.RestSdk.Types;');
  lines.push('');
  lines.push('namespace Camunda.Orchestration.RestSdk.Generated;');
  lines.push('');
  lines.push('public static class GeneratedSuite');
  lines.push('{');
  lines.push(`    public static async Task ${pascalCase(suiteName)}Async()`);
  lines.push('    {');
  lines.push('        using var httpClient = new HttpClient();');
  lines.push('        var client = new OrchestrationClusterClient(');
  lines.push('            httpClient,');
  lines.push('            new ClientOptions { BaseUri = new Uri("http://localhost:8080/v2/") }');
  lines.push('        );');
  lines.push('        var ctx = new Dictionary<string, object?>();');
  lines.push('');
  for (const scenario of collection.scenarios) {
    lines.push(`        // Scenario ${scenario.id}${scenario.name ? ` - ${scenario.name}` : ''}`);
    const ops = scenario.operations?.map((o) => o.operationId).join(' -> ');
    if (ops) lines.push(`        // Chain: ${ops}`);
    if (!scenario.requestPlan || scenario.requestPlan.length === 0) {
      lines.push('        // TODO: No request plan available');
      lines.push('');
      continue;
    }
    for (const step of scenario.requestPlan) {
      lines.push(`        // Step: ${step.operationId}`);
      const methodName = resolveMethodName(step.operationId, map);
      if (!methodName) {
        lines.push(`        // TODO: No SDK mapping for ${step.operationId}`);
        lines.push('');
        continue;
      }
      emitStep(lines, step.operationId, methodName, step);
      lines.push('');
    }
  }
  lines.push('    }');
  lines.push('');
  lines.push('    private static T FromTemplate<T>(object? template)');
  lines.push('    {');
  lines.push('        var json = JsonSerializer.Serialize(template);');
  lines.push('        var result = JsonSerializer.Deserialize<T>(json);');
  lines.push('        if (result is null)');
  lines.push('        {');
  lines.push('            throw new InvalidOperationException("Template deserialization failed.");');
  lines.push('        }');
  lines.push('        return result;');
  lines.push('    }');
  lines.push('');
  lines.push('    private static object? ResolveTemplate(object? template, Dictionary<string, object?> ctx)');
  lines.push('    {');
  lines.push('        if (template is null) return null;');
  lines.push('        if (template is string s)');
  lines.push('        {');
  lines.push('            if (s.StartsWith("${") && s.EndsWith("}"))');
  lines.push('            {');
  lines.push('                var key = s[2..^1];');
  lines.push('                return ctx.TryGetValue(key, out var v) ? v : null;');
  lines.push('            }');
  lines.push('            return s;');
  lines.push('        }');
  lines.push('        if (template is Dictionary<string, object?> dict)');
  lines.push('        {');
  lines.push('            var resolved = new Dictionary<string, object?>();');
  lines.push('            foreach (var (key, value) in dict)');
  lines.push('            {');
  lines.push('                resolved[key] = ResolveTemplate(value, ctx);');
  lines.push('            }');
  lines.push('            return resolved;');
  lines.push('        }');
  lines.push('        if (template is List<object?> list)');
  lines.push('        {');
  lines.push('            var resolved = new List<object?>();');
  lines.push('            foreach (var item in list)');
  lines.push('            {');
  lines.push('                resolved.Add(ResolveTemplate(item, ctx));');
  lines.push('            }');
  lines.push('            return resolved;');
  lines.push('        }');
  lines.push('        return template;');
  lines.push('    }');
  lines.push('');
  lines.push('    private static string GetRequiredString(Dictionary<string, object?> ctx, string key)');
  lines.push('    {');
  lines.push('        if (!ctx.TryGetValue(key, out var value) || value is null)');
  lines.push('        {');
  lines.push('            throw new InvalidOperationException($"Missing required binding: {key}");');
  lines.push('        }');
  lines.push('        return value.ToString() ?? string.Empty;');
  lines.push('    }');
  lines.push('');
  lines.push('    private static void ApplyExtract(Dictionary<string, object?> ctx, object response, string fieldPath, string bind)');
  lines.push('    {');
  lines.push('        var root = JsonSerializer.SerializeToElement(response);');
  lines.push('        if (TryExtract(root, fieldPath, out var value))');
  lines.push('        {');
  lines.push('            ctx[bind] = value;');
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    private static bool TryExtract(JsonElement element, string fieldPath, out object? value)');
  lines.push('    {');
  lines.push('        value = null;');
  lines.push('        var current = element;');
  lines.push('        foreach (var rawPart in fieldPath.Split("."))');
  lines.push('        {');
  lines.push('            var part = rawPart;');
  lines.push('            int? index = null;');
  lines.push('            if (part.EndsWith("[]"))');
  lines.push('            {');
  lines.push('                part = part[..^2];');
  lines.push('                index = 0;');
  lines.push('            }');
  lines.push("            var bracket = part.IndexOf('[');");
  lines.push('            if (bracket >= 0 && part.EndsWith("]"))');
  lines.push('            {');
  lines.push('                var name = part[..bracket];');
  lines.push('                var indexText = part[(bracket + 1)..^1];');
  lines.push('                if (int.TryParse(indexText, out var parsed)) index = parsed;');
  lines.push('                part = name;');
  lines.push('            }');
  lines.push('            if (!current.TryGetProperty(part, out current)) return false;');
  lines.push('            if (index is not null)');
  lines.push('            {');
  lines.push('                if (current.ValueKind != JsonValueKind.Array) return false;');
  lines.push('                if (current.GetArrayLength() == 0) return false;');
  lines.push('                current = current[index.Value];');
  lines.push('            }');
  lines.push('        }');
  lines.push('        value = current.ValueKind switch');
  lines.push('        {');
  lines.push('            JsonValueKind.String => current.GetString(),');
  lines.push('            JsonValueKind.Number => current.ToString(),');
  lines.push('            JsonValueKind.True => true,');
  lines.push('            JsonValueKind.False => false,');
  lines.push('            JsonValueKind.Null => null,');
  lines.push('            _ => current.ToString(),');
  lines.push('        };');
  lines.push('        return true;');
  lines.push('    }');
  lines.push('');
  lines.push('    private static DeploymentRequest BuildDeploymentRequest(object? template, Dictionary<string, object?> ctx)');
  lines.push('    {');
  lines.push('        var resolved = ResolveTemplate(template, ctx) as Dictionary<string, object?>;');
  lines.push('        var fields = resolved != null && resolved.TryGetValue("fields", out var f)');
  lines.push('            ? f as Dictionary<string, object?>');
  lines.push('            : null;');
  lines.push('        var files = resolved != null && resolved.TryGetValue("files", out var filesObj)');
  lines.push('            ? filesObj as Dictionary<string, object?>');
  lines.push('            : null;');
  lines.push('        var resources = new List<DeploymentResource>();');
  lines.push('        if (files != null)');
  lines.push('        {');
  lines.push('            foreach (var (key, value) in files)');
  lines.push('            {');
  lines.push('                if (value is not string pathValue) continue;');
  lines.push('                var path = pathValue.StartsWith("@@FILE:") ? pathValue[7..] : pathValue;');
  lines.push('                var content = File.ReadAllBytes(path);');
  lines.push('                var fileName = Path.GetFileName(path);');
  lines.push('                resources.Add(new DeploymentResource(fileName, "application/octet-stream", content));');
  lines.push('            }');
  lines.push('        }');
  lines.push('        TenantId? tenantId = null;');
  lines.push('        if (fields != null && fields.TryGetValue("tenantId", out var tenant))');
  lines.push('        {');
  lines.push('            tenantId = tenant?.ToString();');
  lines.push('        }');
  lines.push('        return new DeploymentRequest { TenantId = tenantId, Resources = resources };');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function pascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

function resolveMethodName(opId: string, map: CsharpOperationMap): string | undefined {
  const mapped = map[opId]?.[0]?.region;
  if (mapped) return mapped;
  return DEFAULT_METHOD_BY_OP_ID[opId];
}

function emitStep(
  lines: string[],
  opId: string,
  methodName: string,
  step: {
    bodyTemplate?: unknown;
    multipartTemplate?: unknown;
    pathParams?: { name: string; var: string }[];
    extract?: { fieldPath: string; bind: string }[];
  },
): void {
  const responseVar = `${opId}Response`;
  if (opId === 'createDeployment') {
    lines.push('        var deploymentTemplate = ' + renderTemplate(step.multipartTemplate) + ';');
    lines.push('        var deploymentRequest = BuildDeploymentRequest(deploymentTemplate, ctx);');
    lines.push(`        var ${responseVar} = await client.${methodName}(deploymentRequest);`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'createProcessInstance') {
    lines.push('        var instanceTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var instanceRequest = FromTemplate<CreateProcessInstanceRequest>(ResolveTemplate(instanceTemplate, ctx));');
    lines.push(`        var ${responseVar} = await client.${methodName}(instanceRequest);`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'searchProcessInstances') {
    lines.push('        var searchTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var searchRequest = FromTemplate<SearchProcessInstancesRequest>(ResolveTemplate(searchTemplate, ctx));');
    lines.push(`        var ${responseVar} = await client.${methodName}(searchRequest);`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'getProcessInstance') {
    const pathVar = step.pathParams?.find((p) => p.name === 'processInstanceKey')?.var;
    const processInstanceKey = pathVar ? `GetRequiredString(ctx, "${pathVar}")` : 'string.Empty';
    lines.push(`        var ${responseVar} = await client.${methodName}(${processInstanceKey});`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'activateJobs') {
    lines.push('        var activationTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var activationRequest = FromTemplate<ActivateJobsRequest>(ResolveTemplate(activationTemplate, ctx));');
    lines.push(`        var ${responseVar} = await client.${methodName}(activationRequest);`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'searchJobs') {
    lines.push('        var searchTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var searchRequest = FromTemplate<JobSearchRequest>(ResolveTemplate(searchTemplate, ctx));');
    lines.push(`        var ${responseVar} = await client.${methodName}(searchRequest);`);
    emitExtracts(lines, responseVar, step.extract);
    return;
  }
  if (opId === 'completeJob') {
    const pathVar = step.pathParams?.find((p) => p.name === 'jobKey')?.var;
    const jobKey = pathVar ? `GetRequiredString(ctx, "${pathVar}")` : 'string.Empty';
    lines.push('        var completionTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var completionRequest = FromTemplate<CompleteJobRequest>(ResolveTemplate(completionTemplate, ctx));');
    lines.push(`        await client.${methodName}(${jobKey}, completionRequest);`);
    return;
  }
  if (opId === 'failJob') {
    const pathVar = step.pathParams?.find((p) => p.name === 'jobKey')?.var;
    const jobKey = pathVar ? `GetRequiredString(ctx, "${pathVar}")` : 'string.Empty';
    lines.push('        var failureTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var resolvedFailure = ResolveTemplate(failureTemplate, ctx);');
    lines.push('        if (resolvedFailure is null)');
    lines.push('        {');
    lines.push(`            await client.${methodName}(${jobKey});`);
    lines.push('        }');
    lines.push('        else');
    lines.push('        {');
    lines.push('            var failureRequest = FromTemplate<JobFailRequest>(resolvedFailure);');
    lines.push(`            await client.${methodName}(${jobKey}, failureRequest);`);
    lines.push('        }');
    return;
  }
  if (opId === 'cancelProcessInstance') {
    const pathVar = step.pathParams?.find((p) => p.name === 'processInstanceKey')?.var;
    const processInstanceKey = pathVar ? `GetRequiredString(ctx, "${pathVar}")` : 'string.Empty';
    lines.push('        var cancelTemplate = ' + renderTemplate(step.bodyTemplate) + ';');
    lines.push('        var cancelRequest = FromTemplate<CancelProcessInstanceRequest>(ResolveTemplate(cancelTemplate, ctx));');
    lines.push(`        await client.${methodName}(${processInstanceKey}, cancelRequest);`);
    return;
  }
  lines.push(`        // TODO: Unsupported operation ${opId}`);
}

function emitExtracts(
  lines: string[],
  responseVar: string,
  extracts: { fieldPath: string; bind: string }[] | undefined,
): void {
  if (!extracts || extracts.length === 0) return;
  for (const ex of extracts) {
    lines.push(`        ApplyExtract(ctx, ${responseVar}, '${ex.fieldPath}', '${ex.bind}');`);
  }
}

function renderTemplate(value: unknown): string {
  return renderValue(value);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => renderValue(item)).join(', ');
    return `new List<object?> { ${items} }`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => `[${JSON.stringify(key)}] = ${renderValue(v)}`)
      .join(', ');
    return `new Dictionary<string, object?> { ${entries} }`;
  }
  return 'null';
}

const DEFAULT_METHOD_BY_OP_ID: Record<string, string> = {
  createDeployment: 'CreateDeploymentAsync',
  createProcessInstance: 'CreateProcessInstanceAsync',
  searchProcessInstances: 'SearchProcessInstancesAsync',
  getProcessInstance: 'GetProcessInstanceAsync',
  activateJobs: 'ActivateJobsAsync',
  searchJobs: 'SearchJobsAsync',
  completeJob: 'CompleteJobAsync',
  failJob: 'FailJobAsync',
  cancelProcessInstance: 'CancelProcessInstanceAsync',
};
