// One Slack thread per day, one reply per (PR, failure fingerprint) — ported from camunda-hub's
// AlwaysGreen (.github/scripts/alwaysgreen/slack_thread.py).
//
// The Hub PR check used to post a fresh top-level message for every failing run, and one PR can
// trigger a dozen runs. Here a re-run of the SAME failure edits its reply in place (an edit does
// not re-notify, so the medic is paged once), while a DIFFERENT failure on the same PR gets a
// new reply and pages again.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.

import { readFileSync } from 'node:fs';

const API = 'https://slack.com/api/';
const DAILY_MARKER_PREFIX = 'hub-pr-day:';
// Pages of conversations.history to walk before concluding today's parent does not exist. One
// page is not enough on a busy channel and would split the day exactly when it is busiest.
export const HISTORY_PAGES = 10;

export interface SlackMessage {
  ts?: string;
  text?: string;
  bot_id?: string;
  app_id?: string;
}

interface SlackResponse {
  ok?: boolean;
  error?: string;
  ts?: string;
  messages?: SlackMessage[];
  channels?: { id?: string; name?: string }[];
  response_metadata?: { next_cursor?: string };
}

// The only I/O, so tests substitute it.
export interface SlackApi {
  call(method: string, payload: Record<string, unknown>): Promise<SlackResponse>;
  get(method: string, params: Record<string, string>): Promise<SlackResponse>;
}

export function replyMarker(pr: string, fingerprint: string): string {
  return `hub-pr:${pr}:fp:${fingerprint}`;
}

export function dailyMarker(date: string): string {
  return `${DAILY_MARKER_PREFIX}${date}`;
}

// Newest bot message containing the marker. Bot-only, so a human quoting it cannot capture it.
export function findIn(messages: SlackMessage[], marker: string): string {
  const hits = messages.filter((m) => (m.bot_id || m.app_id) && (m.text ?? '').includes(marker));
  hits.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
  return hits.at(-1)?.ts ?? '';
}

function must(resp: SlackResponse, what: string): SlackResponse {
  if (!resp.ok) throw new Error(`${what}: ${resp.error}`);
  return resp;
}

export class ChannelUnresolved extends Error {}

// conversations.history/replies take an ID, not a name, while the workflows address channels by
// name. Needs the bot to hold channels:read; without it the caller falls back to a plain post
// rather than losing the alert.
export async function resolveChannel(api: SlackApi, channel: string): Promise<string> {
  if (!channel.startsWith('#')) return channel;
  const name = channel.slice(1);
  let cursor = '';
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params: Record<string, string> = {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '1000',
    };
    if (cursor) params.cursor = cursor;
    const resp = await api.get('conversations.list', params);
    if (!resp.ok) throw new ChannelUnresolved(`conversations.list: ${resp.error}`);
    const hit = resp.channels?.find((c) => c.name === name);
    if (hit?.id) return hit.id;
    cursor = resp.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  throw new ChannelUnresolved(`channel ${channel} not found`);
}

export async function findDailyParent(api: SlackApi, channel: string, date: string) {
  const marker = dailyMarker(date);
  let cursor = '';
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params: Record<string, string> = { channel, limit: '200' };
    if (cursor) params.cursor = cursor;
    const resp = must(await api.get('conversations.history', params), 'conversations.history');
    const ts = findIn(resp.messages ?? [], marker);
    if (ts) return ts;
    cursor = resp.response_metadata?.next_cursor ?? '';
    if (!cursor) return '';
  }
  // Returning '' here would post a duplicate parent, so fail closed like every unprovable read.
  throw new Error(
    `today's parent not found within ${HISTORY_PAGES} pages; refusing to post a second`,
  );
}

// Workflow concurrency is per PR, so two PRs can both see no parent and both create one. Slack
// has no compare-and-set, and serialising the job would make GitHub drop all but one pending run
// (and with it an alert). Instead converge after the fact: every racer re-reads the day's parents
// and keeps the earliest, deleting its own if it lost. Whoever posts last always sees the other.
export async function settleParent(
  api: SlackApi,
  channel: string,
  date: string,
  ownTs: string,
): Promise<string> {
  const marker = dailyMarker(date);
  let cursor = '';
  const parents: string[] = [];
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params: Record<string, string> = { channel, limit: '200' };
    if (cursor) params.cursor = cursor;
    const resp = must(await api.get('conversations.history', params), 'conversations.history');
    for (const m of resp.messages ?? []) {
      if ((m.bot_id || m.app_id) && (m.text ?? '').includes(marker) && m.ts) parents.push(m.ts);
    }
    cursor = resp.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  const earliest = parents.sort((a, b) => Number(a) - Number(b))[0];
  if (!earliest || earliest === ownTs) return ownTs;
  // Best effort: a failed delete only leaves an empty duplicate parent, never a lost alert.
  await api.call('chat.delete', { channel, ts: ownTs });
  return earliest;
}

// conversations.replies is cursor-paginated; reading one page would miss an older matching reply
// once the day's thread outgrows it and post the same failure again.
export async function findReply(
  api: SlackApi,
  channel: string,
  parentTs: string,
  marker: string,
): Promise<string> {
  let cursor = '';
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params: Record<string, string> = { channel, ts: parentTs, limit: '200' };
    if (cursor) params.cursor = cursor;
    const resp = must(await api.get('conversations.replies', params), 'conversations.replies');
    const ts = findIn(
      (resp.messages ?? []).filter((m) => m.ts !== parentTs),
      marker,
    );
    if (ts) return ts;
    cursor = resp.response_metadata?.next_cursor ?? '';
    if (!cursor) return '';
  }
  // Returning '' would post a duplicate and re-page, so fail closed like findDailyParent.
  throw new Error(`reply not found within ${HISTORY_PAGES} pages; refusing to post a duplicate`);
}

export async function upsert(
  api: SlackApi,
  args: { channel: string; date: string; marker: string; text: string },
): Promise<{ action: 'posted' | 'updated'; replyTs: string }> {
  const { date, marker } = args;
  const channel = await resolveChannel(api, args.channel);
  let parentTs = await findDailyParent(api, channel, date);
  if (!parentTs) {
    const text =
      `:test_tube: *Generated hub suite — camunda-hub PRs, ${date}*\n` +
      'One reply per PR and failure, edited in place on re-runs.\n' +
      `\`${dailyMarker(date)}\``;
    const resp = must(
      await api.call('chat.postMessage', { channel, text, unfurl_links: false }),
      'chat.postMessage (parent)',
    );
    parentTs = await settleParent(api, channel, date, resp.ts ?? '');
  }

  // The marker rides in the body so the next run can find this reply again.
  const body = `${args.text}\n\`${marker}\``;
  const existing = await findReply(api, channel, parentTs, marker);

  if (existing) {
    must(
      await api.call('chat.update', { channel, ts: existing, text: body, unfurl_links: false }),
      'chat.update',
    );
    return { action: 'updated', replyTs: existing };
  }
  const resp = must(
    await api.call('chat.postMessage', {
      channel,
      thread_ts: parentTs,
      text: body,
      unfurl_links: false,
    }),
    'chat.postMessage',
  );
  return { action: 'posted', replyTs: resp.ts ?? '' };
}

function slackApi(token: string): SlackApi {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async call(method, payload) {
      const resp = await fetch(API + method, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      return resp.json();
    },
    async get(method, params) {
      const resp = await fetch(`${API + method}?${new URLSearchParams(params)}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      return resp.json();
    },
  };
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

async function main(): Promise<void> {
  const token = process.env.SLACK_TOKEN ?? '';
  if (!token) {
    console.error('SLACK_TOKEN is empty; nothing posted');
    return;
  }
  const text = readFileSync(arg('text-file'), 'utf8').trimEnd();
  const api = slackApi(token);
  try {
    const result = await upsert(api, {
      channel: arg('channel'),
      date: arg('date'),
      marker: arg('marker'),
      text,
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    // Threading is an optimisation; the alert is not. Whatever failed (channel lookup, a missing
    // history scope, a Slack error), post the message plainly rather than lose it. A partial
    // failure can at worst duplicate an alert.
    console.error(
      `::warning::Slack threading failed (${err instanceof Error ? err.message : err}) - posting without threading`,
    );
    const resp = await api.call('chat.postMessage', {
      channel: arg('channel'),
      text,
      unfurl_links: false,
    });
    if (!resp.ok) console.error(`::warning::Slack post failed: ${resp.error}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
