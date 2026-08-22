import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "google-style";
const STATE_FILE = "google-style.json";

interface StyleState {
	enabled: boolean;
}

const GOOGLE_STYLE_PROMPT = `Apply Google developer documentation style to every user-facing response. Address the reader as "you." Use active voice, present tense, standard American English, and concise, direct language. Write for a global audience. Avoid jargon, slang, idioms, hype, and unnecessary detail. Use sentence case, serial commas, descriptive links, code font for code, and bold for literal UI elements.`;

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

export function getGoogleStyleStatePath(
	configDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): string {
	return join(configDir, STATE_FILE);
}

export function readGoogleStyleMode(statePath = getGoogleStyleStatePath()): boolean {
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8")) as StyleState;
		return state.enabled === true;
	} catch {
		return false;
	}
}

export function writeGoogleStyleMode(enabled: boolean, statePath = getGoogleStyleStatePath()): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
}

export function buildGoogleStylePrompt(): string {
	return `## Active writing style: Google developer documentation

${GOOGLE_STYLE_PROMPT}`;
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_ID, enabled ? "Google style" : undefined);
}

export default function googleStyleExtension(pi: ExtensionAPI): void {
	let enabled = false;

	const restore = (ctx: ExtensionContext): void => {
		enabled = readGoogleStyleMode();
		updateStatus(ctx, enabled);
	};

	pi.registerCommand("google-style", {
		description: "Switch Google writing style on or off globally",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();
			if (normalized === "" || normalized === "status") {
				enabled = readGoogleStyleMode();
				updateStatus(ctx, enabled);
				ctx.ui.notify(`Google style is ${enabled ? "on" : "off"}`, "info");
				return;
			}

			const next = parseGoogleStyleMode(normalized);
			if (next === undefined) {
				ctx.ui.notify("Usage: /google-style on|off|status", "warning");
				return;
			}

			enabled = next;
			writeGoogleStyleMode(enabled);
			updateStatus(ctx, enabled);
			ctx.ui.notify(`Google style ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", async (event) => {
		enabled = readGoogleStyleMode();
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildGoogleStylePrompt()}`,
		};
	});
}
