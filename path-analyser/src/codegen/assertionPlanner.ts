import path from 'path';
import { EndpointScenario, RequestStep } from '../types.js';

export type SimpleType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface AssertionSpec {
  path: string;            // json path (dot/bracket) starting under the root json object
  required: boolean;       // whether to assert presence unconditionally
  type?: SimpleType;       // runtime type check
}

export interface FinalStepAssertionPlan {
  topLevel: AssertionSpec[];
  slices: { expected: string[]; bySlice: Record<string, AssertionSpec[]> };
  arrays: { arrayNames: string[]; byArray: Record<string, AssertionSpec[]> };
}

export function planFinalStepAssertions(s: EndpointScenario, step: RequestStep): FinalStepAssertionPlan {
  // Top-level fields come from responseShapeFields
  const topLevel: AssertionSpec[] = (s.responseShapeFields || []).map(f => ({
    path: f.name,
    required: !!f.required,
    type: (f as any).type as SimpleType || 'unknown'
  }));

  // Determine expected slices (prefer domain-provided, fallback to heuristic)
  const expected = new Set<string>(Array.isArray((step as any).expectedDeploymentSlices) ? (step as any).expectedDeploymentSlices : []);
  if (expected.size === 0 && step.bodyKind === 'multipart' && step.multipartTemplate?.files) {
    try {
      for (const [, fval] of Object.entries<any>(step.multipartTemplate.files)) {
        if (typeof fval === 'string' && fval.startsWith('@@FILE:')) {
          const pth = fval.slice('@@FILE:'.length);
          const ext = path.extname(pth).toLowerCase();
          if (ext === '.bpmn' || ext === '.bpmn20.xml' || pth.includes('/bpmn/')) expected.add('processDefinition');
          if (ext === '.dmn' || ext === '.dmn11.xml' || pth.includes('/dmn/')) { expected.add('decisionDefinition'); expected.add('decisionRequirements'); }
          if (ext === '.form' || ext === '.json' || pth.includes('/forms/')) expected.add('form');
        }
      }
    } catch {}
  }

  const bySlice: Record<string, AssertionSpec[]> = {};
  const nested = (s as any).responseNestedSlices as Record<string, { name: string; type: string; required?: boolean }[]> | undefined;
  if (nested) {
    for (const slice of expected) {
      const defs = nested[slice] || [];
      bySlice[slice] = defs.map(d => ({
        path: `deployments[0].${slice}.${d.name}`,
        required: !!d.required,
        type: (d as any).type as SimpleType || 'unknown'
      }));
    }
  }
  // Array item field plans
  const byArray: Record<string, AssertionSpec[]> = {};
  const arrSpec = (s as any).responseArrayItemFields as Record<string, { name: string; type: string; required?: boolean }[]> | undefined;
  const arrayNames: string[] = [];
  if (arrSpec) {
    for (const [arrName, defs] of Object.entries(arrSpec)) {
      arrayNames.push(arrName);
      byArray[arrName] = defs.map(d => ({
        path: `${arrName}[0].${d.name}`,
        required: !!d.required,
        type: (d as any).type as SimpleType || 'unknown'
      }));
    }
  }

  return { topLevel, slices: { expected: Array.from(expected), bySlice }, arrays: { arrayNames, byArray } };
}
