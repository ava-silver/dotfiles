import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isReadToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOCAL_FILENAME = "AGENTS.local.md";
const SUBDIRECTORY_FILENAME = "AGENTS.md";

// Walk from cwd up to the filesystem root, collecting AGENTS.local.md files.
// Ordered root-first, same as pi's own AGENTS.md discovery, so nearer files
// take precedence when read top-to-bottom.
export function findLocalAgentsFiles(cwd: string, projectTrusted: boolean): string[] {
	if (!projectTrusted) return [];

	const found: string[] = [];
	let dir = cwd;
	while (true) {
		const candidate = join(dir, LOCAL_FILENAME);
		if (existsSync(candidate)) found.push(candidate);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return found.reverse();
}

export function findSubdirectoryAgentsFiles(cwd: string, readPath: string): string[] {
	const root = resolve(cwd);
	const target = resolve(root, readPath);
	const pathFromRoot = relative(root, target);
	if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) return [];

	const found: string[] = [];
	let dir = dirname(target);
	while (dir !== root) {
		const candidate = join(dir, SUBDIRECTORY_FILENAME);
		if (candidate !== target && existsSync(candidate)) found.push(candidate);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return found.reverse();
}

export default function localAgentsMdExtension(pi: ExtensionAPI): void {
	const loaded = new Set<string>();

	pi.on("session_start", () => loaded.clear());

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

	pi.on("tool_result", (event, ctx) => {
		if (!isReadToolResult(event) || event.isError || !ctx.isProjectTrusted()) return;
		const readPath = event.input.path;
		if (typeof readPath !== "string") return;

		const files = findSubdirectoryAgentsFiles(ctx.cwd, readPath).filter((path) => !loaded.has(path));
		const blocks: string[] = [];
		for (const path of files) {
			try {
				const content = readFileSync(path, "utf8").trim();
				loaded.add(path);
				blocks.push(`<subdirectory_instructions path="${path}">\n${content}\n</subdirectory_instructions>`);
			} catch {}
		}
		if (blocks.length === 0) return;

		return {
			content: [...event.content, { type: "text", text: `\n\n${blocks.join("\n\n")}` }],
		};
	});
}
