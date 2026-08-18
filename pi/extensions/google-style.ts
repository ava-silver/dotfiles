import { readFileSync } from "node:fs";
import type { BuildSystemPromptOptions, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "google-style-mode";
const STATUS_ID = "google-style";

interface StyleState {
	enabled: boolean;
}

const FALLBACK_STYLE = `- Address the reader as "you."
- Use active voice, present tense, and standard American English.
- Be conversational, friendly, respectful, direct, and concise.
- Write for a global audience. Avoid slang, idioms, hype, jargon, and culturally specific references.
- Put conditions before instructions.
- Use sentence case, descriptive links, and the serial comma.
- Format code in code font and literal UI elements in bold.`;

export function parseGoogleStyleMode(args: string): boolean | undefined {
	switch (args.trim().toLowerCase()) {
		case "on":
		case "new":
		case "google":
			return true;
		case "off":
		case "old":
			return false;
		default:
			return undefined;
	}
}

export function restoreGoogleStyleMode(ctx: ExtensionContext): boolean {
	let enabled = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
		const state = entry.data as StyleState | undefined;
		if (typeof state?.enabled === "boolean") enabled = state.enabled;
	}
	return enabled;
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();
	const end = markdown.indexOf("\n---\n", 4);
	return end === -1 ? markdown.trim() : markdown.slice(end + 5).trim();
}

export function buildGoogleStylePrompt(skills: BuildSystemPromptOptions["skills"]): string {
	const skill = skills?.find(({ name }) => name === "google-developer-style");
	let guidance = FALLBACK_STYLE;
	if (skill) {
		try {
			guidance = stripFrontmatter(readFileSync(skill.filePath, "utf8"));
		} catch {}
	}

	return `## Active writing style: Google developer documentation

Apply this style to every user-facing response, including ordinary conversation, status updates, explanations, and written artifacts. It governs prose, tone, organization, and formatting; it does not change technical decisions or tool behavior. Explicit user and project requirements still take precedence. Do not announce or discuss the active style unless asked.

${guidance}`;
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_ID, enabled ? "Google style" : undefined);
}

export default function googleStyleExtension(pi: ExtensionAPI): void {
	let enabled = false;

	const restore = (ctx: ExtensionContext): void => {
		enabled = restoreGoogleStyleMode(ctx);
		updateStatus(ctx, enabled);
	};

	pi.registerCommand("google-style", {
		description: "Switch Google writing style on or off for this session",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();
			if (normalized === "" || normalized === "status") {
				ctx.ui.notify(`Google style is ${enabled ? "on" : "off"}`, "info");
				return;
			}

			const next = parseGoogleStyleMode(normalized);
			if (next === undefined) {
				ctx.ui.notify("Usage: /google-style on|off|status", "warning");
				return;
			}

			enabled = next;
			pi.appendEntry<StyleState>(STATE_TYPE, { enabled });
			updateStatus(ctx, enabled);
			ctx.ui.notify(`Google style ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildGoogleStylePrompt(event.systemPromptOptions.skills)}`,
		};
	});
}
