import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "git-diff";
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

type DiffTotals = { added: number; deleted: number };

export function parseNumstat(output: string): DiffTotals {
	let added = 0;
	let deleted = 0;

	for (const line of output.split("\n")) {
		const [addedText, deletedText] = line.split("\t", 3);
		const fileAdded = Number(addedText);
		const fileDeleted = Number(deletedText);
		if (Number.isFinite(fileAdded)) added += fileAdded;
		if (Number.isFinite(fileDeleted)) deleted += fileDeleted;
	}

	return { added, deleted };
}

export default function gitDiffStatusExtension(pi: ExtensionAPI): void {
	let refreshId = 0;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") return;
		const id = ++refreshId;
		const result = await pi.exec("git", ["-C", ctx.cwd, "diff", "HEAD", "--numstat", "--"], {
			timeout: 5_000,
		});
		if (id !== refreshId) return;

		if (result.code !== 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const { added, deleted } = parseNumstat(result.stdout);
		const label = [
			ctx.ui.theme.fg("success", `+${added}`),
			ctx.ui.theme.fg("error", `-${deleted}`),
		].join(" ");
		ctx.ui.setStatus(STATUS_KEY, label);
	}

	pi.on("session_start", async (_event, ctx) => refresh(ctx));

	pi.on("tool_execution_end", async (event, ctx) => {
		if (MUTATING_TOOLS.has(event.toolName)) await refresh(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => refresh(ctx));

	pi.on("session_shutdown", (_event, ctx) => {
		refreshId++;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
