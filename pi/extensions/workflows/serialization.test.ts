import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { safeStringify, writeFileAtomic } from "./serialization.ts";

test("safeStringify handles cycles, bigint, depth, and size", () => {
	const value: Record<string, unknown> = {
		bigint: 42n,
		nested: { deeper: { deepest: true } },
		large: "x".repeat(20_000),
	};
	value.self = value;

	const text = safeStringify(value, {
		maxBytes: 2_048,
		maxDepth: 2,
		maxStringBytes: 512,
	});
	assert.ok(Buffer.byteLength(text, "utf8") <= 2_048);
	const parsed: unknown = JSON.parse(text);
	assert.ok(parsed && typeof parsed === "object");
	assert.match(text, /42n/);
	assert.match(text, /circular/);
	assert.match(text, /truncated/);
});

test("atomic writes leave complete readable content with secure mode", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-workflow-test-"));
	try {
		const file = join(directory, "artifact.json");
		await writeFileAtomic(file, '{"value":1}');
		await writeFileAtomic(file, '{"value":2}');
		assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { value: 2 });
		assert.equal(statSync(file).mode & 0o777, 0o600);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("atomic writes clean up temporary files after a failed rename", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-workflow-test-"));
	try {
		const target = join(directory, "target");
		mkdirSync(target);
		await assert.rejects(writeFileAtomic(target, "content"));
		assert.equal(
			readdirSync(directory).some((name) => name.endsWith(".tmp")),
			false,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
