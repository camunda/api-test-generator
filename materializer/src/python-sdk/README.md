# Python SDK Emitter

Lowers Camunda API test scenarios into executable Python test suites using the
Camunda Python SDK.

## Overview

The Python SDK emitter is a pluggable code generator that:

1. **Consumes** scenario collections from the path-analyser planner
2. **Generates** Python test modules with pytest fixtures and async tests
3. **Emits** a self-contained Python project with dependencies and support helpers

The emitter follows the [`@camunda8/emitter-sdk`](../../emitter-sdk/) contract,
making it interchangeable with other targets (Playwright/REST, JS SDK, C# SDK, etc.).

## Orchestrator Integration

Commit f27b460 — Python SDK README orchestrator reference

The orchestrator ([materializer/src/index.ts](../index.ts)) wires the Python SDK
emitter into the code generation pipeline via three key steps:

### 1. Factory Registration

The emitter is created and registered at runtime after the operation-map.json
is loaded from `spec/python-sdk/`:

```typescript
// materializer/src/index.ts
registerEmitter(createPythonSdkEmitter(loadPythonSdkMap(repoRoot)));
```

The operation map is optional; when absent, the emitter skips SDK-specific
validation and falls back to generic scenario rendering.

### 2. Support Materialization

Before emitting test suites, the orchestrator calls `materializePythonSupport(outDir)`
to set up the Python project scaffold:

```typescript
if (emitter.id === 'python-sdk') {
  await materializePythonSupport(outDir);
}
```

This creates:

- `pyproject.toml` — Poetry package configuration with SDK dependencies
- `conftest.py` — Pytest fixtures (`ctx`, `client`) for shared test state
- `README.md` — Project-level documentation

### 3. Per-Endpoint Emission

For each scenario collection (REST endpoint), the orchestrator invokes `emit()`:

```typescript
const files = await emitter.emit(collection, ctx);
```

The emitter returns one `EmittedFile` per collection:

- **Path**: `test_<operation_id>.py` (snake_case per Python convention)
- **Content**: Async test module with fixtures and test functions

## Code Generation Details

### Test Structure

Each emitted module follows this structure:

```python
# test_create_widget.py
"""Auto-generated tests for createWidget"""

import pytest
from typing import Any, Dict

class TestContext:
    """Manages test state and variable binding."""
    def get(self, key: str) -> Any: ...
    def set(self, key: str, value: Any) -> None: ...

@pytest.fixture
def ctx() -> TestContext:
    return TestContext()

@pytest.mark.asyncio
async def test_happy_path(ctx: TestContext) -> None:
    """Scenario: happy path"""
    # Step 1: POST /widgets
    # Step 2: GET /widgets/{widgetKey}
    # ...
```

### Context Variables

Tests use bracket notation (`ctx['var_name']`) for all variable access, allowing
flexible binding patterns:

```python
# Seed initial values
ctx.set('tenant_id_var', 'my-tenant')

# Use in path parameters
url = f'/process-instances/{ctx.get("process_instance_key_var") or "{processInstanceKey}"}'

# Extract from responses
ctx.set('widget_key_var', response.json()['id'])

# Substitute into request bodies
body = {
    "name": ctx.get('widget_name_var'),
    "parentKey": ctx.get('parent_key_var'),
}
```

**Commit b19de2e — ctx['var'] for path parameters**

Path parameters are rendered as f-strings with fallback literals:

```python
# Template: /widgets/{id}
# Rendered: f'/widgets/{ctx.get("id_var") or "{id}"}'
```

The fallback provides a recognizable URL (and a 4xx error) if a path-parameter
binding is missing at runtime, instead of the ambiguous string `"undefined"`.

### Placeholder Substitution

**Commit 7082e67 — whole-string-only placeholder substitution**

Body template placeholders (`"${varName}"`) are only substituted when they
occupy the entire string value (not embedded in larger text):

```python
# Whole-string placeholder → substituted
body = {
    "processInstanceKey": ctx.get('process_instance_key_var'),  # ✓
}

# Partial/embedded placeholder → left as-is
body = {
    "description": "Instance ${processInstanceKeyVar} created",  # ✗ not substituted
}
```

This prevents accidental partial replacements and makes the test source more readable.

### String Escaping

**Commit 86d980d — toPythonLiteral escaping**

String literals are escaped for Python's single-quoted strings:

```typescript
toPythonLiteral("path\\to\\file")  // → path\\\\to\\\\file
toPythonLiteral("it's")            // → it\'s
toPythonLiteral("line1\nline2")    // → line1\\nline2
```

## File Organization

```
generated/camunda-oca/python-sdk/
├── pyproject.toml               # Poetry config with SDK dependencies
├── conftest.py                  # Pytest fixtures and test context
├── README.md                    # Project documentation
├── test_create_widget.py        # Generated test module
├── test_deploy_process.py       # Generated test module
└── fixtures/                    # Deployment artifacts (BPMN, DMN, etc.)
    ├── process.bpmn
    └── form.form
```

## Emitter Contract

Implements `EmitterStrategy`:

```typescript
{
  id: 'python-sdk',
  name: 'Python SDK',
  supportedConfigs: ['*'],  // Config-agnostic
  async emit(collection, ctx): Promise<EmittedFile[]>,
  async scaffold(ctx): Promise<EmittedFile[]>,  // Optional
}
```

- **id**: `'python-sdk'` (used in `--target=python-sdk`)
- **supportedConfigs**: `['*']` (works with any named config)
- **emit()**: Pure; returns in-memory `EmittedFile` objects
- **scaffold()**: Optional; emitter relies on orchestrator's `materializePythonSupport()`

## Operation Map

The emitter optionally consumes `spec/python-sdk/operation-map.json` (fetched
via `npm run fetch-sdk-maps`), mapping OpenAPI operationId → SDK method names.

When present, the emitter can validate:
- SDK method coverage (which operations have SDK bindings?)
- Expected method signatures
- Breaking changes in new SDK versions

When absent, the emitter falls back to REST-only generation without SDK-specific
validation.

## Integration with path-analyser

The emitter receives a `EndpointScenarioCollection` from the path-analyser planner,
containing:

```typescript
{
  endpoint: { operationId, method, path },
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [
        {
          operationId: 'createWidget',
          method: 'POST',
          path: '/widgets',
          pathTemplate: '/widgets',
          bodyTemplate: { name: '${nameVar}' },
          expect: { status: 201 },
        },
      ],
      bindings: { nameVar: 'My Widget' },
      expectedResult: { kind: 'success' },
    },
  ],
}
```

The emitter materializes this into executable Python test code.

---

For the overall materialization pipeline and orchestrator contract, see
[materializer/README.md](../README.md).

For the stable emitter SDK contract, see [emitter-sdk/README.md](../../emitter-sdk/README.md).
