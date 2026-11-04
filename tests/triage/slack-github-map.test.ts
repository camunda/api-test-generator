import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildMap,
  githubLogin,
  mention,
  needsLookup,
  resolveFieldId,
  type SlackApi,
  type SlackResponse,
} from '../../scripts/triage/slack-github-map.ts';

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/triage/slack-github-map.ts',
);

// A scripted Slack API: one handler per method; records the calls made so tests can assert the
// per-user path was (or was not) taken.
function fakeApi(
  handlers: Partial<Record<string, (params: Record<string, string>) => SlackResponse>>,
): { api: SlackApi; calls: Array<{ method: string; params: Record<string, string> }> } {
  const calls: Array<{ method: string; params: Record<string, string> }> = [];
  const api: SlackApi = {
    async get(method, params) {
      calls.push({ method, params });
      const h = handlers[method];
      return h ? h(params) : { ok: false, error: 'no_handler' };
    },
  };
  return { api, calls };
}

const GH_FIELD = {
  ok: true,
  profile: { fields: [{ id: 'Xf01', label: 'GitHub' }] },
} satisfies SlackResponse;

describe('githubLogin', () => {
  it('reads a login from a full profile URL', () => {
    expect(githubLogin('https://github.com/Wollefitz')).toBe('wollefitz');
    expect(githubLogin('http://github.com/octo-cat/')).toBe('octo-cat');
    expect(githubLogin('https://github.com/foo?tab=repositories')).toBe('foo');
  });

  it('reads a bare handle or @handle', () => {
    expect(githubLogin('octocat')).toBe('octocat');
    expect(githubLogin('@OctoCat')).toBe('octocat');
    expect(githubLogin('  spaced  ')).toBe('spaced');
  });

  it('rejects anything that is not a single valid login', () => {
    expect(githubLogin('')).toBe('');
    expect(githubLogin(undefined)).toBe('');
    expect(githubLogin('two words')).toBe('');
    expect(githubLogin('-leadinghyphen')).toBe('');
    expect(githubLogin('a'.repeat(40))).toBe('');
  });
});

describe('resolveFieldId', () => {
  it('finds the GitHub field by label, case-insensitively', async () => {
    const { api } = fakeApi({
      'team.profile.get': () => ({
        ok: true,
        profile: { fields: [{ id: 'Xf9', label: 'github' }] },
      }),
    });
    expect(await resolveFieldId(api)).toBe('Xf9');
  });

  it('honors an explicit override without calling the API', async () => {
    const { api, calls } = fakeApi({});
    expect(await resolveFieldId(api, 'XfOverride')).toBe('XfOverride');
    expect(calls).toHaveLength(0);
  });

  it('returns empty when there is no GitHub field or the call fails', async () => {
    const { api: noField } = fakeApi({
      'team.profile.get': () => ({
        ok: true,
        profile: { fields: [{ id: 'Xf1', label: 'Phone' }] },
      }),
    });
    expect(await resolveFieldId(noField)).toBe('');
    const { api: failed } = fakeApi({
      'team.profile.get': () => ({ ok: false, error: 'missing_scope' }),
    });
    expect(await resolveFieldId(failed)).toBe('');
  });
});

describe('buildMap', () => {
  it('builds the map from fields carried inline by users.list, skipping bots and deleted users', async () => {
    const { api, calls } = fakeApi({
      'team.profile.get': () => GH_FIELD,
      'users.list': () => ({
        ok: true,
        members: [
          { id: 'U1', profile: { fields: { Xf01: { value: 'https://github.com/alice' } } } },
          { id: 'U2', profile: { fields: { Xf01: { value: '@Bob' } } } },
          { id: 'U3', is_bot: true, profile: { fields: { Xf01: { value: 'botty' } } } },
          { id: 'U4', deleted: true, profile: { fields: { Xf01: { value: 'ghost' } } } },
          { id: 'U5', profile: { fields: { Xf01: { value: '' } } } }, // present but blank
        ],
      }),
    });
    const map = await buildMap(api);
    expect(map).toEqual({ alice: 'U1', bob: 'U2' });
    // Inline fields were present, so no per-user users.profile.get calls were needed.
    expect(calls.some((c) => c.method === 'users.profile.get')).toBe(false);
  });

  it('falls back to users.profile.get when users.list omits custom fields', async () => {
    const profiles: Record<string, string> = { U1: 'https://github.com/alice', U2: 'carol' };
    const { api, calls } = fakeApi({
      'team.profile.get': () => GH_FIELD,
      'users.list': () => ({ ok: true, members: [{ id: 'U1' }, { id: 'U2' }] }),
      'users.profile.get': (p) => ({
        ok: true,
        profile: { fields: { Xf01: { value: profiles[p.user] } } },
      }),
    });
    const map = await buildMap(api);
    expect(map).toEqual({ alice: 'U1', carol: 'U2' });
    expect(calls.filter((c) => c.method === 'users.profile.get')).toHaveLength(2);
  });

  it('paginates users.list via the next_cursor', async () => {
    const pages: Record<string, SlackResponse> = {
      '': {
        ok: true,
        members: [{ id: 'U1', profile: { fields: { Xf01: { value: 'alice' } } } }],
        response_metadata: { next_cursor: 'CUR' },
      },
      CUR: { ok: true, members: [{ id: 'U2', profile: { fields: { Xf01: { value: 'bob' } } } }] },
    };
    const { api } = fakeApi({
      'team.profile.get': () => GH_FIELD,
      'users.list': (p) => pages[p.cursor ?? ''],
    });
    expect(await buildMap(api)).toEqual({ alice: 'U1', bob: 'U2' });
  });

  it('inserts a login that collides with an Object.prototype key as an own property', async () => {
    const { api } = fakeApi({
      'team.profile.get': () => GH_FIELD,
      'users.list': () => ({
        ok: true,
        members: [{ id: 'U1', profile: { fields: { Xf01: { value: 'constructor' } } } }],
      }),
    });
    const map = await buildMap(api);
    expect(Object.hasOwn(map, 'constructor')).toBe(true);
    expect(map.constructor).toBe('U1');
    expect(mention('constructor', map)).toBe('<@U1>');
  });

  it('returns an empty map when the GitHub field cannot be found (no scan)', async () => {
    const { api, calls } = fakeApi({
      'team.profile.get': () => ({ ok: false, error: 'missing_scope' }),
    });
    expect(await buildMap(api)).toEqual({});
    expect(calls.some((c) => c.method === 'users.list')).toBe(false);
  });

  it('stops and returns a partial map when a per-user fetch is rate-limited', async () => {
    const { api } = fakeApi({
      'team.profile.get': () => GH_FIELD,
      'users.list': () => ({ ok: true, members: [{ id: 'U1' }, { id: 'U2' }] }),
      'users.profile.get': (p) =>
        p.user === 'U1'
          ? { ok: true, profile: { fields: { Xf01: { value: 'alice' } } } }
          : { ok: false, error: 'ratelimited' },
    });
    expect(await buildMap(api)).toEqual({ alice: 'U1' });
  });

  it('never throws — a thrown transport error yields an empty map', async () => {
    const api: SlackApi = {
      async get() {
        throw new Error('network down');
      },
    };
    await expect(buildMap(api)).resolves.toEqual({});
  });
});

describe('mention', () => {
  const map = { alice: 'U1', bob: 'U2' };
  it('returns a Slack mention for a mapped login, case-insensitively and @-tolerant', () => {
    expect(mention('alice', map)).toBe('<@U1>');
    expect(mention('Bob', map)).toBe('<@U2>');
    expect(mention('@alice', map)).toBe('<@U1>');
  });

  it('returns empty for an unmapped or empty login (caller falls back to the medic)', () => {
    expect(mention('carol', map)).toBe('');
    expect(mention('', map)).toBe('');
    expect(mention(undefined, map)).toBe('');
  });

  it('handles logins that collide with Object.prototype keys (constructor, toString, …)', () => {
    // These are valid GitHub handles but also inherited prototype properties; a bare `map[key]`
    // would return a function and produce a malformed mention. Own-property lookup must be used.
    expect(mention('constructor', {})).toBe('');
    expect(mention('toString', {})).toBe('');
    expect(mention('valueOf', { alice: 'U1' })).toBe('');
    expect(mention('constructor', { constructor: 'U9' })).toBe('<@U9>');
    expect(mention('ToString', { tostring: 'U8' })).toBe('<@U8>');
  });
});

describe('needsLookup', () => {
  it('is true only when some item carries a non-empty login under the key', () => {
    expect(needsLookup([{ fixer: 'alice' }], 'fixer')).toBe(true);
    expect(needsLookup([{ fixer: '' }, { type: 'x' }], 'fixer')).toBe(false);
    expect(needsLookup([], 'fixer')).toBe(false);
    // the key must match — a login under a different key is not something to resolve
    expect(needsLookup([{ author: 'alice' }], 'fixer')).toBe(false);
    expect(needsLookup([{ author: 'alice' }], 'author')).toBe(true);
  });
});

describe('CLI --enrich (fail-soft glue)', () => {
  // Without a Slack token the resolver cannot map anyone, so every item gets an empty
  // `<key>Mention` and the formatter falls back to the GitHub link — the alert is never blocked.
  it('adds an empty <key>Mention to every item when no token is available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghmap-'));
    const file = join(dir, 'summary.json');
    writeFileSync(file, JSON.stringify([{ type: 'opened', fixer: 'octocat' }, { type: 'x' }]));
    const env = { ...process.env };
    env.SLACK_TOKEN = '';
    env.SLACK_BOT_TOKEN = '';
    execFileSync('node', [CLI, '--enrich', file, '--key', 'fixer'], { env, stdio: 'ignore' });
    const items: Array<Record<string, unknown>> = JSON.parse(readFileSync(file, 'utf8'));
    expect(items[0].fixerMention).toBe('');
    expect(items[1].fixerMention).toBe('');
    expect(items[0].fixer).toBe('octocat'); // original fields are preserved
  });
});
