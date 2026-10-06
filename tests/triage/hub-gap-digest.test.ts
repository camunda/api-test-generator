import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  type Item,
  parseHubPr,
  postDigest,
} from '../../scripts/triage/hub-gap-digest.ts';

const now = new Date('2026-10-10T07:00:00Z');

function item(over: Partial<Item>): Item {
  return {
    number: 1,
    url: 'https://github.com/camunda/api-test-generator/issues/1',
    title: '[hub-pr-check] Generator gap on camunda-hub#100',
    createdAt: '2026-10-05T07:00:00Z',
    assignee: 'alice',
    hubPr: 100,
    hubState: 'merged',
    mergedAt: '2026-10-07T07:00:00Z',
    ...over,
  };
}

describe('parseHubPr', () => {
  it('reads the camunda-hub PR number from the issue title', () => {
    expect(parseHubPr('[hub-pr-check] Generator gap on camunda-hub#27799')).toBe(27799);
  });

  it('returns null for an unrelated title', () => {
    expect(parseHubPr('Something else #12')).toBeNull();
  });
});

describe('buildDigest', () => {
  it('stays silent when no tracked PR has merged', () => {
    expect(buildDigest([item({ hubState: 'open' })], now).text).toBe('');
    expect(buildDigest([], now).text).toBe('');
  });

  it('lists a merged PR with ages and the assignee', () => {
    const d = buildDigest([item({})], now);
    expect(d.overdue).toHaveLength(1);
    expect(d.text).toContain('camunda-hub#100');
    expect(d.text).toContain('merged 3d ago');
    expect(d.text).toContain('api-test-generator#1');
    expect(d.text).toContain('(5d)');
    expect(d.text).toContain('assigned to `alice`');
  });

  it('says so when nobody is assigned', () => {
    expect(buildDigest([item({ assignee: '' })], now).text).toContain('unassigned');
  });

  it('puts the oldest merge first', () => {
    const d = buildDigest(
      [
        item({ number: 2, hubPr: 200, mergedAt: '2026-10-09T07:00:00Z' }),
        item({ number: 1, hubPr: 100, mergedAt: '2026-10-01T07:00:00Z' }),
      ],
      now,
    );
    expect(d.overdue.map((i) => i.hubPr)).toEqual([100, 200]);
  });

  it('counts PRs that have not merged yet without listing them', () => {
    const d = buildDigest([item({}), item({ number: 3, hubPr: 300, hubState: 'open' })], now);
    expect(d.text).toContain('1 more tracked');
    expect(d.text).not.toContain('camunda-hub#300');
  });

  it('closes issues whose PR was closed without merging, and never lists them', () => {
    const d = buildDigest([item({ hubState: 'closed', mergedAt: '' })], now);
    expect(d.toClose).toHaveLength(1);
    expect(d.text).toBe('');
  });

  it('escapes markup characters in the assignee', () => {
    expect(buildDigest([item({ assignee: 'a<b>' })], now).text).toContain('a&lt;b&gt;');
  });
});

describe('postDigest', () => {
  it('sends the digest to the channel', async () => {
    const calls: { url: string; token: string; body: string }[] = [];
    await postDigest('hello', 'tok', '#chan', async (url, token, init) => {
      calls.push({ url, token, body: String(init.body) });
      return { ok: true };
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.postMessage');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      channel: '#chan',
      text: 'hello',
      unfurl_links: false,
    });
  });

  it('throws when Slack rejects the post, so the run fails instead of staying green', async () => {
    await expect(
      postDigest('hello', 'tok', '#chan', async () => ({ ok: false, error: 'not_in_channel' })),
    ).rejects.toThrow('Slack post failed: not_in_channel');
  });
});
