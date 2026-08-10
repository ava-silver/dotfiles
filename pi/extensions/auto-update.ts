import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const STATUS_KEY = "auto-update";

function isRecent(path: string): boolean {
	try {
		return Date.now() - statSync(path).mtimeMs < CHECK_INTERVAL_MS;
	} catch {
		return false;
	}
}

function remove(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Missing files are fine.
	}
}

function offline(): boolean {
	return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
}

export default function autoUpdateExtension(pi: ExtensionAPI): void {
	let resultTimer: ReturnType<typeof setInterval> | undefined;

	function clearStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" || offline()) return;

		const stateDir = join(getAgentDir(), "auto-update");
		const attemptPath = join(stateDir, "last-attempt");
		const lockPath = join(stateDir, "update.lock");
		const resultPath = join(stateDir, "result");
		const logPath = join(stateDir, "update.log");
		mkdirSync(stateDir, { recursive: true });

		if (isRecent(attemptPath)) return;
		if (isRecent(lockPath)) return;
		remove(lockPath);

		let lockFd: number;
		try {
			lockFd = openSync(lockPath, "wx");
		} catch {
			return;
		}

		if (isRecent(attemptPath)) {
			closeSync(lockFd);
			remove(lockPath);
			return;
		}

		writeFileSync(lockFd, `${process.pid}\n`);
		closeSync(lockFd);
		writeFileSync(attemptPath, `${new Date().toISOString()}\n`);
		remove(resultPath);

		if (ctx.mode === "tui") {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "Pi update checking…"));
		}

		const script = `
status=failure
result=$3
log=$4
lock=$5
finish() {
  printf '%s\\n' "$status" > "$result.tmp.$$"
  mv "$result.tmp.$$" "$result"
  rm -f "$lock"
}
trap finish EXIT HUP INT TERM
if "$1" "$2" update --all >> "$log" 2>&1; then
  status=success
fi
`;

		const child = spawn(
			"/bin/sh",
			["-c", script, "pi-auto-update", process.execPath, process.argv[1], resultPath, logPath, lockPath],
			{ detached: true, stdio: "ignore" },
		);
		child.once("error", () => {
			remove(lockPath);
			if (ctx.mode === "tui") {
				clearStatus(ctx);
				ctx.ui.notify(`Pi update could not start. See ${logPath}`, "warning");
			}
		});
		child.unref();

		if (ctx.mode !== "tui") return;
		resultTimer = setInterval(() => {
			let result: string;
			try {
				result = readFileSync(resultPath, "utf8").trim();
			} catch {
				return;
			}

			if (resultTimer) clearInterval(resultTimer);
			resultTimer = undefined;
			clearStatus(ctx);
			if (result === "success") {
				ctx.ui.notify("Pi update check finished -- updates apply next launch.", "info");
			} else {
				ctx.ui.notify(`Pi update failed. See ${logPath}`, "warning");
			}
		}, 1_000);
		resultTimer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (resultTimer) clearInterval(resultTimer);
		resultTimer = undefined;
		clearStatus(ctx);
	});
}
