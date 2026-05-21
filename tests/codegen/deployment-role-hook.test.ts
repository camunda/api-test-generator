// Class-scoped regression guard for #233 Step 6: the deployment-gateway
// extracts must remain reachable via the SDK RoleHookProvider contract.
// If a future refactor renames the hook, drops the role, or fails to
// register the provider, downstream emitter contributors (and the
// internal Playwright orchestrator) will see an unwired role and the
// deploy() helper materializes with an empty extracts array — a silent
// suite regression. The assertions below pin both the contract surface
// (hook + role names) and the registration wiring.

import {
  _resetRegistriesForTests,
  getRoleHookProvider,
  registerRoleHookProvider,
} from '@camunda8/emitter-sdk';
import { describe, expect, test } from 'vitest';
import {
  DEPLOYMENT_HOOK,
  DeploymentRoleHookProvider,
} from '../../configs/camunda-oca/codegen/playwright/roles/deploymentGateway/hook.ts';

describe('DeploymentRoleHookProvider (SDK RoleHookProvider contract, #233 Step 6)', () => {
  test('declares stable hook + role names', () => {
    expect(DeploymentRoleHookProvider.hook).toBe(DEPLOYMENT_HOOK);
    expect(DEPLOYMENT_HOOK).toBe('deployment');
    // The role string must match the planner-side constant; otherwise
    // ctx.roleExtras[<role>] is keyed differently than the emitter looks
    // it up and the deploy() helper renders an empty extracts list.
    expect(DeploymentRoleHookProvider.role).toBe('deploymentGateway');
  });

  test('is retrievable from the SDK registry after registration', () => {
    _resetRegistriesForTests();
    expect(getRoleHookProvider(DEPLOYMENT_HOOK)).toBeUndefined();
    registerRoleHookProvider(DeploymentRoleHookProvider);
    const fetched = getRoleHookProvider(DEPLOYMENT_HOOK);
    expect(fetched).toBe(DeploymentRoleHookProvider);
    expect(fetched?.role).toBe('deploymentGateway');
    _resetRegistriesForTests();
  });
});
