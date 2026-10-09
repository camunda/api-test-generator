import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  type DigestDeps,
  type GapIssue,
  type Item,
  parseHubPr,
  postDigest,
  resolveItems,
  runDigest,
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

// Regression: when every camunda-hub lookup failed (broken token, API outage), the old script skipped
// each issue with a warning and printed "Nothing overdue", so the run stayed green over a read it
// never made. resolveItems must report those failures so main can fail the run.
describe('resolveItems', () => {
  const gap = (over: Partial<GapIssue>): GapIssue => ({
    number: 1,
    url: 'https://github.com/camunda/api-test-generator/issues/1',
    title: '[hub-pr-check] Generator gap on camunda-hub#100',
    createdAt: '2026-10-05T07:00:00Z',
    assignee: 'alice',
    ...over,
  });

  it('reports every issue as failed when all lookups fail, instead of returning nothing silently', async () => {
    const issues = [gap({ number: 1 }), gap({ number: 2, title: 'x camunda-hub#200' })];
    const r = await resolveItems(issues, async () => {
      throw new Error('HTTP 401');
    });
    expect(r.items).toHaveLength(0);
    expect(r.failed).toHaveLength(2);
    expect(r.failed[0]).toContain('camunda-hub#100');
    expect(r.failed[0]).toContain('HTTP 401');
  });

  it('keeps the readable PRs and still reports the unreadable one', async () => {
    const issues = [
      gap({ number: 1 }),
      gap({ number: 2, title: 'Generator gap on camunda-hub#200' }),
    ];
    const r = await resolveItems(issues, async (pr) => {
      if (pr === 200) throw new Error('HTTP 503');
      return { state: 'merged', mergedAt: '2026-10-07T07:00:00Z' };
    });
    expect(r.items.map((i) => i.hubPr)).toEqual([100]);
    expect(r.failed).toEqual([expect.stringContaining('camunda-hub#200')]);
  });

  it('reports an issue whose title names no camunda-hub PR, rather than dropping it', async () => {
    const r = await resolveItems(
      [gap({ number: 7, title: 'Generator gap, no PR named' })],
      async () => {
        throw new Error('should not be called');
      },
    );
    expect(r.items).toHaveLength(0);
    expect(r.failed).toEqual(['api-test-generator#7: no camunda-hub PR number in its title']);
  });

  it('reports nothing when every lookup succeeds', async () => {
    const r = await resolveItems([gap({})], async () => ({ state: 'open', mergedAt: '' }));
    expect(r.failed).toEqual([]);
    expect(r.items[0]?.hubState).toBe('open');
  });
});

// The run-level contract: whatever could be read is still posted and closed, and the run then fails
// when any part of the read was incomplete. These drive runDigest with fakes for every read and write,
// so they fail if the wiring ever stops turning a problem into a rejection.
describe('runDigest', () => {
  const gapIssue = (number: number, hubPr: number): GapIssue => ({
    number,
    url: `https://github.com/camunda/api-test-generator/issues/${number}`,
    title: `[hub-pr-check] Generator gap on camunda-hub#${hubPr}`,
    createdAt: '2026-10-05T07:00:00Z',
    assignee: 'alice',
  });

  const mergedPr = { state: 'merged' as const, mergedAt: '2026-10-07T07:00:00Z' };
  const closedPr = { state: 'closed' as const, mergedAt: '' };

  function harness(over: Partial<DigestDeps> = {}) {
    const posted: string[] = [];
    const closed: number[] = [];
    const errors: string[] = [];
    const deps: DigestDeps = {
      dryRun: false,
      slackToken: 'tok',
      listIssues: async () => ({ issues: [gapIssue(1, 100)], truncated: false }),
      lookupPr: async () => mergedPr,
      closeIssue: async (i) => {
        closed.push(i.number);
      },
      post: async (text) => {
        posted.push(text);
      },
      log: () => {},
      error: (line) => {
        errors.push(line);
      },
      now,
      ...over,
    };
    return { deps, posted, closed, errors };
  }

  it('posts the overdue digest and resolves when every read succeeded', async () => {
    const h = harness();
    await expect(runDigest(h.deps)).resolves.toBeUndefined();
    expect(h.posted).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('stays silent and resolves when nothing is tracked', async () => {
    const h = harness({ listIssues: async () => ({ issues: [], truncated: false }) });
    await expect(runDigest(h.deps)).resolves.toBeUndefined();
    expect(h.posted).toEqual([]);
  });

  it('fails when every lookup fails, instead of staying green over a read it never made', async () => {
    const h = harness({
      lookupPr: async () => {
        throw new Error('HTTP 401');
      },
    });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete: 1 problem(s)');
    expect(h.errors).toEqual([expect.stringContaining('HTTP 401')]);
    expect(h.posted).toEqual([]);
  });

  it('still posts and closes what it could read, then fails for the one it could not', async () => {
    const h = harness({
      listIssues: async () => ({
        issues: [gapIssue(1, 100), gapIssue(2, 200), gapIssue(3, 300)],
        truncated: false,
      }),
      lookupPr: async (pr) => {
        if (pr === 200) return closedPr;
        if (pr === 300) throw new Error('HTTP 503');
        return mergedPr;
      },
    });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete');
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]).toContain('camunda-hub#100');
    expect(h.closed).toEqual([2]);
    expect(h.errors).toEqual([expect.stringContaining('camunda-hub#300')]);
  });

  it('fails when the issue list was cut off by the page cap', async () => {
    const h = harness({ listIssues: async () => ({ issues: [], truncated: true }) });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete');
    expect(h.errors).toEqual([expect.stringContaining('the rest were not read')]);
  });

  it('fails when overdue PRs exist but there is no Slack token, and posts nothing', async () => {
    const h = harness({ slackToken: '' });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete');
    expect(h.posted).toEqual([]);
    expect(h.errors).toEqual([expect.stringContaining('SLACK_TOKEN is empty')]);
  });

  it('does not need a Slack token when nothing is overdue', async () => {
    const h = harness({ slackToken: '', lookupPr: async () => ({ state: 'open', mergedAt: '' }) });
    await expect(runDigest(h.deps)).resolves.toBeUndefined();
  });

  it('fails on a title naming no camunda-hub PR', async () => {
    const h = harness({
      listIssues: async () => ({
        issues: [{ ...gapIssue(9, 1), title: 'Generator gap, no PR named' }],
        truncated: false,
      }),
    });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete');
  });

  it('on a dry run posts and closes nothing, but still fails on a partial read', async () => {
    const h = harness({
      dryRun: true,
      listIssues: async () => ({
        issues: [gapIssue(1, 100), gapIssue(2, 200), gapIssue(3, 300)],
        truncated: false,
      }),
      lookupPr: async (pr) => {
        if (pr === 200) return closedPr;
        if (pr === 300) throw new Error('HTTP 503');
        return mergedPr;
      },
    });
    await expect(runDigest(h.deps)).rejects.toThrow('Digest incomplete');
    expect(h.posted).toEqual([]);
    expect(h.closed).toEqual([]);
  });

  it('propagates a rejected Slack post', async () => {
    const h = harness({
      post: async () => {
        throw new Error('Slack post failed: not_in_channel');
      },
    });
    await expect(runDigest(h.deps)).rejects.toThrow('Slack post failed: not_in_channel');
  });
});

describe('buildDigest link', () => {
  it('ends the digest with a link to what to do, and stays empty when nothing is overdue', () => {
    expect(buildDigest([item({})], now).text).toContain(
      '<https://github.com/camunda/api-test-generator/blob/main/docs/hub-pr-check-cookbook.md#keeping-track-of-pending-generator-fixes|📖 What to do about these>',
    );
    expect(buildDigest([], now).text).toBe('');
  });
});
