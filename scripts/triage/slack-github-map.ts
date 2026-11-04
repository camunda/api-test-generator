// Resolve a GitHub login to a Slack <@user> mention via each person's Slack profile.
//
// Wolfgang's ask on the 2026-10-28 handover call: tag the PR author / fix author, not the medic —
// "everybody should have filled out in the Slack profile the GitHub profile link, so you can query
// that", with "a fallback: if you cannot derive the GitHub handle from Slack, then you fall back to
// the Matic". This builds { github-login -> slack-user-id } from the custom "GitHub" profile field
// so callers can emit a real <@U…> mention, and returns '' for anyone not mapped so the caller can
// fall back to the medic.
//
// Fail-soft by construction: any Slack error, a missing scope, or a rate limit yields an empty (or
// partial) map and never throws, so an alert is never lost to the lookup — it just falls back.
//
// Slack scopes required for a real mention to resolve (admin toggle on the app; until then the map
// is empty and everything falls back): `users:read` (users.list) and `users.profile:read`
// (team.profile.get for the field id, and users.profile.get where users.list omits custom fields).
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.

import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://slack.com/api/';
// A hard cap on users.list pages (200/page) so a misbehaving cursor can never loop forever.
export const MAX_USER_PAGES = 50;
// A hard cap on per-user users.profile.get calls (only used where users.list omits custom fields),
// so a large workspace cannot make the lookup run unbounded. Beyond it we stop and fall back.
export const MAX_PROFILE_FETCHES = 1500;

// users.list / users.profile.get carry custom fields as an object keyed by field id → { value }.
export interface SlackProfileFieldValue {
  value?: string;
}
// team.profile.get carries field *definitions* as an array of { id, label }.
export interface TeamProfileField {
  id?: string;
  label?: string;
}
export interface SlackMember {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { fields?: Record<string, SlackProfileFieldValue> | null };
}
export interface SlackResponse {
  ok?: boolean;
  error?: string;
  members?: SlackMember[];
  // team.profile.get → an array of field definitions; users.profile.get → an object of field values.
  profile?: { fields?: TeamProfileField[] | Record<string, SlackProfileFieldValue> | null };
  response_metadata?: { next_cursor?: string };
}

// The only I/O, so tests substitute it.
export interface SlackApi {
  get(method: string, params: Record<string, string>): Promise<SlackResponse>;
}

// Extract a lowercased GitHub login from whatever someone put in their profile field: a full URL
// (`https://github.com/Foo`), a bare `@handle`, or a plain `handle`. Returns '' when it is not a
// single valid GitHub login (1–39 chars, alphanumeric with non-repeated single hyphens).
export function githubLogin(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  const m = s.match(/github\.com\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(s) ? s.toLowerCase() : '';
}

// Find the custom profile field id whose label is "GitHub" (case-insensitive), unless an explicit
// id is supplied (SLACK_GITHUB_FIELD_ID). Returns '' when the field cannot be found.
export async function resolveFieldId(api: SlackApi, override?: string): Promise<string> {
  if (override) return override;
  const resp = await api.get('team.profile.get', {});
  const fields = resp.ok ? resp.profile?.fields : null;
  if (!Array.isArray(fields)) return '';
  for (const f of fields) {
    if (f.id && (f.label ?? '').trim().toLowerCase() === 'github') return f.id;
  }
  return '';
}

// Build { github-login(lowercase) -> slack-user-id }. users.list is the source of members; custom
// fields come inline when the workspace includes them, else from users.profile.get per member
// (bounded by MAX_PROFILE_FETCHES). Fail-soft: never throws — returns {} or a partial map.
export async function buildMap(
  api: SlackApi,
  fieldOverride?: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const fieldId = await resolveFieldId(api, fieldOverride);
    if (!fieldId) return map;

    const needProfile: string[] = [];
    let cursor = '';
    for (let page = 0; page < MAX_USER_PAGES; page++) {
      const params: Record<string, string> = { limit: '200' };
      if (cursor) params.cursor = cursor;
      const resp = await api.get('users.list', params);
      if (!resp.ok || !resp.members) break;
      for (const member of resp.members) {
        if (!member.id || member.deleted || member.is_bot) continue;
        const inline = member.profile?.fields;
        if (inline && fieldId in inline) {
          const login = githubLogin(inline[fieldId]?.value);
          if (login && !(login in map)) map[login] = member.id;
        } else {
          // users.list did not carry custom fields for this member — resolve it per-user below.
          needProfile.push(member.id);
        }
      }
      cursor = resp.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }

    for (const userId of needProfile.slice(0, MAX_PROFILE_FETCHES)) {
      const resp = await api.get('users.profile.get', { user: userId });
      if (resp.error === 'ratelimited') break; // fail-soft: stop and use the partial map
      const fields = resp.ok ? resp.profile?.fields : null;
      if (!fields || Array.isArray(fields)) continue; // users.profile.get is the object-of-values shape
      const login = githubLogin(fields[fieldId]?.value);
      if (login && !(login in map)) map[login] = userId;
    }
  } catch {
    return map;
  }
  return map;
}

// '<@U123>' when the login maps to a Slack user, else '' (caller falls back to the medic).
export function mention(login: string | undefined, map: Record<string, string>): string {
  const key = (login ?? '').replace(/^@/, '').toLowerCase();
  const id = key ? map[key] : '';
  return id ? `<@${id}>` : '';
}

function slackApi(token: string): SlackApi {
  const headers = { Authorization: `Bearer ${token}` };
  return {
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

// CLI. Two modes, both fail-soft (empty mention / unchanged file on any lookup failure):
//   --login <handle>                 print the <@id> mention (or empty) for one GitHub login
//   --enrich <file.json> [--key fixer] [--out <file>]
//                                    read a JSON array of summary items, add `<key>Mention` to each
//                                    from its `<key>` login, and write it back (or to --out)
async function main(): Promise<void> {
  const token = process.env.SLACK_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? '';
  const fieldOverride = process.env.SLACK_GITHUB_FIELD_ID ?? '';
  const map = token ? await buildMap(slackApi(token), fieldOverride) : {};
  if (!token) console.error('SLACK_TOKEN is empty; no mentions resolved, callers fall back');

  const single = arg('login');
  if (single) {
    process.stdout.write(mention(single, map));
    return;
  }

  const file = arg('enrich');
  if (file) {
    const key = arg('key') || 'fixer';
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON (the summary file)
    const items = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;
    for (const item of items) {
      const login = typeof item[key] === 'string' ? item[key] : '';
      item[`${key}Mention`] = mention(login, map);
    }
    writeFileSync(arg('out') || file, JSON.stringify(items));
    return;
  }

  console.error(
    'usage: slack-github-map.ts --login <handle> | --enrich <file.json> [--key k] [--out f]',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
