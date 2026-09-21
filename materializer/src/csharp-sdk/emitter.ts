import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import { assertSafeGlobalContextSeeds } from 'path-analyser/ontology/loader';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  EventualWaitSpec,
  GlobalContextSeed,
  RequestStep,
} from 'path-analyser/types';
// Reused rather than re-implemented: the Playwright emitter already owns the
// canonical logic for deciding which client-minted bindings need a
// `{ unique: true }` seed (#304 — client-minted, not extracted from an
// earlier step, and the consuming step declares HTTP 409). See #342 for the
// omitWhenUnbound half of the same contract.
import { computeUniqueBindings } from '../playwright/ctxSeeding.js';
import {
  type CsharpOperationMap,
  type CsharpOperationMapEntry,
  CsharpOperationMapSource,
  type SdkMappingSource,
} from './sdk-mapping.js';

export type { CsharpOperationMap, CsharpOperationMapEntry };

const CSHARP_REQUEST_TYPE_BY_OPERATION: Record<string, string> = {
  createDeployment: 'DeploymentRequest',
  createUser: 'UserRequest',
  createTenant: 'TenantCreateRequest',
  createGroup: 'GroupCreateRequest',
  createMappingRule: 'MappingRuleCreateRequest',
  searchProcessInstances: 'ProcessInstanceSearchQuery',
  searchProcessDefinitions: 'ProcessDefinitionSearchQuery',
  searchProcessInstanceIncidents: 'IncidentSearchQuery',
  searchDecisionDefinitions: 'DecisionDefinitionSearchQuery',
  searchDecisionInstances: 'DecisionInstanceSearchQuery',
  searchDecisionRequirements: 'DecisionRequirementsSearchQuery',
  searchUserTasks: 'UserTaskSearchQuery',
  searchUserTaskVariables: 'SearchUserTaskVariablesRequest',
  searchUserTaskAuditLogs: 'UserTaskAuditLogSearchQueryRequest',
  activateJobs: 'JobActivationRequest',
  searchJobs: 'JobSearchQuery',
  searchMessageSubscriptions: 'MessageSubscriptionSearchQuery',
  searchCorrelatedMessageSubscriptions: 'CorrelatedMessageSubscriptionSearchQuery',
  searchIncidents: 'IncidentSearchQuery',
  searchAuthorizations: 'AuthorizationSearchQuery',
  searchUsers: 'UserSearchQueryRequest',
  searchGroups: 'GroupSearchQueryRequest',
  searchUsersForGroup: 'GroupUserSearchQueryRequest',
  searchClientsForGroup: 'GroupClientSearchQueryRequest',
  searchRolesForGroup: 'RoleSearchQueryRequest',
  searchMappingRulesForGroup: 'MappingRuleSearchQueryRequest',
  searchRoles: 'RoleSearchQueryRequest',
  searchUsersForRole: 'RoleUserSearchQueryRequest',
  searchGroupsForRole: 'RoleGroupSearchQueryRequest',
  searchClientsForRole: 'RoleClientSearchQueryRequest',
  searchMappingRulesForRole: 'MappingRuleSearchQueryRequest',
  searchTenants: 'TenantSearchQueryRequest',
  searchUsersForTenant: 'TenantUserSearchQueryRequest',
  searchClientsForTenant: 'TenantClientSearchQueryRequest',
  searchGroupIdsForTenant: 'TenantGroupSearchQueryRequest',
  searchRolesForTenant: 'RoleSearchQueryRequest',
  searchMappingRulesForTenant: 'MappingRuleSearchQueryRequest',
  searchMappingRule: 'MappingRuleSearchQueryRequest',
  searchBatchOperations: 'BatchOperationSearchQuery',
  searchBatchOperationItems: 'BatchOperationItemSearchQuery',
  searchVariables: 'SearchVariablesRequest',
  searchElementInstances: 'ElementInstanceSearchQuery',
  searchElementInstanceIncidents: 'IncidentSearchQuery',
  searchClusterVariables: 'ClusterVariableSearchQueryRequest',
  searchGlobalTaskListeners: 'GlobalTaskListenerSearchQueryRequest',
  searchAuditLogs: 'AuditLogSearchQueryRequest',
  searchUserTaskEffectiveVariables: 'SearchUserTaskEffectiveVariablesRequest',
  completeJob: 'JobCompletionRequest',
  cancelProcessInstance: 'CancelProcessInstanceRequest',
  failJob: 'JobFailRequest',
  completeUserTask: 'UserTaskCompletionRequest',
  assignUserTask: 'UserTaskAssignmentRequest',
  deleteResource: 'DeleteResourceRequest',
  deleteProcessInstance: 'DeleteProcessInstanceRequest',
  createDocumentLink: 'DocumentLinkRequest',
  getJobTypeStatistics: 'JobTypeStatisticsQuery',
  getProcessDefinitionMessageSubscriptionStatistics:
    'ProcessDefinitionMessageSubscriptionStatisticsQuery',
  getProcessDefinitionStatistics: 'ProcessDefinitionElementStatisticsQuery',
  getProcessDefinitionInstanceStatistics: 'ProcessDefinitionInstanceStatisticsQuery',
  getProcessInstanceStatisticsByError: 'IncidentProcessInstanceStatisticsByErrorQuery',
  modifyProcessInstance: 'ProcessInstanceModificationInstruction',
  resolveIncident: 'IncidentResolutionRequest',
  getProcessInstanceStatisticsByDefinition: 'IncidentProcessInstanceStatisticsByDefinitionQuery',
  getProcessDefinitionInstanceVersionStatistics: 'ProcessDefinitionInstanceVersionStatisticsQuery',
  getJobErrorStatistics: 'JobErrorStatisticsQuery',
  getJobTimeSeriesStatistics: 'JobTimeSeriesStatisticsQuery',
  getJobWorkerStatistics: 'JobWorkerStatisticsQuery',
};

// operationId-independent map: a path parameter's name (camelCased) to the
// real SDK's strongly-typed key struct. Verified by reflecting the real
// Camunda.Orchestration.Sdk 9.2.2 assembly -- every one of these types
// exposes a `static <Type> AssumeExists(string value)` factory. Path
// parameters previously passed the raw `object` returned by `RequireBinding`
// straight into the SDK call, which fails to compile with CS1503
// ("cannot convert from 'object' to '<KeyType>'") against the real SDK.
const CSHARP_PATH_PARAM_KEY_TYPE: Record<string, string> = {
  auditLogKey: 'AuditLogKey',
  decisionDefinitionKey: 'DecisionDefinitionKey',
  decisionRequirementsKey: 'DecisionRequirementsKey',
  documentId: 'DocumentId',
  elementInstanceKey: 'ElementInstanceKey',
  incidentKey: 'IncidentKey',
  jobKey: 'JobKey',
  processDefinitionKey: 'ProcessDefinitionKey',
  processInstanceKey: 'ProcessInstanceKey',
  resourceKey: 'ResourceKey',
  userTaskKey: 'UserTaskKey',
  variableKey: 'VariableKey',
  authorizationKey: 'AuthorizationKey',
  batchOperationKey: 'BatchOperationKey',
  decisionEvaluationInstanceKey: 'DecisionEvaluationInstanceKey',
  decisionEvaluationKey: 'DecisionEvaluationKey',
  adHocSubProcessInstanceKey: 'ElementInstanceKey',
};

const PATH_PARAM_RE = /\{([^}]+)\}/g;

// SDK methods that return a bare (non-generic) `Task` rather than
// `Task<T>`. Verified by reflecting every public `CamundaClient` method
// against the real Camunda.Orchestration.Sdk 9.2.2 assembly. Assigning the
// awaited result of one of these calls to a `var` fails to compile with
// CS0815 ("Cannot assign void to an implicitly-typed variable") -- these
// methods have no response body to assert against or extract from.
const CSHARP_VOID_METHODS = new Set<string>([
  'ActivateAdHocSubProcessActivitiesAsync',
  'AssignClientToGroupAsync',
  'AssignClientToTenantAsync',
  'AssignGroupToTenantAsync',
  'AssignMappingRuleToGroupAsync',
  'AssignMappingRuleToTenantAsync',
  'AssignRoleToClientAsync',
  'AssignRoleToGroupAsync',
  'AssignRoleToMappingRuleAsync',
  'AssignRoleToTenantAsync',
  'AssignRoleToUserAsync',
  'AssignUserTaskAsync',
  'AssignUserToGroupAsync',
  'AssignUserToTenantAsync',
  'CancelBatchOperationAsync',
  'CancelProcessInstanceAsync',
  'CompleteJobAsync',
  'CompleteUserTaskAsync',
  'CreateElementInstanceVariablesAsync',
  'DeleteAuthorizationAsync',
  'DeleteDecisionInstanceAsync',
  'DeleteDocumentAsync',
  'DeleteGlobalClusterVariableAsync',
  'DeleteGlobalTaskListenerAsync',
  'DeleteGroupAsync',
  'DeleteMappingRuleAsync',
  'DeleteProcessInstanceAsync',
  'DeleteRoleAsync',
  'DeleteTenantAsync',
  'DeleteTenantClusterVariableAsync',
  'DeleteUserAsync',
  'FailJobAsync',
  'GetStatusAsync',
  'MigrateProcessInstanceAsync',
  'ModifyProcessInstanceAsync',
  'PinClockAsync',
  'ResetClockAsync',
  'ResolveIncidentAsync',
  'ResumeBatchOperationAsync',
  'RunWorkersAsync',
  'StopAllWorkersAsync',
  'SuspendBatchOperationAsync',
  'ThrowJobErrorAsync',
  'UnassignClientFromGroupAsync',
  'UnassignClientFromTenantAsync',
  'UnassignGroupFromTenantAsync',
  'UnassignMappingRuleFromGroupAsync',
  'UnassignMappingRuleFromTenantAsync',
  'UnassignRoleFromClientAsync',
  'UnassignRoleFromGroupAsync',
  'UnassignRoleFromMappingRuleAsync',
  'UnassignRoleFromTenantAsync',
  'UnassignRoleFromUserAsync',
  'UnassignUserFromGroupAsync',
  'UnassignUserFromTenantAsync',
  'UnassignUserTaskAsync',
  'UpdateAuthorizationAsync',
  'UpdateJobAsync',
  'UpdateUserTaskAsync',
]);

export function csharpSdkSuiteFileName(
  collection: EndpointScenarioCollection,
  mode: 'feature' | 'integration' | 'variant',
): string {
  const op = collection.endpoint.operationId;
  return `${op}/${op}.${mode}.Tests.cs`;
}

export function renderCsharpSdkSuite(
  collection: EndpointScenarioCollection,
  mapping: SdkMappingSource,
  opts: {
    suiteName?: string;
    mode?: 'feature' | 'integration' | 'variant';
    globalContextSeeds?: readonly GlobalContextSeed[];
  },
): string {
  return buildSuiteSource(collection, mapping, opts);
}

export function createCsharpEmitter(mapping?: CsharpOperationMap): EmitterStrategy {
  const mappingSource: SdkMappingSource = new CsharpOperationMapSource(mapping);
  return {
    id: 'csharp-sdk',
    name: 'C# SDK (Camunda Orchestration)',
    supportedConfigs: ['*'],
    async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
      const content = renderCsharpSdkSuite(collection, mappingSource, {
        suiteName: ctx.suiteName,
        mode: ctx.mode,
        globalContextSeeds: ctx.globalContextSeeds,
      });
      return [
        {
          relativePath: csharpSdkSuiteFileName(collection, ctx.mode),
          content,
        },
      ];
    },
  };
}

function buildSuiteSource(
  collection: EndpointScenarioCollection,
  mapping: SdkMappingSource,
  opts: {
    suiteName?: string;
    mode?: 'feature' | 'integration' | 'variant';
    globalContextSeeds?: readonly GlobalContextSeed[];
  },
): string {
  if (opts.globalContextSeeds !== undefined) {
    assertSafeGlobalContextSeeds(opts.globalContextSeeds);
  }

  const lines: string[] = [];
  const suiteName = opts.suiteName || collection.endpoint.operationId;
  // The mode suffix (omitted for the default `feature` mode to preserve
  // existing class names) disambiguates the C# type name across sibling
  // suites for the same operationId. Unlike Playwright's file-scoped
  // `test.describe` blocks or Python's per-module functions, C# classes
  // share a single namespace across every compiled file, so a feature
  // suite and a variant suite for the same operation previously collided
  // as CS0101 "namespace already contains a definition" once both were
  // compiled into the same project.
  const modeSuffix = opts.mode && opts.mode !== 'feature' ? toPascalCase(opts.mode) : '';
  const className = `${toPascalCase(suiteName)}${modeSuffix}Tests`;

  lines.push('using System;');
  lines.push('using System.Collections.Generic;');
  lines.push('using System.IO;');
  lines.push('using System.Net.Http;');
  lines.push('using System.Threading.Tasks;');
  lines.push('using Camunda.Orchestration.Sdk;');
  lines.push('using Xunit;');
  lines.push('');
  lines.push('namespace CamundaIntegrationTests;');
  lines.push('');
  lines.push(`public class ${className} : TestFixtureBase`);
  lines.push('{');

  const seeds = opts.globalContextSeeds ?? [];
  for (const scenario of collection.scenarios) {
    lines.push(renderScenarioTest(scenario, mapping, seeds));
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function renderScenarioTest(
  s: EndpointScenario,
  mapping: SdkMappingSource,
  globalContextSeeds: readonly GlobalContextSeed[],
): string {
  const title = `${s.id} - ${escapeQuotes(s.name || 'scenario')}`;
  const methodName = toSafeIdentifier(`Scenario_${s.id}_${s.name || 'scenario'}`);
  const body: string[] = [];

  body.push('    [Fact]');
  body.push(`    public async Task ${methodName}()`);
  body.push('    {');
  body.push(`      // ${title}`);
  body.push('      var ctx = new Dictionary<string, object?>();');

  const globalSeedNames = new Set(
    globalContextSeeds.filter((seed) => !seed.omitWhenUnbound).map((seed) => seed.binding),
  );
  // `omitWhenUnbound` seeds are NOT auto-seeded in the universal prologue;
  // the binding stays null so the outgoing request omits the field and the
  // broker applies its default (#342). Mirrors the Playwright ctxSeeding
  // contract in materializer/src/playwright/ctxSeeding.ts. We track the
  // mapped field names so multipart bodies can null-guard them.
  const omitWhenUnboundFields = new Set(
    globalContextSeeds.filter((seed) => seed.omitWhenUnbound).map((seed) => seed.fieldName),
  );
  // Binding names (not field names) for the same omitWhenUnbound seeds, used
  // below to also exclude them from the per-scenario `seedBindingsList`
  // path — without this, a scenario whose planner-computed `seedBindings`
  // happened to name e.g. `tenantIdVar` would still auto-seed it via the
  // legacy `SeedBindingIfMissing` call, defeating the omission above (the
  // reviewed bug: the binding got a generic/sentinel value instead of
  // staying unset). A binding stays eligible for seeding when this
  // scenario is itself the *producer* minting the value uniquely — see
  // `uniqueBindings` below (mirrors ctxSeeding.ts's `emitCtxSeeding`).
  const omitWhenUnboundNames = new Set(
    globalContextSeeds.filter((seed) => seed.omitWhenUnbound).map((seed) => seed.binding),
  );
  const uniqueBindings = computeUniqueBindings(s.requestPlan, s.modelDerivedLiteralBindings);
  // Literal entries whose binding name is flagged unique must NOT be
  // written verbatim: a concrete client-minted value here would defeat the
  // `{ unique: true }` seed the binding needs (mirrors ctxSeeding.ts's
  // `emitCtxSeeding` — see #320). Strip them from the literal loop and
  // re-route them into the seed loop below so they get a fresh
  // `SeedBindingIfMissing(..., unique: true)` call instead.
  const literalEntries = s.bindings
    ? Object.entries(s.bindings).filter(([k, v]) => v !== '__PENDING__' && !uniqueBindings.has(k))
    : [];
  const strippedForUnique = s.bindings
    ? Object.entries(s.bindings)
        .filter(([k, v]) => v !== '__PENDING__' && uniqueBindings.has(k))
        .map(([k]) => k)
    : [];
  const seedBindingsList = Array.from(
    new Set([...(s.seedBindings ?? []), ...strippedForUnique]),
  ).filter(
    (k) => !globalSeedNames.has(k) && (!omitWhenUnboundNames.has(k) || uniqueBindings.has(k)),
  );

  if (literalEntries.length > 0) {
    body.push('      // Seed scenario bindings');
    for (const [k, v] of literalEntries) {
      body.push(`      ctx[${stringLiteral(k)}] = ${renderCsharpValue(v)};`);
    }
  }
  if (seedBindingsList.length > 0) {
    if (literalEntries.length === 0) {
      body.push('      // Seed scenario bindings');
    }
    for (const k of seedBindingsList) {
      const uniqueArg = uniqueBindings.has(k) ? ', unique: true' : '';
      body.push(
        `      SeedBindingIfMissing(ctx, ${stringLiteral(k)}, ${stringLiteral(k)}${uniqueArg});`,
      );
    }
  }
  for (const seed of globalContextSeeds) {
    if (seed.omitWhenUnbound) continue;
    const uniqueArg = uniqueBindings.has(seed.binding) ? ', unique: true' : '';
    body.push(
      `      SeedBindingIfMissing(ctx, ${stringLiteral(seed.binding)}, ${stringLiteral(seed.seedRule)}${uniqueArg});`,
    );
  }

  if (!s.requestPlan) {
    body.push('      // No request plan available');
    body.push('    }');
    return body.join('\n');
  }

  const requestPlan = s.requestPlan;
  requestPlan.forEach((step: RequestStep, idx: number) => {
    const method = mapping.resolveMethod(step.operationId);
    if (method === undefined) {
      throw new Error(
        `No published C# SDK method mapping found for operationId ${step.operationId}`,
      );
    }
    const varName = `result${idx + 1}`;
    const requestVar = `request${idx + 1}`;
    const responseVar = `response${idx + 1}`;
    const requestType = resolveRequestTypeName(step);
    const expectError = step.expect.status >= 400;

    if (step.bodyKind === 'multipart') {
      body.push(`      // Multipart request`);
      body.push('      {');
      const multipart = normalizeMultipartTemplate(step.multipartTemplate);

      const fieldsVar = `fields${idx + 1}`;
      const filesVar = `files${idx + 1}`;

      body.push(`        var ${fieldsVar} = new Dictionary<string, object?>();`);
      for (const [fieldName, fieldValue] of Object.entries(multipart.fields)) {
        const whole = typeof fieldValue === 'string' ? /^\$\{([^}]+)\}$/.exec(fieldValue) : null;
        if (whole && omitWhenUnboundFields.has(fieldName)) {
          // A nullable lookup, NOT renderCsharpValue: the latter renders a
          // whole `${binding}` placeholder via RequireBinding, which throws
          // on a missing binding before this null-guard ever runs. Only a
          // null-tolerant lookup lets a genuinely-unbound consumer scenario
          // omit the field so the broker applies its default (#342).
          const local = `__${toSafeIdentifier(fieldName)}Val`;
          body.push(`        var ${local} = GetBindingOrNull(ctx, ${stringLiteral(whole[1])});`);
          body.push(
            `        if (${local} is not null) ${fieldsVar}[${stringLiteral(fieldName)}] = ${local};`,
          );
          continue;
        }
        const valueExpr = renderCsharpValue(fieldValue, '        ');
        body.push(`        ${fieldsVar}[${stringLiteral(fieldName)}] = ${valueExpr};`);
      }

      body.push(`        var ${filesVar} = new Dictionary<string, object?>();`);
      for (const [fileName, fileValue] of Object.entries(multipart.files)) {
        const valueExpr = renderMultipartFileValue(fileValue);
        body.push(`        ${filesVar}[${stringLiteral(fileName)}] = ${valueExpr};`);
      }

      const emptyDocumentFiles =
        Object.keys(multipart.files).length === 0 &&
        (step.operationId === 'createDocument' || step.operationId === 'createDocuments');
      const documentFileField = step.operationId === 'createDocuments' ? 'files' : 'file';

      if (expectError) {
        body.push('        var ex = await Assert.ThrowsAnyAsync<CamundaSdkException>(async () =>');
        body.push('        {');
        if (method === 'DeployResourcesFromFilesAsync') {
          const resources = multipart.files.resources;
          const filesExpr = renderFileArray(resources);
          const tenantExpr = renderTenantExpr(multipart.fields.tenantId);
          body.push(`          var resourceFiles = ${filesExpr};`);
          body.push(
            `          await ${renderClientCall(method, step, `resourceFiles, ${tenantExpr}`)};`,
          );
        } else if (emptyDocumentFiles) {
          body.push(`          using var content${idx + 1} = new MultipartFormDataContent();`);
          body.push(
            `          content${idx + 1}.Add(new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes("Hello, world!")), ${stringLiteral(documentFileField)}, "hello.txt");`,
          );
          body.push(`          foreach (var field in ${fieldsVar}) {`);
          body.push(`            if (field.Value == null) continue;`);
          body.push(
            `            content${idx + 1}.Add(new StringContent(Convert.ToString(field.Value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty), field.Key);`,
          );
          body.push(`          }`);
          body.push(`          await ${renderClientCall(method, step, `content${idx + 1}`)};`);
        } else {
          body.push(
            `          using var content${idx + 1} = BuildMultipart(${fieldsVar}, ${filesVar});`,
          );
          body.push(`          await ${renderClientCall(method, step, `content${idx + 1}`)};`);
        }
        body.push('        });');
        body.push(`        Assert.Equal((int?)${step.expect.status}, (int?)ex.Status);`);
        body.push('      }');
        return;
      }

      if (method === 'DeployResourcesFromFilesAsync') {
        const resources = multipart.files.resources;
        const filesExpr = renderFileArray(resources);
        const tenantExpr = renderTenantExpr(multipart.fields.tenantId);
        body.push(`        var resourceFiles = ${filesExpr};`);
        body.push(
          `        var result${idx + 1} = await ${renderClientCall(method, step, `resourceFiles, ${tenantExpr}`)};`,
        );
      } else if (emptyDocumentFiles) {
        body.push(`        using var content${idx + 1} = new MultipartFormDataContent();`);
        body.push(
          `        content${idx + 1}.Add(new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes("Hello, world!")), ${stringLiteral(documentFileField)}, "hello.txt");`,
        );
        body.push(`        foreach (var field in ${fieldsVar}) {`);
        body.push(`          if (field.Value == null) continue;`);
        body.push(
          `          content${idx + 1}.Add(new StringContent(Convert.ToString(field.Value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty), field.Key);`,
        );
        body.push(`        }`);
        body.push(
          `        var result${idx + 1} = await ${renderClientCall(method, step, `content${idx + 1}`)};`,
        );
      } else {
        body.push(
          `        using var content${idx + 1} = BuildMultipart(${fieldsVar}, ${filesVar});`,
        );
        body.push(
          `        var result${idx + 1} = await ${renderClientCall(method, step, `content${idx + 1}`)};`,
        );
      }

      body.push(`        AssertExpectedStatus(result${idx + 1}, ${step.expect.status});`);
      body.push(`        var response${idx + 1} = ToJsonElement(result${idx + 1});`);

      if (step.extract?.length) {
        for (const ex of step.extract) {
          body.push(
            `        ExtractInto(ctx, ${stringLiteral(ex.bind)}, response${idx + 1}, ${stringLiteral(ex.fieldPath)});`,
          );
        }
      }

      const isFinal = idx === requestPlan.length - 1;
      const isErrorScenario = s.expectedResult && s.expectedResult.kind === 'error';
      if (isFinal && s.responseShapeFields?.length && !isErrorScenario) {
        body.push(`        AssertResponseShape(response${idx + 1}, new[] {`);
        for (const field of s.responseShapeFields) {
          const required = field.required ? 'true' : 'false';
          const nullable = field.nullable ? 'true' : 'false';
          body.push(
            `          (${stringLiteral(field.name)}, required: ${required}, nullable: ${nullable}),`,
          );
        }
        body.push('        });');
      }

      body.push('      }');
      renderCsharpEventualWaits(body, step, idx, mapping);
      return;
    }

    body.push(`      // Step ${idx + 1}: ${step.operationId}`);
    body.push('      {');

    const jsonFields = collectJsonRequestFields(step, omitWhenUnboundFields);
    const hasBody = jsonRequestFieldsHaveBody(jsonFields);
    const shouldPassEmptyRequest = !hasBody && requestType !== undefined;
    if (hasBody && requestType === undefined) {
      throw new Error(
        `No published C# request DTO mapping found for operationId ${step.operationId}`,
      );
    }
    if (expectError) {
      body.push('        var ex = await Assert.ThrowsAnyAsync<CamundaSdkException>(async () => {');
      if (hasBody) {
        body.push(
          ...emitJsonRequestDataLines(
            requestVar,
            requireRequestType(step, requestType),
            jsonFields,
            '          ',
          ),
        );
        body.push(`          await ${renderClientCall(method, step, requestVar)};`);
      } else if (shouldPassEmptyRequest) {
        body.push(`          var ${requestVar} = new ${requestType}();`);
        body.push(`          await ${renderClientCall(method, step, requestVar)};`);
      } else {
        body.push(`          await ${renderClientCall(method, step)};`);
      }
      body.push('        });');
      body.push(`        Assert.Equal((int?)${step.expect.status}, (int?)ex.Status);`);
      body.push('      }');
      return;
    }

    // Methods that return a bare `Task` (CSHARP_VOID_METHODS) have no
    // response body: assigning `await Client.Method(...)` to a `var` fails
    // to compile with CS0815. A successful (non-throwing) completion is the
    // pass condition for these calls, so there is nothing to assert or
    // extract from.
    const isVoidMethod = CSHARP_VOID_METHODS.has(method);
    if (isVoidMethod && step.extract?.length) {
      throw new Error(
        `Cannot extract from the response of operationId ${step.operationId}: its SDK method ${method} returns no response body (bare Task).`,
      );
    }

    if (hasBody) {
      body.push(
        ...emitJsonRequestDataLines(
          requestVar,
          requireRequestType(step, requestType),
          jsonFields,
          '        ',
        ),
      );
      body.push(
        `        ${isVoidMethod ? '' : `var ${varName} = `}await ${renderClientCall(method, step, requestVar)};`,
      );
    } else if (shouldPassEmptyRequest) {
      body.push(`        var ${requestVar} = new ${requestType}();`);
      body.push(
        `        ${isVoidMethod ? '' : `var ${varName} = `}await ${renderClientCall(method, step, requestVar)};`,
      );
    } else {
      body.push(
        `        ${isVoidMethod ? '' : `var ${varName} = `}await ${renderClientCall(method, step)};`,
      );
    }

    if (isVoidMethod) {
      body.push('      }');
      renderCsharpEventualWaits(body, step, idx, mapping);
      return;
    }

    body.push(`        AssertExpectedStatus(${varName}, ${step.expect.status});`);
    body.push(`        var ${responseVar} = ToJsonElement(${varName});`);

    if (step.extract?.length) {
      for (const ex of step.extract) {
        body.push(
          `        ExtractInto(ctx, ${stringLiteral(ex.bind)}, ${responseVar}, ${stringLiteral(ex.fieldPath)});`,
        );
      }
    }

    const isFinal = idx === requestPlan.length - 1;
    const isErrorScenario = s.expectedResult && s.expectedResult.kind === 'error';
    if (isFinal && s.responseShapeFields?.length && !isErrorScenario) {
      body.push(`        AssertResponseShape(${responseVar}, new[] {`);
      for (const field of s.responseShapeFields) {
        const required = field.required ? 'true' : 'false';
        const nullable = field.nullable ? 'true' : 'false';
        body.push(
          `          (${stringLiteral(field.name)}, required: ${required}, nullable: ${nullable}),`,
        );
      }
      body.push('        });');
    }

    body.push('      }');
    renderCsharpEventualWaits(body, step, idx, mapping);
  });

  body.push('    }');
  return body.join('\n');
}

/**
 * Partition a JSON request body's top-level fields into ones that render
 * inline immediately, and ones that must be deferred to a runtime-conditional
 * assignment because they are a whole `${binding}` placeholder flagged
 * `omitWhenUnbound` (#342). Mirrors the multipart-fields handling above and
 * python-sdk's `renderPythonDictAssignment` -- without this, every JSON
 * consumer scenario either sends the legacy seeded sentinel or throws from
 * `RequireBinding` once the seed is correctly left unset, instead of omitting
 * the field and letting the broker apply its own default.
 */
function partitionJsonFields(
  bodyTemplate: Record<string, unknown>,
  omitWhenUnboundFields: ReadonlySet<string>,
): { inline: [string, unknown][]; deferred: { fieldName: string; binding: string }[] } {
  const inline: [string, unknown][] = [];
  const deferred: { fieldName: string; binding: string }[] = [];
  for (const [k, v] of Object.entries(bodyTemplate)) {
    const whole = typeof v === 'string' ? /^\$\{([^}]+)\}$/.exec(v) : null;
    if (whole && omitWhenUnboundFields.has(k)) {
      deferred.push({ fieldName: k, binding: whole[1] });
      continue;
    }
    inline.push([k, v]);
  }
  return { inline, deferred };
}

type JsonRequestFields =
  | {
      kind: 'record';
      inline: [string, unknown][];
      deferred: { fieldName: string; binding: string }[];
    }
  | { kind: 'scalar'; value: unknown }
  | { kind: 'none' };

function collectJsonRequestFields(
  step: RequestStep,
  omitWhenUnboundFields: ReadonlySet<string>,
): JsonRequestFields {
  if (step.bodyKind !== 'json' || step.bodyTemplate === undefined) return { kind: 'none' };
  if (isRecord(step.bodyTemplate)) {
    const { inline, deferred } = partitionJsonFields(step.bodyTemplate, omitWhenUnboundFields);
    return { kind: 'record', inline, deferred };
  }
  return { kind: 'scalar', value: step.bodyTemplate };
}

function jsonRequestFieldsHaveBody(fields: JsonRequestFields): boolean {
  if (fields.kind === 'scalar') return true;
  if (fields.kind === 'record') return fields.inline.length > 0 || fields.deferred.length > 0;
  return false;
}

/**
 * Emit the statements that build a request's data dictionary (mirroring the
 * multipart-fields statement style) and the final `BuildRequest<T>(...)`
 * call, deferring `omitWhenUnbound` fields to a nullable lookup + null-guard
 * assignment instead of an unconditional (and possibly throwing) inline
 * value.
 */
function emitJsonRequestDataLines(
  requestVar: string,
  requestType: string,
  fields: JsonRequestFields,
  indent: string,
): string[] {
  const dataVar = `${requestVar}Data`;
  const lines = [`${indent}var ${dataVar} = new Dictionary<string, object?>();`];
  if (fields.kind === 'scalar') {
    lines.push(`${indent}${dataVar}["body"] = ${renderCsharpValue(fields.value, indent)};`);
  } else if (fields.kind === 'record') {
    for (const [fieldName, value] of fields.inline) {
      lines.push(
        `${indent}${dataVar}[${stringLiteral(fieldName)}] = ${renderCsharpValue(value, indent)};`,
      );
    }
    for (const { fieldName, binding } of fields.deferred) {
      const local = `__${toSafeIdentifier(fieldName)}Val`;
      lines.push(`${indent}var ${local} = GetBindingOrNull(ctx, ${stringLiteral(binding)});`);
      lines.push(
        `${indent}if (${local} is not null) ${dataVar}[${stringLiteral(fieldName)}] = ${local};`,
      );
    }
  }
  lines.push(`${indent}var ${requestVar} = BuildRequest<${requestType}>(${dataVar});`);
  return lines;
}

function requireRequestType(step: RequestStep, requestType: string | undefined): string {
  if (requestType === undefined) {
    throw new Error(
      `No published C# request DTO mapping found for operationId ${step.operationId}`,
    );
  }
  return requestType;
}

function renderClientCall(method: string, step: RequestStep, requestExpression?: string): string {
  return renderClientCallForPath(method, step.pathTemplate, requestExpression, step.pathParams);
}

function renderClientCallForPath(
  method: string,
  pathTemplate: string,
  requestExpression?: string,
  pathParams?: { name: string; var: string }[],
): string {
  const nameToVar = new Map<string, string>();
  for (const param of pathParams ?? []) {
    nameToVar.set(param.name, param.var);
  }
  const argumentsList = derivePathParamNames(pathTemplate).map((rawName) => {
    const name = toCamelCase(rawName);
    const keyType = CSHARP_PATH_PARAM_KEY_TYPE[name];
    // The planner/emitter contract (mirrored by the JS SDK emitter's
    // `buildJavaScriptUrlExpression`) lets `RequestStep.pathParams[].var`
    // alias a URL param name to a different ctx binding name; fall back to
    // the derived `${name}Var` only when no explicit alias is given.
    const varName = nameToVar.get(rawName) ?? `${name}Var`;
    const binding = stringLiteral(varName);
    if (keyType === undefined) {
      // Not every path parameter is a strongly-typed key struct (e.g.
      // getUser's `/users/{username}` takes a plain string) -- fall back to
      // the raw string binding instead of erroring on every unmapped name.
      return `RequireStringBinding(ctx, ${binding})`;
    }
    return `${keyType}.AssumeExists(RequireStringBinding(ctx, ${binding}))`;
  });
  if (requestExpression !== undefined) argumentsList.push(requestExpression);
  return `Client.${method}(${argumentsList.join(', ')})`;
}

/**
 * Render every planner-annotated eventual-state wait (#159) attached to
 * `step` as sibling blocks after its producer step's own block closes.
 * Polls the witness operation via `AwaitEventuallyWitness` (vendored in
 * TestFixtureBase.cs), which treats a thrown exception (e.g. a 404 while
 * the indexer catches up) the same as a false predicate and rethrows on
 * budget exhaustion -- mirroring the Playwright/JS reference emitters.
 */
function renderCsharpEventualWaits(
  body: string[],
  step: RequestStep,
  stepIdx: number,
  mapping: SdkMappingSource,
): void {
  const waits = step.eventualWaitsAfter ?? [];
  for (let w = 0; w < waits.length; w++) {
    renderCsharpEventualWait(body, waits[w], stepIdx, w, mapping);
  }
}

function renderCsharpEventualWait(
  body: string[],
  wait: EventualWaitSpec,
  _stepIdx: number,
  _waitIdx: number,
  mapping: SdkMappingSource,
): void {
  const w = wait.witness;
  const method = mapping.resolveMethod(w.operationId);
  if (method === undefined) {
    throw new Error(`No published C# SDK method mapping found for operationId ${w.operationId}`);
  }
  const waitUpToMs = w.waitUpToMs ?? 10_000;
  const pollIntervalMs = Math.max(10, w.pollIntervalMs ?? 500);

  body.push(`      // Wait for ${wait.state} (eventual; witness: ${w.operationId})`);
  body.push('      {');
  body.push('        await AwaitEventuallyWitness(');
  body.push(
    `          async () => (object?)(await ${renderClientCallForPath(method, w.pathTemplate)}),`,
  );
  body.push(
    `          b => WitnessPredicateMatches(b, ${stringLiteral(w.predicate.path)}, ${renderCsharpValue(w.predicate.equals)}),`,
  );
  body.push(`          ${stringLiteral(w.operationId)},`);
  body.push(`          ${waitUpToMs},`);
  body.push(`          ${pollIntervalMs}`);
  body.push('        );');
  body.push('      }');
}

function resolveRequestTypeName(step: RequestStep): string | undefined {
  if (step.operationId === 'createProcessInstance') {
    const body = step.bodyTemplate;
    if (isRecord(body) && 'processDefinitionKey' in body) {
      return 'ProcessInstanceCreationInstructionByKey';
    }
    return 'ProcessInstanceCreationInstructionById';
  }
  return CSHARP_REQUEST_TYPE_BY_OPERATION[step.operationId];
}

function derivePathParamNames(pathTemplate: string): string[] {
  return [...pathTemplate.matchAll(PATH_PARAM_RE)].map((match) => match[1]);
}

function renderCsharpValue(value: unknown, indent = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return renderTemplateString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const inner = value.map((v) => renderCsharpValue(v, `${indent}  `)).join(', ');
    return `new object?[] { ${inner} }`;
  }
  if (isRecord(value)) {
    const entries: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      const rendered = renderCsharpValue(v, `${indent}  `);
      entries.push(`${indent}  [${stringLiteral(k)}] = ${rendered},`);
    }
    if (entries.length === 0) return 'new Dictionary<string, object?>()';
    return `new Dictionary<string, object?>\n${indent}{\n${entries.join('\n')}\n${indent}}`;
  }
  return 'null';
}

function renderTemplateString(value: string): string {
  const fullMatch = value.match(/^\$\{([^}]+)\}$/);
  if (fullMatch) {
    return renderTemplateToken(fullMatch[1]);
  }
  const templateRe = /\$\{([^}]+)\}/g;
  if (!templateRe.test(value)) {
    return stringLiteral(value);
  }
  const parts: string[] = [];
  let lastIndex = 0;
  templateRe.lastIndex = 0;
  let match: RegExpExecArray | null = templateRe.exec(value);
  while (match !== null) {
    const [token, name] = match;
    const prefix = value.slice(lastIndex, match.index);
    if (prefix) parts.push(escapeInterpolatedLiteral(prefix));
    parts.push(`{${renderTemplateToken(name)}}`);
    lastIndex = match.index + token.length;
    match = templateRe.exec(value);
  }
  const suffix = value.slice(lastIndex);
  if (suffix) parts.push(escapeInterpolatedLiteral(suffix));
  return `$"${parts.join('')}"`;
}

function renderTemplateToken(name: string): string {
  if (name === 'RANDOM') {
    return 'SeedBinding("RANDOM")';
  }
  return `RequireBinding(ctx, ${stringLiteral(name)})`;
}

function normalizeMultipartTemplate(template: unknown): {
  fields: Record<string, unknown>;
  files: Record<string, unknown>;
} {
  if (!isRecord(template)) return { fields: {}, files: {} };
  const fields = isRecord(template.fields) ? template.fields : {};
  const files = isRecord(template.files) ? template.files : {};
  return { fields, files };
}

function renderMultipartFileValue(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('@@FILE:')) {
    return stringLiteral(value.slice('@@FILE:'.length));
  }
  return renderCsharpValue(value);
}

function renderFileArray(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.startsWith('@@FILE:') ? value.slice('@@FILE:'.length) : value;
    return `new[] { ResolveFixturePath(${stringLiteral(raw)}) }`;
  }
  if (Array.isArray(value)) {
    const entries = value.map((v) => {
      if (typeof v === 'string') {
        const raw = v.startsWith('@@FILE:') ? v.slice('@@FILE:'.length) : v;
        return `ResolveFixturePath(${stringLiteral(raw)})`;
      }
      const expr = renderCsharpValue(v);
      return `ResolveFixturePath(Convert.ToString(${expr}) ?? string.Empty)`;
    });
    return `new[] { ${entries.join(', ')} }`;
  }
  return 'Array.Empty<string>()';
}

function renderTenantExpr(value: unknown): string {
  if (typeof value === 'string') {
    const fullMatch = value.match(/^\$\{([^}]+)\}$/);
    if (fullMatch) {
      // tenantId is omitWhenUnbound (#342): a nullable lookup lets a
      // consumer scenario that never seeded this binding pass `null` and
      // have the broker apply its default, instead of RequireStringBinding
      // throwing before the request can even be sent.
      return `GetStringBindingOrNull(ctx, ${stringLiteral(fullMatch[1])})`;
    }
  }
  return value !== undefined ? renderCsharpValue(value) : 'null';
}

function escapeInterpolatedLiteral(value: string): string {
  return value.replace(/\{/g, '{{').replace(/\}/g, '}}').replace(/"/g, '""');
}

function stringLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toPascalCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toCamelCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

function toSafeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([^A-Za-z_])/, '_$1');
  return cleaned.length > 0 ? cleaned : 'Scenario';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
