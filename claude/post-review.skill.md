---
name: post-review
description: Post a GitHub PR review with inline comments. Use when the user says 'post review', 'submit review', 'post comments on PR', 'leave review', or wants to post code review feedback as a GitHub review with inline comments.
allowed-tools: Bash(gh api:*), Bash(gh pr view:*), Bash(gh pr diff:*), AskUserQuestion
---

# Post Review

Posts a GitHub PR review via the GitHub API with inline comments.

## Key Rules

1. **All comments that could receive replies MUST be posted as inline comments** (on a specific file/line), not in the review body. The review body does not support threaded replies on GitHub. The body should only contain a brief summary/sentiment.

2. **Ask the user what approval level to use** before posting, using AskUserQuestion with these options:
   - COMMENT — neutral feedback, no approval signal
   - REQUEST_CHANGES — block merge until addressed
   - APPROVE — approve the PR

## Workflow

### Step 1: Identify the PR

Determine the PR number and repo from context. If not obvious, check `gh pr view --json number,url` for the current branch or ask the user.

### Step 2: Collect review content from the conversation

Look at what the user has discussed in the conversation. Gather:
- The overall review summary (short — 1-2 sentences for the body)
- Individual comments with their target file, line number, and body text

### Step 3: Ask approval level

Use AskUserQuestion to ask what approval level to use (COMMENT, REQUEST_CHANGES, or APPROVE).

### Step 4: Get the PR head commit SHA

```bash
gh api repos/{owner}/{repo}/pulls/{number} --jq '.head.sha'
```

### Step 5: Post the review

Use `gh api` with `--input -` to POST to `repos/{owner}/{repo}/pulls/{number}/reviews`. Pipe a JSON payload via heredoc.

**Payload structure:**
```json
{
  "commit_id": "<head_sha>",
  "event": "<APPROVE|REQUEST_CHANGES|COMMENT>",
  "body": "<short summary — no actionable feedback here>",
  "comments": [
    {
      "path": "path/to/file.go",
      "line": 42,
      "side": "RIGHT",
      "body": "The actual review comment with suggestions, questions, etc."
    }
  ]
}
```

For multi-line comments, also include `start_line` and `start_side: "RIGHT"`.

**Important:** Build the JSON payload as a heredoc piped to `gh api ... --input -`. Do not use `--field` for the comments array — GitHub's API rejects it as a string. Example:

```bash
cat <<'PAYLOAD' | gh api repos/{owner}/{repo}/pulls/{number}/reviews -X POST --input -
{
  "commit_id": "abc123...",
  "event": "REQUEST_CHANGES",
  "body": "overall lgtm, just a couple things",
  "comments": [
    {
      "path": "src/foo.go",
      "line": 10,
      "side": "RIGHT",
      "body": "Consider using the shared helper here."
    }
  ]
}
PAYLOAD
```

### Step 6: Confirm

Report success or failure to the user, including a link to the review.
