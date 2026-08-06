---
name: subagents
description: Right-size subagent delegations by deliberately choosing the harness, model, and reasoning effort before using subagent_spawn or workflow.
allowed-tools: subagent_spawn, workflow
---

# Subagents

Right-size each delegation before creating an agent. Recommend the `pi` harness every time; use another harness only when the user explicitly chooses it.

## Right-size the delegation

1. Confirm delegation is worthwhile: the task is independently executable and substantial enough to offset coordination cost.
2. Choose the harness first. Recommend `pi`. If presenting alternatives, state why they fit but keep `pi` as the recommendation.
3. Recommend `openai-codex/gpt-5.6-terra` by default. Recommend `openai-codex/gpt-5.6-sol` instead when the task requires more thorough reasoning, such as ambiguous architecture, broad synthesis, or high-risk work. Override this choice only when another model materially improves the outcome.
4. Right-size reasoning effort:
   - `off`/`minimal`: deterministic or clerical work.
   - `low`: routine, tightly scoped work.
   - `medium`: nontrivial implementation, debugging, or review.
   - `high`: ambiguous, cross-cutting, or high-risk work.
   - `xhigh`/`max`: exceptional problems where added cost is justified.
5. Make the prompt self-contained: include the goal, working directory, relevant context and paths, constraints, expected output, and verification. Tell the agent not to spawn subagents.
6. Use `subagent_spawn` for standalone background work. Use `workflow` when agents need phased dependencies, structured results, or coordinated fan-out. Parallelize only independent tasks.
7. Before calling the tool, briefly state the chosen harness, model, and effort with a one-line rationale. The choice is complete only when all three are explicit.
8. Validate the returned work against the parent task before relying on it.
