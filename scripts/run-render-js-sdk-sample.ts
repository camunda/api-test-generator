import { renderJsSuite } from '../materializer/src/js-sdk/emitter.ts';

const collection = {
  endpoint: { operationId: 'getWidget', method: 'GET', path: '/widgets/{widgetId}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Fetch a widget by ID',
      operations: [{ operationId: 'getWidget', method: 'GET', path: '/widgets/{widgetId}' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getWidget',
          method: 'GET',
          pathTemplate: '/widgets/{widgetId}',
          pathParams: [{ name: 'widgetId', var: 'widgetIdVar' }],
          expect: { status: 200 },
          extract: [{ fieldPath: 'data.id', bind: 'widgetId' }],
        },
      ],
    },
  ],
};

const out = renderJsSuite(collection as any, { mode: 'feature' });
const lines = out.split(/\r?\n/);
console.log(lines.find((l) => l.includes('const url1')) || 'url1 not found');
console.log(lines.find((l) => l.includes("ctx['widgetId']")) || 'extract not found');
console.log('\n--- full snippet ---\n');
console.log(lines.slice(lines.findIndex((l)=>l.includes('const url1'))-1, lines.findIndex((l)=>l.includes("ctx['widgetId']"))+2).join('\n'));
