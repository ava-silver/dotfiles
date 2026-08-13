import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FILENAME = "AGENTS.local.md";

// Walk from cwd up to the filesystem root, collecting AGENTS.local.md files.
// Ordered root-first, same as pi's own AGENTS.md discovery, so nearer files
// take precedence when read top-to-bottom.
export function findLocalAgentsFiles(cwd: string, projectTrusted: boolean): string[] {
	if (!projectTrusted) return [];

	const found: string[] = [];
	let dir = cwd;
	while (true) {
		const candidate = join(dir, FILENAME);
		if (existsSync(candidate)) found.push(candidate);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return found.reverse();
}

export default function localAgentsMdExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const files = findLocalAgentsFiles(ctx.cwd, ctx.isProjectTrusted());
		if (files.length === 0) return;

		const blocks = files.map((path) => {
			const content = readFileSync(path, "utf8").trim();
			return `<local_instructions path="${path}">\n${content}\n</local_instructions>`;
		});

		return {
			systemPrompt: `${event.systemPrompt}\n\n${blocks.join("\n\n")}`,
		};
	});
}
