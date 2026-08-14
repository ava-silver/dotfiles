import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import {
	MAX_ARTIFACT_BYTES,
	removeTerminalArtifactDirectory,
	settledTerminalIdsToPrune,
	truncateTerminalText,
	writeArtifactChunk,
} from "./shells.ts";

test("artifact writes stop at their quota", () => {
	const writes: Buffer[] = [];
	const result = writeArtifactChunk(1, Buffer.from("abcdef"), 4, (_fd, buffer, offset, length) => {
		writes.push(Buffer.from(buffer.subarray(offset, offset + length)));
		return length;
	});

	assert.deepEqual(result, { written: 4, truncated: true, failed: false });
	assert.equal(Buffer.concat(writes).toString(), "abcd");
	assert.equal(MAX_ARTIFACT_BYTES, 10 * 1024 * 1024);
});

test("artifact write failures are contained", () => {
	const result = writeArtifactChunk(1, Buffer.from("output"), 10, () => {
		throw new Error("disk full");
	});

	assert.deepEqual(result, { written: 0, truncated: false, failed: true });
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

test("pruning removes a settled terminal's private artifact directory", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const artifactDir = path.join(root, "artifact");
	fs.mkdirSync(artifactDir);
	fs.writeFileSync(path.join(artifactDir, "output.log"), "output");

	removeTerminalArtifactDirectory(artifactDir);

	assert.equal(fs.existsSync(artifactDir), false);
	assert.equal(fs.existsSync(root), true);
});

test("shutdown artifact cleanup is idempotent", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const artifactDirs = ["first", "second"].map((name) => path.join(root, name));
	for (const artifactDir of artifactDirs) {
		fs.mkdirSync(artifactDir);
		fs.writeFileSync(path.join(artifactDir, "output.log"), "output");
	}

	for (const artifactDir of artifactDirs) removeTerminalArtifactDirectory(artifactDir);
	for (const artifactDir of artifactDirs) removeTerminalArtifactDirectory(artifactDir);

	assert.deepEqual(fs.readdirSync(root), []);
});
