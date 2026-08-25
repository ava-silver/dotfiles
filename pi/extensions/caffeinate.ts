import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function caffeinateExtension(pi: ExtensionAPI): void {
	let caffeinate: ChildProcess | undefined;

	const start = (): void => {
		if (caffeinate) return;
		caffeinate = spawn("caffeinate", ["-d"], { stdio: "ignore" });
		caffeinate.once("exit", () => {
			caffeinate = undefined;
		});
	};

	const stop = (): void => {
		caffeinate?.kill();
		caffeinate = undefined;
	};

	pi.on("agent_start", start);
	pi.on("agent_settled", stop);
	pi.on("session_shutdown", stop);
}
