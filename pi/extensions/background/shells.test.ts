import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundHub } from "./src/hub.ts";
import {
	MAX_ARTIFACT_BYTES,
	removeTerminalArtifactDirectory,
	setupShells,
	settledTerminalIdsToPrune,
	truncateTerminalText,
} from "./shells.ts";

type ToolResult = { content: Array<{ text: string }>; details: { id?: string; status?: string } };
type Tool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function shellTools() {
	const tools = new Map<string, Tool>();
	const pi = {
		on: () => undefined,
		registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
		sendMessage: () => undefined,
	} as unknown as ExtensionAPI;
	setupShells(pi, { registerProvider: () => () => undefined } as unknown as BackgroundHub);
	return {
		run: tools.get("background_shell_run")!,
		cancel: tools.get("background_shell_cancel")!,
		check: tools.get("background_shell_check")!,
	};
}

function artifactPath(result: ToolResult | undefined): string | undefined {
	return /Full output: (.+)]/.exec(result?.content[0]?.text ?? "")?.[1];
}

test("artifact quota remains 10 MB", () => {
	assert.equal(MAX_ARTIFACT_BYTES, 10 * 1024 * 1024);
});

test("stream artifacts finalize before a settled shell is reported", async () => {
	const { run, check } = shellTools();
	const cwd = process.cwd();
	const started = await run.execute(
		"test",
		{ command: "head -c 65536 /dev/zero | tr '\\0' x", title: "output", working_dir: cwd },
		undefined,
		undefined,
		{
			cwd,
		},
	);
	assert.ok(started.details.id);

	let result: ToolResult | undefined;
	for (let attempt = 0; attempt < 40; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		result = await check.execute("test", { id: started.details.id });
		if (result.details.status !== "running") break;
	}
	assert.equal(result?.details.status, "done");
	const outputPath = artifactPath(result);
	assert.ok(outputPath);
	const artifact = await fs.promises.readFile(outputPath);
	assert.equal(artifact.length, 65536);
	assert.equal((await fs.promises.stat(outputPath)).mode & 0o777, 0o600);
	assert.equal((await fs.promises.stat(path.dirname(outputPath))).mode & 0o777, 0o700);
	await removeTerminalArtifactDirectory(path.dirname(outputPath));
});

test("cancelling waits for buffered artifact output", async () => {
	const { run, cancel, check } = shellTools();
	const cwd = process.cwd();
	const started = await run.execute(
		"test",
		{ command: "head -c 65536 /dev/zero | tr '\\0' x; sleep 5", title: "cancel", working_dir: cwd },
		undefined,
		undefined,
		{ cwd },
	);
	assert.ok(started.details.id);

	let running: ToolResult | undefined;
	for (let attempt = 0; attempt < 40; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		running = await check.execute("test", { id: started.details.id });
		if (artifactPath(running)) break;
	}
	const outputPath = artifactPath(running);
	assert.ok(outputPath);

	await cancel.execute("test", { ids: [started.details.id] });
	const settled = await check.execute("test", { id: started.details.id });
	assert.equal(settled.details.status, "error");
	assert.ok((await fs.promises.readFile(outputPath)).length >= 65536);
	await removeTerminalArtifactDirectory(path.dirname(outputPath));
});

test("terminal text truncation reserves room for its artifact notice", () => {
	const { text, truncated } = truncateTerminalText(
		"line\n".repeat(DEFAULT_MAX_LINES + 1),
		"[Full output: /tmp/output]",
	);

	assert.equal(truncated, true);
	assert.ok(Buffer.byteLength(text) <= DEFAULT_MAX_BYTES);
	assert.ok(text.split("\n").length <= DEFAULT_MAX_LINES);
	assert.match(text, /Full output/);
});

test("settled terminal pruning is oldest-first and never prunes running terminals", () => {
	const ids = settledTerminalIdsToPrune(
		[
			{ id: "tr-2", status: "done", startedAt: 1, endedAt: 2 },
			{ id: "tr-1", status: "error", startedAt: 1, endedAt: 2 },
			{ id: "tr-3", status: "running", startedAt: 0, endedAt: undefined },
			{ id: "tr-4", status: "done", startedAt: 1, endedAt: 4 },
		],
		2,
	);

	assert.deepEqual(ids, ["tr-1", "tr-2"]);
});

test("pruning removes a settled terminal's private artifact directory", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const artifactDir = path.join(root, "artifact");
	fs.mkdirSync(artifactDir);
	fs.writeFileSync(path.join(artifactDir, "output.log"), "output");

	await removeTerminalArtifactDirectory(artifactDir);

	assert.equal(fs.existsSync(artifactDir), false);
	assert.equal(fs.existsSync(root), true);
});

test("shutdown artifact cleanup is idempotent", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const artifactDirs = ["first", "second"].map((name) => path.join(root, name));
	for (const artifactDir of artifactDirs) {
		fs.mkdirSync(artifactDir);
		fs.writeFileSync(path.join(artifactDir, "output.log"), "output");
	}

	await Promise.all(artifactDirs.map(removeTerminalArtifactDirectory));
	await Promise.all(artifactDirs.map(removeTerminalArtifactDirectory));

	assert.deepEqual(fs.readdirSync(root), []);
});
