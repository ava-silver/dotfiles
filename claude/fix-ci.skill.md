---
name: fix-ci
description: Check GitHub (first) and GitLab CI for failing jobs, fix the code, then commit & push
---

# Fix CI

Find and fix failing CI jobs on the current branch.

## Steps

1. **Check GitHub CI first** — run `gh run list --branch $(git branch --show-current) --limit 5 --json status,conclusion,name,databaseId`.
   - If any have `conclusion` = `failure`, get logs with `gh run view <id> --log-failed`.
   - If no runs exist or all passed, move to step 2.

2. **Check GitLab CI** — use the `glab` CLI (auth is pre-configured). Since the git remote points to GitHub, pass `--repo DataDog/<repo>` (where `<repo>` is `basename $(git remote get-url origin) .git`) on all `glab` commands that need it.
   - Get the latest failed pipeline on this branch: `glab ci list -b $(git branch --show-current) --status failed -p 1 -o json --repo DataDog/<repo> | jq '.[0].id'`
   - Get failed jobs from that pipeline: `glab api "projects/DataDog%2F<repo>/pipelines/<pipeline_id>/jobs?scope[]=failed" | jq '.[] | {id, name, stage}'`
   - Get the job log: `glab ci trace <job_id> --repo DataDog/<repo>`

3. **Fix the code** — analyze the failure logs, identify root causes, and fix. Use existing project tools (formatters, linters) where possible.

4. **Commit and push** — run: `git ac <what the fix was>` to commit (may need to run a second time if it fails due to pre-commit) and push using `gt ss`

5. **Repeat** — Continue this, polling every minute until CI is green on the PR
