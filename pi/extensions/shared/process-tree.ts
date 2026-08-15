import { spawn } from "node:child_process";

/** Force-kill a process and all descendants in its process group. */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		const taskkill = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
			stdio: "ignore",
			windowsHide: true,
		});
		// Process teardown is best-effort; a missing taskkill must not crash Pi.
		taskkill.on("error", () => {});
		taskkill.unref();
		return;
	}

	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// The process already exited.
		}
	}
}
