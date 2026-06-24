---
name: mcp
description: Call MCP servers (Atlassian/Jira/Confluence, Datadog metrics on staging and prod) from the shell via the mcp-cli bridge. Load this whenever a task needs Jira, Confluence, or Datadog metrics, or when the user mentions MCP, mcp-cli, or a specific MCP server.
---

# MCP via mcp-cli

pi has no built-in MCP. Reach MCP servers through the `mcp-cli` bridge, which
exposes dynamic discovery + tool calls over the shell. This keeps tool schemas
out of context until you actually need them.

Config lives at `~/.config/mcp/mcp_servers.json`. Remote OAuth servers are
proxied through `mcp-remote`, which handles the browser login and caches tokens
in `~/.mcp-auth` (per server URL).

## Servers

| Server | Use for |
|---|---|
| `atlassian` | Jira issues + Confluence pages (one server covers both) |
| `datadog-staging` | Datadog on **staging** (`datad0g.com`) |
| `datadog-prod` | Datadog on **prod** (`datadoghq.com`) |
| `slack` | Datadog Slack: read/search channels + threads, post messages |

Staging and prod are separate entries with independent OAuth sessions -- log in
to each org once. `slack` runs a local stdio proxy
(`~/.claude/skills/slack-mcp/scripts/slack-mcp-proxy.py`) backed by a macOS
keychain token, so no OAuth round-trip happens at call time.

## Workflow

```sh
mcp-cli                       # list all servers + tool names
mcp-cli info <server>         # tools for one server, with params
mcp-cli info <server> <tool>  # full JSON input schema for a tool
mcp-cli grep "<glob>"         # search tools by name across servers, e.g. "*metric*"
mcp-cli call <server> <tool> '{"arg": "value"}'   # execute
```

Always `info` a tool to confirm its schema before `call`. Pipe complex JSON via
stdin or build it with `jq -n`.

## First-time auth

The first `mcp-cli info <server>` against a remote server triggers an
`mcp-remote` OAuth browser flow. Run it once interactively per server (and
once each for `datadog-staging` and `datadog-prod`). Tokens are cached
afterward.

## Notes

- Datadog entries use toolsets `metrics,logs,monitors,dashboards`. Edit the URL
  in the config to change them.
- For Jira/Confluence specifics (cloud ID, SVLS ticket fields), also load the
  `atlassian` skill.
- If Slack calls return a 401 the proxy auto-refreshes; if that fails, re-run
  `python3 ~/.claude/skills/slack-mcp/scripts/slack-mcp-auth.py`.
- Force a fresh connection with `MCP_NO_DAEMON=1 mcp-cli ...` if a daemon goes
  stale after a config change.
