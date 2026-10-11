/**
 * Item 6a — omit a body field whose `${...}` binding resolves to null.
 *
 * THE DEFECT
 * A whole-string `${var}` placeholder in a request body renders inline as
 * `ctx.get('var')`. When the producer step never bound that variable — the
 * common case for a cursor, because a single-page response has no
 * `page.endCursor` to extract — the value is `None` and the body serialises an
 * EXPLICIT JSON null:
 *
 *     body_2 = {'page': {'after': ctx.get('endCursorVar')}}
 *     -> {"page": {"after": null}}
 *
 * The broker rejects that: `{"page":{"after":null}}` is 400 "At least one of
 * [from, after, before, limit] is required", because an explicit null is a
 * *present but unusable* cursor, not an absent one. Dropping only the key is
 * NOT enough either — `{"page":{}}` is also 400, while `{}` is 200. So the fix
 * must remove the null, and then remove any container that became empty as a
 * result. Arrays behave the same way: `filter.tags=[null]` is 400, `[]` is 200.
 *
 * THE FIX
 * A generated `support/prune.py` helper recursively drops null dict values and
 * null list elements, then drops a container that became empty *because* of
 * that pruning. The emitter wraps a body literal in `prune_nulls(...)` only
 * when the template actually contains a whole-string placeholder (the only
 * placeholder form that can yield None — the concatenated form already falls
 * back to `''`), so bodies that cannot produce a null stay byte-identical.
 *
 * WHY NOT REUSE `omitWhenUnbound`
 * That existing mechanism is keyed by field NAME from the config's
 * global-context-seeds ABox and only ever applies to a TOP-LEVEL field, so it
 * cannot express `page.after`. It stays as-is; this is the general,
 * config-agnostic rule beside it.
 *
 * CRITICAL CONSTRAINT the tests below pin down: 38 nested containers in the
 * bundled templates are ALREADY empty (`updateJob.changeset = {}`,
 * `resolveIncidentsBatchOperation.filter = {}`, `evaluateConditionals.variables
 * = {}`, ...). Those are deliberate, meaningful empty values and must survive
 * — the prune may only remove a container that was non-empty before pruning.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { renderPythonSuite } from '../../materializer/src/python-sdk/emitter.js';
import { loadPythonProjectScaffoldingFiles } from '../../materializer/src/python-sdk/materialize-support.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.js';

const PH = (name: string): string => `\${${name}}`;

function step(bodyTemplate: unknown, overrides: Partial<RequestStep> = {}): RequestStep {
  return {
    operationId: 'searchDecisionInstances',
    method: 'POST',
    pathTemplate: '/decision-instances/search',
    bodyKind: 'json',
    bodyTemplate,
    expect: { status: 200 },
    ...overrides,
  };
}

function collectionFor(steps: RequestStep[]): EndpointScenarioCollection {
  const first = steps[0];
  if (first === undefined) throw new Error('collectionFor needs at least one step');
  return {
    endpoint: {
      operationId: first.operationId,
      method: first.method,
      path: first.pathTemplate,
    },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'cursor pagination',
        description: 'Search, then page through the results',
        operations: steps.map((s) => ({
          operationId: s.operationId,
          method: s.method,
          path: s.pathTemplate,
        })),
        requestPlan: steps,
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
      },
    ],
  };
}

/** The `body_N = ...` line the emitter produced for the first step. */
function bodyLine(output: string, n = 1): string {
  const line = output.split('\n').find((l) => l.trimStart().startsWith(`body_${n} = `));
  if (line === undefined) throw new Error(`no body_${n} assignment in emitted suite`);
  return line.trim();
}

/**
 * Evaluate an emitted Python expression against a stub ctx, using the REAL
 * generated prune helper. This is the load-bearing half of the suite: it
 * proves the emitted code's runtime behaviour, not just its spelling.
 *
 * The helper is written to a temp dir and imported as a module rather than
 * spliced into a `-c` script, because `support/prune.py` opens with
 * `from __future__ import annotations`, which Python requires to be the first
 * statement in a file.
 */
function evalEmitted(pythonExpr: string, ctx: Record<string, unknown>): unknown {
  const prune = loadPythonProjectScaffoldingFiles().find(
    (f) => f.relativePath === 'support/prune.py',
  );
  if (prune === undefined) throw new Error('support/prune.py is not emitted');
  const dir = mkdtempSync(join(tmpdir(), 'prune-eval-'));
  try {
    writeFileSync(join(dir, 'prune.py'), prune.content, 'utf8');
    // NB: the dict is bound to `_data`, not `ctx`, so the stub's `get` closure
    // cannot resolve to the stub itself and recurse.
    const script = `
import json
from prune import prune_nulls
_data = json.loads(r'''${JSON.stringify(ctx)}''')
class _Ctx:
    def get(self, k, d=None):
        return _data.get(k, d)
ctx = _Ctx()
print(json.dumps(${pythonExpr.replace(/^body_\d+ = /, '')}))
`;
    const out = execFileSync('python3', ['-B', '-c', script], {
      encoding: 'utf8',
      cwd: dir,
    });
    return JSON.parse(out.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the python support package ships prune_nulls (Item 6a)', () => {
  test('support/prune.py is emitted and defines prune_nulls', () => {
    const files = loadPythonProjectScaffoldingFiles();
    const prune = files.find((f) => f.relativePath === 'support/prune.py');

    expect(prune, 'support/prune.py must be emitted').toBeDefined();
    expect(prune?.content).toContain('def prune_nulls(');
  });

  test('prune_nulls drops a null cursor AND the page object that becomes empty', () => {
    // The exact defect: `{"page":{"after":null}}` is a 400, `{}` is a 200.
    expect(evalEmitted(`prune_nulls({'page': {'after': None}})`, {})).toEqual({});
    expect(evalEmitted(`prune_nulls({'page': {'before': None}})`, {})).toEqual({});
  });

  test('prune_nulls keeps a bound cursor and its siblings untouched', () => {
    expect(
      evalEmitted(`prune_nulls({'page': {'after': ctx.get('endCursorVar')}})`, {
        endCursorVar: 'cursor-abc',
      }),
    ).toEqual({ page: { after: 'cursor-abc' } });

    // A null sibling must not take a bound one down with it.
    expect(
      evalEmitted(`prune_nulls({'page': {'after': ctx.get('endCursorVar'), 'limit': 10}})`, {}),
    ).toEqual({ page: { limit: 10 } });
  });

  test('prune_nulls preserves a container that was ALREADY empty in the template', () => {
    // 38 such containers exist in the bundled templates and are meaningful:
    // updateJob.changeset={}, resolveIncidentsBatchOperation.filter={},
    // evaluateConditionals.variables={}. Pruning them would change semantics.
    expect(evalEmitted(`prune_nulls({'changeset': {}})`, {})).toEqual({ changeset: {} });
    expect(evalEmitted(`prune_nulls({'filter': {}, 'page': {'after': None}})`, {})).toEqual({
      filter: {},
    });
    expect(evalEmitted(`prune_nulls({'variables': [], 'page': {'after': None}})`, {})).toEqual({
      variables: [],
    });
  });

  test('prune_nulls drops null array elements AND the key when the list empties', () => {
    // Keeping `[]` is NOT safe: `filter.tags=[]` is 200 but
    // `filter.elementInstanceKeys=[]` and `filter.tenantIds=[]` are both 400,
    // and `filter.$or=[{tags:[]}]` is a 500. Dropping the emptied key is the
    // only uniform behaviour, so a list emptied by pruning is removed like a
    // dict emptied by pruning.
    expect(evalEmitted(`prune_nulls({'filter': {'tags': [None]}})`, {})).toEqual({});
    expect(
      evalEmitted(`prune_nulls({'filter': {'tags': [ctx.get('tagVar'), 'real']}})`, {}),
    ).toEqual({ filter: { tags: ['real'] } });
    // A list that was ALREADY empty in the template is preserved verbatim.
    expect(evalEmitted(`prune_nulls({'filter': {'tags': []}})`, {})).toEqual({
      filter: { tags: [] },
    });
  });

  test('prune_nulls propagates the drop up through nested containers', () => {
    // The `$or` shape: a pruned-empty dict must also leave its parent list,
    // which then empties and leaves its parent dict — otherwise the broker
    // sees `{"filter":{"$or":[{}]}}`, which is a 500.
    expect(evalEmitted(`prune_nulls({'filter': {'$or': [{'tags': [None]}]}})`, {})).toEqual({});
    // A sibling constraint survives the cascade.
    expect(
      evalEmitted(`prune_nulls({'filter': {'$or': [{'tags': [None]}], 'name': 'x'}})`, {}),
    ).toEqual({ filter: { name: 'x' } });
  });

  test('prune_nulls is order- and scalar-preserving, and idempotent', () => {
    expect(
      evalEmitted(`prune_nulls({'b': 1, 'a': None, 'c': {'d': False, 'e': 0, 'f': ''}})`, {}),
    ).toEqual({ b: 1, c: { d: false, e: 0, f: '' } });
    // Falsy-but-bound values must survive: only None is pruned.
    expect(evalEmitted(`prune_nulls(prune_nulls({'x': {'y': None}}))`, {})).toEqual({});
  });
});

describe('the emitter wraps a null-capable body in prune_nulls (Item 6a)', () => {
  test('a nested cursor placeholder is wrapped so an unbound cursor cannot serialise null', () => {
    const output = renderPythonSuite(
      collectionFor([step({ page: { after: PH('endCursorVar') } })]),
    );
    const line = bodyLine(output);

    expect(line).toContain('prune_nulls(');
    expect(line).toContain("'page': {'after': ctx.get('endCursorVar')}");
    expect(output).toContain('from support.prune import prune_nulls');
  });

  test('a top-level placeholder is wrapped too (the general rule, not a cursor special case)', () => {
    const line = bodyLine(renderPythonSuite(collectionFor([step({ name: PH('nameVar') })])));

    expect(line).toContain('prune_nulls(');
    expect(line).toContain("'name': ctx.get('nameVar')");
  });

  test('an array-element placeholder is wrapped', () => {
    const line = bodyLine(
      renderPythonSuite(collectionFor([step({ filter: { tags: [PH('tagVar')] } })])),
    );

    expect(line).toContain('prune_nulls(');
    expect(line).toContain("'tags': [ctx.get('tagVar')]");
  });

  test('a body with NO whole-string placeholder is left byte-identical (no needless wrapping)', () => {
    const output = renderPythonSuite(
      collectionFor([step({ enabled: true, limit: 10, changeset: {} })]),
    );
    const line = bodyLine(output);

    expect(line).not.toContain('prune_nulls(');
    expect(output).not.toContain('from support.prune import prune_nulls');
  });

  test('a CONCATENATED placeholder is not treated as null-capable (it already falls back to "")', () => {
    // 'proc-${processInstanceKeyVar}-${tenantIdVar}' renders as a '+' chain
    // whose parts degrade to '', never None, so wrapping would be churn.
    const line = bodyLine(
      renderPythonSuite(collectionFor([step({ name: `proc-${PH('processInstanceKeyVar')}-x` })])),
    );

    expect(line).not.toContain('prune_nulls(');
    expect(line).toContain("str(ctx.get('processInstanceKeyVar'))");
  });

  test("the planner's RANDOM seed token is not treated as a ctx binding", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal '${RANDOM}' planner seed token, not JS interpolation — it must survive verbatim in the emitted source.
    const RANDOM_TOKEN = '${RANDOM}';
    const line = bodyLine(renderPythonSuite(collectionFor([step({ name: RANDOM_TOKEN })])));

    expect(line).not.toContain('prune_nulls(');
    expect(line).toContain(RANDOM_TOKEN);
  });

  test('the import is emitted once per suite, not once per step', () => {
    const output = renderPythonSuite(
      collectionFor([
        step({ page: { after: PH('endCursorVar') } }),
        step({ page: { before: PH('startCursorVar') } }),
      ]),
    );

    expect(output.match(/from support\.prune import prune_nulls/g)).toHaveLength(1);
  });
});

describe('the emitted body omits an unbound cursor at runtime (Item 6a)', () => {
  test('the real emitted body_N line yields {} when the cursor was never bound', () => {
    const output = renderPythonSuite(
      collectionFor([step({ page: { after: PH('endCursorVar') } })]),
    );

    // End-to-end: take the ACTUAL emitted assignment and run it in Python with
    // an empty ctx, which is exactly the failing live scenario.
    expect(evalEmitted(bodyLine(output), {})).toEqual({});
    expect(evalEmitted(bodyLine(output), { endCursorVar: 'cur-1' })).toEqual({
      page: { after: 'cur-1' },
    });
  });
});
