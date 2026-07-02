// `/pr-feedback` -- fetch this PR's review feedback from GitHub directly (no agent
// tool calls needed), hand the raw feedback to the agent, and have it judge which
// comments are valid and fix those in the code.
//
// This deliberately stops short of committing/pushing -- that's `/yeet`'s job.

import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function gh(cwd: string, args: string[]): string {
  return execFileSync("gh", args, { cwd, encoding: "utf-8" }).trim();
}

function repoSlug(cwd: string): string {
  return gh(cwd, [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
}

function resolvePrNumber(cwd: string, args: string): string {
  const explicit = args.trim().match(/\d+/);
  if (explicit) return explicit[0];
  return gh(cwd, ["pr", "view", "--json", "number", "-q", ".number"]);
}

function ghApiJson<T>(
  cwd: string,
  repo: string,
  path: string,
  jq: string,
): T[] {
  const out = gh(cwd, [
    "api",
    `repos/${repo}/${path}`,
    "--paginate",
    "--jq",
    jq,
  ]);
  if (!out.trim()) return [];
  // `--paginate` with `--jq` emits one JSON array per page; concatenate them.
  const arrays = out
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T[]);
  return arrays.flat();
}

interface InlineComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: string;
  in_reply_to_id: number | null;
}

interface Review {
  state: string;
  user: string;
  body: string;
}

interface Feedback {
  inlineComments: InlineComment[];
  reviews: Review[];
}

// Issue-level (PR-level) comments are excluded: in practice they're Graphite
// stack-list bots, CI placeholder comments, and perf-report bots -- never
// actionable review feedback. Real review feedback comes in as inline comments
// or review bodies.
function fetchFeedback(cwd: string, repo: string, pr: string): Feedback {
  return {
    inlineComments: ghApiJson<InlineComment>(
      cwd,
      repo,
      `pulls/${pr}/comments`,
      "[.[] | {id, path, line: .original_line, body, user: .user.login, in_reply_to_id}]",
    ),
    reviews: ghApiJson<Review>(
      cwd,
      repo,
      `pulls/${pr}/reviews`,
      "[.[] | {state, user: .user.login, body}]",
    ),
  };
}

function isEmpty(feedback: Feedback): boolean {
  return feedback.inlineComments.length === 0 && feedback.reviews.length === 0;
}

// Strips boilerplate that automated reviewers (Codex, etc.) wrap around their
// actual findings, and pulls out a compact severity badge (e.g. "P2") when present.
function cleanBody(raw: string): { label: string | null; text: string } {
  let body = raw;

  // Drop collapsible "About Codex in GitHub" style boilerplate blocks.
  body = body.replace(/<details>[\s\S]*?<\/details>/gi, "");

  // Screenshots/images aren't visible to the agent -- note that one was attached
  // instead of dropping the context entirely.
  body = body.replace(/<img\b[^>]*>/gi, "[screenshot attached]");

  // Pull a leading severity badge + title, e.g.
  // `**<sub><sub>![P2 Badge](...)</sub></sub>  Gate Vercel projects**` -- the bold
  // wraps the whole first line, so unwrap that before extracting the badge.
  const lines = body.split("\n");
  let firstLine = (lines[0] ?? "").trim();
  const boldMatch = firstLine.match(/^\*\*(.*)\*\*$/);
  if (boldMatch) firstLine = boldMatch[1].trim();
  let label: string | null = null;
  const badgeMatch = firstLine.match(
    /^\s*(?:<sub>\s*)*!\[(\w+)\s*Badge\]\([^)]*\)(?:\s*<\/sub>)*\s*/i,
  );
  if (badgeMatch) {
    label = badgeMatch[1].toUpperCase();
    firstLine = firstLine.slice(badgeMatch[0].length).trim();
  }
  body = [firstLine, ...lines.slice(1)].join("\n");
  body = body.replace(/<\/?sub>/gi, "");

  // Strip standard CTA/header/footer lines that carry no signal.
  body = body.replace(/^\s*Useful\? React with.*$/gim, "");
  body = body.replace(/^\s*\*{0,2}Reviewed commit:?\*{0,2}.*$/gim, "");
  body = body.replace(
    /^\s*Here are some automated review suggestions.*$/gim,
    "",
  );
  body = body.replace(/^#{1,6}.*Codex Review.*$/gim, "");

  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return { label, text: body };
}

function formatThreads(comments: InlineComment[]): string {
  if (comments.length === 0) return "(none)";

  const byId = new Map<number, InlineComment>();
  for (const c of comments) byId.set(c.id, c);
  const roots = comments.filter((c) => c.in_reply_to_id == null);
  const repliesByRoot = new Map<number, InlineComment[]>();
  for (const c of comments) {
    if (c.in_reply_to_id == null) continue;
    // Walk up to the thread root in case of nested replies.
    let rootId = c.in_reply_to_id;
    while (byId.get(rootId)?.in_reply_to_id != null) {
      rootId = byId.get(rootId)!.in_reply_to_id as number;
    }
    if (!repliesByRoot.has(rootId)) repliesByRoot.set(rootId, []);
    repliesByRoot.get(rootId)!.push(c);
  }

  return roots
    .map((root) => {
      const { label, text } = cleanBody(root.body);
      const tag = label ? `[${label}] ` : "";
      const lines = [
        `- ${root.path}:${root.line ?? "?"} -- @${root.user}: ${tag}${text}`,
      ];
      for (const reply of repliesByRoot.get(root.id) ?? []) {
        const replyClean = cleanBody(reply.body);
        lines.push(
          `    ↳ @${reply.user}: ${replyClean.label ? `[${replyClean.label}] ` : ""}${replyClean.text}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatReviews(reviews: Review[]): string {
  if (reviews.length === 0) return "(none)";
  const cleaned = reviews
    .map((r) => ({ ...r, ...cleanBody(r.body) }))
    // A `COMMENTED` review with nothing left after cleanup is just a wrapper around
    // its inline comments (or pure automated-reviewer boilerplate) -- drop it.
    .filter((r) => r.text || r.state !== "COMMENTED");
  if (cleaned.length === 0) return "(none)";
  return cleaned
    .map((r) => `- @${r.user} [${r.state}]${r.text ? `: ${r.text}` : ""}`)
    .join("\n");
}

function buildPrompt(repo: string, pr: string, feedback: Feedback): string {
  return `Here is the review feedback for ${repo}#${pr}, fetched directly from GitHub.

Inline review comments (indented lines are replies in the same thread):
${formatThreads(feedback.inlineComments)}

Reviews:
${formatReviews(feedback.reviews)}

For each piece of feedback (inline comment thread or review), skip anything already resolved by a prior reply or code change, then decide if it's valid:
- Valid -- fix it in the code.
- Invalid or not actionable (e.g. a question, already handled, out of scope, or a matter of opinion you disagree with) -- skip it and note why.

Do not reply to comments on GitHub and do not commit or push -- just make the code changes. Report a short summary of what you fixed and what you skipped (with reasons).`;
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("pr-feedback", {
    description:
      "Fetch PR review feedback and fix valid issues in the code (no commit)",
    handler: async (args, ctx) => {
      let prompt: string;
      try {
        const repo = repoSlug(ctx.cwd);
        const pr = resolvePrNumber(ctx.cwd, args ?? "");
        const feedback = fetchFeedback(ctx.cwd, repo, pr);
        if (isEmpty(feedback)) {
          ctx.ui.notify(
            `/pr-feedback: no review feedback found on ${repo}#${pr}`,
            "info",
          );
          return;
        }
        prompt = buildPrompt(repo, pr, feedback);
      } catch (err) {
        ctx.ui.notify(
          `/pr-feedback: failed to fetch PR feedback (${(err as Error).message})`,
          "error",
        );
        return;
      }

      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
        ctx.ui.notify("Queued /pr-feedback as a follow-up", "info");
      }
    },
  });
}
