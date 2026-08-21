// Run user `!` / `!!` commands with zsh aliases and escalate cancellation
// signals for both user commands and the agent's `bash` tool. Repeated Escape presses use
// SIGINT, SIGTERM, SIGKILL; timeouts use SIGINT, SIGQUIT, SIGKILL at 5s intervals.

import {
	createBashToolDefinition,
	getShellConfig,
	type BashOperations,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { killProcessTree } from "./shared/process-tree.ts";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
const TIMEOUT_ESCALATION_DELAY_MS = 5_000;
const ZSH_ALIAS_INIT = '[[ ! -r "$HOME/.zsh_aliases" ]] || source "$HOME/.zsh_aliases"';

function withZshAliases(command: string): string {
	const quotedCommand = `'${command.replaceAll("'", "'\\''")}'`;
	return `${ZSH_ALIAS_INIT}; eval -- ${quotedCommand}`;
}

interface EscapeEscalationRequest {
	handled: boolean;
}

interface RunningProcess {
	child: ChildProcess;
	nextSignal: number;
}

function resolveZshPath(): string | undefined {
	const candidates = [
		process.env.SHELL?.endsWith("/zsh") ? process.env.SHELL : undefined,
		"/bin/zsh",
		"/usr/bin/zsh",
		"/opt/homebrew/bin/zsh",
		"/usr/local/bin/zsh",
	].filter((path): path is string => Boolean(path));
	return candidates.find((path) => existsSync(path));
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
	if (signal === "SIGKILL") {
		killProcessTree(pid);
		return;
	}
	if (process.platform === "win32") return;

	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// The process already exited.
		}
	}
}
function waitForChild(child: ChildProcess): Promise<number | null> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let idleTimer: NodeJS.Timeout | undefined;
		let exitCode: number | null = null;

		const cleanup = () => {
			if (idleTimer) clearTimeout(idleTimer);
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			child.stdout?.removeListener("data", onData);
			child.stderr?.removeListener("data", onData);
		};
		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolve(code);
		};
		const armIdleTimer = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => finish(exitCode), 100);
		};
		const onData = () => {
			if (exitCode !== null) armIdleTimer();
		};
		const onError = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			exitCode = code;
			armIdleTimer();
		};
		const onClose = (code: number | null) => finish(code);

		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.once("error", onError);
		child.once("exit", onExit);
		child.once("close", onClose);
	});
}

function createEscalatingOperations(
	running: Set<RunningProcess>,
	shellPath?: string,
	loadZshAliases = false,
): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			if (signal?.aborted) throw new Error("aborted");

			const shell = getShellConfig(shellPath);
			const commandFromStdin = shell.commandTransport === "stdin";
			const args = loadZshAliases
				? ["-c", withZshAliases(command)]
				: commandFromStdin
					? shell.args
					: [...shell.args, command];
			const child = spawn(shell.shell, args, {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? process.env,
				stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});

			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);

			const tracked = child.pid ? { child, nextSignal: 0 } : undefined;
			if (tracked) running.add(tracked);
			let timedOut = false;
			const timeoutHandles: NodeJS.Timeout[] = [];

			const sendNextSignal = () => {
				if (!tracked?.child.pid) return;
				const index = Math.min(tracked.nextSignal, SIGNALS.length - 1);
				const nextSignal = SIGNALS[index];
				if (!nextSignal) return;
				signalProcessTree(tracked.child.pid, nextSignal);
				tracked.nextSignal = Math.min(index + 1, SIGNALS.length);
			};
			const onAbort = () => sendNextSignal();

			try {
				if (timeout !== undefined) {
					const timeoutMs = timeout * 1000;
					timeoutHandles.push(
						setTimeout(() => {
							timedOut = true;
							if (tracked?.child.pid) {
								signalProcessTree(tracked.child.pid, "SIGINT");
								tracked.nextSignal = Math.max(tracked.nextSignal, 1);
							}
						}, timeoutMs),
						setTimeout(() => {
							if (tracked?.child.pid) {
								signalProcessTree(tracked.child.pid, "SIGQUIT");
								tracked.nextSignal = Math.max(tracked.nextSignal, 2);
							}
						}, timeoutMs + TIMEOUT_ESCALATION_DELAY_MS),
						setTimeout(
							() => {
								if (tracked?.child.pid) {
									signalProcessTree(tracked.child.pid, "SIGKILL");
									tracked.nextSignal = SIGNALS.length;
								}
							},
							timeoutMs + TIMEOUT_ESCALATION_DELAY_MS * 2,
						),
					);
				}

				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}

				const exitCode = await waitForChild(child);
				if (signal?.aborted) throw new Error("aborted");
				if (timedOut) throw new Error(`timeout:${timeout}`);
				return { exitCode };
			} finally {
				if (tracked) running.delete(tracked);
				for (const timeoutHandle of timeoutHandles) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export default function (pi: ExtensionAPI): void {
	const running = new Set<RunningProcess>();
	const agentOperations = createEscalatingOperations(running);
	const userOperations = createEscalatingOperations(running, resolveZshPath(), true);

	const unsubscribe = pi.events.on("shell-signal-escalation:escape", (data) => {
		const request = data as EscapeEscalationRequest;
		const started = [...running].filter((process) => process.nextSignal > 0);
		if (started.length === 0) return;

		request.handled = true;
		for (const process of running) {
			if (!process.child.pid) continue;
			const index = Math.min(process.nextSignal, SIGNALS.length - 1);
			const nextSignal = SIGNALS[index];
			if (!nextSignal) continue;
			signalProcessTree(process.child.pid, nextSignal);
			process.nextSignal = Math.min(index + 1, SIGNALS.length);
		}
	});

	pi.on("session_start", (_event, ctx) => {
		pi.registerTool(createBashToolDefinition(ctx.cwd, { operations: agentOperations }));
	});

	pi.on("user_bash", () => ({ operations: userOperations }));

	pi.on("session_shutdown", () => {
		unsubscribe();
		for (const process of running) {
			if (process.child.pid) signalProcessTree(process.child.pid, "SIGKILL");
		}
		running.clear();
	});
}
