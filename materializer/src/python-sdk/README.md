# Python SDK Emitter

Generates async pytest test suites for the Camunda REST API using the `camunda-orchestration-sdk` Python package.

## Overview

The Python SDK emitter lowers an `EndpointScenarioCollection` (from the planner) into async pytest tests that invoke the `CamundaAsyncClient` from the Python SDK.

- **Emitter ID**: `python-sdk`
- **Output format**: `.py` async pytest test modules
- **Test framework**: pytest + pytest-asyncio
- **Client**: `CamundaAsyncClient` (async, recommended)
- **Assertion strategy**: SDK raises typed exceptions on non-2xx; plain `assert result is not None` smoke test

## Usage

### Generate Python tests for all endpoints

```bash
npm run codegen:python-sdk:all
```

### Generate Python tests for a single endpoint

```bash
npm run codegen:python-sdk -- activateJobs
```

## Environment Variables

### `PYTHON_SDK_REF` (for fetch-python-sdk-map)

Controls which commit of `camunda/orchestration-cluster-api-python` is fetched.

```bash
# Fetch from main (default)
npm run fetch-python-sdk-map

# Fetch from specific commit SHA
PYTHON_SDK_REF=abc123def456 npm run fetch-python-sdk-map

# As part of the full pipeline
npm run pipeline
```

## Emitted Test Structure

### Example: activateJobs scenario

```python
# test/activate_jobs.python_sdk.spec.py
# Test suite for activateJobs
# This file is auto-generated. Do not edit.

from typing import Any
import pytest
from camunda.client import CamundaAsyncClient
from helper import extract_into, seedBinding

@pytest.mark.asyncio
async def test_sc_activate_jobs_simple(client: CamundaAsyncClient) -> None:
  """Activates jobs of a given type and extracts the first job key"""
  
  ctx: dict[str, Any] = {}
  
  # Seed scenario bindings
  ctx['workerType'] = 'MyWorkerType'
  
  # Seed runtime-generated bindings
  if 'workerType' not in ctx:
    ctx['workerType'] = seedBinding('workerType')
  
  # Step 1: activateJobs
  request_body = {
    'type': ctx['workerType'],
    'maxJobsToActivate': 1,
    'timeout': 30000,
  }
  
  result = await client.activate_jobs(
    data=ActivateJobsRequest.from_dict(request_body)
  )
  
  assert result is not None, 'activateJobs must return a response'
  
  # Extract response fields
  extract_into(ctx, 'jobKey', result['jobs'][0]['key'])
```

## Materialized Support Files

The emitter vendors the following Python files into the generated suite directory:

- **conftest.py** — pytest configuration and `CamundaAsyncClient` session fixture
- **helper.py** — `extract_into()` and `seedBinding()` test helpers
- **requirements.txt** — dependencies (camunda-orchestration-sdk, pytest, pytest-asyncio)
- **pytest.ini** — pytest config with `asyncio_mode = auto`

### conftest.py: Client Fixture

Supports both local (unauthenticated) and SaaS (OAuth2) configurations via environment variables:

**Local (unauthenticated):**
```bash
export CAMUNDA_BASE_URL=http://localhost:8080
pytest test_*.py
```

**SaaS (OAuth2):**
```bash
export CAMUNDA_BASE_URL=https://<region>.camunda.cloud
export CAMUNDA_CLIENT_ID=<your-client-id>
export CAMUNDA_CLIENT_SECRET=<your-client-secret>
export CAMUNDA_OAUTH_URL=https://<region>.auth.camunda.cloud
pytest test_*.py
```

The `client` fixture is session-scoped and injected into every test automatically.

### helper.py: Test Helpers

**`extract_into(ctx, bind_name, value)`** — Extract a response field into the test context.
- Preserves existing bindings (skips assignment if value is None).
- Called after each step to capture response fields for downstream steps.

**`seedBinding(bind_name, default_value=None)`** — Seed a random or default value.
- Generates UUIDs for identifier-type bindings when no default is provided.
- Called during scenario setup to populate undefined bindings.

## SDK Operation Mapping

The emitter translates Camunda `operationId` (camelCase) to Python SDK method names (snake_case):

- `activateJobs` → `client.activate_jobs()`
- `createDeployment` → `client.create_deployment()`
- `deleteProcessDefinition` → `client.delete_process_definition()`

Resolution order:
1. Check `spec/python-sdk/operation-map.json` (fetched from SDK repo via `fetch-python-sdk-map`)
2. Fall back to `camelToSnake()` conversion if not found

## Supported Scenario Shapes

### ✅ Supported

- **Single-step scenarios** — one `client.<method>()` call per test
- **Multi-step chains** — request → extract → next request
- **JSON request bodies** — converted via `<ModelClass>.from_dict(body_dict)`
- **Response field extraction** — via `extract_into()` helper
- **Seed bindings** — literal values or generated UUIDs

### ❌ Unsupported (Hard-fail at generation time)

- **Multipart request bodies** — `bodyKind === 'multipart'`
  - Python SDK integration does not support file uploads; use HTTP/Playwright suites instead
- **Custom validation logic** — jsonschema, pydantic, etc.
  - SDK raises typed exceptions on non-2xx; plain `assert` statements sufficient for smoke tests

## Test Execution

### Install dependencies

```bash
cd <generated-suite-dir>
pip install -r requirements.txt
```

### Run all tests

```bash
pytest test_*.py -v
```

### Run a single test

```bash
pytest test_activate_jobs.python_sdk.spec.py::test_sc_activate_jobs_simple -v
```

### Run with live broker (docker-compose)

```bash
# Terminal 1: start Camunda
docker-compose up -d

# Terminal 2: run tests
pytest test_*.py -v --tb=short

# Terminal 3: cleanup
docker-compose down
```

## Architecture & Purity

The Python SDK emitter is **pure**: it accepts a scenario collection and context, and returns an in-memory list of `EmittedFile` objects. No filesystem or network I/O occurs during emission. The orchestrator (`materializer/src/index.ts`) handles directory creation and file writes.

### EmitterFactory Pattern

The emitter is created by `createPythonSdkEmitter()`, which accepts an optional `OperationMapJsonSource`. This allows:

- **Production use**: Map is fetched from `spec/python-sdk/operation-map.json` and passed to the factory
- **Unit tests**: Tests use a default fallback or mock mapping without requiring the SDK repo

### Determinism

The emitter produces deterministic output: identical input always yields identical output. This is critical for:

- Regression testing (Layer-3 invariants)
- Build cache validation
- Snapshot-based testing

## Limitations & Roadmap

### Current Limitations

- **No request-validation (negative testing)** — HTTP-only feature; Python SDK tests are smoke tests
- **No custom assertions** — plain `assert result is not None`; SDK exceptions are the primary assertion mechanism
- **No type stubs** — model class names inferred heuristically from operationId (e.g., `ActivateJobsRequest`)

### Future Enhancements

- Auto-generate type stubs from OpenAPI spec
- Optional Pydantic schema validation
- Support for discriminated union (oneOf/anyOf) response shapes
- Multi-step orchestration with explicit context binding visualization

**SaaS (OAuth2):**
```bash
export CAMUNDA_BASE_URL=https://<region>.camunda.cloud
export CAMUNDA_CLIENT_ID=<your-client-id>
export CAMUNDA_CLIENT_SECRET=<your-client-secret>
export CAMUNDA_OAUTH_URL=https://<region>.auth.camunda.cloud
pytest test_*.py
```

## Operation Mapping

The emitter resolves `operationId` (camelCase) from the OpenAPI spec to Python method names (snake_case) via the operation-map loaded from the Python SDK:

- `activateJobs` → `activate_jobs`
- `createDeployment` → `create_deployment`
- `listProcessDefinitions` → `list_process_definitions`

If the operation-map is unavailable, the emitter falls back to simple camelCase → snake_case conversion.

## Request Bodies

Request bodies are instantiated using the `from_dict()` class method:

```python
# For single-body operations:
result = await client.create_deployment(
  data=CreateDeploymentRequest.from_dict(request_body)
)

# For oneOf/anyOf bodies, from_dict() selects the discriminant variant internally
result = await client.start_process_instance(
  data=StartProcessInstanceRequest.from_dict(request_body)
)
```

## Response Extraction

Response fields are extracted into the test context dict using the `extract_into()` helper:

```python
extract_into(ctx, 'jobKey', result.jobs[0].key)
extract_into(ctx, 'processInstanceKey', result.processInstanceKey)
```

The helper preserves seeded bindings — if a field is `None` or undefined, the existing binding is not overwritten.

## Error Handling

The Python SDK raises typed exceptions for non-2xx responses:

- `BadRequestError` (400)
- `UnauthorizedError` (401)
- `NotFoundError` (404)
- `ConflictError` (409)
- And others per the SDK contract

The emitter does **not** emit explicit status assertions. Reaching the next line confirms success; an exception proves failure:

```python
result = await client.activate_jobs(data=...)
assert result is not None  # Smoke test only; SDK guarantees non-None on 2xx
```

## Multipart Bodies (Hard-Fail)

The Python SDK emitter does **not** support multipart request bodies. Attempting to emit a scenario with a multipart step will throw:

```
[PythonSdkEmitter] Hard-fail: multipart body in step 0 (createDeployment). 
The Python SDK does not support multipart uploads. 
This scenario cannot be emitted.
```

This is a known limitation and will surface at generation time rather than producing a broken test.

## Seed Bindings

Scenarios may declare `seedBindings` (variables with `__PENDING__` values). These are seeded at test startup:

```python
# Literal bindings
ctx['tenantId'] = '<default>'

# Runtime-generated bindings
if 'processDefinitionKey' not in ctx:
  ctx['processDefinitionKey'] = seedBinding('processDefinitionKey')
```

## Assertion Strategy

Per the specification, the Python SDK emitter relies on:

1. **SDK throws on non-2xx** — no explicit status assertion needed
2. **Plain `assert` statements** — no external validation library (jsonschema, pydantic, deepdiff)
3. **extract_into() for response binding** — attributes are strongly typed, not raw JSON

Example:

```python
result = await client.activate_jobs(data=...)
assert result is not None
extract_into(ctx, 'jobKey', result.jobs[0].key)
```

## Known Limitations

- **No request-validation parity**: The Python emitter is path-analyser only. HTTP-level request-validation (negative tests, HTTP 400 expectations) is out of scope and remains in `request-validation/`.
- **No multipart support**: Scenarios with `bodyKind === 'multipart'` will hard-fail.
- **Simplified type inference**: Model class names are inferred from `operationId` via a heuristic (PascalCase + "Request" suffix). For accuracy, the SDK's type stubs should be consulted.

## Regress Testing

Layer-3 regression invariants in `configs/camunda-oca/regression-invariants.test.ts` assert:

1. Every URL placeholder is either seeded or extracted by an upstream step (mirrors Bug A from JS SDK)
2. The emitter's operation-map keyset matches the Python SDK's `examples/operation-map.json` under CI

Run the full pipeline + tests locally before pushing:

```bash
npm run pipeline
npm test
```
