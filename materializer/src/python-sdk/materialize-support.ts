/**
 * Materialize Python SDK test support files into the generated output directory.
 *
 * Vendors self-contained Python support modules so generated test suites
 * are runnable standalone without any dependency on this generator project.
 *
 * Files materialized:
 *   - conftest.py — pytest session fixture with CamundaAsyncClient
 *   - helper.py — extract_into() and seedBinding() helpers
 *   - requirements.txt — dependencies (camunda-orchestration-sdk, pytest, pytest-asyncio)
 *   - pytest.ini — pytest configuration (asyncio_mode = auto)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const CONFTEST_PY = `"""
Pytest configuration for Camunda API test suite.

Session-scoped client fixture and asyncio configuration.
"""

import os
import pytest
from camunda.client import CamundaAsyncClient


@pytest.fixture(scope='session')
def client() -> CamundaAsyncClient:
  """
  Session-scoped CamundaAsyncClient fixture.
  
  Supports both local (unauthenticated) and SaaS (OAuth2) configurations
  via environment variables:
  
  Local (unauthenticated):
    CAMUNDA_BASE_URL=http://localhost:8080
    (no auth env vars needed)
  
  SaaS (OAuth2):
    CAMUNDA_BASE_URL=https://<region>.camunda.cloud
    CAMUNDA_CLIENT_ID=<your-client-id>
    CAMUNDA_CLIENT_SECRET=<your-client-secret>
    CAMUNDA_OAUTH_URL=https://<region>.auth.camunda.cloud
  """
  base_url = os.getenv('CAMUNDA_BASE_URL', 'http://localhost:8080')
  client_id = os.getenv('CAMUNDA_CLIENT_ID')
  client_secret = os.getenv('CAMUNDA_CLIENT_SECRET')
  oauth_url = os.getenv('CAMUNDA_OAUTH_URL')
  
  # Create client with optional OAuth2 credentials
  if client_id and client_secret and oauth_url:
    return CamundaAsyncClient(
      base_url=base_url,
      client_id=client_id,
      client_secret=client_secret,
      oauth_url=oauth_url,
    )
  else:
    # Local unauthenticated mode
    return CamundaAsyncClient(base_url=base_url)
`;

const HELPER_PY = `"""
Test helper functions for Camunda API test suite.

Provides:
  - extract_into() — extract response fields into context dict
  - seedBinding() — seed random or default values for test variables
"""

import random
import string
import uuid
from typing import Any, Optional


def extract_into(ctx: dict[str, Any], bind_name: str, value: Any) -> None:
  """
  Extract a value from a response and store it in the test context.
  
  Preserves existing bindings (skips assignment if value is None or
  undefined), so seeded bindings from earlier steps are not overwritten
  by responses that omit the field.
  
  Args:
    ctx: Test context dict (mutated in-place)
    bind_name: Key to store the value under
    value: Value to extract (assignment skipped if None)
  """
  if value is not None:
    ctx[bind_name] = value


def seedBinding(
  bind_name: str,
  default_value: Optional[str | int | float | bool] = None,
) -> str | int | float | bool:
  """
  Seed a random or default value for a test variable.
  
  Called during scenario setup to populate undefined bindings.
  Generates UUIDs for identifier types (default), or returns the
  provided default_value if supplied.
  
  Args:
    bind_name: Name of the binding (used for logging/debugging)
    default_value: Optional literal value to return instead of generating random
  
  Returns:
    The default_value if supplied, otherwise a generated UUID string
  """
  if default_value is not None:
    return default_value
  # Generate a UUID for identifier-type bindings
  return str(uuid.uuid4())
`;

const REQUIREMENTS_TXT = `camunda-orchestration-sdk>=1.0.0
pytest>=7.0
pytest-asyncio>=0.21.0
`;

const PYTEST_INI = `[pytest]
asyncio_mode = auto
testpaths = .
python_files = test_*.py
python_classes = Test*
python_functions = test_*
`;

/**
 * Materialize Python support files into the generated test suite directory.
 *
 * Creates:
 *   - <outDir>/conftest.py — pytest configuration + client fixture
 *   - <outDir>/helper.py — test helper functions
 *   - <outDir>/requirements.txt — Python dependencies
 *   - <outDir>/pytest.ini — pytest config (asyncio_mode = auto)
 */
export async function materializePythonSupport(outDir: string): Promise<void> {
  const files: Array<[string, string]> = [
    ['conftest.py', CONFTEST_PY],
    ['helper.py', HELPER_PY],
    ['requirements.txt', REQUIREMENTS_TXT],
    ['pytest.ini', PYTEST_INI],
  ];

  await fs.mkdir(outDir, { recursive: true });

  for (const [filename, content] of files) {
    const filePath = path.join(outDir, filename);
    await fs.writeFile(filePath, content, 'utf8');
  }
}
