---
name: atlassian
description: Ava's Atlassian (Jira, Confluence) workflow. Load this skill whenever using any Atlassian MCP tools.
user_invocable: false
---

# Atlassian

## Setup

- **Cloud ID**: `66c05bee-f5ff-4718-b6fc-81351e5ef659` (Datadog Atlassian cloud) -- use this for all MCP tool calls

## Creating SVLS Jira tickets

### Defaults

| Field | Value |
|---|---|
| Project | SVLS (`15505`) |
| Issue type | Task (`10002`) |
| Team - SVLS (`customfield_15831`) | Serverless Onboarding & Enablement (`22498`) |
| Labels (`labels`) | `["Team - SVLS"]` |
| Priority | **Omit entirely** |
| Assignee | Leave blank unless explicitly requested |
| Parent (epic) | Always required -- ask if not provided |

### Setting the parent (epic)

Use the `parent` field (not `customfield_10014`):

```json
"parent": { "key": "SVLS-XXXX" }
```

### Team - SVLS allowed values

| Value | ID |
|---|---|
| Agent | 19143 |
| APM | 19141 |
| App | 19140 |
| Data | 19139 |
| DevEx | 19142 |
| Integrations | 19144 |
| Serverless AWS | 22447 |
| Serverless Azure | 22448 |
| Serverless Cloud Tracing | 22451 |
| Serverless Edge Computing | 22450 |
| Serverless Experiences | 22449 |
| Serverless Onboarding & Enablement | 22498 |

### Steps

1. Parse user input for: summary, description, parent epic, and any overrides to the defaults above.
2. If no epic is provided, ask before proceeding.
3. Call `mcp__claude_ai_Atlassian__createJiraIssue` with:
   - `cloudId`: `66c05bee-f5ff-4718-b6fc-81351e5ef659`
   - `projectIdOrKey`: `"SVLS"`
   - `issueTypeId`: `"10002"`
   - `summary`: from user input
   - `description`: from user input (if provided)
   - `parent`: `{ "key": "<epic key>" }`
   - `customfield_15831`: `{ "id": "22498" }` (or user-specified team ID)
   - `labels`: `["Team - SVLS"]`
   - Do NOT include `priority` or `assignee` unless explicitly requested
4. Return the ticket key and link: `https://datadoghq.atlassian.net/browse/<KEY>`
