import { assertSafeGlobalContextSeeds } from 'path-analyser/ontology/loader';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  GlobalContextSeed,
  RequestStep,
} from 'path-analyser/types';
import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import { FallbackMappingSource, type SdkMappingSource } from './sdk-mapping.js';

export type CsharpOperationMap = Record<string, string>;

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
  const source = mapping ? Object.entries(mapping) : [];
  const mappingSource: SdkMappingSource = {
    resolveMethod(opId: string): string {
      const entry = source.find(([op]) => op === opId);
      if (entry) return entry[1];
      return toPascalCase(opId) + 'Async';
    },
  };
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
  const className = `${toPascalCase(suiteName)}Tests`;

  lines.push('using System;');
  lines.push('using System.Collections.Generic;');
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

  const globalSeedNames = new Set(globalContextSeeds.map((seed) => seed.binding));
  const seedBindingsList = (s.seedBindings ?? []).filter((k) => !globalSeedNames.has(k));
  const sentinelLocals = new Map<string, string>();

  if (s.bindings && Object.keys(s.bindings).length > 0) {
    body.push('      // Seed scenario bindings');
    for (const [k, v] of Object.entries(s.bindings)) {
      if (v === '__PENDING__') continue;
      body.push(`      ctx[${stringLiteral(k)}] = ${renderCsharpValue(v)};`);
    }
  }
  if (seedBindingsList.length > 0) {
    if (!s.bindings || Object.keys(s.bindings).length === 0) {
      body.push('      // Seed scenario bindings');
    }
    for (const k of seedBindingsList) {
      body.push(`      SeedBindingIfMissing(ctx, ${stringLiteral(k)}, ${stringLiteral(k)});`);
    }
  }
  for (const seed of globalContextSeeds) {
    body.push(
      `      SeedBindingIfMissing(ctx, ${stringLiteral(seed.binding)}, ${stringLiteral(seed.seedRule)});`,
    );
    if (seed.stripFromMultipartWhenDefault && seed.defaultSentinel !== undefined) {
      const local = `__${seed.fieldName}IsDefault`;
      sentinelLocals.set(seed.fieldName, local);
      body.push(
        `      var ${local} = IsDefaultSentinel(ctx, ${stringLiteral(seed.binding)}, ${stringLiteral(seed.defaultSentinel)});`,
      );
    }
  }

  if (!s.requestPlan) {
    body.push('      // No request plan available');
    body.push('    }');
    return body.join('\n');
  }

  const requestPlan = s.requestPlan;
  requestPlan.forEach((step: RequestStep, idx: number) => {
    const method = mapping.resolveMethod(step.operationId);
    const varName = `result${idx + 1}`;
    const requestVar = `request${idx + 1}`;
    const responseVar = `response${idx + 1}`;
    const requestType = `${toPascalCase(step.operationId)}Request`;
    const expectError = step.expect.status >= 400;

    if (step.bodyKind === 'multipart') {
      body.push(`      // Multipart request`);
      body.push('      {');
      const multipart = normalizeMultipartTemplate(step.multipartTemplate);

      const fieldsVar = `fields${idx + 1}`;
      const filesVar = `files${idx + 1}`;

      body.push(`        var ${fieldsVar} = new Dictionary<string, object?>();`);
      for (const [fieldName, fieldValue] of Object.entries(multipart.fields)) {
        const local = sentinelLocals.get(fieldName);
        const valueExpr = renderCsharpValue(fieldValue, '        ');
        if (local) {
          body.push(
            `        if (!${local}) ${fieldsVar}[${stringLiteral(fieldName)}] = ${valueExpr};`,
          );
        } else {
          body.push(`        ${fieldsVar}[${stringLiteral(fieldName)}] = ${valueExpr};`);
        }
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
        body.push('        var ex = await Assert.ThrowsAsync<HttpSdkException>(async () =>');
        body.push('        {');
        if (method === 'DeployResourcesFromFilesAsync') {
          const resources = multipart.files.resources;
          const filesExpr = renderFileArray(resources);
          const tenantExpr = renderTenantExpr(
            multipart.fields.tenantId,
            sentinelLocals.get('tenantId'),
          );
          body.push(`          var resourceFiles = ${filesExpr};`);
          body.push(`          await Client.${method}(resourceFiles, ${tenantExpr});`);
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
          body.push(`          await Client.${method}(content${idx + 1});`);
        } else {
          body.push(
            `          using var content${idx + 1} = BuildMultipart(${fieldsVar}, ${filesVar});`,
          );
          body.push(`          await Client.${method}(content${idx + 1});`);
        }
        body.push('        });');
        body.push(`        Assert.Equal(${step.expect.status}, ex.Status);`);
        body.push('      }');
        return;
      }

      if (method === 'DeployResourcesFromFilesAsync') {
        const resources = multipart.files.resources;
        const filesExpr = renderFileArray(resources);
        const tenantExpr = renderTenantExpr(
          multipart.fields.tenantId,
          sentinelLocals.get('tenantId'),
        );
        body.push(`        var resourceFiles = ${filesExpr};`);
        body.push(
          `        var result${idx + 1} = await Client.${method}(resourceFiles, ${tenantExpr});`,
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
        body.push(`        var result${idx + 1} = await Client.${method}(content${idx + 1});`);
      } else {
        body.push(
          `        using var content${idx + 1} = BuildMultipart(${fieldsVar}, ${filesVar});`,
        );
        body.push(`        var result${idx + 1} = await Client.${method}(content${idx + 1});`);
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
      return;
    }

    body.push(`      // Step ${idx + 1}: ${step.operationId}`);
    body.push('      {');

    const requestParts = buildRequestParts(step);
    if (expectError) {
      body.push('        var ex = await Assert.ThrowsAsync<HttpSdkException>(async () => {');
      if (requestParts.length > 0) {
        body.push(`          var ${requestVar} = BuildRequest<${requestType}>(${requestParts});`);
        body.push(`          await Client.${method}(${requestVar});`);
      } else {
        body.push(`          await Client.${method}();`);
      }
      body.push('        });');
      body.push(`        Assert.Equal(${step.expect.status}, ex.Status);`);
      body.push('      }');
      return;
    }

    if (requestParts.length > 0) {
      body.push(`        var ${requestVar} = BuildRequest<${requestType}>(${requestParts});`);
      body.push(`        var ${varName} = await Client.${method}(${requestVar});`);
    } else {
      body.push(`        var ${varName} = await Client.${method}();`);
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
  });

  body.push('    }');
  return body.join('\n');
}

function buildRequestParts(step: RequestStep): string {
  const entries: string[] = [];

  if (step.pathParams?.length) {
    for (const p of step.pathParams) {
      entries.push(`          [${stringLiteral(p.name)}] = ctx[${stringLiteral(p.var)}],`);
    }
  }

  if (step.bodyKind === 'json' && step.bodyTemplate !== undefined) {
    if (isRecord(step.bodyTemplate)) {
      for (const [k, v] of Object.entries(step.bodyTemplate)) {
        const rendered = renderCsharpValue(v, '          ');
        entries.push(`          [${stringLiteral(k)}] = ${rendered},`);
      }
    } else {
      const bodyExpr = renderCsharpValue(step.bodyTemplate, '          ');
      entries.push(`          ["body"] = ${bodyExpr},`);
    }
  }

  if (entries.length === 0) return '';
  return `new Dictionary<string, object?>\n        {\n${entries.join('\n')}\n        }`;
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
    return `ctx[${stringLiteral(fullMatch[1])}]`;
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
    parts.push(`{ctx[${stringLiteral(name)}]}`);
    lastIndex = match.index + token.length;
    match = templateRe.exec(value);
  }
  const suffix = value.slice(lastIndex);
  if (suffix) parts.push(escapeInterpolatedLiteral(suffix));
  return `$"${parts.join('')}"`;
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
    return `new[] { Path.Combine(AppContext.BaseDirectory, "fixtures", ${stringLiteral(raw)}) }`;
  }
  if (Array.isArray(value)) {
    const entries = value.map((v) => {
      if (typeof v === 'string') {
        const raw = v.startsWith('@@FILE:') ? v.slice('@@FILE:'.length) : v;
        return `Path.Combine(AppContext.BaseDirectory, "fixtures", ${stringLiteral(raw)})`;
      }
      const expr = renderCsharpValue(v);
      return `Path.Combine(AppContext.BaseDirectory, "fixtures", Convert.ToString(${expr}) ?? string.Empty)`;
    });
    return `new[] { ${entries.join(', ')} }`;
  }
  return 'Array.Empty<string>()';
}

function renderTenantExpr(value: unknown, sentinelLocal?: string): string {
  const expr = value !== undefined ? renderCsharpValue(value) : 'null';
  if (sentinelLocal) return `(${sentinelLocal} ? null : ${expr})`;
  return expr;
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
