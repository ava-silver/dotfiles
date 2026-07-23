// Run user `!` / `!!` commands with zsh and escalate repeated Escape presses
// for both user commands and the agent's `bash` tool: SIGINT, SIGTERM, SIGKILL.

import {
	createBashToolDefinition,
	getShellConfig,
	type BashOperations,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
type EscalationSignal = (typeof SIGNALS)[number];

interface EscapeEscalationRequest {
	handled: boolean;
}

interface RunningProcess {
	child: ChildProcess;
	nextSignal: number;
}

function resolveZshPath(): string | undefined {
	const candidates = [
		process.env.SHELL && /\/zsh$/.test(process.env.SHELL) ? process.env.SHELL : undefined,
		"/bin/zsh",
		"/usr/bin/zsh",
		"/opt/homebrew/bin/zsh",
		"/usr/local/bin/zsh",
	].filter((path): path is string => Boolean(path));
	return candidates.find((path) => existsSync(path));
}

function signalProcessTree(pid: number, signal: EscalationSignal): void {
	if (process.platform === "win32") {
		if (signal === "SIGKILL") {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				windowsHide: true,
			});
		}
		return;
	}

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
): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			if (signal?.aborted) throw new Error("aborted");

			const shell = getShellConfig(shellPath);
			const commandFromStdin = shell.commandTransport === "stdin";
			const child = spawn(
				shell.shell,
				commandFromStdin ? shell.args : [...shell.args, command],
				{
					cwd,
					detached: process.platform !== "win32",
					env: env ?? process.env,
					stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
					windowsHide: true,
				},
			);

			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);

			const tracked = child.pid ? { child, nextSignal: 0 } : undefined;
			if (tracked) running.add(tracked);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;

			const sendNextSignal = () => {
				if (!tracked?.child.pid) return;
				const index = Math.min(tracked.nextSignal, SIGNALS.length - 1);
				signalProcessTree(tracked.child.pid, SIGNALS[index]);
				tracked.nextSignal = Math.min(index + 1, SIGNALS.length);
			};
			const onAbort = () => sendNextSignal();

			try {
				if (timeout !== undefined) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (tracked?.child.pid) {
							signalProcessTree(tracked.child.pid, "SIGKILL");
							tracked.nextSignal = SIGNALS.length;
						}
					}, timeout * 1000);
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
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export default function (pi: ExtensionAPI): void {
	const running = new Set<RunningProcess>();
	const agentOperations = createEscalatingOperations(running);
	const userOperations = createEscalatingOperations(running, resolveZshPath());

	const unsubscribe = pi.events.on("shell-signal-escalation:escape", (data) => {
		const request = data as EscapeEscalationRequest;
		const started = [...running].filter((process) => process.nextSignal > 0);
		if (started.length === 0) return;

		request.handled = true;
		for (const process of running) {
			if (!process.child.pid) continue;
			const index = Math.min(process.nextSignal, SIGNALS.length - 1);
			signalProcessTree(process.child.pid, SIGNALS[index]);
			process.nextSignal = Math.min(index + 1, SIGNALS.length);
		}
	});

	pi.on("session_start", (_event, ctx) => {
		pi.registerTool(
			createBashToolDefinition(ctx.cwd, { operations: agentOperations }),
		);
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
