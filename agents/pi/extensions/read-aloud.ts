import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_RATE_WPM = 250;
const MIN_RATE_WPM = 80;
const MAX_RATE_WPM = 600;
const PRESENCE_IDLE_LIMIT_MS = 5 * 60 * 1000;

type AssistantContent =
	| { type: "text"; text: string }
	| { type: string; [key: string]: unknown };

type BranchEntry = {
	id?: string;
	type: string;
	message?: {
		role?: string;
		stopReason?: string;
		content?: AssistantContent[];
	};
};

export type LatestAssistantText =
	| { status: "found"; entryId?: string; text: string }
	| { status: "missing" }
	| { status: "incomplete"; stopReason: string };

export function extractLatestAssistantText(entries: readonly BranchEntry[]): LatestAssistantText {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;

		const stopReason = entry.message.stopReason ?? "unknown";
		if (stopReason !== "stop") return { status: "incomplete", stopReason };

		const text = (entry.message.content ?? [])
			.filter((content): content is { type: "text"; text: string } =>
				content.type === "text" && typeof content.text === "string",
			)
			.map((content) => content.text)
			.join("\n")
			.trim();

		return text ? { status: "found", entryId: entry.id, text } : { status: "missing" };
	}

	return { status: "missing" };
}

function stripFencedCodeBlocks(markdown: string): string {
	const kept: string[] = [];
	let fence: { character: "`" | "~"; length: number } | undefined;

	for (const line of markdown.split("\n")) {
		if (!fence) {
			const opener = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (!opener?.[1]) {
				kept.push(line);
				continue;
			}
			fence = { character: opener[1][0] as "`" | "~", length: opener[1].length };
			continue;
		}

		const trimmed = line.trim();
		const closing = trimmed.match(/^(`+|~+)$/)?.[1];
		if (closing?.[0] === fence.character && closing.length >= fence.length) fence = undefined;
	}

	return kept.join("\n");
}

function stripMarkdownLinkDestinations(markdown: string): string {
	let result = "";
	let cursor = 0;

	while (cursor < markdown.length) {
		const image = markdown.startsWith("![", cursor);
		if (!image && markdown[cursor] !== "[") {
			result += markdown[cursor];
			cursor++;
			continue;
		}

		const labelStart = cursor + (image ? 2 : 1);
		const labelEnd = markdown.indexOf("](", labelStart);
		if (labelEnd === -1) {
			result += markdown[cursor];
			cursor++;
			continue;
		}

		let depth = 1;
		let end = labelEnd + 2;
		for (; end < markdown.length && depth > 0; end++) {
			if (markdown[end] === "\\") {
				end++;
				continue;
			}
			if (markdown[end] === "(") depth++;
			else if (markdown[end] === ")") depth--;
		}
		if (depth !== 0) {
			result += markdown[cursor];
			cursor++;
			continue;
		}

		result += markdown.slice(labelStart, labelEnd);
		cursor = end;
	}

	return result;
}

export function normalizeForSpeech(markdown: string): string {
	return stripMarkdownLinkDestinations(stripFencedCodeBlocks(markdown))
		.replace(/<https?:\/\/[^>]+>/gi, " ")
		.replace(/https?:\/\/\S+/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*(?:[-*+] |\d+[.)] |>\s*)/gm, "")
		.replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, " ")
		.replace(/^\s*\|\s*/gm, "")
		.replace(/\s*\|\s*$/gm, ".")
		.replace(/\s*\|\s*/g, ", ")
		.replace(/[*_~]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseHidIdleMs(output: string): number | undefined {
	const match = output.match(/"HIDIdleTime"\s*=\s*(\d+)/);
	if (!match?.[1]) return undefined;
	const nanoseconds = Number(match[1]);
	return Number.isSafeInteger(nanoseconds) ? nanoseconds / 1_000_000 : undefined;
}

export function parseScreenLocked(output: string): boolean | undefined {
	const match = output.match(/"IOConsoleLocked"\s*=\s*(Yes|No)/);
	if (!match?.[1]) return undefined;
	return match[1] === "Yes";
}

export function parseRate(input: string): number | undefined {
	if (!/^\d+$/.test(input.trim())) return undefined;
	const rate = Number(input.trim());
	return Number.isInteger(rate) && rate >= MIN_RATE_WPM && rate <= MAX_RATE_WPM ? rate : undefined;
}

type ActiveSpeech = {
	child: ChildProcessWithoutNullStreams;
	cancelled: boolean;
	errorReported: boolean;
};

export default function readAloudExtension(pi: ExtensionAPI): void {
	let rateWpm = DEFAULT_RATE_WPM;
	let activeSpeech: ActiveSpeech | undefined;
	let lastAutoReadEntryId: string | undefined;
	let autoReadGeneration = 0;

	function stopSpeech(): boolean {
		if (!activeSpeech) return false;
		const speech = activeSpeech;
		activeSpeech = undefined;
		speech.cancelled = true;
		speech.child.stdin.end();
		speech.child.kill();
		return true;
	}

	function startSpeech(text: string, ctx: ExtensionContext, notify: boolean): void {
		stopSpeech();
		const normalized = normalizeForSpeech(text);
		if (!normalized) {
			if (notify) ctx.ui.notify("Nothing readable in the last response", "info");
			return;
		}

		const child = spawn("/usr/bin/say", ["-r", String(rateWpm), "-f", "-"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		const speech: ActiveSpeech = { child, cancelled: false, errorReported: false };
		activeSpeech = speech;
		let stderr = "";

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.stdin.on("error", (error) => {
			if (!speech.cancelled && !speech.errorReported) {
				speech.errorReported = true;
				ctx.ui.notify(`Read aloud failed: ${error.message}`, "error");
			}
		});
		child.on("error", (error) => {
			if (activeSpeech === speech) activeSpeech = undefined;
			if (!speech.cancelled && !speech.errorReported) {
				speech.errorReported = true;
				ctx.ui.notify(`Read aloud failed: ${error.message}`, "error");
			}
		});
		child.on("close", (code) => {
			if (activeSpeech === speech) activeSpeech = undefined;
			if (!speech.cancelled && code !== 0 && !speech.errorReported) {
				speech.errorReported = true;
				ctx.ui.notify(`Read aloud failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`, "error");
			}
		});

		child.stdin.end(normalized);
		if (notify) ctx.ui.notify(`Reading aloud at ${rateWpm} WPM`, "info");
	}

	function latestText(ctx: ExtensionContext, notify: boolean): LatestAssistantText {
		const latest = extractLatestAssistantText(ctx.sessionManager.getBranch() as BranchEntry[]);
		if (!notify || latest.status === "found") return latest;
		if (latest.status === "incomplete") {
			ctx.ui.notify(`Last assistant response incomplete (${latest.stopReason})`, "error");
		} else {
			ctx.ui.notify("No completed assistant response found", "error");
		}
		return latest;
	}

	function toggleSpeech(ctx: ExtensionContext): void {
		autoReadGeneration++;
		if (stopSpeech()) {
			ctx.ui.notify("Read aloud stopped", "info");
			return;
		}
		const latest = latestText(ctx, true);
		if (latest.status === "found") startSpeech(latest.text, ctx, true);
	}

	async function userIsPresent(): Promise<boolean> {
		try {
			const [root, hid] = await Promise.all([
				pi.exec("/usr/sbin/ioreg", ["-n", "Root", "-d1"]),
				pi.exec("/usr/sbin/ioreg", ["-l", "-c", "IOHIDSystem"]),
			]);
			if (root.code !== 0 || hid.code !== 0) return false;
			const locked = parseScreenLocked(root.stdout);
			const idleMs = parseHidIdleMs(hid.stdout);
			return locked === false && idleMs !== undefined && idleMs < PRESENCE_IDLE_LIMIT_MS;
		} catch {
			return false;
		}
	}

	pi.registerCommand("read-aloud", {
		description: "Read the latest assistant response aloud, or stop current speech",
		handler: async (_args, ctx) => toggleSpeech(ctx),
	});

	pi.registerCommand("speech-rate", {
		description: `Show or set read-aloud speed (${MIN_RATE_WPM}-${MAX_RATE_WPM} WPM)`,
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				ctx.ui.notify(`Speech rate: ${rateWpm} WPM`, "info");
				return;
			}
			const parsed = parseRate(value);
			if (parsed === undefined) {
				ctx.ui.notify(`Usage: /speech-rate <${MIN_RATE_WPM}-${MAX_RATE_WPM}>`, "error");
				return;
			}
			rateWpm = parsed;
			ctx.ui.notify(`Speech rate set to ${rateWpm} WPM`, "info");
		},
	});

	pi.registerShortcut("ctrl+r", {
		description: "Read the latest assistant response aloud, or stop current speech",
		handler: async (ctx) => toggleSpeech(ctx),
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const latest = latestText(ctx, false);
		if (latest.status !== "found" || latest.entryId === lastAutoReadEntryId) return;
		lastAutoReadEntryId = latest.entryId;
		const generation = ++autoReadGeneration;
		if (!(await userIsPresent()) || generation !== autoReadGeneration) return;

		const current = latestText(ctx, false);
		if (current.status === "found" && current.entryId === latest.entryId) startSpeech(current.text, ctx, false);
	});

	pi.on("session_shutdown", async () => {
		autoReadGeneration++;
		stopSpeech();
	});
}
