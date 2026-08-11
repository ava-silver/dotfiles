import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const MERGE_COMMAND = /\bgh\s+pr\s+merge\b/;
const EXPLICIT_PR = /\bgh\s+pr\s+merge\s+(?!-)(\S+)/;
const API_MERGE = /\bgh\s+api\b[\s\S]*(?:mergePullRequest|\/merge\b)/;

async function gh(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, { cwd, encoding: "utf8" });
	return stdout.trim();
}

export default function (pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (API_MERGE.test(command)) {
			return {
				block: true,
				reason:
					"PR merges through gh api are blocked. Do not bypass this guard; use gh pr merge from the current branch.",
			};
		}
		if (!MERGE_COMMAND.test(command)) return;
		if (EXPLICIT_PR.test(command)) {
			return {
				block: true,
				reason: "Explicit PR numbers are blocked. Do not bypass this guard; merge only the current branch's PR.",
			};
		}

		try {
			const [viewer, pr] = await Promise.all([
				gh(ctx.cwd, ["api", "user", "--jq", ".login"]),
				gh(ctx.cwd, ["pr", "view", "--json", "author,headRefName"]),
			]);
			const details = JSON.parse(pr) as { author?: { login?: string }; headRefName?: string };
			if (details.author?.login !== viewer || !details.headRefName?.startsWith("ava.silver/")) {
				return {
					block: true,
					reason: "Only the authenticated user's ava.silver/* branch PR may be merged. Do not bypass this guard.",
				};
			}
		} catch (error) {
			return {
				block: true,
				reason: `Could not verify the current branch PR: ${error instanceof Error ? error.message : String(error)}. Do not bypass this guard.`,
			};
		}
	});
}
