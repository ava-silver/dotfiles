---
name: mcp
description: Call MCP servers (Atlassian/Jira/Confluence, Datadog metrics on staging and prod) from pi via the pi-mcp-adapter `mcp` tool. Load this whenever a task needs Jira, Confluence, or Datadog metrics, or when the user mentions MCP, pi-mcp-adapter, or a specific MCP server.
---

# MCP via pi-mcp-adapter

MCP is reached through the `pi-mcp-adapter` extension, which exposes a single
`mcp` tool (~200 tokens) instead of dumping every server's schema into context.
Servers are **lazy** -- they only start when you first call one of their tools.
Tool metadata is cached, so search/describe work without a live connection.

Shared config lives at `~/.config/mcp/mcp.json` (`mcpServers` schema). Remote
OAuth servers are proxied through `mcp-remote`, which handles the browser login
and caches tokens in `~/.mcp-auth` (per server URL).

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

The `mcp` tool is called with a single object. Mode precedence:
`action > tool (call) > server (list) > describe > search > nothing (status)`.

```
mcp({})                                  # status: servers + connection state
mcp({ server: "datadog-prod" })          # list tools from one server
mcp({ search: "metric" })                # search tools by name/description
mcp({ describe: "<tool_name>" })         # full params for a tool
mcp({ tool: "<tool_name>", args: '{"arg": "value"}' })   # call (args is a JSON string)
mcp({ tool: "<tool_name>", server: "datadog-prod", args: '{...}' })  # disambiguate same-named tools
```

`args` is always a **JSON string**, not an object. Always `describe` a tool to
confirm its schema before calling it.

## Auth

First call to a remote server triggers `mcp-remote`'s OAuth browser flow; tokens
cache afterward. If the adapter reports `auth_required`, either:

```
mcp({ action: "auth-start", server: "<name>" })    # returns a browser URL
mcp({ action: "auth-complete", server: "<name>", args: '{"redirectUrl":"..."}' })
```

Or, in an interactive local session, use the `/mcp-auth <server>` slash command.
Run OAuth once per server (and once each for `datadog-staging` and
`datadog-prod`).

## Notes

- Manage servers interactively with the `/mcp` slash command (`/mcp setup` to
  import host configs).
- Datadog entries use toolsets `metrics,logs,monitors,dashboards`. Edit the URL
  in `~/.config/mcp/mcp.json` to change them.
- For Jira/Confluence specifics (cloud ID, SVLS ticket fields), also load the
  `atlassian` skill.
- If Slack calls return a 401 the proxy auto-refreshes; if that fails, re-run
  `python3 ~/.claude/skills/slack-mcp/scripts/slack-mcp-auth.py`.
