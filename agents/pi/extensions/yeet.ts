// `/yeet` -- stage, commit, and push the current repo changes following the
// git-workflow skill (Graphite-based, never `git push`).
//
// The branch is resolved deterministically here so the agent doesn't burn tokens
// figuring out which path to take:
//   - on the main branch -> create a branch + commit + PR via `git cr`
//   - on a feature branch -> add a commit via `git ac` + push via `gt ss`

import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

// Resolve the repo's default branch without depending on a `git main` gitconfig alias.
// Prefer origin/HEAD; fall back to a local main/master if the symbolic-ref isn't set.
function mainBranch(cwd: string): string {
	try {
		const ref = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
		return ref.replace(/^refs\/remotes\/origin\//, "");
	} catch {
		for (const candidate of ["main", "master"]) {
			try {
				git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`]);
				return candidate;
			} catch {
				// try next candidate
			}
		}
		return "main";
	}
}

const COMMON = `Follow the git-workflow skill (read its SKILL.md if you have not already). Never use \`git push\`. If there are no changes to commit, say so and stop.`;

function featureBranchPrompt(branch: string): string {
	return `Stage, commit, and push the current repository changes.

You are on feature branch \`${branch}\`, so add to it:
1. \`git ac <short description>\` -- write a concise description of the diff (the ticket prefix is added automatically from the branch name).
2. \`gt ss --no-edit -q\` to push.

${COMMON}`;
}

function mainBranchPrompt(branch: string): string {
	return `Stage, commit, and push the current repository changes.

You are on the main branch \`${branch}\`, so create a new branch with the first commit + PR in one shot using \`git cr\`:
- With a ticket: \`git cr <ticket> <short description>\` (e.g. \`git cr svls-1234 fix the timeout\`).
- No ticket: \`git cr chore <short description>\`.
Infer a concise description from the diff. If the user supplied a ticket below, use it; otherwise use the chore form.

${COMMON}`;
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("yeet", {
		description: "Stage, commit, and push the current repo changes (git-workflow skill)",
		handler: async (args, ctx) => {
			let base: string;
			try {
				const branch = git(ctx.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
				const main = mainBranch(ctx.cwd);
				base = branch === main ? mainBranchPrompt(branch) : featureBranchPrompt(branch);
			} catch {
				ctx.ui.notify("/yeet: not a git repo (or git failed)", "error");
				return;
			}

			const prompt = args?.trim() ? `${base}\n\nAdditional instructions from the user:\n${args.trim()}` : base;

			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /yeet as a follow-up", "info");
			}
		},
	});
}
