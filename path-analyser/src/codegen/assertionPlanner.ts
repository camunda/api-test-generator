import path from 'node:path';
import type { EndpointScenario, RequestStep } from '../types.js';

export type SimpleType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'unknown';

const SIMPLE_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'unknown',
] as const satisfies readonly SimpleType[];

const SIMPLE_TYPES_LIST: readonly string[] = SIMPLE_TYPES;

function isSimpleType(t: string | undefined): t is SimpleType {
  return !!t && SIMPLE_TYPES_LIST.includes(t);
}

function toSimpleType(t: string | undefined): SimpleType {
  return isSimpleType(t) ? t : 'unknown';
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export interface AssertionSpec {
  path: string; // json path (dot/bracket) starting under the root json object
  required: boolean; // whether to assert presence unconditionally
  type?: SimpleType; // runtime type check
}

export interface FinalStepAssertionPlan {
  topLevel: AssertionSpec[];
  slices: { expected: string[]; bySlice: Record<string, AssertionSpec[]> };
  arrays: { arrayNames: string[]; byArray: Record<string, AssertionSpec[]> };
}

export function planFinalStepAssertions(
  s: EndpointScenario,
  step: RequestStep,
): FinalStepAssertionPlan {
  // Top-level fields come from responseShapeFields
  const topLevel: AssertionSpec[] = (s.responseShapeFields || []).map((f) => ({
    path: f.name,
    required: !!f.required,
    type: toSimpleType(f.type),
  }));

  // Determine expected slices (prefer domain-provided, fallback to heuristic)
  const expected = new Set<string>(
    Array.isArray(step.expectedDeploymentSlices) ? step.expectedDeploymentSlices : [],
  );
  const multipart = isPlainRecord(step.multipartTemplate) ? step.multipartTemplate : undefined;
  const multipartFiles = multipart && isPlainRecord(multipart.files) ? multipart.files : undefined;
  if (expected.size === 0 && step.bodyKind === 'multipart' && multipartFiles) {
    for (const fval of Object.values(multipartFiles)) {
      if (typeof fval === 'string' && fval.startsWith('@@FILE:')) {
        const pth = fval.slice('@@FILE:'.length);
        const ext = path.extname(pth).toLowerCase();
        if (ext === '.bpmn' || ext === '.bpmn20.xml' || pth.includes('/bpmn/'))
          expected.add('processDefinition');
        if (ext === '.dmn' || ext === '.dmn11.xml' || pth.includes('/dmn/')) {
          expected.add('decisionDefinition');
          expected.add('decisionRequirements');
        }
        if (ext === '.form' || ext === '.json' || pth.includes('/forms/')) expected.add('form');
      }
    }
  }

  const bySlice: Record<string, AssertionSpec[]> = {};
  const nested = s.responseNestedSlices;
  if (nested) {
    for (const slice of expected) {
      const defs = nested[slice] || [];
      bySlice[slice] = defs.map((d) => ({
        path: `deployments[0].${slice}.${d.name}`,
        required: !!d.required,
        type: toSimpleType(d.type),
      }));
    }
  }
  // Array item field plans
  const byArray: Record<string, AssertionSpec[]> = {};
  const arrSpec = s.responseArrayItemFields;
  const arrayNames: string[] = [];
  if (arrSpec) {
    for (const [arrName, defs] of Object.entries(arrSpec)) {
      arrayNames.push(arrName);
      byArray[arrName] = defs.map((d) => ({
        path: `${arrName}[0].${d.name}`,
        required: !!d.required,
        type: toSimpleType(d.type),
      }));
    }
  }

  return {
    topLevel,
    slices: { expected: Array.from(expected), bySlice },
    arrays: { arrayNames, byArray },
  };
}
