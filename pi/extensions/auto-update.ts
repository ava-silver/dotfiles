import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerTransientSegment } from "./shared/footer-segments.ts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

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

	function clearStatus(_ctx: ExtensionContext): void {
		registerTransientSegment("auto-update", null);
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
			registerTransientSegment("auto-update", {
				text: "packages updating…",
				bg: "#414559",
				fg: "#838ba7",
			});
		}

		const extensionsDir = import.meta.dirname;

		const script = `
status=failure
result=$3
log=$4
lock=$5
extensions_dir=$6
finish() {
  printf '%s\\n' "$status" > "$result.tmp.$$"
  mv "$result.tmp.$$" "$result"
  rm -f "$lock"
}
trap finish EXIT HUP INT TERM
if "$1" "$2" update --all >> "$log" 2>&1; then
  status=success
  pi_pkg="$(dirname "$(dirname "$2")")/package.json"
  new_version=$(jq -r .version "$pi_pkg" 2>>"$log")
  if [ -n "$new_version" ] && [ -f "$extensions_dir/package.json" ]; then
    tmp=$(mktemp)
    jq --arg v "$new_version" '
      .devDependencies["@earendil-works/pi-coding-agent"] = $v |
      .devDependencies["@earendil-works/pi-ai"] = $v |
      .devDependencies["@earendil-works/pi-tui"] = $v
    ' "$extensions_dir/package.json" > "$tmp" && mv "$tmp" "$extensions_dir/package.json"
    (cd "$extensions_dir" && bun install) >> "$log" 2>&1 || true
  fi
fi
`;

		const piEntrypoint = process.argv[1];
		if (!piEntrypoint) {
			remove(lockPath);
			return;
		}
		const child = spawn(
			"/bin/sh",
			["-c", script, "pi-auto-update", process.execPath, piEntrypoint, resultPath, logPath, lockPath, extensionsDir],
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
				ctx.ui.notify("Pi update finished -- changes apply next launch.", "info");
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
