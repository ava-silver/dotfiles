import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("proxy exits on SIGTERM while stdin is idle", async () => {
	const child = spawn(
		process.execPath,
		["--experimental-strip-types", fileURLToPath(new URL("./proxy.ts", import.meta.url))],
		{
			stdio: ["pipe", "ignore", "pipe"],
			env: { ...process.env, PI_SLACK_MCP_PROXY_READY: "1" },
		},
	);
	await once(child.stderr!, "data");
	assert.equal(child.exitCode, null);
	child.kill("SIGTERM");

	const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
	assert.equal(signal, null);
	assert.equal(code, 0);
});
