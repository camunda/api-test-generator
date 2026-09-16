/**
 * Python SDK project materialization.
 *
 * Sets up scaffolding and support files needed for an emitted Python test suite.
 * This includes package configuration, runtime helpers, and fixtures.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmittedFile } from '@camunda8/emitter-sdk';
import { getActiveConfigDir } from 'path-analyser/configResolver';

export const PYTHON_SDK_FIXTURES_DIR_NAME = 'fixtures';

/**
 * Locate the active config's `fixtures/` directory (#221 / Lift 11:
 * `configs/<config>/fixtures/`). Walks up from this module's location
 * looking for a repo root (one containing `configs.json`), mirroring
 * js-sdk's `defaultFixturesSourceDir` and csharp-sdk's `defaultFixturesDir`.
 */
function defaultFixturesSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'configs.json'))) {
      return path.join(getActiveConfigDir(dir), PYTHON_SDK_FIXTURES_DIR_NAME);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate repo root for Python SDK fixtures from ${here}.`);
}

/**
 * Copy the active config's `fixtures/` directory into
 * `<outDir>/fixtures/`, so `support.fixtures.resolve_fixture()` finds
 * deployment artifacts (BPMN/DMN/form files) regardless of the cwd pytest
 * is invoked from. Mirrors js-sdk's `materializeSdkFixtures` and
 * csharp-sdk's fixture vendoring in `materializeCsharpSupport`. A missing
 * source dir is tolerated (not every config ships fixtures) — an absent
 * destination surfaces as a normal `resolve_fixture` `FileNotFoundError`
 * at test time instead of a hard failure here.
 */
export async function materializePythonFixtures(
  outDir: string,
  fixturesSourceDir: string = defaultFixturesSourceDir(),
): Promise<string> {
  const destination = path.join(outDir, PYTHON_SDK_FIXTURES_DIR_NAME);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  try {
    await fs.cp(fixturesSourceDir, destination, { recursive: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return destination;
    }
    throw error;
  }
  return destination;
}

/**
 * Materialize Python SDK support files into the output directory.
 * Creates Python-specific project structure, dependencies, and runtime helpers.
 */
export async function materializePythonSupport(outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });

  const scaffoldingFiles = loadPythonProjectScaffoldingFiles();

  for (const file of scaffoldingFiles) {
    const filePath = path.join(outDir, file.relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }
}

/**
 * Load Python project scaffolding files (package.json, pyproject.toml, README, etc.).
 * These are the foundational files needed for an independent Python test project.
 */
export function loadPythonProjectScaffoldingFiles(): EmittedFile[] {
  return [
    {
      relativePath: 'pyproject.toml',
      content: `[build-system]
requires = ["poetry-core>=1.0.0"]
build-backend = "poetry.core.masonry.api"

[project]
name = "camunda-sdk-tests"
version = "0.1.0"
description = "Auto-generated test suite for Camunda SDK"
requires-python = ">=3.11"
authors = [
    {name = "api-test-generator", email = "none@example.com"}
]
dependencies = [
    "camunda-orchestration-sdk>=9.0.0",
    "pytest>=7.0",
    "pytest-asyncio>=0.21",
    "httpx>=0.24",
]

[tool.poetry]
# This project is a flat pytest suite with no importable package of its own —
# only its dependencies need installing. Without this, poetry-core's build
# backend tries to build/install a "camunda-sdk-tests" package, finds no
# matching module/folder, and fails (confirmed via a real pip install -e . run).
package-mode = false

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["."]
python_files = "test_*.py"
python_classes = "Test*"
python_functions = "test_*"

[tool.isort]
profile = "black"
line_length = 100

[tool.black]
line-length = 100
target-version = ["py311"]

[tool.mypy]
python_version = "3.11"
check_untyped_defs = true
warn_unused_ignores = true
`,
    },
    {
      relativePath: 'README.md',
      content: `# Camunda Python SDK Tests

Auto-generated integration test suite for the Camunda REST API.

## Setup

Install dependencies using Poetry:

\`\`\`bash
poetry install
\`\`\`

## Running Tests

Run all tests:

\`\`\`bash
poetry run pytest
\`\`\`

Run a specific test file:

\`\`\`bash
poetry run pytest test_create_widget.py -v
\`\`\`

Run with specific markers:

\`\`\`bash
poetry run pytest -m asyncio -v
\`\`\`

## Runtime Configuration

The generated tests execute real HTTP calls through \`httpx.AsyncClient\`.

- \`CAMUNDA_BASE_URL\` (default: \`http://localhost:8080/v2\`)
- \`CAMUNDA_TIMEOUT_SECONDS\` (default: \`30\`)
- \`BEARER_TOKEN\` (optional) -- sent as \`Authorization: Bearer <token>\` on every
  request, for secured clusters. Matches the Playwright/JS SDK suites' own
  \`BEARER_TOKEN\` convention (see the repo README).

Example:

\`\`\`bash
CAMUNDA_BASE_URL=http://localhost:8080/v2 CAMUNDA_TIMEOUT_SECONDS=60 poetry run pytest -v
\`\`\`

## Test Structure

Each test file corresponds to a single REST API endpoint. Test scenarios within each file exercise:

- **Happy path**: Standard successful request/response flow
- **Variants**: Optional response shape variations  
- **Error cases**: Expected HTTP error responses (4xx, 5xx)

## Context Variable Binding

Tests use a shared context object (\`ctx\`) to:

1. **Seed initial values** from global context seeds (e.g., tenant ID)
2. **Extract values** from response bodies to feed subsequent requests
3. **Substitute** into path parameters, query strings, and request bodies

Example:

\`\`\`python
# Seed a value before the test scenario starts
ctx.set('tenant_id_var', 'my-tenant')

# Use it in a path parameter
url = f'/process-instances/{ctx.get("tenant_id_var")}'

# Extract a value from a response and reuse it
ctx.set('process_instance_key_var', response.json()['key'])
\`\`\`

## Generated Files

- \`test_*.py\` — Individual test modules, one per REST endpoint
- \`conftest.py\` — Pytest fixtures and shared configuration
- \`support/\` — Runtime helpers and utilities
- \`fixtures/\` — Deployment artifacts (BPMN, DMN, forms)

---

Generated by [api-test-generator](https://github.com/camunda/api-test-generator)
`,
    },
    {
      relativePath: 'support/fixtures.py',
      content: `"""
Helpers for resolving @@FILE fixtures in generated Python tests.
"""

from pathlib import Path
import os


def resolve_fixture(relative_path: str) -> bytes:
    """Resolve a @@FILE relative path to file bytes."""
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise ValueError('Fixture path missing after @@FILE:')
    # Mirror the JS fixture helper's guard: @@FILE markers can be authored in
    # scenario/domain-semantics inputs, so reject absolute paths and '..'
    # segments before they ever reach a filesystem read.
    if Path(relative_path).is_absolute() or '..' in Path(relative_path).parts:
        raise ValueError(f'Unsafe fixture path: {relative_path}')

    active_config = os.getenv('CONFIG', 'camunda-oca').strip() or 'camunda-oca'
    here = Path(__file__).resolve().parent
    candidates = [
        Path(relative_path),
        Path.cwd() / relative_path,
        Path.cwd() / 'fixtures' / relative_path,
        Path.cwd() / 'configs' / active_config / 'fixtures' / relative_path,
        here.parent / 'fixtures' / relative_path,
        here.parent.parent / 'fixtures' / relative_path,
        here.parent.parent.parent / 'fixtures' / relative_path,
    ]

    last_error: OSError | None = None
    for candidate in candidates:
        try:
            return candidate.read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            continue
        except OSError as err:
            last_error = err

    if last_error is not None:
        raise FileNotFoundError(f'Fixture not found: {relative_path}. Last error: {last_error}')
    raise FileNotFoundError(f'Fixture not found: {relative_path}')
`,
    },
    {
      relativePath: 'support/seeding.py',
      content: `"""
Deterministic seed helpers for generated Python tests.
"""

from __future__ import annotations

import hashlib
import os
import uuid

_SPEC_SALT = ''
_RUN_NONCE: str | None = None
# Per-name call counter (see seed_binding() below): distinguishes repeated
# calls for the same binding name within one run, e.g. two scenarios in the
# same endpoint collection (sharing init_spec_salt(operationId)) that both
# seed a binding named "tenantIdVar" would otherwise hash to the identical
# value -- a producer/consumer pair uniquely seeding the same name within a
# single run still collided even though _resolve_run_nonce() differentiates
# separate run invocations. Never reset mid-run, so values stay distinct
# for the process lifetime; deterministic across runs because pytest's
# collection order is itself deterministic for a fixed TEST_SEED.
_CALL_COUNTERS: dict[str, int] = {}


def init_spec_salt(salt: str) -> None:
    """Set the per-suite salt used by seed_binding()."""
    global _SPEC_SALT
    _SPEC_SALT = salt


def _next_call_index(name: str) -> int:
    idx = _CALL_COUNTERS.get(name, 0)
    _CALL_COUNTERS[name] = idx + 1
    return idx


def _resolve_run_nonce() -> str:
    """
    Per-process nonce mixed into \`unique=True\` seeds so re-running the
    suite against the same broker doesn't collide on a previous run's
    client-minted identifiers. Sourced from env \`TEST_RUN_NONCE\` if set
    (lets CI replay a specific failed run), otherwise from \`uuid.uuid4()\`
    at first use, cached for the process lifetime. Mirrors
    \`_resolveRunNonce()\` in materializer/src/playwright/support/seeding.ts.
    """
    global _RUN_NONCE
    if _RUN_NONCE is not None:
        return _RUN_NONCE
    env = os.getenv('TEST_RUN_NONCE', '')
    _RUN_NONCE = env if env else uuid.uuid4().hex
    return _RUN_NONCE


def seed_binding(name: str, unique: bool = False) -> str:
    """Generate a deterministic seed value for the given binding name."""
    seed = os.getenv('TEST_SEED', 'snapshot-baseline')
    # Without a per-process fallback, an unset TEST_RUN_NONCE made
    # nonce == '' regardless of \`unique\`, so a "unique" seed was
    # byte-identical to an ordinary one — defeating the whole point of
    # \`unique=True\` (client-minted identifiers consumed by an op that
    # declares HTTP 409 would collide across separate run invocations).
    nonce = _resolve_run_nonce() if unique else ''
    call_index = _next_call_index(name)
    material = f'{seed}:{_SPEC_SALT}:{nonce}:{name}:{call_index}'
    digest = hashlib.sha256(material.encode('utf-8')).hexdigest()[:12]
    if 'email' in name.lower():
        return f'{name}-{digest}@example.com'
    if name.lower().endswith('id') or name.lower().endswith('key'):
        return f'{name}-{digest}'
    return f'{name}-{digest}'
`,
    },

    {
      relativePath: 'conftest.py',
      content: `"""
Pytest configuration and fixtures for Camunda SDK tests.
"""

import pytest
import os
from typing import Any, Dict, AsyncGenerator
import httpx


class TestContext:
    """
    Shared test context for managing state across HTTP requests.
    
    Used to:
    - Seed initial context values (e.g., tenant ID)
    - Extract and store response values for later requests
    - Substitute variables into request bodies and path parameters
    """

    def __init__(self):
        """Initialize an empty context."""
        self.ctx: Dict[str, Any] = {}
        self.responses: Dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a value from the context.
        
        Args:
            key: The context variable name
            default: Default value if key not found
            
        Returns:
            The stored value, or default if not found
        """
        return self.ctx.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """
        Set a value in the context.
        
        Args:
            key: The variable name to store under
            value: The value to store
        """
        self.ctx[key] = value

    def store_response(self, operation_id: str, response: Any) -> None:
        """
        Store a response for later inspection.
        
        Args:
            operation_id: The operation that was called
            response: The response object to store
        """
        self.responses[operation_id] = response


@pytest.fixture
async def ctx() -> TestContext:
    """
    Provide a fresh test context for each test.
    
    Yields:
        A new TestContext instance with empty state
    """
    return TestContext()


@pytest.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """
    Provide an async HTTP client for tests.
    
    Yields:
        An httpx AsyncClient configured for the test environment
    """
    base_url = os.getenv("CAMUNDA_BASE_URL", "http://localhost:8080/v2")
    if not base_url.endswith("/"):
        # Request URLs are emitted without a leading '/' so they resolve as
        # relative references against base_url's own path (e.g. '/v2'). Per
        # RFC 3986, that only extends the path -- rather than replacing it --
        # when base_url itself ends with '/'.
        base_url += "/"
    timeout_seconds = float(os.getenv("CAMUNDA_TIMEOUT_SECONDS", "30"))
    bearer_token = os.getenv("BEARER_TOKEN")
    headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}

    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=timeout_seconds,
        headers=headers,
    ) as client:
        yield client
`,
    },
  ];
}
