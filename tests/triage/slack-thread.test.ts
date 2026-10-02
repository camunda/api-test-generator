import { describe, expect, it } from 'vitest';
import {
  ChannelUnresolved,
  dailyMarker,
  findDailyParent,
  findIn,
  findReply,
  replyMarker,
  resolveChannel,
  type SlackApi,
  type SlackMessage,
  seenCount,
  settleParent,
  upsert,
} from '../../scripts/triage/slack-thread.ts';

// In-memory channel: enough of conversations.* and chat.* for upsert's behaviour.
function fakeSlack(history: SlackMessage[] = []) {
  const messages: (SlackMessage & { thread_ts?: string })[] = [...history];
  const calls: string[] = [];
  let n = 1000;
  const api: SlackApi = {
    async get(method, params) {
      if (method === 'conversations.history') return { ok: true, messages };
      return {
        ok: true,
        messages: messages.filter((m) => m.ts === params.ts || m.thread_ts === params.ts),
      };
    },
    async call(method, payload) {
      calls.push(method);
      if (method === 'chat.update') {
        const m = messages.find((x) => x.ts === payload.ts);
        if (m) m.text = String(payload.text);
        return { ok: true, ts: String(payload.ts) };
      }
      const ts = String(++n);
      messages.push({
        ts,
        text: String(payload.text),
        bot_id: 'B1',
        thread_ts: payload.thread_ts ? String(payload.thread_ts) : undefined,
      });
      return { ok: true, ts };
    },
  };
  return { api, messages, calls };
}

const base = { channel: 'C1', date: '2026-10-01' };

describe('upsert', () => {
  it('creates the daily parent once and posts the first reply into it', async () => {
    const { api, messages } = fakeSlack();
    const result = await upsert(api, {
      ...base,
      marker: replyMarker('7', 'aaaa1111'),
      text: 'red',
    });
    expect(result.action).toBe('posted');
    expect(messages.filter((m) => m.text?.includes(dailyMarker(base.date)))).toHaveLength(1);
    expect(messages.at(-1)?.thread_ts).toBe(messages[0]?.ts);
  });

  it('edits in place when the same failure re-runs, so it does not page again', async () => {
    const { api, messages, calls } = fakeSlack();
    const marker = replyMarker('7', 'aaaa1111');
    await upsert(api, { ...base, marker, text: 'first' });
    const again = await upsert(api, { ...base, marker, text: 'second' });
    expect(again.action).toBe('updated');
    expect(calls.filter((c) => c === 'chat.postMessage')).toHaveLength(2); // parent + one reply
    expect(messages.at(-1)?.text).toContain('second');
  });

  it('posts a new reply when the same PR fails differently', async () => {
    const { api, messages } = fakeSlack();
    await upsert(api, { ...base, marker: replyMarker('7', 'aaaa1111'), text: 'one' });
    const other = await upsert(api, { ...base, marker: replyMarker('7', 'bbbb2222'), text: 'two' });
    expect(other.action).toBe('posted');
    expect(messages.filter((m) => m.thread_ts)).toHaveLength(2);
  });

  it('keeps different PRs apart', async () => {
    const { api } = fakeSlack();
    await upsert(api, { ...base, marker: replyMarker('7', 'aaaa1111'), text: 'one' });
    const other = await upsert(api, { ...base, marker: replyMarker('8', 'aaaa1111'), text: 'two' });
    expect(other.action).toBe('posted');
  });

  it('reuses an existing parent instead of splitting the day', async () => {
    const { api, messages } = fakeSlack([
      { ts: '1', text: `x \`${dailyMarker(base.date)}\``, bot_id: 'B1' },
    ]);
    await upsert(api, { ...base, marker: replyMarker('7', 'aaaa1111'), text: 'red' });
    expect(messages.filter((m) => m.text?.includes(dailyMarker(base.date)))).toHaveLength(1);
  });
});

describe('findIn', () => {
  it('ignores human messages that quote a marker', () => {
    expect(findIn([{ ts: '1', text: 'hub-pr:7:fp:a' }], 'hub-pr:7:fp:a')).toBe('');
  });
});

describe('resolveChannel', () => {
  const listing = (ok: boolean): SlackApi => ({
    async call() {
      return { ok: true };
    },
    async get() {
      return ok
        ? { ok: true, channels: [{ id: 'C42', name: 'camunda-hub-pr-e2e-results' }] }
        : { ok: false, error: 'missing_scope' };
    },
  });

  it('passes an id through untouched', async () => {
    expect(await resolveChannel(listing(false), 'C1')).toBe('C1');
  });

  it('resolves a #name to its id', async () => {
    expect(await resolveChannel(listing(true), '#camunda-hub-pr-e2e-results')).toBe('C42');
  });

  it('signals fallback when the bot cannot list channels', async () => {
    await expect(resolveChannel(listing(false), '#x')).rejects.toBeInstanceOf(ChannelUnresolved);
  });

  it('signals fallback when the channel is unknown', async () => {
    await expect(resolveChannel(listing(true), '#other')).rejects.toBeInstanceOf(ChannelUnresolved);
  });
});

describe('settleParent', () => {
  const parent = (ts: string) => ({ ts, bot_id: 'B1', text: `x \`${dailyMarker(base.date)}\`` });

  function api(messages: SlackMessage[]) {
    const deleted: string[] = [];
    const impl: SlackApi = {
      async get() {
        return { ok: true, messages };
      },
      async call(method, payload) {
        if (method === 'chat.delete') deleted.push(String(payload.ts));
        return { ok: true };
      },
    };
    return { impl, deleted };
  }

  it('keeps its own parent when it is the earliest', async () => {
    const { impl, deleted } = api([parent('2'), parent('5')]);
    expect(await settleParent(impl, 'C1', base.date, '2')).toBe('2');
    expect(deleted).toEqual([]);
  });

  it('deletes its own parent and adopts the earlier one when it lost the race', async () => {
    const { impl, deleted } = api([parent('2'), parent('5')]);
    expect(await settleParent(impl, 'C1', base.date, '5')).toBe('2');
    expect(deleted).toEqual(['5']);
  });
});

describe('findReply', () => {
  it('walks pages to find an older matching reply', async () => {
    const marker = replyMarker('7', 'aaaa1111');
    const pages: Record<string, SlackMessage[]> = {
      '': [{ ts: '1', bot_id: 'B1', text: 'other' }],
      next: [{ ts: '2', bot_id: 'B1', text: marker }],
    };
    const impl: SlackApi = {
      async call() {
        return { ok: true };
      },
      async get(_method, params) {
        const key = params.cursor ?? '';
        return {
          ok: true,
          messages: pages[key],
          response_metadata: { next_cursor: key === '' ? 'next' : '' },
        };
      },
    };
    expect((await findReply(impl, 'C1', '0', marker))?.ts).toBe('2');
  });

  it('fails closed instead of reporting "not found" when pages run out', async () => {
    const impl: SlackApi = {
      async call() {
        return { ok: true };
      },
      async get() {
        return { ok: true, messages: [], response_metadata: { next_cursor: 'again' } };
      },
    };
    await expect(findReply(impl, 'C1', '0', 'm')).rejects.toThrow(/refusing to post a duplicate/);
  });
});

describe('findDailyParent', () => {
  const parent = (ts: string) => ({ ts, bot_id: 'B1', text: `x \`${dailyMarker(base.date)}\`` });
  const withHistory = (messages: SlackMessage[]): SlackApi => ({
    async call() {
      return { ok: true };
    },
    async get() {
      return { ok: true, messages };
    },
  });

  it('returns the earliest parent when a race left duplicates, however they are ordered', async () => {
    expect(
      await findDailyParent(withHistory([parent('9'), parent('3'), parent('5')]), 'C1', base.date),
    ).toBe('3');
  });

  it('returns empty when the day has no parent and the history was read to the end', async () => {
    expect(await findDailyParent(withHistory([]), 'C1', base.date)).toBe('');
  });

  it('only asks Slack for the day itself', async () => {
    const seen: Record<string, string>[] = [];
    const impl: SlackApi = {
      async call() {
        return { ok: true };
      },
      async get(_m, params) {
        seen.push(params);
        return { ok: true, messages: [] };
      },
    };
    await findDailyParent(impl, 'C1', base.date);
    expect(seen[0]?.oldest).toBe(String(Date.parse(`${base.date}T00:00:00Z`) / 1000));
  });

  it('fails closed when the page limit runs out before any parent is found', async () => {
    const impl: SlackApi = {
      async call() {
        return { ok: true };
      },
      async get() {
        return { ok: true, messages: [], response_metadata: { next_cursor: 'more' } };
      },
    };
    await expect(findDailyParent(impl, 'C1', base.date)).rejects.toThrow(
      /refusing to choose a parent/,
    );
  });

  it('fails closed even when a parent was found, because an older one may be unread', async () => {
    const impl: SlackApi = {
      async call() {
        return { ok: true };
      },
      async get() {
        return {
          ok: true,
          messages: [{ ts: '5', bot_id: 'B1', text: `x \`${dailyMarker(base.date)}\`` }],
          response_metadata: { next_cursor: 'more' },
        };
      },
    };
    await expect(findDailyParent(impl, 'C1', base.date)).rejects.toThrow(
      /refusing to choose a parent/,
    );
    await expect(settleParent(impl, 'C1', base.date, '9')).rejects.toThrow(
      /refusing to choose a parent/,
    );
  });
});

describe('seen counter', () => {
  it('counts how many times the same reply was written, starting at 1', async () => {
    const { api } = fakeSlack();
    const marker = replyMarker('7', 'noevidence');
    const first = await upsert(api, { ...base, marker, text: 'a' });
    const second = await upsert(api, { ...base, marker, text: 'b' });
    const third = await upsert(api, { ...base, marker, text: 'c' });
    expect([first.seen, second.seen, third.seen]).toEqual([1, 2, 3]);
  });

  it('counts each PR and failure separately', async () => {
    const { api } = fakeSlack();
    await upsert(api, { ...base, marker: replyMarker('7', 'noevidence'), text: 'a' });
    const other = await upsert(api, { ...base, marker: replyMarker('8', 'noevidence'), text: 'a' });
    expect(other.seen).toBe(1);
  });

  it('reads the counter back out of a reply body', () => {
    expect(seenCount('x `hub-pr:7:fp:y` `seen:4`')).toBe(4);
    expect(seenCount('no counter here')).toBe(0);
  });

  it('ignores a counter-looking token inside the reply text', () => {
    expect(seenCount('op `seen:9` and more\n`hub-pr:7:fp:y` `seen:2`')).toBe(2);
    expect(seenCount('op `seen:9` only, no real counter')).toBe(0);
  });

  it('cannot be forced by text that contains a counter', async () => {
    const { api } = fakeSlack();
    const marker = replyMarker('7', 'noevidence');
    const first = await upsert(api, { ...base, marker, text: 'ids: `seen:2`' });
    const second = await upsert(api, { ...base, marker, text: 'ids: `seen:2`' });
    expect([first.seen, second.seen]).toEqual([1, 2]);
  });
});
