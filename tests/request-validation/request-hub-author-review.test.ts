import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Regression guard for .github/scripts/request-hub-author-review.sh — the helper that requests a review
// from the camunda-hub developer who introduced an endpoint (Wolfgang's handover rule), on top of the
// CODEOWNERS team request. The script is exercised against a stub `gh` on PATH and a fake sibling spec
// tree, the same way the coverage scripts are tested in hub-gap-issue.test.ts. No network, no real gh.

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/request-hub-author-review.sh',
);
const SPEC_DIR = 'restapi/public-api/src/main/resources/openapi/v2';
const REL = `${SPEC_DIR}/files.yaml`;
const EMPTY_PR = '{"reviewRequests":[],"reviews":[]}';

// A `gh` stub: records nothing, answers only the calls the script makes. STUB_PRVIEW_JSON backs
// `gh pr view`; STUB_SHAS is the commit list for `commits?path=`; per-commit JSON is read from
// $STUB_J/<sha>.json. It honours `--jq` with real jq, so author.login resolution and the pr-view count
// run against the same jq the script relies on. `\${...}` is escaped so it stays bash, not JS.
const ghStub = `#!/usr/bin/env bash
jq_flag=0; expr=""; prev=""
for a in "$@"; do [ "$prev" = "--jq" ] && { jq_flag=1; expr="$a"; }; prev="$a"; done
sub="$1"; arg="$2"
emit(){ if [ "$jq_flag" = 1 ]; then printf '%s' "$1" | jq -r "$expr"; else printf '%s' "$1"; fi; }
if [ "$sub" = pr ]; then
  case "$2" in
    view) emit "$STUB_PRVIEW_JSON" ;;
    edit) [ -n "\${STUB_EDIT_FAIL:-}" ] && exit 1; exit 0 ;;
  esac
  exit 0
fi
if [ "$sub" = api ]; then
  case "$arg" in
    *"/commits?path="*) printf '%s\\n' $STUB_SHAS ;;
    *"/commits/"*"/pulls") echo '' ;;
    *"/commits/"*) sha="\${arg##*/commits/}"; emit "$(cat "$STUB_J/$sha.json" 2>/dev/null || echo '{}')" ;;
  esac
fi
`;

type Commit = { author: string; files: { filename: string; patch: string }[] };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A spec file declaring each operationId (YAML form), so the file lookup resolves it to REL. */
function specFor(ops: string[]): string {
  const paths = ops.map((op) => `  /${op}:\n    post:\n      operationId: ${op}`).join('\n');
  return `paths:\n${paths}\n`;
}

/** A commit that adds `op`'s declaration in REL (an introduction), by `author`. */
function intro(author: string, op: string): Commit {
  return { author, files: [{ filename: REL, patch: `+      operationId: ${op}` }] };
}

type RunOpts = {
  ops: string[];
  spec?: string; // defaults to a file declaring `ops`
  commits?: Record<string, Commit>; // sha -> commit; defaults to one intro per op
  prView?: string; // gh pr view json; defaults to no requests/reviews
  env?: Record<string, string>; // extra env (PR, GEN_TOKEN, MAX_REVIEWERS, DRY_RUN, STUB_EDIT_FAIL, …)
};

/** Runs the helper against the stub, returning merged stdout+stderr and the exit code. */
function run(opts: RunOpts): { out: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), 'req-review-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const jDir = join(dir, 'j');
  const hub = join(dir, 'hub');
  mkdirSync(bin);
  mkdirSync(jDir);
  mkdirSync(join(hub, SPEC_DIR), { recursive: true });
  writeFileSync(join(bin, 'gh'), ghStub);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(hub, REL), opts.spec ?? specFor(opts.ops));
  const commits =
    opts.commits ??
    Object.fromEntries(opts.ops.map((op, i) => [`s${i}`, intro(`author-${op}`, op)]));
  for (const [sha, c] of Object.entries(commits)) {
    // The GitHub commits API shapes the author as { login }, which the script reads via `.author.login`.
    writeFileSync(
      join(jDir, `${sha}.json`),
      JSON.stringify({ author: { login: c.author }, files: c.files }),
    );
  }
  const env: Record<string, string> = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PR: '1',
    GEN_REPO: 'camunda/api-test-generator',
    GEN_TOKEN: 'gen',
    HUB_CONTENTS_TOKEN: 'contents',
    HUB_PR_TOKEN: 'pr',
    HUB_DIR: hub,
    OPERATION_IDS: opts.ops.join(' '),
    STUB_PRVIEW_JSON: opts.prView ?? EMPTY_PR,
    STUB_SHAS: Object.keys(commits).join(' '),
    STUB_J: jDir,
    ...opts.env,
  };
  // Merge stderr into stdout so warnings (stderr) and results (stdout) are both asserted; capture the
  // exit code on the non-zero path (execFileSync throws).
  try {
    const out = execFileSync('bash', ['-c', 'exec "$1" 2>&1', 'bash', script], {
      env,
      encoding: 'utf8',
    });
    return { out, code: 0 };
  } catch (e) {
    // execFileSync throws on a non-zero exit, carrying stdout/status on the error. Read them without a
    // cast (`as` is banned): an all-optional shape accepts any object, then narrow each field by typeof.
    const err: { stdout?: unknown; status?: unknown } =
      typeof e === 'object' && e !== null ? e : {};
    const out = typeof err.stdout === 'string' ? err.stdout : '';
    const code = typeof err.status === 'number' ? err.status : 1;
    return { out, code };
  }
}

describe('request-hub-author-review: attribution', () => {
  it('requests the author who introduced the operation in the spec file', () => {
    const { out } = run({ ops: ['createFile'], commits: { s0: intro('alice', 'createFile') } });
    expect(out).toContain('Requested review from @alice on camunda/api-test-generator#1');
  });

  it('matches the complete operationId, not a prefix (getFile ≠ getFileVersions)', () => {
    // Both declared in the spec; only the exact file's introduction must be attributed.
    const { out } = run({
      ops: ['getFile'],
      spec: specFor(['getFile', 'getFileVersions']),
      commits: { s0: intro('alice', 'getFile'), s1: intro('mallory', 'getFileVersions') },
    });
    expect(out).toContain('Requested review from @alice');
    expect(out).not.toContain('mallory');
  });

  it('drops a bot author and falls back to CODEOWNERS', () => {
    const { out, code } = run({
      ops: ['createFile'],
      commits: { s0: intro('renovate[bot]', 'createFile') },
    });
    expect(out).toContain('CODEOWNERS team remains the reviewer');
    expect(out).not.toContain('Requested review');
    expect(code).toBe(0);
  });

  it('leaves attribution unresolved when no spec file declares the operation', () => {
    const { out } = run({ ops: ['ghostOp'], spec: specFor(['createFile']), commits: {} });
    expect(out).toContain('cannot attribute');
    expect(out).toContain('CODEOWNERS team remains the reviewer');
  });

  it('does not attribute a mere mention of the id in another file', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: {
        s0: {
          author: 'bob',
          files: [
            { filename: 'tests/foo.spec.ts', patch: '+ operationId: createFile (a mention)' },
          ],
        },
      },
    });
    expect(out).toContain('CODEOWNERS team remains the reviewer');
    expect(out).not.toContain('@bob');
  });

  it('does not treat a same-file reflow (remove + re-add) as an introduction', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: {
        s0: {
          author: 'carol',
          files: [
            {
              filename: REL,
              patch: '-      operationId: createFile\n+        operationId: createFile',
            },
          ],
        },
      },
    });
    expect(out).toContain('CODEOWNERS team remains the reviewer');
    expect(out).not.toContain('@carol');
  });

  it('does not attribute a move between spec files to the mover', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: {
        s0: {
          author: 'dave',
          files: [
            { filename: REL, patch: '+      operationId: createFile' },
            { filename: `${SPEC_DIR}/legacy.yaml`, patch: '-      operationId: createFile' },
          ],
        },
      },
    });
    expect(out).toContain('CODEOWNERS team remains the reviewer');
    expect(out).not.toContain('@dave');
  });

  it('skips a non-identifier operationId rather than embedding it in the regex', () => {
    const { out } = run({ ops: ['bad;id'], spec: specFor(['createFile']), commits: {} });
    expect(out).toContain('not an identifier-safe operationId');
    expect(out).toContain('CODEOWNERS team remains the reviewer');
  });

  it('dedupes authors and caps at MAX_REVIEWERS', () => {
    const { out } = run({
      ops: ['opA', 'opB', 'opC'],
      commits: { s0: intro('alice', 'opA'), s1: intro('bob', 'opB'), s2: intro('carol', 'opC') },
      env: { MAX_REVIEWERS: '2' },
    });
    expect(out).toContain('@alice');
    expect(out).toContain('@bob');
    expect(out).not.toContain('@carol');
  });
});

describe('request-hub-author-review: idempotency and guards', () => {
  it('is a no-op when an individual reviewer is already requested', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      prView: '{"reviewRequests":[{"login":"someone"}],"reviews":[]}',
    });
    expect(out).toContain('leaving it as is');
    expect(out).not.toContain('Requested review');
  });

  it('counts a team-only request as no individual reviewer and proceeds', () => {
    // A team entry has no `.login`; CODEOWNERS requests the team on every PR, so it must not block.
    const { out } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      prView: '{"reviewRequests":[{"name":"hub-backend","slug":"hub-backend"}],"reviews":[]}',
    });
    expect(out).toContain('Requested review from @alice');
  });

  it('is a no-op when the author already submitted a review (request has since cleared)', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      prView: '{"reviewRequests":[],"reviews":[{"author":{"login":"alice"}}]}',
    });
    expect(out).toContain('leaving it as is');
    expect(out).not.toContain('Requested review');
  });

  it('ignores a bot-only review and still requests the author', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      prView:
        '{"reviewRequests":[],"reviews":[{"author":{"login":"copilot-pull-request-reviewer[bot]"}}]}',
    });
    expect(out).toContain('Requested review from @alice');
  });

  it('warns and exits 0 when the reviewer cannot be requested (no repo access)', () => {
    const { out, code } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      env: { STUB_EDIT_FAIL: '1' },
    });
    expect(out).toContain('could not request @alice');
    expect(code).toBe(0);
  });

  it('prints the intended reviewer but requests none in a dry run', () => {
    const { out } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      env: { DRY_RUN: '1' },
    });
    expect(out).toContain('[dry-run] would request review from @alice');
    expect(out).not.toContain('Requested review from @alice');
  });

  it('hard-errors when a required input is missing', () => {
    const { out, code } = run({
      ops: ['createFile'],
      commits: { s0: intro('alice', 'createFile') },
      env: { PR: '' },
    });
    expect(out).toContain('PR is required');
    expect(code).toBe(1);
  });
});
