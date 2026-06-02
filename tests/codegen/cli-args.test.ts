import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../../materializer/src/cli-args.ts';

describe('parseCliArgs', () => {
  test('default target is playwright', () => {
    expect(parseCliArgs(['createWidget'])).toEqual({
      target: 'playwright',
      positional: 'createWidget',
      help: false,
      allTargets: false,
      listTargets: false,
    });
  });

  test('--target=<id> overrides the default', () => {
    expect(parseCliArgs(['--target=typescript-sdk', 'createWidget'])).toEqual({
      target: 'typescript-sdk',
      positional: 'createWidget',
      help: false,
      allTargets: false,
      listTargets: false,
    });
  });

  test('--target after the positional still applies', () => {
    expect(parseCliArgs(['--all', '--target=python-sdk'])).toEqual({
      target: 'python-sdk',
      positional: '--all',
      help: false,
      allTargets: false,
      listTargets: false,
    });
  });

  test('--help short and long', () => {
    expect(parseCliArgs(['--help'])).toMatchObject({ help: true });
    expect(parseCliArgs(['-h'])).toMatchObject({ help: true });
  });

  test('--all-targets sets allTargets and preserves the positional sentinel', () => {
    expect(parseCliArgs(['--all-targets', '--all'])).toMatchObject({
      allTargets: true,
      positional: '--all',
    });
  });

  test('list-targets subcommand sets listTargets', () => {
    expect(parseCliArgs(['list-targets'])).toMatchObject({
      listTargets: true,
      positional: undefined,
    });
  });

  test('--all is preserved as the positional sentinel', () => {
    expect(parseCliArgs(['--all'])).toMatchObject({ positional: '--all' });
  });

  test('empty argv yields no positional and no help', () => {
    expect(parseCliArgs([])).toEqual({
      target: 'playwright',
      positional: undefined,
      help: false,
      allTargets: false,
      listTargets: false,
    });
  });

  test('first positional wins; later positionals are ignored', () => {
    // CLI accepts a single operationId; documenting the parser behaviour explicitly.
    expect(parseCliArgs(['createWidget', 'extra'])).toMatchObject({
      positional: 'createWidget',
    });
  });
});
