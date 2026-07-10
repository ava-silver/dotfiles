import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KokoroTTS } from "kokoro-js";

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const REWRITE_MODEL = { provider: "anthropic", id: "claude-haiku-4-5" };
const KOKORO_VOICE = "af_sky";
const DEFAULT_SPEED = 2.0;
const MIN_SPEED = 1.0;
const MAX_SPEED = 2.5;
const PRESENCE_IDLE_LIMIT_MS = 5 * 60 * 1000;
const REWRITE_PROMPT = `Rewrite the written assistant text as a natural spoken rendition.

Feel free to paraphrase, restructure sentences, use conversational transitions, combine repetitive points, and omit minor details that do not affect the meaning. Optimize for something a person would naturally say aloud rather than a literal reading. Convert file paths, command flags, identifiers, versions, and other written technical notation into short human descriptions instead of reading their exact syntax. For example, "agents/pi/extensions/read-aloud/index.ts" can become "the read aloud index file." The listener can see the original text if exact details are needed. Preserve the core meaning, decisions, and important caveats, but do not invent new claims. Return only the spoken rendition with no preface, labels, Markdown, or commentary.`;

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
	if (!/^\d+(?:\.\d+)?$/.test(input.trim())) return undefined;
	const speed = Number(input.trim());
	return Number.isFinite(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED ? speed : undefined;
}

type ActiveSpeech = {
	generation: number;
	cancelled: boolean;
	abortController: AbortController;
	ctx: ExtensionContext;
	player?: ChildProcessWithoutNullStreams;
	playerClosed?: Promise<void>;
	playerError?: Error;
	task?: Promise<void>;
};

export default function readAloudExtension(pi: ExtensionAPI): void {
	let speed = DEFAULT_SPEED;
	let activeSpeech: ActiveSpeech | undefined;
	let lastAutoReadEntryId: string | undefined;
	let autoReadGeneration = 0;
	let modelPromise: Promise<KokoroTTS> | undefined;
	const rewriteCache = new Map<string, string>();
	const speechTasks = new Set<Promise<void>>();

	function stopSpeech(): boolean {
		if (!activeSpeech) return false;
		const speech = activeSpeech;
		activeSpeech = undefined;
		speech.cancelled = true;
		speech.abortController.abort();
		speech.ctx.ui.setStatus("read-aloud", undefined);
		speech.player?.stdin.end();
		speech.player?.kill();
		return true;
	}

	async function loadModel(ctx: ExtensionContext, speech: ActiveSpeech): Promise<KokoroTTS> {
		if (!modelPromise) {
			ctx.ui.setStatus("read-aloud", "Loading Kokoro speech model...");
			modelPromise = import("kokoro-js")
				.then(({ KokoroTTS }) => KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" }))
				.catch((error) => {
					modelPromise = undefined;
					throw error;
				});
		}
		try {
			return await modelPromise;
		} finally {
			if (activeSpeech === speech) ctx.ui.setStatus("read-aloud", undefined);
		}
	}

	function startPlayer(speech: ActiveSpeech, sampleRate: number): ChildProcessWithoutNullStreams {
		const player = spawn(
			"ffplay",
			["-nodisp", "-autoexit", "-loglevel", "error", "-f", "f32le", "-ar", String(sampleRate), "pipe:0"],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		speech.player = player;
		let stderr = "";
		let settled = false;
		speech.playerClosed = new Promise<void>((resolve) => {
			const settle = () => {
				if (settled) return;
				settled = true;
				resolve();
			};
			player.stderr.setEncoding("utf8");
			player.stderr.on("data", (chunk: string) => {
				stderr += chunk;
			});
			player.stdin.on("error", (error) => {
				if (!speech.cancelled) speech.playerError = error;
			});
			player.on("error", (error) => {
				if (!speech.cancelled) speech.playerError = error;
				settle();
			});
			player.on("close", (code) => {
				if (!speech.cancelled && code !== 0 && !speech.playerError) {
					speech.playerError = new Error(stderr.trim() || `ffplay exited with code ${code}`);
				}
				settle();
			});
		});
		return player;
	}

	async function rewriteForSpeech(text: string, ctx: ExtensionContext, speech: ActiveSpeech): Promise<string> {
		const cached = rewriteCache.get(text);
		if (cached) return cached;

		try {
			const model = ctx.modelRegistry.find(REWRITE_MODEL.provider, REWRITE_MODEL.id);
			if (!model) return text;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey || speech.cancelled) return text;

			const response = await completeSimple(
				model,
				{
					systemPrompt: REWRITE_PROMPT,
					messages: [
						{
							role: "user",
							content: [{ type: "text", text }],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					signal: speech.abortController.signal,
					reasoning: "minimal",
					maxTokens: 4096,
					temperature: 0.2,
				},
			);
			if (speech.cancelled || response.stopReason !== "stop") return text;
			const rewritten = response.content
				.filter((content): content is { type: "text"; text: string } => content.type === "text")
				.map((content) => content.text)
				.join("\n")
				.trim();
			const normalized = normalizeForSpeech(rewritten);
			if (!normalized) return text;
			rewriteCache.set(text, normalized);
			if (rewriteCache.size > 20) rewriteCache.delete(rewriteCache.keys().next().value!);
			return normalized;
		} catch {
			return text;
		}
	}

	async function writePcm(speech: ActiveSpeech, bytes: Buffer): Promise<void> {
		const player = speech.player;
		if (!player || player.stdin.destroyed) throw new Error("Audio player closed unexpectedly");
		if (player.stdin.write(bytes)) return;

		await Promise.race([
			once(player.stdin, "drain", { signal: speech.abortController.signal }),
			speech.playerClosed ?? Promise.resolve(),
		]);
		if (speech.cancelled) return;
		if (speech.playerError) throw speech.playerError;
		if (player.stdin.destroyed) throw new Error("Audio player closed unexpectedly");
	}

	async function runSpeech(text: string, ctx: ExtensionContext, notify: boolean, speech: ActiveSpeech): Promise<void> {
		try {
			const [model, spokenText] = await Promise.all([loadModel(ctx, speech), rewriteForSpeech(text, ctx, speech)]);
			if (speech.cancelled || activeSpeech !== speech) return;

			const { TextSplitterStream } = await import("kokoro-js");
			const splitter = new TextSplitterStream();
			splitter.push(spokenText);
			splitter.close();

			let generatedAudio = false;
			for await (const { audio } of model.stream(splitter, { voice: KOKORO_VOICE, speed })) {
				if (speech.cancelled || activeSpeech !== speech) return;
				generatedAudio = true;
				if (!speech.player) startPlayer(speech, audio.sampling_rate);
				const bytes = Buffer.from(audio.audio.buffer, audio.audio.byteOffset, audio.audio.byteLength);
				await writePcm(speech, bytes);
			}
			if (!generatedAudio) throw new Error("Kokoro produced no audio");
			if (speech.cancelled || activeSpeech !== speech) return;

			speech.player?.stdin.end();
			await speech.playerClosed;
			if (speech.playerError) throw speech.playerError;
		} catch (error) {
			if (!speech.cancelled && activeSpeech === speech) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Read aloud failed: ${message}`, "error");
			}
		} finally {
			if (speech.player && speech.player.exitCode === null && !speech.player.killed) {
				speech.player.stdin.end();
				speech.player.kill();
			}
			if (activeSpeech === speech) activeSpeech = undefined;
			if (notify && !speech.cancelled && !speech.playerError) ctx.ui.setStatus("read-aloud", undefined);
		}
	}

	function startSpeech(text: string, ctx: ExtensionContext, notify: boolean): void {
		stopSpeech();
		const normalized = normalizeForSpeech(text);
		if (!normalized) {
			if (notify) ctx.ui.notify("Nothing readable in the last response", "info");
			return;
		}

		const speech: ActiveSpeech = {
			generation: ++autoReadGeneration,
			cancelled: false,
			abortController: new AbortController(),
			ctx,
		};
		activeSpeech = speech;
		if (notify) ctx.ui.notify(`Rewriting with Haiku, then speaking locally at ${speed}x`, "info");
		const task = runSpeech(normalized, ctx, notify, speech);
		speech.task = task;
		speechTasks.add(task);
		void task.finally(() => speechTasks.delete(task));
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
		description: "Rewrite the latest response with Haiku and read it locally, or stop current speech",
		handler: async (_args, ctx) => toggleSpeech(ctx),
	});

	pi.registerCommand("speech-rate", {
		description: `Show or set Kokoro speed (${MIN_SPEED}-${MAX_SPEED}x)`,
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				ctx.ui.notify(`Speech speed: ${speed}x`, "info");
				return;
			}
			const parsed = parseRate(value);
			if (parsed === undefined) {
				ctx.ui.notify(`Usage: /speech-rate <${MIN_SPEED}-${MAX_SPEED}>`, "error");
				return;
			}
			speed = parsed;
			ctx.ui.notify(`Speech speed set to ${speed}x`, "info");
		},
	});

	pi.registerShortcut("ctrl+r", {
		description: "Rewrite the latest response with Haiku and read it locally, or stop current speech",
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
		await Promise.allSettled(speechTasks);

		const pendingModel = modelPromise;
		modelPromise = undefined;
		if (pendingModel) {
			try {
				const model = await pendingModel;
				await model.model.dispose();
			} catch {
				// Loading or disposal failure should not block session shutdown.
			}
		}
		rewriteCache.clear();
	});
}
