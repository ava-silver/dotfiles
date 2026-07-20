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
to each org once. `slack` runs a local stdio proxy backed by a macOS keychain token, so no OAuth
round-trip happens at call time.

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

Two auth paths depending on transport:

- **Native HTTP OAuth** (server has a `url` + `auth: "oauth"`, e.g. `datadog-staging`,
  `datadog-prod`): the adapter manages OAuth. Use `/mcp-auth <server>` interactively,
  or the headless paste-the-code fallback:
  ```
  mcp({ action: "auth-start", server: "<name>" })    # returns a browser URL
  mcp({ action: "auth-complete", server: "<name>", args: '{"redirectUrl":"..."}' })
  ```
- **stdio via `mcp-remote`** (server has `command`/`args`, e.g. `atlassian`):
  the adapter does NOT manage OAuth -- `/mcp-auth` will reject it ("does not use
  OAuth"). `mcp-remote` runs its own browser flow on first connect; just call a
  tool or `/mcp reconnect <server>`. Tokens cache in `~/.mcp-auth`.

Run OAuth once per server (and once each for `datadog-staging` and `datadog-prod`).

`mcp-remote` binds a **deterministic callback port** derived from the server URL.
If login fails with `No authorization code received`, a stale `mcp-remote` process
is likely squatting that port: `pgrep -fl mcp-remote`, kill the offenders, then
retry.

## Notes

- Manage servers interactively with the `/mcp` slash command (`/mcp setup` to
  import host configs).
- Datadog entries use toolsets `metrics,logs,monitors,dashboards`. Edit the URL
  in `~/.config/mcp/mcp.json` to change them.
- For Jira/Confluence specifics (cloud ID, SVLS ticket fields), also load the
  `atlassian` skill.
- If Slack calls report authentication is required, call the `slack_auth` tool.
  It asks for confirmation, opens Slack in the user's browser, and returns when
  authorization completes. `/slack-auth` is the manual fallback.
- The proxy auto-refreshes tokens on 401.
