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

2. **Check GitLab CI** — the GitLab project is always `https://gitlab.ddbuild.io/DataDog/<repo>` where `<repo>` is `basename $(git remote get-url origin) .git`. Use `ddtool auth gitlab token` to get a token for auth.
   - Get the project ID: `curl -s --header "PRIVATE-TOKEN: $(ddtool auth gitlab token)" "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2F<repo>" | jq '.id'`
   - Get failed jobs from the latest pipeline on this branch: `curl -s --header "PRIVATE-TOKEN: $(ddtool auth gitlab token)" "https://gitlab.ddbuild.io/api/v4/projects/<project_id>/pipelines?ref=<branch>&status=failed&per_page=1" | jq '.[0].id'`, then `curl -s --header "PRIVATE-TOKEN: $(ddtool auth gitlab token)" "https://gitlab.ddbuild.io/api/v4/projects/<project_id>/pipelines/<pipeline_id>/jobs?scope[]=failed" | jq '.[] | {id, name, stage}'`
   - Get the job log: `curl -s --header "PRIVATE-TOKEN: $(ddtool auth gitlab token)" "https://gitlab.ddbuild.io/api/v4/projects/<project_id>/jobs/<job_id>/trace"`

3. **Fix the code** — analyze the failure logs, identify root causes, and fix. Use existing project tools (formatters, linters) where possible.

4. **Commit and push** — run: `git ac <what the fix was>` to commit (may need to run a second time if it fails due to pre-commit) and push using `gt ss`

5. **Repeat** — Continue this, polling every minute until CI is green on the PR
