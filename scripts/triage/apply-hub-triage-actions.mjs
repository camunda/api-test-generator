#!/usr/bin/env node
// Executes the write actions (camunda-hub issues, api-test-generator PRs)
// that the Claude triage agent only DRAFTED. The agent's own process never
// holds GH_TOKEN_HUB/GH_TOKEN_GENERATOR (see "Run Claude triage agent" in
// triage-camunda-hub-nightly.yml) — it reads untrusted content (spec/report/
// PR-diff text) and could in principle be hijacked by a prompt injection, so
// it never gets a write-capable credential to misuse. This plain, non-agentic
// script is the only place those credentials are used: it reads
// hub-triage.json's structured issue/fix_pr/suppress_pr fields (written by
// the agent) and performs the corresponding gh/git calls, then overwrites
// those same fields with the real outcome. Uses execFileSync with argv
// arrays throughout (never a shell string), so nothing in a title/body/
// branch name the agent authored can be interpreted as a shell command.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [, , triageFilePath, generatorRepoDir] = process.argv;
if (!triageFilePath || !generatorRepoDir) {
  console.error('Usage: apply-hub-triage-actions.mjs <triage-json-path> <generator-repo-dir>');
  process.exit(1);
}

const ghTokenHub = process.env.GH_TOKEN_HUB ?? '';
const ghTokenGenerator = process.env.GH_TOKEN_GENERATOR ?? '';

const triage = JSON.parse(readFileSync(triageFilePath, 'utf8'));

function writeTempFile(content) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hub-triage-'));
  const file = path.join(dir, 'body.txt');
  writeFileSync(file, content ?? '', 'utf8');
  return file;
}

// Defense in depth: git/gh don't normally echo credentials back on error,
// but this text can end up in a Slack-visible field, so strip the pattern
// the pushed remote URL would take if it ever did leak into an error.
function redact(text) {
  return String(text ?? '').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}

function runCapture(cmd, args, env) {
  return execFileSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
}

function fileHubIssue(failure) {
  const issue = failure.issue;
  if (!issue || !issue.action || issue.action === 'none') return;
  if (!ghTokenHub) {
    failure.action = 'report-only';
    failure.file_error = 'GH_TOKEN_HUB unavailable — could not execute the drafted issue action.';
    return;
  }
  try {
    if (issue.action === 'create') {
      const bodyFile = writeTempFile(issue.body);
      failure.issue_url = runCapture(
        'gh',
        [
          'issue',
          'create',
          '--repo',
          'camunda/camunda-hub',
          '--title',
          issue.title,
          '--body-file',
          bodyFile,
          '--label',
          'kind/bug',
          '--label',
          'nightly-detected',
        ],
        { GH_TOKEN: ghTokenHub },
      );
      return;
    }
    if (issue.action === 'reopen-and-comment' || issue.action === 'comment-fp') {
      if (issue.action === 'reopen-and-comment') {
        runCapture(
          'gh',
          ['issue', 'reopen', String(issue.target_number), '--repo', 'camunda/camunda-hub'],
          { GH_TOKEN: ghTokenHub },
        );
      }
      const bodyFile = writeTempFile(issue.comment_body);
      runCapture(
        'gh',
        [
          'issue',
          'comment',
          String(issue.target_number),
          '--repo',
          'camunda/camunda-hub',
          '--body-file',
          bodyFile,
        ],
        { GH_TOKEN: ghTokenHub },
      );
      failure.issue_url = `https://github.com/camunda/camunda-hub/issues/${issue.target_number}`;
    }
  } catch (err) {
    failure.action = 'report-only';
    failure.file_error = redact(err.stderr?.toString() || err.message);
  }
}

function pushAndOpenPr(pr) {
  if (!pr || !pr.branch) return { url: null, error: null };
  if (!ghTokenGenerator) {
    return { url: null, error: 'GH_TOKEN_GENERATOR unavailable — could not push/open the drafted PR.' };
  }
  try {
    execFileSync('git', ['-C', generatorRepoDir, 'rev-parse', '--verify', pr.branch], {
      stdio: 'pipe',
    });
  } catch {
    return {
      url: null,
      error: `Local branch '${pr.branch}' not found — the agent did not commit its drafted change.`,
    };
  }
  const remote = `https://x-access-token:${ghTokenGenerator}@github.com/camunda/api-test-generator.git`;
  try {
    execFileSync('git', ['-C', generatorRepoDir, 'push', remote, `${pr.branch}:${pr.branch}`], {
      stdio: 'pipe',
    });
  } catch (err) {
    return {
      url: null,
      error: `git push failed: ${redact(err.stderr?.toString() || err.message).slice(0, 2000)}`,
    };
  }
  try {
    const bodyFile = writeTempFile(pr.body);
    const url = runCapture(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        'camunda/api-test-generator',
        '--base',
        'main',
        '--head',
        pr.branch,
        '--title',
        pr.title,
        '--body-file',
        bodyFile,
        '--label',
        'nightly-api-fix',
      ],
      { GH_TOKEN: ghTokenGenerator },
    );
    return { url, error: null };
  } catch (err) {
    return {
      url: null,
      error: `gh pr create failed: ${redact(err.stderr?.toString() || err.message).slice(0, 2000)}`,
    };
  }
}

for (const failure of triage.failures ?? []) {
  fileHubIssue(failure);

  if (failure.suppress_pr) {
    const { url, error } = pushAndOpenPr(failure.suppress_pr);
    if (url) failure.suppress_pr_url = url;
    if (error) failure.suppress_error = error;
  }
  if (failure.fix_pr) {
    const { url, error } = pushAndOpenPr(failure.fix_pr);
    if (url) failure.fix_pr_url = url;
    if (error) {
      failure.action = 'report-only';
      failure.file_error = error;
    }
  }
}

for (const op of triage.unmapped_operations ?? []) {
  if (op.fix_pr) {
    const { url, error } = pushAndOpenPr(op.fix_pr);
    if (url) {
      op.fix_pr_url = url;
      op.action = 'fix-pr';
    }
    if (error) {
      op.action = 'report-only';
      op.file_error = error;
    }
  }
}

// Recomputed post-execution (not trusted from the agent's own draft), so the
// Slack digest reflects what actually happened rather than the agent's
// pre-execution intent.
const failures = triage.failures ?? [];
const unmapped = triage.unmapped_operations ?? [];
triage.counts = {
  product: failures.filter((f) => f.category === 'product').length,
  infrastructure: failures.filter((f) => f.category === 'infrastructure').length,
  flakiness: failures.filter((f) => f.category === 'flakiness').length,
  test_generation: failures.filter((f) => f.subcategory === 'test-generation').length,
  known_issue: failures.filter((f) => f.known_issue === true).length,
  filed: failures.filter((f) => f.action === 'file' && f.issue_url).length,
  skipped_recent_change: failures.filter((f) => f.action === 'skip').length,
  unmapped: unmapped.length,
  fixed:
    failures.filter((f) => f.action === 'fix-pr' && f.fix_pr_url).length +
    unmapped.filter((o) => o.action === 'fix-pr' && o.fix_pr_url).length,
  suppressed: failures.filter((f) => Boolean(f.suppress_pr_url)).length,
};

writeFileSync(triageFilePath, `${JSON.stringify(triage, null, 2)}\n`, 'utf8');
