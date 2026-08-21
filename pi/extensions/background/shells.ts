/**
 * Background shells -- run long-lived shell commands, inspect output, or
 * cancel them.
 *
 * Tools (for the parent LLM):
 * - background_shell_run: fire-and-forget command spawn (command, title, working_dir).
 * - background_shell_cancel: kill one or more background shells.
 * - background_shell_check: peek at status and recent output.
 * - background_shell_list: list all background shells.
 *
 * Unawaited shells queue their output as a follow-up message when they
 * settle. `/background` opens the shared task picker.
 */

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerTransientSegment } from "../shared/footer-segments.ts";
import { killProcessTree } from "../shared/process-tree.ts";
import type { BackgroundHub } from "./src/hub.ts";

// --- Config ----------------------------------------------------------------

const OUTPUT_CAP_BYTES = 512 * 1024; // rolling buffer cap per terminal
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const CHECK_PREVIEW_BYTES = 4 * 1024;
const FOLLOW_UP_BYTES = 24 * 1024;
export const MAX_RUNNING_TERMINALS = 16;
export const MAX_TRACKED_TERMINALS = 128;

// --- Domain ----------------------------------------------------------------

export type TerminalStatus = "running" | "done" | "error";

interface Terminal {
	id: string;
	title: string;
	command: string;
	cwd: string;
	status: TerminalStatus;
	exitCode: number | undefined;
	/** Combined stdout+stderr, trimmed to OUTPUT_CAP_BYTES. */
	output: Buffer[];
	outputBytes: number;
	pid: number | undefined;
	startedAt: number;
	endedAt: number | undefined;
	proc: child_process.ChildProcess | undefined;
	artifactDir: string | undefined;
	artifactPath: string | undefined;
	artifactStream: fs.WriteStream | undefined;
	artifactFinalizing: Promise<void> | undefined;
	artifactBlocked: boolean;
	settling: Promise<void> | undefined;
	settled: Promise<void>;
	resolveSettled: () => void;
	killRequested: boolean;
	killNotify: boolean;
	artifactBytes: number;
	artifactStatus: "available" | "truncated" | "unavailable";
	abortCleanup: (() => void) | undefined;
}

let counter = 0;
function nextId() {
	return `tr-${++counter}`;
}

function elapsed(t: Terminal): string {
	const ms = (t.endedAt ?? Date.now()) - t.startedAt;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function describe(t: Terminal): string {
	const artifact = artifactNotice(t);
	return `${t.id} [${t.status}] "${t.title}" (${elapsed(t)}, ${t.cwd})${artifact ? ` ${artifact}` : ""}`;
}

function pauseOutput(t: Terminal): void {
	t.proc?.stdout?.pause();
	t.proc?.stderr?.pause();
}

function resumeOutput(t: Terminal): void {
	t.proc?.stdout?.resume();
	t.proc?.stderr?.resume();
}

function finishArtifact(t: Terminal): Promise<void> {
	if (t.artifactFinalizing) return t.artifactFinalizing;
	const stream = t.artifactStream;
	if (!stream) return Promise.resolve();
	t.artifactStream = undefined;
	if (t.artifactBlocked) {
		t.artifactBlocked = false;
		resumeOutput(t);
	}
	t.artifactFinalizing = new Promise((resolve) => {
		stream.once("close", resolve);
		stream.end();
	});
	return t.artifactFinalizing;
}

function failArtifact(t: Terminal): void {
	t.artifactStatus = "unavailable";
	void finishArtifact(t);
}

/** Append a chunk to a terminal's bounded combined output buffer and artifact. */
function appendOutput(t: Terminal, chunk: Buffer | string): void {
	const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
	const stream = t.artifactStream;
	if (stream) {
		const length = Math.min(bytes.length, Math.max(0, MAX_ARTIFACT_BYTES - t.artifactBytes));
		if (length > 0) {
			try {
				t.artifactBytes += length;
				if (!stream.write(bytes.subarray(0, length))) {
					t.artifactBlocked = true;
					pauseOutput(t);
					stream.once("drain", () => {
						t.artifactBlocked = false;
						if (t.artifactStream === stream) resumeOutput(t);
					});
				}
			} catch {
				failArtifact(t);
			}
		}
		if (bytes.length > length) {
			t.artifactStatus = "truncated";
			void finishArtifact(t);
		}
	}
	t.output.push(bytes);
	t.outputBytes += bytes.length;
	while (t.outputBytes > OUTPUT_CAP_BYTES) {
		const first = t.output[0];
		if (!first) break;
		const excess = t.outputBytes - OUTPUT_CAP_BYTES;
		if (first.length <= excess) {
			t.output.shift();
			t.outputBytes -= first.length;
		} else {
			t.output[0] = first.subarray(excess);
			t.outputBytes -= excess;
		}
	}
}

function outputText(t: Terminal): string {
	return Buffer.concat(t.output).toString();
}

export function truncateTerminalText(content: string, notice?: string): { text: string; truncated: boolean } {
	const suffix = notice ? `\n${notice}` : "";
	const truncation = truncateTail(content, {
		maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(suffix, "utf8")),
		maxLines: notice ? DEFAULT_MAX_LINES - 1 : DEFAULT_MAX_LINES,
	});
	return { text: truncation.content + (truncation.truncated ? suffix : ""), truncated: truncation.truncated };
}

function artifactNotice(t: Terminal): string | undefined {
	if (t.artifactStatus === "truncated")
		return `[Artifact truncated at ${formatSize(MAX_ARTIFACT_BYTES)}; not full output.]`;
	if (t.artifactStatus === "unavailable") return "[Artifact unavailable; not full output.]";
	return undefined;
}

function terminalOutput(t: Terminal, maxBytes = DEFAULT_MAX_BYTES): { text: string; truncated: boolean } {
	const artifact = artifactNotice(t);
	const outputNotice =
		t.artifactStatus === "available"
			? `[Output truncated at ${formatSize(maxBytes)}. Full output: ${t.artifactPath}]`
			: `[Output truncated at ${formatSize(maxBytes)}. ${artifact}]`;
	const reservedBytes =
		Buffer.byteLength(outputNotice, "utf8") + (artifact ? Buffer.byteLength(artifact, "utf8") + 1 : 0) + 1;
	const truncation = truncateTail(outputText(t) || "(no output)", {
		maxBytes: Math.max(0, Math.min(maxBytes, DEFAULT_MAX_BYTES) - reservedBytes),
		maxLines: DEFAULT_MAX_LINES - (artifact ? 2 : 1),
	});
	const notices = [truncation.truncated ? outputNotice : undefined, artifact].filter(
		(notice): notice is string => notice !== undefined,
	);
	return {
		text: truncation.content + (notices.length ? `\n${notices.join("\n")}` : ""),
		truncated: truncation.truncated,
	};
}

export function settledTerminalIdsToPrune(
	terminals: ReadonlyArray<{ id: string; status: TerminalStatus; startedAt: number; endedAt: number | undefined }>,
	maxTracked: number = MAX_TRACKED_TERMINALS,
): string[] {
	return terminals
		.filter((t) => t.status !== "running")
		.sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt) || a.id.localeCompare(b.id))
		.slice(0, Math.max(0, terminals.length - maxTracked))
		.map((t) => t.id);
}

/** Best-effort cleanup so retention never turns a failed removal into an extension failure. */
export async function removeTerminalArtifactDirectory(artifactDir: string | undefined): Promise<void> {
	if (!artifactDir) return;
	try {
		await fs.promises.rm(artifactDir, { recursive: true, force: true });
	} catch {}
}

// --- Extension -------------------------------------------------------------

export function setupShells(pi: ExtensionAPI, background: BackgroundHub) {
	const terminals = new Map<string, Terminal>();
	/** Terminals whose results should be delivered as follow-ups when idle. */
	const pending = new Map<string, Terminal>();
	let sessionCtx: ExtensionContext | undefined;

	// -- Status footer -------------------------------------------------------

	const updateStatus = () => {
		const all = [...terminals.values()];
		if (all.length === 0) {
			registerTransientSegment("terminals", null);
			return;
		}
		const running = all.filter((t) => t.status === "running").length;
		const failed = all.filter((t) => t.status === "error").length;
		const done = all.length - running - failed;
		const parts: string[] = [];
		if (running > 0) parts.push(`${running} running`);
		if (done > 0) parts.push(`${done} done`);
		if (failed > 0) parts.push(`${failed} failed`);
		const bg = failed > 0 ? "#e78284" : running > 0 ? "#81c8be" : "#a6d189";
		registerTransientSegment("terminals", { text: `$ ${parts.join(" · ")}`, bg, fg: "#1e2030" });
	};

	// -- Result delivery -----------------------------------------------------

	const deliverResult = (t: Terminal) => {
		const verb = t.status === "error" ? "failed" : "finished";
		const exitInfo = t.exitCode !== undefined ? ` (exit ${t.exitCode})` : "";
		const { text: body } = terminalOutput(t, FOLLOW_UP_BYTES);
		pi.sendMessage(
			{
				customType: "terminal-result",
				content: truncateTerminalText(`Background shell ${t.id} "${t.title}" ${verb}${exitInfo}\n\n${body}`).text,
				display: true,
				details: { id: t.id, title: t.title, status: t.status, exitCode: t.exitCode },
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	};

	const flushPending = () => {
		for (const t of pending.values()) deliverResult(t);
		pending.clear();
	};

	const listeners = new Set<() => void>();
	const notifyListeners = () => {
		for (const cb of listeners) cb();
	};

	const onSettled = (t: Terminal) => {
		updateStatus();
		notifyListeners();
		if (!sessionCtx) return;
		pending.set(t.id, { ...t }); // snapshot
		if (sessionCtx.isIdle()) flushPending();
	};

	// -- Spawn ---------------------------------------------------------------

	const closeArtifact = async (t: Terminal) => {
		await finishArtifact(t);
		t.abortCleanup?.();
		t.abortCleanup = undefined;
	};

	const settleTerminal = (
		t: Terminal,
		status: TerminalStatus,
		exitCode: number | undefined,
		deliver: boolean,
		notify: boolean,
	): Promise<void> => {
		if (t.settling) return t.settling;
		t.settling = (async () => {
			await closeArtifact(t);
			if (t.endedAt !== undefined) return;
			t.exitCode = exitCode;
			t.status = status;
			t.endedAt = Date.now();
			t.proc = undefined;
			if (deliver) onSettled(t);
			else if (notify) {
				notifyListeners();
				updateStatus();
			}
		})().finally(t.resolveSettled);
		return t.settling;
	};

	const removeArtifact = async (t: Terminal) => {
		if (t.killRequested) await t.settled;
		else if (t.settling) await t.settling;
		else await closeArtifact(t);
		await removeTerminalArtifactDirectory(t.artifactDir);
	};

	const pruneTerminals = () => {
		for (const id of settledTerminalIdsToPrune([...terminals.values()], MAX_TRACKED_TERMINALS - 1)) {
			const t = terminals.get(id);
			if (!t) continue;
			// Once untracked, no tool result can disclose this artifact path.
			terminals.delete(id);
			pending.delete(id);
			void removeArtifact(t);
		}
	};

	const spawnTerminal = async (
		opts: { command: string; title: string; cwd: string },
		signal?: AbortSignal,
	): Promise<Terminal> => {
		pruneTerminals();
		if ([...terminals.values()].filter((t) => t.status === "running").length >= MAX_RUNNING_TERMINALS)
			throw new Error(`Max ${MAX_RUNNING_TERMINALS} running terminals reached.`);
		if (terminals.size >= MAX_TRACKED_TERMINALS)
			throw new Error(`Max ${MAX_TRACKED_TERMINALS} tracked terminals reached.`);
		let artifactDir: string | undefined;
		let artifactPath: string | undefined;
		let artifactStream: fs.WriteStream | undefined;
		let artifactStatus: Terminal["artifactStatus"] = "available";
		try {
			artifactDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-terminal-"));
			await fs.promises.chmod(artifactDir, 0o700);
			artifactPath = path.join(artifactDir, "output.log");
			artifactStream = fs.createWriteStream(artifactPath, { flags: "w", mode: 0o600 });
			await new Promise<void>((resolve, reject) => {
				artifactStream?.once("open", () => resolve());
				artifactStream?.once("error", reject);
			});
		} catch {
			artifactStatus = "unavailable";
			artifactStream?.destroy();
			await removeTerminalArtifactDirectory(artifactDir);
			artifactDir = undefined;
			artifactPath = undefined;
			artifactStream = undefined;
		}
		let resolveSettled: () => void = () => undefined;
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve;
		});
		const t: Terminal = {
			id: nextId(),
			title: opts.title,
			command: opts.command,
			cwd: opts.cwd,
			status: "running",
			exitCode: undefined,
			output: [],
			outputBytes: 0,
			pid: undefined,
			startedAt: Date.now(),
			endedAt: undefined,
			proc: undefined,
			artifactDir,
			artifactPath,
			artifactStream,
			artifactFinalizing: undefined,
			artifactBlocked: false,
			settling: undefined,
			settled,
			resolveSettled,
			killRequested: false,
			killNotify: false,
			artifactBytes: 0,
			artifactStatus,
			abortCleanup: undefined,
		};
		if (artifactStream) artifactStream.on("error", () => failArtifact(t));
		terminals.set(t.id, t);
		updateStatus();
		const proc = child_process.spawn("bash", ["-c", opts.command], {
			cwd: opts.cwd,
			detached: process.platform !== "win32",
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		t.proc = proc;
		t.pid = proc.pid;

		proc.stdout.on("data", (chunk: Buffer) => appendOutput(t, chunk));
		proc.stderr.on("data", (chunk: Buffer) => appendOutput(t, chunk));

		const settle = (code: number | null, error?: Error) => {
			if (error) appendOutput(t, `\n[spawn error: ${error.message}]`);
			const killed = t.killRequested;
			void settleTerminal(
				t,
				killed || error || code !== 0 ? "error" : "done",
				killed ? undefined : (code ?? undefined),
				!killed,
				killed && t.killNotify,
			);
		};
		proc.on("close", (code: number | null) => settle(code));
		proc.on("error", (error: Error) => settle(null, error));

		const abort = () => killTerminal(t, true);
		if (signal?.aborted) abort();
		else if (signal) {
			signal.addEventListener("abort", abort, { once: true });
			t.abortCleanup = () => signal.removeEventListener("abort", abort);
		}
		return t;
	};

	const killTerminal = (t: Terminal, notify: boolean): boolean => {
		if (t.status !== "running" || t.settling || t.killRequested) return false;
		t.killRequested = true;
		t.killNotify = notify;
		pending.delete(t.id);
		appendOutput(t, "\n[process killed]\n");
		if (t.pid !== undefined) killProcessTree(t.pid);
		return true;
	};

	// -- Session lifecycle ---------------------------------------------------

	let unregisterProvider: (() => void) | undefined;

	pi.on("session_start", (_event, ctx) => {
		sessionCtx = ctx;
		unregisterProvider?.();
		unregisterProvider = background.registerProvider("terminals", {
			label: "Background Shells",
			list() {
				return [...terminals.values()]
					.filter((t) => t.status === "running")
					.map((t) => ({
						id: t.id,
						title: t.title,
						status: t.status,
						elapsed: () => elapsed(t),
						meta: () => {
							const cmd = t.command.length > 48 ? t.command.slice(0, 45) + "…" : t.command;
							return [cmd];
						},
					}));
			},
			subscribe(cb) {
				listeners.add(cb);
				return () => listeners.delete(cb);
			},
			async openDetail(id, ctx) {
				const t = terminals.get(id);
				if (!t) return;
				await ctx.ui.custom<null>(
					(tui, theme, keybindings, done) =>
						new TerminalOutputView(
							tui,
							theme,
							keybindings,
							id,
							() => terminals.get(id),
							() => {
								const terminal = terminals.get(id);
								if (terminal) killTerminal(terminal, true);
							},
							listeners,
							done,
						),
					{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
				);
			},
			kill(id) {
				const t = terminals.get(id);
				if (t) killTerminal(t, true);
			},
		});
	});

	pi.on("agent_settled", flushPending);

	pi.on("session_shutdown", async () => {
		sessionCtx = undefined;
		pending.clear();
		unregisterProvider?.();
		unregisterProvider = undefined;
		listeners.clear();
		const tracked = [...terminals.values()];
		for (const t of tracked) killTerminal(t, false);
		terminals.clear();
		await Promise.all(tracked.map(removeArtifact));
		registerTransientSegment("terminals", null);
	});

	// -- Tools ---------------------------------------------------------------

	pi.registerTool({
		name: "background_shell_run",
		label: "Run Background Shell",
		description:
			"Run a shell command expected to keep running, such as a dev server. Use the bash tool for commands that finish on their own. " +
			"Returns immediately with a background shell ID. Use background_shell_check to peek at live output.",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to execute" }),
			title: Type.String({ description: "Short human-readable label for this terminal, shown in listings" }),
			working_dir: Type.Optional(Type.String({ description: "Working directory (default: current directory)" })),
		}),
		renderCall(args, theme) {
			const lines = [
				theme.fg("toolTitle", "background_shell_run") + (args.title ? " " + theme.fg("dim", args.title) : ""),
				...(args.command ? [theme.fg("text", `$ ${args.command}`)] : []),
				...(args.working_dir ? [theme.fg("muted", `cwd: ${args.working_dir}`)] : []),
			];
			return new Text(lines.join("\n"), 0, 0);
		},
		async execute(_id, params, signal, _onUpdate, ctx) {
			const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
			try {
				if (!(await fs.promises.stat(cwd)).isDirectory()) throw new Error();
			} catch {
				throw new Error(`working_dir is not a directory: ${cwd}`);
			}
			const title = params.title.trim().slice(0, 160) || "terminal";
			if (signal?.aborted) throw new Error("Terminal run aborted.");
			const t = await spawnTerminal({ command: params.command, title, cwd }, signal);
			return {
				content: [
					{
						type: "text",
						text: truncateTerminalText(
							`Started background shell ${t.id} "${t.title}" (pid ${t.pid ?? "?"}) in ${cwd}${artifactNotice(t) ? `\n${artifactNotice(t)}` : ""}`,
						).text,
					},
				],
				details: { id: t.id, title: t.title, pid: t.pid, cwd, artifactStatus: t.artifactStatus },
			};
		},
	});

	pi.registerTool({
		name: "background_shell_cancel",
		label: "Cancel Background Shells",
		description: "Kill one or more running background shells.",
		parameters: Type.Object({
			ids: Type.Array(Type.String(), {
				description: 'Terminal IDs to cancel, e.g. ["tr-1", "tr-2"]',
				maxItems: 64,
			}),
		}),
		async execute(_id, params) {
			const ids = [...new Set(params.ids)];
			if (ids.length === 0) throw new Error("Provide at least one terminal id.");
			const unknown = ids.filter((id) => !terminals.has(id));
			if (unknown.length > 0) {
				const known = [...terminals.keys()];
				throw new Error(`Unknown background shell id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`);
			}
			const lines: string[] = [];
			const killed: Terminal[] = [];
			for (const id of ids) {
				const t = terminals.get(id);
				if (!t) continue;
				if (killTerminal(t, false)) {
					killed.push(t);
					lines.push(`Killed ${id} "${t.title}".${artifactNotice(t) ? ` ${artifactNotice(t)}` : ""}`);
				} else {
					lines.push(`${id} "${t.title}" was already ${t.status}.`);
				}
			}
			await Promise.all(killed.map((terminal) => terminal.settled));
			updateStatus();
			notifyListeners();
			return {
				content: [{ type: "text", text: truncateTerminalText(lines.join("\n")).text }],
				details: { ids },
			};
		},
	});

	pi.registerTool({
		name: "background_shell_check",
		label: "Check Background Shell",
		description: "Peek at a background shell's current status and recent output without blocking.",
		parameters: Type.Object({
			id: Type.String({ description: "Terminal ID to check" }),
		}),
		async execute(_callId, params) {
			const t = terminals.get(params.id);
			if (!t) {
				const known = [...terminals.keys()];
				throw new Error(`Unknown background shell id "${params.id}". Known: ${known.join(", ") || "none"}.`);
			}
			let text = `${describe(t)}\nCommand: ${t.command}`;
			if (t.exitCode !== undefined) text += `\nExit code: ${t.exitCode}`;
			const { text: preview } = terminalOutput(t, CHECK_PREVIEW_BYTES);
			text += preview ? `\n\nRecent output:\n${preview}` : "\n\n(no output yet)";
			return {
				content: [
					{
						type: "text",
						text: truncateTerminalText(text, "[Response truncated. See artifact status above.]").text,
					},
				],
				details: { id: t.id, status: t.status, exitCode: t.exitCode, artifactStatus: t.artifactStatus },
			};
		},
	});

	pi.registerTool({
		name: "background_shell_list",
		label: "List Background Shells",
		description: "List all background shells and their current status.",
		parameters: Type.Object({}),
		async execute() {
			const all = [...terminals.values()];
			const text = all.length === 0 ? "No background shells." : all.map(describe).join("\n");
			return {
				content: [{ type: "text", text: truncateTerminalText(text).text }],
				details: {
					terminals: all.map((t) => ({ id: t.id, title: t.title, status: t.status, artifactStatus: t.artifactStatus })),
				},
			};
		},
	});

	// -- Detail view ---------------------------------------------------------
}

// --- TerminalOutputView -----------------------------------------------------

const SCROLL_STEP = 6;

// Strip ANSI codes and problematic control characters for clean TUI rendering.
const ANSI_RE =
	/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;
function sanitize(text: string): string {
	return text
		.replace(ANSI_RE, "")
		.replaceAll("\t", "  ")
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

class TerminalOutputView implements Component, Focusable {
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private id: string;
	private getTerminal: () => Terminal | undefined;
	private killTerminal: () => void;
	private done: (value: null) => void;

	private scrollOffset = 0;
	private unsubscribe: () => void;
	private ticker: ReturnType<typeof setInterval>;
	private renderTimer: ReturnType<typeof setTimeout> | undefined;
	private closed = false;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
	}

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		id: string,
		getTerminal: () => Terminal | undefined,
		killTerminal: () => void,
		listeners: Set<() => void>,
		done: (value: null) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.id = id;
		this.getTerminal = getTerminal;
		this.killTerminal = killTerminal;
		this.done = done;
		const scheduleRender = () => this.scheduleRender();
		listeners.add(scheduleRender);
		this.unsubscribe = () => listeners.delete(scheduleRender);
		// Poll at 200 ms so live output stays fresh.
		this.ticker = setInterval(() => this.tui.requestRender(), 200);
	}

	private scheduleRender() {
		if (this.renderTimer) return;
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			if (!this.closed) this.tui.requestRender();
		}, 50);
	}

	private cleanup() {
		if (this.closed) return false;
		this.closed = true;
		this.unsubscribe();
		clearInterval(this.ticker);
		if (this.renderTimer) clearTimeout(this.renderTimer);
		return true;
	}

	private close() {
		if (this.cleanup()) this.done(null);
	}

	dispose(): void {
		this.cleanup();
	}

	private viewportHeight(): number {
		// 8 chrome rows: top border, header, command, content border, content border, hints, bottom border, +1 overlap
		return Math.max(6, (this.tui.terminal.rows || 30) - 8);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.interrupt") || this.keybindings.matches(data, "tui.select.cancel")) {
			this.close();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.cursorUp")) {
			this.scrollOffset += SCROLL_STEP;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.cursorDown")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - SCROLL_STEP);
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.pageUp")) {
			this.scrollOffset += this.viewportHeight();
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.pageDown")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight());
			this.tui.requestRender();
			return;
		}
		if (data === "x" && this.getTerminal()?.status === "running") this.killTerminal();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
		const t = this.getTerminal();
		const lines: string[] = [];
		lines.push(border);

		if (!t) {
			lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
			lines.push(border);
			return lines;
		}

		const glyph =
			t.status === "running"
				? theme.fg("warning", "■")
				: t.status === "done"
					? theme.fg("success", "■")
					: theme.fg("error", "■");
		const exitInfo = t.exitCode !== undefined ? ` · exit ${t.exitCode}` : "";
		lines.push(
			truncateToWidth(
				`${glyph} ${theme.fg("accent", theme.bold(`${t.id} · ${t.title}`))}${theme.fg("muted", ` · ${t.status} · ${elapsed(t)}${exitInfo}`)}`,
				width,
			),
		);
		lines.push(truncateToWidth(theme.fg("dim", `  $ ${t.command}`), width));
		lines.push(border);

		const viewport = this.viewportHeight();
		const rawLines = sanitize(outputText(t) || "(no output)").split("\n");
		const maxOffset = Math.max(0, rawLines.length - viewport);
		if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

		const end = rawLines.length - this.scrollOffset;
		const visible = rawLines.slice(Math.max(0, end - viewport), end);
		for (const line of visible) lines.push(truncateToWidth(line, width));
		// Pad to fixed height so overlay height stays stable.
		while (lines.length < 4 + viewport) lines.push("");

		if (this.scrollOffset > 0) {
			lines[lines.length - 1] = truncateToWidth(
				theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`),
				width,
			);
		}

		lines.push(border);
		lines.push(truncateToWidth(theme.fg("dim", `  esc/ctrl-c back · x kill · ↑/↓ scroll · pgup/pgdn page`), width));
		lines.push(border);
		return lines;
	}

	invalidate(): void {}
}
