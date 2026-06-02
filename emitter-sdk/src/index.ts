/**
 * @camunda8/emitter-sdk — stable contract for materialization emitters.
 *
 * External emitter packages should depend on this package and import
 * everything from here rather than reaching into materializer or
 * path-analyser internals.
 *
 * Typical usage:
 *
 * ```ts
 * import {
 *   type EmitterStrategy,
 *   type EmitContext,
 *   type EmittedFile,
 *   registerEmitter,
 * } from '@camunda8/emitter-sdk';
 *
 * const MyEmitter: EmitterStrategy = {
 *   id: 'my-target',
 *   name: 'My SDK suite',
 *   supportedConfigs: ['camunda-oca'],
 *   async emit(collection, ctx) {
 *     // ...
 *     return [{ relativePath: 'foo.spec.ts', content: '...' }];
 *   },
 * };
 *
 * registerEmitter(MyEmitter);
 * ```
 */

// Re-export the scenario shapes that EmitterStrategy.emit() takes, so
// external emitters can `import { ... } from '@camunda8/emitter-sdk'`
// without a separate path-analyser dependency.
export type {
  EndpointScenarioCollection,
  GlobalContextSeed,
} from 'path-analyser/types';

export {
  _resetRegistriesForTests,
  getEmitter,
  getRoleHookProvider,
  listEmitters,
  listRoleHookProviders,
  registerEmitter,
  registerRoleHookProvider,
} from './registry.js';
export type {
  EmitContext,
  EmittedFile,
  EmitterSdkMap,
  EmitterStrategy,
  JSONSchema,
  LoadedRoleBundle,
  RoleHookProvider,
  RoleMatchSpec,
} from './types.js';
